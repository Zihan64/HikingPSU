import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': { target: process.env.HIKINGPSU_DEV_API || 'http://localhost:8000', rewrite: p => p.replace(/^\/api/, '') } } },
})
