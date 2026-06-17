import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // Porta fixa: o redirect do Google OAuth aponta pra :5174. strictPort evita cair
    // em 5173/5175 (que quebraria o callback).
    port: 5174,
    strictPort: true,
    // Em dev nao ha nginx: encaminha /auth e /api pro auth-backend (porta 3000).
    // Sem isso, fetch("/auth/me") cai no index.html da SPA.
    // 127.0.0.1 (NAO "localhost"): no Windows localhost pode resolver IPv6 (::1) e o
    // Fastify so escuta IPv4 -> connection refused -> 502.
    proxy: {
      "/auth": "http://127.0.0.1:3000",
      "/api": "http://127.0.0.1:3000",
    },
  },
  build: {
    // Sem minificação para preservar backdrop-filter e filtros SVG
    minify: false,
  },
})
