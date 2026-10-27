// Pins the native WebRTC build that react-native-webrtc compiles against.
//
// react-native-webrtc's android/build.gradle asks for `org.jitsi:webrtc:155.+`, a
// dynamic version: Gradle takes whatever Maven Central has newest on the day of the
// build. Forcing one exact version keeps device-test results repeatable, and keeps a
// build from changing under us when Jitsi publishes 155.0.2.
//
// Usage in app.json: ["./plugins/with-pinned-webrtc.js", { "version": "155.0.1" }]
const { withProjectBuildGradle } = require('expo/config-plugins');

const START = '// @voltkit-rtc/example with-pinned-webrtc: start';
const END = '// @voltkit-rtc/example with-pinned-webrtc: end';

function block(language, version) {
  const force = language === 'kt' ? `resolutionStrategy.force("org.jitsi:webrtc:${version}")` : `resolutionStrategy.force 'org.jitsi:webrtc:${version}'`;
  return [START, 'allprojects {', '  configurations.all {', `    ${force}`, '  }', '}', END].join('\n');
}

module.exports = function withPinnedWebrtc(config, props = {}) {
  const version = props.version ?? '155.0.1';
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`with-pinned-webrtc: version must look like 155.0.1, got ${JSON.stringify(version)}`);
  }
  return withProjectBuildGradle(config, (cfg) => {
    const language = cfg.modResults.language === 'kt' ? 'kt' : 'groovy';
    const at = cfg.modResults.contents.indexOf(START);
    const end = cfg.modResults.contents.indexOf(END);
    let contents = cfg.modResults.contents;
    // Idempotent: a second prebuild (or a changed version) replaces the block.
    if (at !== -1 && end !== -1) contents = contents.slice(0, at).trimEnd() + contents.slice(end + END.length);
    cfg.modResults.contents = `${contents.trimEnd()}\n\n${block(language, version)}\n`;
    return cfg;
  });
};
