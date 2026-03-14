import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Import all locale files statically (no lazy loading needed at this app size)
import en from './locales/en/translation.json';
import fr from './locales/fr/translation.json';
import es from './locales/es/translation.json';
import de from './locales/de/translation.json';
import ptBR from './locales/pt-BR/translation.json';
import zhCN from './locales/zh-CN/translation.json';
import ja from './locales/ja/translation.json';
import ru from './locales/ru/translation.json';
import ko from './locales/ko/translation.json';
import ar from './locales/ar/translation.json';
import it from './locales/it/translation.json';
import nl from './locales/nl/translation.json';
import pl from './locales/pl/translation.json';
import tr from './locales/tr/translation.json';
import sv from './locales/sv/translation.json';
import da from './locales/da/translation.json';
import cs from './locales/cs/translation.json';
import uk from './locales/uk/translation.json';

export const SUPPORTED_LANGUAGES: Array<{ code: string; name: string; nativeName: string; dir?: 'rtl' }> = [
  { code: 'en',    name: 'English',            nativeName: 'English' },
  { code: 'fr',    name: 'French',             nativeName: 'Français' },
  { code: 'es',    name: 'Spanish',            nativeName: 'Español' },
  { code: 'de',    name: 'German',             nativeName: 'Deutsch' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)' },
  { code: 'zh-CN', name: 'Chinese (Simplified)', nativeName: '简体中文' },
  { code: 'ja',    name: 'Japanese',           nativeName: '日本語' },
  { code: 'ko',    name: 'Korean',             nativeName: '한국어' },
  { code: 'ru',    name: 'Russian',            nativeName: 'Русский' },
  { code: 'ar',    name: 'Arabic',             nativeName: 'العربية', dir: 'rtl' },
  { code: 'it',    name: 'Italian',            nativeName: 'Italiano' },
  { code: 'nl',    name: 'Dutch',              nativeName: 'Nederlands' },
  { code: 'pl',    name: 'Polish',             nativeName: 'Polski' },
  { code: 'tr',    name: 'Turkish',            nativeName: 'Türkçe' },
  { code: 'sv',    name: 'Swedish',            nativeName: 'Svenska' },
  { code: 'da',    name: 'Danish',             nativeName: 'Dansk' },
  { code: 'cs',    name: 'Czech',              nativeName: 'Čeština' },
  { code: 'uk',    name: 'Ukrainian',          nativeName: 'Українська' },
];

const savedLang = localStorage.getItem('i18n_language') || navigator.language.split('-')[0] || 'en';
const initialLang = SUPPORTED_LANGUAGES.find(l => l.code === savedLang || l.code.startsWith(savedLang))?.code ?? 'en';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en:    { translation: en },
      fr:    { translation: fr },
      es:    { translation: es },
      de:    { translation: de },
      'pt-BR': { translation: ptBR },
      'zh-CN': { translation: zhCN },
      ja:    { translation: ja },
      ko:    { translation: ko },
      ru:    { translation: ru },
      ar:    { translation: ar },
      it:    { translation: it },
      nl:    { translation: nl },
      pl:    { translation: pl },
      tr:    { translation: tr },
      sv:    { translation: sv },
      da:    { translation: da },
      cs:    { translation: cs },
      uk:    { translation: uk },
    },
    lng: initialLang,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

/** Change the active language, persist the choice, update <html dir> for RTL. */
export function setLanguage(code: string) {
  i18n.changeLanguage(code);
  localStorage.setItem('i18n_language', code);
  const lang = SUPPORTED_LANGUAGES.find(l => l.code === code);
  document.documentElement.setAttribute('lang', code);
  document.documentElement.setAttribute('dir', lang?.dir ?? 'ltr');
}

export default i18n;
