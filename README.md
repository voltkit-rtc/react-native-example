# VoltKit RTC: the React Native example

An Expo development build (Expo SDK 58, React Native 0.88, the New Architecture) with the two demos of the
[React Native SDK docs](https://voltkit.in/docs/react-native-sdk): a video call, one-to-one or in a group
(`src/screens/CallScreen.tsx`, the docs' call screen), and an audio room with seats, raised hands, moderation and
chat (`src/screens/AudioRoomScreen.tsx`). It is also the app the SDK's device tests run in: the in-app scenario
runner (`src/e2e/`) answers the host runner in `scripts/test/rn-e2e`.

Tested on Android (the emulator, API 37.1); iOS is a preview. Expo Go cannot run it: react-native-webrtc and the
SDK bring native code, so build the app.

## What is in it

| Path | |
| --- | --- |
| `App.tsx` | The routes: the home screen, the call, the audio room, and the scenario runner when the app is opened by its deep link |
| `src/config.ts`, `src/token.ts` | Where tokens come from: `fetchCredentials(callId, accessToken)` asks the token server; the app never holds the API secret |
| `src/screens/CallScreen.tsx` | The docs' call screen: join, publish, tiles, controls, reconnecting banner, why a call ended |
| `src/screens/AudioRoomScreen.tsx` | Stage seats (`claim`/`release`), hands, the host's moderation (`promote`, `forceMute`, `kick`, `endRoom`), chat, the output picker |
| `src/components/` | `Tile` (a `VideoTrack` with a name), `Controls` (mute, camera, flip, loudspeaker, leave), `OutputPicker`, `ChatPanel`, `EndedBanner` |
| `server/token-server.mjs` | The token endpoint from the docs' token-server page, as one Node file: `PUT /v1/rooms/{id}` then `POST /v1/rooms/{id}/tokens` |
| `src/e2e/` | The scenario runner (below) |
| `plugins/` | `with-pinned-webrtc.js` (org.jitsi:webrtc pinned to 155.0.1) and `with-e2e-network.js` (cleartext for the local test stack only) |

The SDK and its peers come from npm: `@voltkit-rtc/client` 0.9.12, `@voltkit-rtc/react` 0.1.1 and
`@voltkit-rtc/react-native` 0.1.0 (released 2026-10-27). To try an unpublished build instead, `make -C voltkit-rtc
sdk-pack` writes tarballs into `voltkit-rtc/*.tgz` (step 1 below says how to install them).

## Run it

1. The app's dependencies (the SDKs come from npm):

   ```bash
   cd voltkit-rtc/examples/react-native && npm install
   ```

   To test an unpublished SDK build, pack it and name the tarballs: `make -C voltkit-rtc sdk-pack`, then
   `npm install ../../voltkit-rtc-client-0.9.12.tgz ../../voltkit-rtc-react-0.1.1.tgz ../../voltkit-rtc-react-native-0.1.0.tgz`.
   Name them: a plain `npm install` trusts the lockfile's integrity and keeps the cached contents of a tarball that
   changed but kept its name (a repacked SDK would never reach `node_modules`); the explicit specs re-read the files
   and rewrite the lock. Put the registry versions back before committing:
   `npm install @voltkit-rtc/client@0.9.12 @voltkit-rtc/react@0.1.1 @voltkit-rtc/react-native@0.1.0`.

2. The token server, with your project's RTC URL and secret (or the local test stack's: `scripts/test/rn-stack.sh up`,
   then `VOLTKIT_RTC_URL=http://127.0.0.1:18498` and the `BOOTSTRAP_API_KEY` from `voltkit-rtc/.rn-stack/.env`):

   ```bash
   VOLTKIT_RTC_URL=https://api.voltkit.in VOLTKIT_RTC_SECRET=... npm run token-server
   ```

   The emulator reaches it at `http://10.0.2.2:8787`; a phone on the same Wi-Fi needs the machine's address in
   `src/config.ts`. This example takes the name typed on the home screen as the user's identity (the bearer token):
   a real backend checks its own sign-in there.

3. The app, as a development build on the emulator or a phone with USB debugging:

   ```bash
   npm run android          # expo run:android: prebuild, build, install, start Metro
   ```

   The release build the SDK is tested with (R8-minified, Hermes): `bash ../../scripts/test/rn-e2e/build-apk.sh`
   writes `voltkit-rtc/.rn-e2e/app-release.apk`.

Two devices (or a device and a web page with the JavaScript SDK) that enter the same call id meet in the same call.

## The config

`app.json` lists the SDK's config plugin, which declares the permissions, the call service (background calls) and
the `in.voltkit.rtc.*` meta-data; here with `android.screenShare: true` for the screen-sharing scenario. Expo's
default `SYSTEM_ALERT_WINDOW`, `VIBRATE` and storage permissions are blocked with `android.blockedPermissions`.
`expo-build-properties` sets minSdk 24 and R8 minification and resource shrinking in release builds; the SDK carries
the R8 rule react-native-webrtc 155.0.1 needs, so the app adds none. `eas.json` has the development, preview and
production profiles from the docs' Expo page.

## The scenario runner (device tests)

The host runner (`scripts/test/rn-e2e/run.mjs`) force-stops the app and opens
`voltkitrn://scenario?name=<ID>&run=<tag>&host=http://10.0.2.2:<port>`. `App.tsx` then mounts
`src/e2e/ScenarioRunner.tsx`, which:

- posts `hello`, reads `GET /config` (the room and the identities of clients A and B), and long-polls `GET /next` for
  commands, answering each with a `result` event (`POST /event`, mirrored to logcat as `VKRN-RESULT {json}`), every
  event carrying `seq` and the launch's `run` tag;
- mounts a `VoltkitProvider` per client with a token the host mints (`POST /token`): `join`, `leave`, `publish`,
  `setMic`, `switchCamera`, `stats`, `showRemote`, `levels`, `audioOutput`, `requestPermissions`, `callService`,
  `screenShare`, `leaks`, `done` and the rest of `APP_COMMANDS` in `scripts/test/rn-e2e/scenarios.mjs`, each
  implemented in `src/e2e/scenarios/*` through the SDK's public API;
- mirrors every StreamClient event (`client`), every `VideoTrack` size (`view`) and the native side's changes
  (`native`) to the host.

Uses XHR only, never `fetch` or a JS timer (React Native's fetch and timers stop in the background, with the screen
off and during permission dialogs); pauses run on the SDK's native timers. Tokens never appear in events or logs.
`stats` reads the client's transports' raw RTCStats (the counters the host differentiates), the one place the
harness reaches past the public API. `npm test` runs the protocol's unit tests under Node.

The whole contract, with the step kinds and the evidence written, is in `scripts/test/rn-e2e/README.md`.

## Versions

Expo 58.0.19, React Native 0.88.0, React 19.3.0, react-native-webrtc 155.0.1 (org.jitsi:webrtc 155.0.1),
`@voltkit-rtc/react-native` 0.1.0 on `@voltkit-rtc/client` 0.9.12 and `@voltkit-rtc/react` 0.1.1.
