import React from "react";
import { createRoot } from "react-dom/client";
import { LayoutHarnessApp } from "./layout-harness-app.js";
import "@tyrum/operator-ui/globals.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing root element");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <LayoutHarnessApp />
  </React.StrictMode>,
);
