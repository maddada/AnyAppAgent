// Babel for this app: Expo's preset, plus the fence around automation scripts
// (tools/automate-fence.js; it only touches automations/<id>.ts). Leave this file as it is.
const preset = require.resolve('babel-preset-expo', { paths: [require.resolve('expo/package.json')] });

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [preset],
    overrides: [
      {
        // A function, not a RegExp: Metro also loads this config without a file name.
        test: (filename) => !!filename && /[\\/]automations[\\/][^\\/]+\.ts$/.test(filename),
        plugins: [require.resolve('./tools/automate-fence.js')],
      },
    ],
  };
};
