import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
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
