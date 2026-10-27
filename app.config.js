// The example's Expo config is app.json. This file adds the one variant the device tests build on top of it:
// `VK_AUDIO_MODE=media` (set by scripts/test/rn-e2e/build-apk.sh --variant media, for scenario M1) turns the SDK's
// plugin option android.audioMode to "media". Without the variable, the config is app.json as it is.
const PLUGIN = '@voltkit-rtc/react-native';

module.exports = ({ config }) => {
  const mode = process.env.VK_AUDIO_MODE;
  if (!mode) return config;
  if (mode !== 'communication' && mode !== 'media') throw new Error(`VK_AUDIO_MODE must be communication or media, not ${mode}`);
  const plugins = (config.plugins ?? []).map((entry) => {
    const [name, props] = Array.isArray(entry) ? entry : [entry, {}];
    if (name !== PLUGIN) return entry;
    return [name, { ...props, android: { ...(props?.android ?? {}), audioMode: mode } }];
  });
  return { ...config, plugins };
};
