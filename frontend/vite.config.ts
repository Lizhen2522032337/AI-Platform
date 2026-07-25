import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 本地开发时把相对 API 路径交给 Docker 中的统一 Nginx。
    proxy: {
      '/api': {
        target: 'http://192.168.86.133:80',
        changeOrigin: true,
      },
    },
  },
})
