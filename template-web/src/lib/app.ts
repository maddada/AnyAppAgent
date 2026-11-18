// What the builder bakes into every build: the app's name, its slug and the build number.

/** The app's name, as the person sees it. */
export const APP_NAME: string = import.meta.env.VITE_KIWI_NAME || 'My App';

/** The app's short id. All of a person's apps share one web address, so storage names start with it. */
export const APP_SLUG: string = import.meta.env.VITE_KIWI_SLUG || 'my-app';

/** The version number of the code that is running (0 when built outside Kiwimake). */
export const APP_BUILD: number = Number(import.meta.env.VITE_KIWI_BUILD) || 0;
