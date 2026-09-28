import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/pt-serif/cyrillic-400.css";
import "@fontsource/pt-serif/cyrillic-700.css";
import "@fontsource/pt-serif/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-sans/cyrillic-400.css";
import "@fontsource/noto-sans-tc/400.css";
import "@fontsource/noto-sans-tc/600.css";
import "./styles.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
