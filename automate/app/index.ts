import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';

import App from './src/App';
import { runFromNative } from './src/automate/runtime';

// Android wakes the app for an automation (modules/automate, AutomateTaskService): run it without a screen.
AppRegistry.registerHeadlessTask('AppwinAutomateRun', () => runFromNative);

// Registers the root component as 'main' for the native app.
registerRootComponent(App);
