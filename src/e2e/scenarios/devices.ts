/**
 * Device scenarios (D1-D9, C12): cameras, microphones, the audio output and permissions, all through the public API:
 * useLocalMedia().switchCamera, client.switchDevice and listDevices, useAudioOutput() (read in the runner's global
 * probe), setSpeakerphoneOn, selectAudioOutput and requestMediaPermissions.
 */
import type { DeviceKind } from '@voltkit-rtc/client';
import { requestMediaPermissions, selectAudioOutput, setSpeakerphoneOn, type PermissionKind } from '@voltkit-rtc/react-native';
import type { Handler } from '../commands';
import { delay, RunnerError, waitUntil, whoOf } from '../registry';
import { producerIdOfTrack } from './publishing';

const KINDS: readonly DeviceKind[] = ['audioinput', 'audiooutput', 'videoinput'];
const PERMISSIONS: readonly PermissionKind[] = ['camera', 'microphone', 'notifications'];

function kindOf(value: unknown, required: boolean): DeviceKind | undefined {
  if (value === undefined && !required) return undefined;
  if (!KINDS.includes(value as DeviceKind)) throw new RunnerError('bad-params', `kind must be one of ${KINDS.join(', ')}`);
  return value as DeviceKind;
}

export const devices: Record<string, Handler> = {
  /** The published camera as the app sees it: useLocalMedia().facingMode, the track, its settings and its producer (D1). */
  async localMedia(args, ctx) {
    const handle = ctx.registry.handle(whoOf(args));
    const local = handle.local();
    const client = handle.client();
    const track = client.local?.getVideoTracks()[0] ?? null;
    const settings = (track?.getSettings?.() ?? {}) as { deviceId?: unknown; facingMode?: unknown; width?: unknown; height?: unknown };
    return {
      publishing: local.publishing,
      camEnabled: local.camEnabled,
      micEnabled: local.micEnabled,
      facingMode: local.facingMode,
      trackId: track?.id ?? null,
      producerId: producerIdOfTrack(client, track?.id),
      deviceId: typeof settings.deviceId === 'string' ? settings.deviceId : null,
      trackFacing: typeof settings.facingMode === 'string' ? settings.facingMode : null,
      width: typeof settings.width === 'number' ? settings.width : null,
      height: typeof settings.height === 'number' ? settings.height : null,
    };
  },

  async switchCamera(args, ctx) {
    const handle = ctx.registry.handle(whoOf(args));
    const front = await handle.local().switchCamera();
    const client = handle.client();
    const track = client.local?.getVideoTracks()[0] ?? null;
    return { front, producerId: producerIdOfTrack(client, track?.id), trackId: track?.id ?? null };
  },

  async switchDevice(args, ctx) {
    const kind = kindOf(args.kind, true)!;
    if (typeof args.deviceId !== 'string') throw new RunnerError('bad-params', 'deviceId must be a string');
    await ctx.registry.handle(whoOf(args)).client().switchDevice(kind, args.deviceId);
    return {};
  },

  async listDevices(args, ctx) {
    const list = await ctx.registry.handle(whoOf(args)).client().listDevices(kindOf(args.kind, false));
    return list.map((d) => ({ deviceId: d.deviceId, kind: d.kind, label: d.label, ...(d.type ? { type: d.type } : {}), ...(d.facing ? { facing: d.facing } : {}) }));
  },

  /** useAudioOutput(), as the runner's global probe sees it; the native list arrives a moment after the first subscription. */
  async audioOutput(_args, ctx) {
    const snapshot = () => ctx.registry.audioOutput();
    await waitUntil(() => (snapshot().supported ? snapshot().outputs.length > 0 : true), 2000, 'audio outputs').catch(() => undefined);
    return snapshot();
  },

  async setSpeakerphone(args, ctx) {
    const on = Boolean(args.on);
    await setSpeakerphoneOn(on);
    await delay(400);
    return { speakerphone: ctx.registry.global.audio?.speakerphone ?? on };
  },

  async selectAudioOutput(args, ctx) {
    if (typeof args.id !== 'string') throw new RunnerError('bad-params', 'id must be a string');
    await selectAudioOutput(args.id);
    await delay(400);
    return { current: ctx.registry.audioOutput().current };
  },

  async requestPermissions(args) {
    const kinds = Array.isArray(args.kinds) ? args.kinds : [];
    for (const k of kinds) if (!PERMISSIONS.includes(k as PermissionKind)) throw new RunnerError('bad-params', `kinds must be among ${PERMISSIONS.join(', ')}`);
    return requestMediaPermissions(kinds as PermissionKind[]);
  },
};
