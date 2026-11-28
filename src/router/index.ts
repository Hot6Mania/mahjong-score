import { createRouter, createWebHistory } from 'vue-router'
import App from '@/App.vue'
import { isKnuNpmEventHost, isKnuNpmEventPath } from '@/utils/eventMode'

const routes = [
  {
    path: '/',
    name: 'scorer',
    component: App,
  },
  {
    path: '/dashboard/:tab?/:photoId?',
    name: 'dashboard',
    component: App,
  },
  {
    path: '/stats',
    redirect: '/dashboard',
  },
  {
    path: '/preview/seat-edit',
    name: 'preview-seat-edit',
    component: App,
  },
  {
    path: '/knu-npm-2026/preview/seat-edit',
    name: 'knu-npm-preview-seat-edit',
    component: App,
  },
  {
    path: '/knu-npm-2026/test/live',
    name: 'knu-npm-event-test-live',
    component: App,
  },
  {
    path: '/knu-npm-2026/test',
    name: 'knu-npm-event-test',
    component: App,
  },
  {
    path: '/knu-npm-2026/live',
    name: 'knu-npm-event-live',
    component: App,
  },
  {
    path: '/knu-npm-2026/:tab?',
    name: 'knu-npm-event',
    component: App,
  },
  {
    path: '/test/live',
    name: 'event-host-test-live',
    component: App,
  },
  {
    path: '/test',
    name: 'event-host-test',
    component: App,
  },
  {
    path: '/live',
    name: 'event-host-live',
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
  const isEvent = isKnuNpmEventHost() || isKnuNpmEventPath(to.path);
  const isDashboard = !isEvent && (to.path === '/dashboard' || to.path === '/stats');
  const canonicalUrl = isEvent
    ? `${origin}${base}${to.path === '/' ? '/' : to.path}`
    : isDashboard
      ? `${origin}${base}/dashboard`
      : `${origin}${base}/`;
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
