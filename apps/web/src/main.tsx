import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, useRouteError } from "react-router";
import { Editor } from "./routes/Editor.js";

const WEB_BUILD_MARKER = "library-array-fix-2026-07-23";

function AppErrorFallback() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : "The application encountered an unexpected error.";

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "#09090b",
        color: "#fafafa",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          width: "min(520px, 100%)",
          padding: 24,
          border: "1px solid rgba(255,255,255,0.14)",
          borderRadius: 14,
          background: "rgba(255,255,255,0.04)",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22 }}>Music Video Studio needs to reload</h1>
        <p style={{ margin: "12px 0 0", lineHeight: 1.5, opacity: 0.78 }}>{message}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: 18,
            padding: "10px 16px",
            border: 0,
            borderRadius: 8,
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          Reload app
        </button>
        <div style={{ marginTop: 14, fontSize: 11, opacity: 0.45 }}>{WEB_BUILD_MARKER}</div>
      </div>
    </div>
  );
}

const router = createBrowserRouter([
  { path: "/", element: <Editor />, errorElement: <AppErrorFallback /> },
]);

console.info(`[MVS web] ${WEB_BUILD_MARKER}`);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
