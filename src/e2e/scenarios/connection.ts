/**
 * Connection scenarios (C1-C13): join, leave, the app's state, and `done`.
 *
 * `join` mounts a VoltkitProvider for client A or B with a token the host minted (POST /token), exactly as the docs'
 * call screen does: a new provider (a new key) per join, props for the background pause, the call service and the
 * call audio. It resolves when the provider reports the join (onConnected) and rejects with the connect error when
 * it fails (a bad token), so the host sees the registry code.
 */
import { AppState, Platform } from 'react-native';
import type { ClosedReason, JoinResult } from '@voltkit-rtc/client';
import { reactNativePlatform } from '@voltkit-rtc/react-native';
import type { Args, Handler } from '../commands';
import { corruptToken } from '../protocol';
import { delay, RunnerError, whoOf, type SlotSpec } from '../registry';

const ROLES = ['host', 'cohost', 'moderator', 'viewer'] as const;
type Role = (typeof ROLES)[number];

let keys = 0;

/** Rejects after `ms` with a runner timeout; the waited promise's own later outcome is swallowed. */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  promise.catch(() => undefined);
  const timer = delay(ms).then((): never => {
    throw new RunnerError('timeout', `${what}: no answer within ${Math.round(ms / 1000)} s`);
  });
  return Promise.race([promise, timer]);
}

function backgroundOf(args: Args): SlotSpec['background'] {
  const b = args.background;
  if (!b || typeof b !== 'object') return undefined;
  const { pauseCamera, pauseMic } = b as { pauseCamera?: unknown; pauseMic?: unknown };
  return {
    ...(typeof pauseCamera === 'boolean' ? { pauseCamera } : {}),
    ...(typeof pauseMic === 'boolean' ? { pauseMic } : {}),
  };
}

function audioOf(args: Args): SlotSpec['audio'] {
  const a = args.audio;
  if (a === false) return false;
  if (!a || typeof a !== 'object') return undefined;
  const { speakerphone, manage } = a as { speakerphone?: unknown; manage?: unknown };
  return {
    ...(typeof speakerphone === 'boolean' ? { speakerphone } : {}),
    ...(typeof manage === 'boolean' ? { manage } : {}),
  };
}

export const connection: Record<string, Handler> = {
  async join(args, ctx) {
    const who = whoOf(args);
    const role = (typeof args.role === 'string' ? args.role : 'viewer') as Role;
    if (!ROLES.includes(role)) throw new RunnerError('bad-params', `role must be one of ${ROLES.join(', ')}, not ${JSON.stringify(args.role)}`);
    const handle = ctx.registry.handle(who);
    const minted = await ctx.link.token(who, role);
    const token = args.badToken ? corruptToken(minted.token) : minted.token;
    handle.identity = minted.identity;
    handle.role = role;
    const joined: Promise<JoinResult> = handle.expectJoin();
    const spec: SlotSpec = {
      who,
      key: ++keys,
      wsUrl: minted.wsUrl,
      token,
      identity: minted.identity,
      role,
      background: backgroundOf(args),
      callService: typeof args.callService === 'boolean' ? args.callService : undefined,
      audio: audioOf(args),
    };
    const t0 = Date.now();
    ctx.control.mountSlot(spec);
    const result = await withTimeout(joined, 60_000, `join ${who}`);
    return { roomId: result.roomId, identity: result.identity, role: result.role, nodeId: result.nodeId, ms: Date.now() - t0 };
  },

  async leave(args, ctx) {
    const handle = ctx.registry.handle(whoOf(args));
    const client = handle.client();
    const closing: Promise<ClosedReason> = handle.expectClose();
    // useRoom().leave() is client.close(): the docs' Leave button.
    (handle.latest.room?.leave ?? (() => client.close()))();
    const reason = await withTimeout(closing, 5000, 'leave').catch(() => handle.closed ?? null);
    return { reason };
  },

  async done(_args, ctx) {
    ctx.control.releaseAll();
    await delay(300);
    return {};
  },

  async appState() {
    return { appState: AppState.currentState, visible: reactNativePlatform().appVisible(), os: Platform.OS };
  },
};
