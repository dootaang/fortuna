import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@firebase/firestore") || id.includes("node_modules/firebase/firestore")) return "firestore";
          if (id.includes("node_modules/@firebase/auth") || id.includes("node_modules/firebase/auth")) return "auth";
          return undefined;
        },
      },
    },
  },
  server: { port: 5173 },
});
