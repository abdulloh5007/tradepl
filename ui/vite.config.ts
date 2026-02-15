import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return
          if (id.includes("react-dom") || id.includes("react-router-dom") || id.includes("/react/")) {
            return "react-vendor"
          }
          if (id.includes("lightweight-charts")) return "chart-vendor"
          if (id.includes("framer-motion")) return "motion-vendor"
          if (id.includes("swagger-ui-react")) return "swagger-vendor"
          if (id.includes("lottie-web") || id.includes("pako")) return "anim-vendor"
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/v1": {
        target: process.env.VITE_API_BASE || "http://localhost:8080",
        changeOrigin: true,
        ws: true
      },
      "/health": {
        target: process.env.VITE_API_BASE || "http://localhost:8080",
        changeOrigin: true
      }
    }
  }
})
