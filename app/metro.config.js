// Expo's default Metro config, plus the shared theme (tokens, fonts, mark) one folder up.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, "../shared")];
// Files in ../shared (the mark's PNGs) import Metro's asset registry: resolve it from this app.
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];

module.exports = config;
