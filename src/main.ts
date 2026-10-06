import { createApp } from 'vue'
import '@/style.css'
import App from '@/App.vue'
import router from '@/router/index.ts'
import i18n from '@/i18n/i18n.ts'
import { vBackdropDismiss } from '@/directives/backdropDismiss'

const app = createApp(App)
app.use(router)
app.use(i18n)
app.directive('backdrop-dismiss', vBackdropDismiss)
app.mount('#app')