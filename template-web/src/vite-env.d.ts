/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The app's name (anyapp.json). */
  readonly VITE_KIWI_NAME: string;
  /** The app's slug: the prefix of its storage names. */
  readonly VITE_KIWI_SLUG: string;
  /** The build number this code was built as ("0" outside Kiwimake's builder). */
  readonly VITE_KIWI_BUILD: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
