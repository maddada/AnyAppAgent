// The app's visible name, in one place: the name under its icon (app.json "expo.name", which a
// rename in Kiwimake changes). Screens and messages use APP_NAME, never a written-out name.
// The Kotlin side reads the same name (the app's label, Notices.kt).
import Constants from 'expo-constants';

export const APP_NAME: string = Constants.expoConfig?.name?.trim() || 'Automate';
