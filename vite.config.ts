import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// "1.1.0" shows as "1.1"; a patch number shows only when it is not 0.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
const version = pkg.version.replace(/\.0$/, "");

// No `base` here on purpose: Webflow Cloud sets it at build time from the
// environment's mount path (e.g. /creator_vellum). Everything in the app is loaded
// through bundled imports, so it works under any mount path.
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  // The tracer runs in a module worker (it imports the WebAssembly engine).
  worker: { format: "es" },
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
});
