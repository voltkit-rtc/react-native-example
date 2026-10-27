// Lets this test app reach a local VoltKit stack over plain http:// and ws://.
//
// Android release builds refuse cleartext traffic. The device tests run against a
// stack on the developer's machine without TLS: the emulator reaches the host's
// loopback as 10.0.2.2, and LAN runs use the machine's LAN address. This plugin
// permits cleartext for those hosts only, through a network security config.
// It exists for this example and its tests: a production app talks to wss:// and
// https:// and needs none of it.
//
// Hosts come from the plugin's `hosts` option plus RN_E2E_HOSTS (comma separated)
// at prebuild time, so a LAN address can be added without editing app.json.
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const FILE = 'vk_e2e_network_security';

function hostsFrom(props) {
  const fromEnv = (process.env.RN_E2E_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  const all = [...(Array.isArray(props.hosts) ? props.hosts : ['10.0.2.2', '127.0.0.1', 'localhost']), ...fromEnv];
  for (const h of all) {
    if (typeof h !== 'string' || !/^[A-Za-z0-9.-]+$/.test(h)) throw new Error(`with-e2e-network: not a host name or IPv4 address: ${JSON.stringify(h)}`);
  }
  return [...new Set(all)];
}

function xml(hosts) {
  const domains = hosts.map((h) => `    <domain includeSubdomains="false">${h}</domain>`).join('\n');
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!-- Written by plugins/with-e2e-network.js: cleartext for the local test stack only. -->',
    '<network-security-config>',
    '  <domain-config cleartextTrafficPermitted="true">',
    domains,
    '  </domain-config>',
    '</network-security-config>',
    '',
  ].join('\n');
}

module.exports = function withE2eNetwork(config, props = {}) {
  const hosts = hostsFrom(props);
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${FILE}.xml`), xml(hosts));
      return cfg;
    },
  ]);
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) throw new Error('with-e2e-network: AndroidManifest.xml has no <application>');
    app.$['android:networkSecurityConfig'] = `@xml/${FILE}`;
    return cfg;
  });
};
