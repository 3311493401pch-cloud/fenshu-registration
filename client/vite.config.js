import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // base 路径可通过环境变量 VITE_BASE 配置，默认 /fenshu/
  // Render 部署时设置为 / 或 Render 提供的子路径
  base: process.env.VITE_BASE || '/fenshu/',
})
