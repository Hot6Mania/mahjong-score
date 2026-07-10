import { createI18n } from 'vue-i18n'
import ko from '@/locales/ko.json'

/**i18n 설정*/
const i18n = createI18n({
    legacy: false, // Composition API 모드로 전환
    locale: 'ko',
    fallbackLocale: 'ko',
    messages: {
        ko
    }
})

export default i18n