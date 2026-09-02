import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { RolesPage } from "./components/RolesPage.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RolesPage />
  </StrictMode>,
);
