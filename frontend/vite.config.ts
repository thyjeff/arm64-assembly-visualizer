import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://169.254.100.2:8000',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://169.254.100.2:8000',
        ws: true
      }
    }
  }
})
