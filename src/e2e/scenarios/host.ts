/**
 * Harness and health scenarios (H6, H7, H9): the diagnostics, the pre-call check and a listener that throws.
 *
 * `preflight` runs the SDK's preflight with a token the host minted. Its `mode` names what the host has arranged:
 * `badToken` corrupts the token here; `offline` and `denied` are the host's doing (the network off, the camera
 * permission revoked), and `denied` asks the check to test the camera too, so the refused permission shows in the
 * report (the SDK's default check publishes the microphone alone).
 */
import type { ClientEvents, PreflightOptions } from '@voltkit-rtc/client';
import { preflight } from '@voltkit-rtc/react-native';
import type { Handler } from '../commands';
import { corruptToken } from '../protocol';
import { delay, RunnerError, whoOf } from '../registry';

/**
 * `preflight {mode: offline}` waits this long (the SDK's native timers) before it starts: the host sends the command,
 * then cuts the network, which also cuts the app's link to the host, so the command has to be in the app first. The
 * result reaches the host through logcat while the network is off.
 */
export const OFFLINE_START_DELAY_MS = 2000;

const MODES = ['ok', 'badToken', 'offline', 'denied'] as const;

/** A stand-in stream naming the devices the check should capture once joined (the SDK captures them itself). */
function devicesForTest(kinds: ('audio' | 'video')[]): PreflightOptions['media'] {
  const tracks = kinds.map((kind) => Object.freeze({ kind, getSettings: () => ({}) }));
  return Object.freeze({
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
  }) as unknown as PreflightOptions['media'];
}

export const host: Record<string, Handler> = {
  async diagnostics(args, ctx) {
    return ctx.registry.handle(whoOf(args)).client().getDiagnostics();
  },

  async preflight(args, ctx) {
    const mode = (args.mode ?? 'ok') as (typeof MODES)[number];
    if (!MODES.includes(mode)) throw new RunnerError('bad-params', `mode must be one of ${MODES.join(', ')}`);
    const minted = await ctx.link.token('A', 'host');
    const token = mode === 'badToken' ? corruptToken(minted.token) : minted.token;
    const options: Parameters<typeof preflight>[2] = { durationMs: 4000 };
    if (mode === 'denied') options.media = devicesForTest(['audio', 'video']);
    if (mode === 'offline') await delay(OFFLINE_START_DELAY_MS);
    return preflight(minted.wsUrl, token, options);
  },

  async throwInListener(args, ctx) {
    if (typeof args.event !== 'string' || !args.event) throw new RunnerError('bad-params', 'event must be an event name');
    const client = ctx.registry.handle(whoOf(args)).client();
    client.on(args.event as keyof ClientEvents, (() => {
      throw new Error(`scenario listener for ${String(args.event)} threw on purpose`);
    }) as never);
    return {};
  },
};
