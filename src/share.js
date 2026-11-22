function bytesToBase64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(b64url) {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return base64ToBytes(b64);
}

export async function createShareLink({
  title,
  elements,
  appState,
  files,
  ttl = 7776000,
}) {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 128 },
    true,
    ["encrypt", "decrypt"]
  );
  const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const payload = JSON.stringify({
    v: 1,
    title: title || "Untitled",
    elements: elements || [],
    appState: appState || {},
    files: files || {},
  });

  const encoded = new TextEncoder().encode(payload);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded
  );

  const res = await fetch("/api/share", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      v: 1,
      iv: bytesToBase64(iv),
      data: bytesToBase64(new Uint8Array(cipherBuf)),
      ttl,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.id) {
    throw new Error(body.error || `Share failed (HTTP ${res.status})`);
  }

  const keyStr = bytesToBase64Url(rawKey);
  return `${window.location.origin}/share/${body.id}#key=${keyStr}`;
}

export async function loadSharedBoard(id, hash) {
  const params = new URLSearchParams((hash || "").replace(/^#/, ""));
  const keyStr = params.get("key");
  if (!keyStr) {
    throw new Error("Missing decryption key in link.");
  }

  let rawKey;
  try {
    rawKey = base64UrlToBytes(keyStr);
  } catch {
    throw new Error("Invalid decryption key.");
  }

  const res = await fetch(`/api/share/${encodeURIComponent(id)}`);
  if (res.status === 404) {
    throw new Error("This shared link does not exist or has expired.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to load share (HTTP ${res.status})`);
  }

  const record = await res.json();
  const key = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  let plainBuf;
  try {
    plainBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(record.iv) },
      key,
      base64ToBytes(record.data)
    );
  } catch {
    throw new Error("Decryption failed — the link key may be incorrect.");
  }

  const decoded = new TextDecoder().decode(plainBuf);
  const parsed = JSON.parse(decoded);
  return {
    title: parsed.title || "Shared Board",
    elements: Array.isArray(parsed.elements) ? parsed.elements : [],
    appState: parsed.appState || {},
    files: parsed.files && typeof parsed.files === "object" ? parsed.files : {},
    createdAt: record.createdAt || null,
  };
}
