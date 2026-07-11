import { createRouter, createWebHistory } from 'vue-router'
import App from '@/App.vue'

const routes = [
  {
    path: '/',
    component: App,
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/'
  },
]

const router = createRouter({
  history: createWebHistory('/mahjong-score'),
  routes,
})

router.beforeEach((to, _from, next) => {
  // Canonical 태그 동적 업데이트 (hot6mania 도메인 설정)
  const baseUrl = 'https://hot6mania.github.io/mahjong-score';
  const canonicalUrl = `${baseUrl}/`;
  let link: HTMLLinkElement | null = document.querySelector("link[rel='canonical']");
  
  if (link) {
    link.setAttribute('href', canonicalUrl);
  } else {
    link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    link.setAttribute('href', canonicalUrl);
    document.head.appendChild(link);
  }
  
  next();
})

export default router