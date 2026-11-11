// app.json holds the config. This only lets a test build use its own Android package, so a thread
// can install its copy on the shared emulator without replacing com.anyappagent:
//   ANYAPP_ANDROID_PACKAGE=com.anyappagent.pages npm run apk -- --clean
module.exports = ({ config }) => {
  const pkg = process.env.ANYAPP_ANDROID_PACKAGE;
  if (!pkg) return config;
  return { ...config, name: `${config.name} (${pkg.split(".").pop()})`, android: { ...config.android, package: pkg } };
};
