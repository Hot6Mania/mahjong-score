import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import sitemap from 'vite-plugin-sitemap'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    sitemap({
      hostname: 'https://he1fire.github.io', // 여기는 도메인만!
      dynamicRoutes: [
        '/mahjong-score/',   // 메인
        '/mahjong-score/ko', // 한국어
        '/mahjong-score/en', // 영어
        '/mahjong-score/ja'  // 일본어
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
