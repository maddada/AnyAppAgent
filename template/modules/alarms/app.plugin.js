// Copies assets/sounds/* into the Android project's res/raw so alarms can play them while the
// app is closed (scheduleAlarm({ sound: 'adhan' }) plays assets/sounds/adhan.mp3).
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const SOUND = /\.(mp3|ogg|wav|m4a)$/i;

module.exports = function withAlarmSounds(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const src = path.join(cfg.modRequest.projectRoot, 'assets', 'sounds');
      const dest = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'raw');
      if (fs.existsSync(src)) {
        for (const file of fs.readdirSync(src)) {
          if (!SOUND.test(file)) continue;
          // Android resource names: lowercase letters, digits and underscores, starting with a letter.
          const ext = path.extname(file).toLowerCase();
          const base = path.basename(file, path.extname(file)).toLowerCase().replace(/[^a-z0-9_]/g, '_');
          const name = /^[a-z]/.test(base) ? base : `s_${base}`;
          fs.mkdirSync(dest, { recursive: true });
          fs.copyFileSync(path.join(src, file), path.join(dest, name + ext));
        }
      }
      return cfg;
    },
  ]);
};
