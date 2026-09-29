import { createRouter, createWebHistory } from 'vue-router'
import App from '@/App.vue'

const routes = [
  {
    path: '/',
    name: 'scorer',
    component: App,
  },
  {
    path: '/stats',
    name: 'stats',
    alias: '/dashboard',
    component: App,
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/'
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

router.beforeEach((to, _from, next) => {
  // Canonical 태그 동적 업데이트
  const origin = window.location.origin;
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
  const canonicalUrl = to.path === '/stats' ? `${origin}${base}/stats` : `${origin}${base}/`;
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