import "@fontsource-variable/raleway";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyTheme, storedDark } from "./theme";
import "./base.css";
import "./vellum.css";

// Same light/dark choice as the rest of nassau.se, applied before the first paint.
applyTheme(storedDark(), false);

createRoot(document.getElementById("root")!).render(<App />);
