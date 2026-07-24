import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { wardrobeImportApi } from "./scripts/import-job-api.mjs";
import { responsiveImageApi } from "./scripts/responsive-image-api.mjs";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    optimizeDeps: {
      include: ["react", "react-dom/client"],
    },
    server: {
      host: env.WARDROBE_HOST || "127.0.0.1",
      allowedHosts: ["localhost", "127.0.0.1"],
      warmup: {
        clientFiles: ["./src/main.jsx"],
      },
    },
    preview: {
      host: env.WARDROBE_HOST || "127.0.0.1",
      port: 4173,
      allowedHosts: ["localhost", "127.0.0.1"],
    },
    plugins: [react(), responsiveImageApi(), wardrobeImportApi({ env })],
  };
});
