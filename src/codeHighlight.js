export const CODE_LANGUAGES = [
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "python", label: "Python" },
  { id: "java", label: "Java" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
  { id: "cpp", label: "C++" },
  { id: "c", label: "C" },
  { id: "sql", label: "SQL" },
  { id: "bash", label: "Bash" },
  { id: "json", label: "JSON" },
  { id: "html", label: "HTML" },
  { id: "css", label: "CSS" },
  { id: "yaml", label: "YAML" },
  { id: "markdown", label: "Markdown" },
  { id: "text", label: "Plain Text" },
];

const LANG_ALIASES = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  javascript: "javascript",
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
  py: "python",
  python: "python",
  python3: "python",
  java: "java",
  kt: "java",
  kotlin: "java",
  go: "go",
  golang: "go",
  rs: "rust",
  rust: "rust",
  cpp: "cpp",
  "c++": "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "cpp",
  csharp: "cpp",
  c: "c",
  h: "c",
  sql: "sql",
  mysql: "sql",
  postgres: "sql",
  postgresql: "sql",
  sqlite: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  shell: "bash",
  json: "json",
  jsonc: "json",
  html: "html",
  htm: "html",
  xml: "html",
  svg: "html",
  css: "css",
  scss: "css",
  less: "css",
  yml: "yaml",
  yaml: "yaml",
  md: "markdown",
  markdown: "markdown",
  txt: "text",
  text: "text",
  plain: "text",
  plaintext: "text",
};

const LANG_LABELS = Object.fromEntries(CODE_LANGUAGES.map((l) => [l.id, l.label]));

export function normalizeCodeLang(raw) {
  const key = String(raw || "").trim().toLowerCase();
  if (!key) return "text";
  return LANG_ALIASES[key] || "text";
}

export function getCodeLangLabel(lang) {
  const norm = normalizeCodeLang(lang);
  return LANG_LABELS[norm] || "Code";
}

// GitHub / One-Light inspired palette (also auto-inverts cleanly under Excalidraw's dark canvas filter)
export const TOKEN_COLORS = {
  comment: "#6a737d",
  keyword: "#cf222e",
  string: "#0a7e3a",
  number: "#b35900",
  function: "#6639ba",
  type: "#0550ae",
  property: "#0550ae",
  tag: "#116329",
  variable: "#953800",
  operator: "#57606a",
  plain: "#24292f",
};

const KEYWORDS = {
  javascript: new Set([
    "async", "await", "break", "case", "catch", "class", "const", "continue",
    "debugger", "default", "delete", "do", "else", "export", "extends", "false",
    "finally", "for", "from", "function", "if", "import", "in", "instanceof",
    "let", "new", "null", "of", "return", "static", "super", "switch", "this",
    "throw", "true", "try", "typeof", "undefined", "var", "void", "while", "yield",
  ]),
  typescript: new Set([
    "abstract", "as", "async", "await", "break", "case", "catch", "class",
    "const", "continue", "declare", "default", "delete", "do", "else", "enum",
    "export", "extends", "false", "finally", "for", "from", "function", "if",
    "implements", "import", "in", "infer", "instanceof", "interface", "is",
    "keyof", "let", "namespace", "never", "new", "null", "of", "override",
    "private", "protected", "public", "readonly", "return", "satisfies", "static",
    "super", "switch", "this", "throw", "true", "try", "type", "typeof",
    "undefined", "unknown", "var", "void", "while", "yield",
  ]),
  python: new Set([
    "False", "None", "True", "and", "as", "assert", "async", "await", "break",
    "class", "continue", "def", "del", "elif", "else", "except", "finally",
    "for", "from", "global", "if", "import", "in", "is", "lambda", "match",
    "case", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while",
    "with", "yield", "self",
  ]),
  java: new Set([
    "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char",
    "class", "const", "continue", "default", "do", "double", "else", "enum",
    "extends", "false", "final", "finally", "float", "for", "if", "implements",
    "import", "instanceof", "int", "interface", "long", "native", "new", "null",
    "package", "private", "protected", "public", "record", "return", "sealed",
    "short", "static", "super", "switch", "synchronized", "this", "throw",
    "throws", "transient", "true", "try", "var", "void", "volatile", "while",
  ]),
  go: new Set([
    "break", "case", "chan", "const", "continue", "default", "defer", "else",
    "fallthrough", "false", "for", "func", "go", "goto", "if", "import",
    "interface", "iota", "map", "nil", "package", "range", "return", "select",
    "struct", "switch", "true", "type", "var",
  ]),
  rust: new Set([
    "as", "async", "await", "break", "const", "continue", "crate", "dyn", "else",
    "enum", "extern", "false", "fn", "for", "if", "impl", "in", "let", "loop",
    "match", "mod", "move", "mut", "pub", "ref", "return", "Self", "self",
    "static", "struct", "super", "trait", "true", "type", "unsafe", "use",
    "where", "while",
  ]),
  c: new Set([
    "auto", "break", "case", "char", "const", "continue", "default", "do",
    "double", "else", "enum", "extern", "float", "for", "goto", "if", "inline",
    "int", "long", "NULL", "register", "return", "short", "signed", "sizeof",
    "static", "struct", "switch", "typedef", "union", "unsigned", "void",
    "volatile", "while", "true", "false", "bool",
  ]),
  cpp: new Set([
    "alignas", "auto", "bool", "break", "case", "catch", "char", "class",
    "const", "constexpr", "continue", "default", "delete", "do", "double",
    "else", "enum", "explicit", "extern", "false", "float", "for", "friend",
    "goto", "if", "inline", "int", "long", "mutable", "namespace", "new",
    "noexcept", "nullptr", "operator", "override", "private", "protected",
    "public", "return", "short", "signed", "sizeof", "static", "struct",
    "switch", "template", "this", "throw", "true", "try", "typedef", "typename",
    "union", "unsigned", "using", "virtual", "void", "volatile", "while",
  ]),
  sql: new Set([
    "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "IS", "NULL", "AS",
    "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "OUTER", "ON", "GROUP", "BY",
    "ORDER", "ASC", "DESC", "HAVING", "LIMIT", "OFFSET", "INSERT", "INTO",
    "VALUES", "UPDATE", "SET", "DELETE", "CREATE", "ALTER", "DROP", "TABLE",
    "INDEX", "VIEW", "DATABASE", "PRIMARY", "FOREIGN", "KEY", "REFERENCES",
    "UNIQUE", "DEFAULT", "CHECK", "CONSTRAINT", "DISTINCT", "UNION", "ALL",
    "CASE", "WHEN", "THEN", "ELSE", "END", "EXISTS", "BETWEEN", "LIKE",
    "ILIKE", "TRUE", "FALSE", "WITH", "RETURNING", "COUNT", "SUM", "AVG",
    "MIN", "MAX", "COALESCE",
  ]),
  bash: new Set([
    "if", "then", "else", "elif", "fi", "for", "in", "do", "done", "while",
    "until", "case", "esac", "function", "return", "exit", "export", "local",
    "readonly", "unset", "shift", "source", "echo", "printf", "cd", "pwd",
    "ls", "cat", "grep", "awk", "sed", "find", "xargs", "curl", "git", "npm",
    "npx", "node", "python", "docker", "kubectl", "sudo", "chmod", "mkdir",
    "rm", "cp", "mv", "true", "false",
  ]),
};

const BUILTIN_TYPES = new Set([
  "string", "number", "boolean", "object", "symbol", "bigint", "any",
  "int", "int8", "int16", "int32", "int64", "uint", "uint8", "uint16",
  "uint32", "uint64", "float32", "float64", "i8", "i16", "i32", "i64",
  "u8", "u16", "u32", "u64", "f32", "f64", "usize", "isize", "str", "byte",
  "rune", "error", "size_t", "std", "vector", "map", "dict", "list", "tuple",
  "set", "float", "Promise", "Array", "Map", "Set", "Record", "Partial",
  "Required", "Omit", "Pick", "Date", "RegExp", "Error", "Object", "String",
  "Number", "Boolean", "Console", "Math", "JSON", "Option", "Result", "Vec",
  "Box", "Rc", "Arc", "VARCHAR", "INT", "INTEGER", "BIGINT", "TEXT", "BOOLEAN",
  "TIMESTAMP", "DATE", "DECIMAL", "JSONB",
]);

function pushToken(tokens, type, text) {
  if (!text) return;
  const prev = tokens[tokens.length - 1];
  if (prev && prev.type === type) {
    prev.text += text;
  } else {
    tokens.push({ type, text });
  }
}

function readQuoted(line, start, quoteChar) {
  let i = start + 1;
  while (i < line.length) {
    if (line[i] === "\\" && i + 1 < line.length) {
      i += 2;
      continue;
    }
    if (line[i] === quoteChar) {
      return i + 1;
    }
    i += 1;
  }
  return line.length;
}

function tokenizeHtmlLine(line, state) {
  const tokens = [];
  let i = 0;
  let inComment = Boolean(state?.inHtmlComment);

  while (i < line.length) {
    if (inComment) {
      const end = line.indexOf("-->", i);
      if (end === -1) {
        pushToken(tokens, "comment", line.slice(i));
        return { tokens, state: { inHtmlComment: true } };
      }
      pushToken(tokens, "comment", line.slice(i, end + 3));
      i = end + 3;
      inComment = false;
      continue;
    }

    if (line.startsWith("<!--", i)) {
      inComment = true;
      continue;
    }

    if (line[i] === "<") {
      const tagM = line.slice(i).match(/^<\/?([a-zA-Z][\w:-]*|![a-zA-Z]+)/);
      if (tagM) {
        const prefixLen = line[i + 1] === "/" ? 2 : 1;
        pushToken(tokens, "operator", line.slice(i, i + prefixLen));
        pushToken(tokens, "tag", tagM[1]);
        i += tagM[0].length;

        // Parse attributes until '>'
        while (i < line.length && line[i] !== ">") {
          if (/\s/.test(line[i])) {
            let s = i;
            while (i < line.length && /\s/.test(line[i])) i += 1;
            pushToken(tokens, "plain", line.slice(s, i));
          } else if (line[i] === "/" && line[i + 1] === ">") {
            break;
          } else if (line[i] === '"' || line[i] === "'") {
            const end = readQuoted(line, i, line[i]);
            pushToken(tokens, "string", line.slice(i, end));
            i = end;
          } else if (line[i] === "=") {
            pushToken(tokens, "operator", "=");
            i += 1;
          } else {
            const attrM = line.slice(i).match(/^[a-zA-Z_:][\w:.-]*/);
            if (attrM) {
              pushToken(tokens, "property", attrM[0]);
              i += attrM[0].length;
            } else {
              pushToken(tokens, "plain", line[i]);
              i += 1;
            }
          }
        }
        if (line.startsWith("/>", i)) {
          pushToken(tokens, "operator", "/>");
          i += 2;
        } else if (line[i] === ">") {
          pushToken(tokens, "operator", ">");
          i += 1;
        }
        continue;
      }
    }

    pushToken(tokens, "plain", line[i]);
    i += 1;
  }

  return { tokens, state: { inHtmlComment: false } };
}

function tokenizeJsonLine(line) {
  const tokens = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "/" && line[i + 1] === "/") {
      pushToken(tokens, "comment", line.slice(i));
      break;
    }
    if (ch === '"') {
      const end = readQuoted(line, i, '"');
      const rest = line.slice(end).trimStart();
      pushToken(tokens, rest.startsWith(":") ? "property" : "string", line.slice(i, end));
      i = end;
      continue;
    }
    const numM = line.slice(i).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (numM && (i === 0 || !/\w/.test(line[i - 1]))) {
      pushToken(tokens, "number", numM[0]);
      i += numM[0].length;
      continue;
    }
    const kwM = line.slice(i).match(/^(?:true|false|null)\b/);
    if (kwM && (i === 0 || !/\w/.test(line[i - 1]))) {
      pushToken(tokens, "keyword", kwM[0]);
      i += kwM[0].length;
      continue;
    }
    if ("{}[]:,".includes(ch)) {
      pushToken(tokens, "operator", ch);
      i += 1;
      continue;
    }
    pushToken(tokens, "plain", ch);
    i += 1;
  }
  return { tokens, state: {} };
}

function tokenizeYamlLine(line) {
  const tokens = [];
  const trimmed = line.trimStart();
  if (trimmed.startsWith("#")) {
    pushToken(tokens, "comment", line);
    return { tokens, state: {} };
  }
  const kvM = line.match(/^(\s*(?:-\s+)?)([\w.-]+)(\s*:\s*)(.*)$/);
  if (kvM) {
    pushToken(tokens, "operator", kvM[1]);
    pushToken(tokens, "property", kvM[2]);
    pushToken(tokens, "operator", kvM[3]);
    const val = kvM[4];
    if (val) {
      const cIdx = val.indexOf(" #");
      const mainVal = cIdx >= 0 ? val.slice(0, cIdx) : val;
      const commentVal = cIdx >= 0 ? val.slice(cIdx) : "";
      if (/^(?:true|false|null|~)$/i.test(mainVal.trim())) {
        pushToken(tokens, "keyword", mainVal);
      } else if (/^-?\d+(?:\.\d+)?$/.test(mainVal.trim())) {
        pushToken(tokens, "number", mainVal);
      } else {
        pushToken(tokens, "string", mainVal);
      }
      if (commentVal) pushToken(tokens, "comment", commentVal);
    }
    return { tokens, state: {} };
  }
  pushToken(tokens, "plain", line);
  return { tokens, state: {} };
}

function tokenizeCssLine(line, state) {
  const tokens = [];
  let i = 0;
  let inBlock = Boolean(state?.inBlockComment);

  while (i < line.length) {
    if (inBlock) {
      const end = line.indexOf("*/", i);
      if (end === -1) {
        pushToken(tokens, "comment", line.slice(i));
        return { tokens, state: { inBlockComment: true } };
      }
      pushToken(tokens, "comment", line.slice(i, end + 2));
      i = end + 2;
      inBlock = false;
      continue;
    }
    if (line.startsWith("/*", i)) {
      inBlock = true;
      continue;
    }
    if (line[i] === '"' || line[i] === "'") {
      const end = readQuoted(line, i, line[i]);
      pushToken(tokens, "string", line.slice(i, end));
      i = end;
      continue;
    }
    if (line[i] === "@") {
      const m = line.slice(i).match(/^@[a-zA-Z-]+/);
      if (m) {
        pushToken(tokens, "keyword", m[0]);
        i += m[0].length;
        continue;
      }
    }
    const hexM = line.slice(i).match(/^#[0-9a-fA-F]{3,8}\b/);
    if (hexM) {
      pushToken(tokens, "number", hexM[0]);
      i += hexM[0].length;
      continue;
    }
    const propM = line.slice(i).match(/^([a-zA-Z-]+)(\s*:)/);
    if (propM && (i === 0 || /\s/.test(line[i - 1]))) {
      pushToken(tokens, "property", propM[1]);
      pushToken(tokens, "operator", propM[2]);
      i += propM[0].length;
      continue;
    }
    const selM = line.slice(i).match(/^[.#][a-zA-Z_-][\w-]*/);
    if (selM) {
      pushToken(tokens, "function", selM[0]);
      i += selM[0].length;
      continue;
    }
    const numM = line.slice(i).match(/^-?\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?\b/);
    if (numM && (i === 0 || !/\w/.test(line[i - 1]))) {
      pushToken(tokens, "number", numM[0]);
      i += numM[0].length;
      continue;
    }
    if ("{}:;,()".includes(line[i])) {
      pushToken(tokens, "operator", line[i]);
      i += 1;
      continue;
    }
    pushToken(tokens, "plain", line[i]);
    i += 1;
  }

  return { tokens, state: { inBlockComment: false } };
}

export function tokenizeCodeLine(line, rawLang = "text", state = {}) {
  const lang = normalizeCodeLang(rawLang);
  const s = String(line ?? "");
  if (!s) return { tokens: [], state: { ...state } };

  if (lang === "text" || lang === "markdown") {
    return { tokens: [{ type: "plain", text: s }], state: {} };
  }
  if (lang === "html") return tokenizeHtmlLine(s, state);
  if (lang === "json") return tokenizeJsonLine(s);
  if (lang === "yaml") return tokenizeYamlLine(s);
  if (lang === "css") return tokenizeCssLine(s, state);

  const tokens = [];
  const kwSet = KEYWORDS[lang] || KEYWORDS.javascript;
  const isSql = lang === "sql";
  const isHashComment = lang === "python" || lang === "bash";
  const isCComment = !isHashComment && !isSql;
  const isBash = lang === "bash";
  const isCPreproc = lang === "c" || lang === "cpp";

  let i = 0;
  let inBlock = Boolean(state?.inBlockComment);

  while (i < s.length) {
    // 1. Ongoing /* ... */ block comment
    if (inBlock) {
      const end = s.indexOf("*/", i);
      if (end === -1) {
        pushToken(tokens, "comment", s.slice(i));
        return { tokens, state: { inBlockComment: true } };
      }
      pushToken(tokens, "comment", s.slice(i, end + 2));
      i = end + 2;
      inBlock = false;
      continue;
    }

    const ch = s[i];

    // 2. Comments
    if ((isCComment || isSql) && ch === "/" && s[i + 1] === "*") {
      inBlock = true;
      continue;
    }
    if (isCComment && ch === "/" && s[i + 1] === "/") {
      pushToken(tokens, "comment", s.slice(i));
      break;
    }
    if (isSql && ch === "-" && s[i + 1] === "-") {
      pushToken(tokens, "comment", s.slice(i));
      break;
    }
    if (isHashComment && ch === "#") {
      pushToken(tokens, "comment", s.slice(i));
      break;
    }

    // 3. C/C++ preprocessor (#include, #define)
    if (isCPreproc && ch === "#") {
      const m = s.slice(i).match(/^#\s*[a-zA-Z_]\w*/);
      if (m) {
        pushToken(tokens, "keyword", m[0]);
        i += m[0].length;
        continue;
      }
    }

    // 4. Decorators / Annotations (@Component, @dataclass)
    if (ch === "@") {
      const m = s.slice(i).match(/^@[a-zA-Z_][\w.]*/);
      if (m) {
        pushToken(tokens, "variable", m[0]);
        i += m[0].length;
        continue;
      }
    }

    // 5. Bash variables ($HOME, ${VAR}) & flags (--save)
    if (isBash && ch === "$") {
      const m = s.slice(i).match(/^\$(?:\{[^}]+\}|[a-zA-Z_]\w*|[0-9?*#@!$-])/);
      if (m) {
        pushToken(tokens, "variable", m[0]);
        i += m[0].length;
        continue;
      }
    }
    if (isBash && ch === "-" && (i === 0 || /\s/.test(s[i - 1]))) {
      const m = s.slice(i).match(/^--?[a-zA-Z0-9_-]+/);
      if (m) {
        pushToken(tokens, "property", m[0]);
        i += m[0].length;
        continue;
      }
    }

    // 6. Strings ('...', "...", `...`)
    if (ch === '"' || ch === "'" || ch === "`") {
      // Python triple quotes on single line
      if (lang === "python" && (s.startsWith('"""', i) || s.startsWith("'''", i))) {
        const delim = s.slice(i, i + 3);
        const end = s.indexOf(delim, i + 3);
        const stop = end === -1 ? s.length : end + 3;
        pushToken(tokens, "string", s.slice(i, stop));
        i = stop;
        continue;
      }
      const end = readQuoted(s, i, ch);
      pushToken(tokens, "string", s.slice(i, end));
      i = end;
      continue;
    }

    // 7. Numbers
    if (/[0-9]/.test(ch) && (i === 0 || !/[a-zA-Z_$]/.test(s[i - 1]))) {
      const m = s.slice(i).match(/^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?)/);
      if (m) {
        pushToken(tokens, "number", m[0]);
        i += m[0].length;
        continue;
      }
    }

    // 8. Identifiers (keywords, built-in types, functions, PascalCase types)
    if (/[a-zA-Z_$]/.test(ch)) {
      const m = s.slice(i).match(/^[a-zA-Z_$][\w$]*/);
      if (m) {
        const word = m[0];
        const nextChar = s.slice(i + word.length).trimStart()[0];
        const lookup = isSql ? word.toUpperCase() : word;
        if (kwSet.has(lookup)) {
          pushToken(tokens, "keyword", word);
        } else if (BUILTIN_TYPES.has(word) || (isSql && BUILTIN_TYPES.has(lookup))) {
          pushToken(tokens, "type", word);
        } else if (nextChar === "(") {
          pushToken(tokens, "function", word);
        } else if (/^[A-Z][a-zA-Z0-9_]*$/.test(word) && word.length > 1 && /[a-z]/.test(word)) {
          pushToken(tokens, "type", word);
        } else {
          pushToken(tokens, "plain", word);
        }
        i += word.length;
        continue;
      }
    }

    // 9. Operators & punctuation
    if ("+-*/%=!<>&|^~?:;.,()[]{}".includes(ch)) {
      pushToken(tokens, "operator", ch);
      i += 1;
      continue;
    }

    pushToken(tokens, "plain", ch);
    i += 1;
  }

  return { tokens, state: { inBlockComment: false } };
}

export function tokenizeCode(code, lang = "text") {
  const lines = String(code ?? "").replace(/\r\n?/g, "\n").split("\n");
  let state = {};
  return lines.map((line) => {
    const res = tokenizeCodeLine(line, lang, state);
    state = res.state;
    return res.tokens;
  });
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function highlightCodeToHtml(code, lang = "text") {
  const tokenizedLines = tokenizeCode(code, lang);
  return tokenizedLines
    .map((lineTokens) =>
      lineTokens
        .map((tok) =>
          tok.type === "plain"
            ? escapeHtml(tok.text)
            : `<span class="tok-${tok.type}">${escapeHtml(tok.text)}</span>`
        )
        .join("")
    )
    .join("\n");
}
