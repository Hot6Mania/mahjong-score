/// <reference types="vite/client" />
declare module '*.vue' {
  import { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
declare module "*.json" {
  const value: any;
  export default value;
}

interface ImportMetaEnv {
  readonly VITE_GOOGLE_AUTH_WORKER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}