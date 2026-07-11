import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import sitemap from 'vite-plugin-sitemap'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    sitemap({
      hostname: 'https://hot6mania.github.io',
      dynamicRoutes: [
        '/mahjong-score/'   // 메인
      ],
      exclude: ['/', '/404'],
      outDir: 'dist',
      generateRobotsTxt: false
    })
  ],
  base: "/mahjong-score/",
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})
