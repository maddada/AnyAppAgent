// electron-builder configuration for the signed Windows installer
// (.github/workflows/windows-installer.yml): package.json's "build" section plus the Certum signing
// hook. Signs Kiwimake.exe, Electron's DLLs, the uninstaller and the installer, SHA-256 only.
const base = require("../package.json").build;

module.exports = {
  ...base,
  win: {
    ...base.win,
    signExts: [".dll"],
    signtoolOptions: {
      sign: require("./sign-certum.cjs").default,
      signingHashAlgorithms: ["sha256"],
    },
  },
};
