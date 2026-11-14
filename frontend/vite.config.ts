import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base keeps the built site working everywhere:
//  - GitHub Pages project sites (https://thyjeff.github.io/arm64-assembly-visualizer/)
//  - The device-served portal (http://<device-ip>:8000/)
//  - Local dev (http://localhost:3000/)
export default defineConfig({
  base: './',
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
