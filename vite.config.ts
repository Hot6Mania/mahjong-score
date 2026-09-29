import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import sitemap from 'vite-plugin-sitemap'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    sitemap({
      hostname: process.env.VITE_SITE_URL || 'https://kimk-house.party',
      dynamicRoutes: [
        '/'   // 메인
      ],
      exclude: ['/404'],
      outDir: 'dist',
      generateRobotsTxt: false
    })
  ],
  base: process.env.VITE_BASE_URL || "/",
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})
