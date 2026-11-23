import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "@excalidraw/excalidraw/index.css";
import { initNativeMarkdown } from "./nativeMarkdown";
import { initTableRenderer } from "./tableRender";
import Home from "./Home";
import Board from "./Board";
import ShareView from "./ShareView";
import "./styles.css";

initNativeMarkdown();
initTableRenderer();

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/board/:id" element={<Board />} />
      <Route path="/share/:id" element={<ShareView />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </BrowserRouter>
);
