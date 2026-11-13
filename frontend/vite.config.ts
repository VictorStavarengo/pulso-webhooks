import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const destino = process.env.PULSO_API_URL ?? 'http://127.0.0.1:8000'

// O frontend fala com a API pela mesma origem; em dev o Vite repassa as rotas
// para o uvicorn, o que mantém o cookie de sessão no primeiro domínio.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: destino, changeOrigin: true },
      '/webhooks': { target: destino, changeOrigin: true },
      '/health': { target: destino, changeOrigin: true },
    },
  },
})
