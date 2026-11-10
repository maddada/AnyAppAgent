// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

const nodeGlobals = {
  Buffer: 'readonly',
  process: 'readonly',
  console: 'readonly',
  require: 'readonly',
  module: 'writable',
  __dirname: 'readonly',
};

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'build/*', 'android/*', 'node_modules/*'],
  },
  {
    // Node scripts and config plugins run on the PC, not in the app.
    files: ['scripts/**', '**/*.plugin.js', '*.config.js'],
    languageOptions: { globals: nodeGlobals },
  },
]);
