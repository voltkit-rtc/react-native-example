/**
 * Publishing scenarios (P1-P12, H8): the camera and microphone through useLocalMedia(), the screen share, and the
 * `stats` the host measures with.
 *
 * `stats` reads the send and receive transports' RTCStats. The SDK's public stats (getVideoStats, getReceiveStats)
 * are rates, not the counters the host differentiates (framesDecoded, framesSent, bytesReceived), so the runner reads
 * the raw reports through the client's transports and names each RTP stream with the public remoteTracks and local
 * stream: that is the one place this harness reaches past the public API, guarded so a client without those members
 * answers empty stats rather than failing.
 */
import type { CodecPreference, StreamClient, VideoQuality } from '@voltkit-rtc/client';
import type { LocalPublishOptions } from '@voltkit-rtc/react-native';
import type { Handler } from '../commands';
import { shapeStats, type StatsEntry, type StatsMaps } from '../protocol';
import { leakCounters, RunnerError, whoOf, type ClientHandle } from '../registry';

interface TrackRef {
  id: string;
}

interface TransportLike {
  closed?: boolean;
  getStats(): Promise<unknown>;
}

interface ProducerLike {
  id: string;
  track?: TrackRef | null;
  rtpSender?: { track?: TrackRef | null } | null;
}

interface ConsumerLike {
  localId: string;
  producerId: string;
}

/** The client's transports, producers and consumers, read for stats only; any of them may be missing. */
interface PrivateClient {
  sendTransport?: TransportLike | null;
  recvTransport?: TransportLike | null;
  producers?: Map<string, ProducerLike>;
  consumers?: Map<string, ConsumerLike>;
}

const priv = (client: StreamClient): PrivateClient => client as unknown as PrivateClient;

async function entriesOf(transport: TransportLike | null | undefined): Promise<StatsEntry[]> {
  if (!transport || transport.closed || typeof transport.getStats !== 'function') return [];
  let report: unknown;
  try {
    report = await transport.getStats();
  } catch {
    return [];
  }
  if (!report) return [];
  const values = (report as { values?: () => Iterable<unknown> }).values;
  const list = typeof values === 'function' ? [...values.call(report)] : Array.isArray(report) ? report : Object.values(report as Record<string, unknown>);
  return list.filter((e): e is StatsEntry => Boolean(e) && typeof e === 'object');
}

/** The producer id of the client's own track, when the client lets it be read. */
export function producerIdOfTrack(client: StreamClient, trackId: string | null | undefined): string | null {
  if (!trackId) return null;
  const producers = priv(client).producers;
  if (!(producers instanceof Map)) return null;
  for (const producer of producers.values()) {
    const id = producer.track?.id ?? producer.rtpSender?.track?.id;
    if (id === trackId) return producer.id;
  }
  return null;
}

function statsMaps(handle: ClientHandle, client: StreamClient): StatsMaps {
  const mids = new Map<string, string>();
  const consumers = priv(client).consumers;
  if (consumers instanceof Map) for (const c of consumers.values()) if (c?.producerId) mids.set(c.producerId, c.localId);
  const remote: StatsMaps['remote'] = handle.latest.tracks.map((t) => ({
    producerId: t.producerId,
    identity: t.identity,
    source: t.source,
    trackId: t.track?.id ?? null,
    mid: mids.get(t.producerId) ?? null,
  }));
  const local: StatsMaps['local'] = [];
  const stream = client.local;
  for (const t of stream?.getVideoTracks() ?? []) local.push({ trackId: t.id, source: 'camera', kind: 'video', producerId: producerIdOfTrack(client, t.id) });
  for (const t of stream?.getAudioTracks() ?? []) local.push({ trackId: t.id, source: 'mic', kind: 'audio', producerId: producerIdOfTrack(client, t.id) });
  const screen = handle.latest.local?.screenStream;
  for (const t of screen?.getVideoTracks() ?? []) local.push({ trackId: t.id, source: 'screen', kind: 'video', producerId: producerIdOfTrack(client, t.id) });
  for (const t of screen?.getAudioTracks() ?? []) local.push({ trackId: t.id, source: 'screen-audio', kind: 'audio', producerId: producerIdOfTrack(client, t.id) });
  return { remote, local };
}

const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

export const publishing: Record<string, Handler> = {
  async publish(args, ctx) {
    const local = ctx.registry.handle(whoOf(args)).local();
    const options: LocalPublishOptions = { video: bool(args.camera, true), audio: bool(args.mic, true) };
    if (typeof args.codec === 'string') options.codec = args.codec as CodecPreference;
    if (args.frameRate === 30 || args.frameRate === 60) options.frameRate = args.frameRate;
    if (typeof args.quality === 'string') options.quality = args.quality as VideoQuality;
    if (args.audioQuality === 'std' || args.audioQuality === 'hd') options.audioQuality = args.audioQuality;
    const t0 = Date.now();
    await local.publish(options);
    return { ms: Date.now() - t0 };
  },

  async unpublish(args, ctx) {
    await ctx.registry.handle(whoOf(args)).local().unpublish();
    return {};
  },

  async setMic(args, ctx) {
    const handle = ctx.registry.handle(whoOf(args));
    await handle.local().setMicEnabled(bool(args.on, true));
    return { micEnabled: handle.client().micEnabled };
  },

  async setCam(args, ctx) {
    const handle = ctx.registry.handle(whoOf(args));
    await handle.local().setCamEnabled(bool(args.on, true));
    return { camEnabled: handle.client().camEnabled };
  },

  async setVideoFrameRate(args, ctx) {
    const fps = args.fps;
    if (fps !== 30 && fps !== 60) throw new RunnerError('bad-params', 'fps must be 30 or 60');
    return { frameRate: await ctx.registry.handle(whoOf(args)).local().setVideoFrameRate(fps) };
  },

  async setAudioQuality(args, ctx) {
    const quality = args.quality;
    if (quality !== 'std' && quality !== 'hd') throw new RunnerError('bad-params', 'quality must be std or hd');
    return { quality: await ctx.registry.handle(whoOf(args)).local().setAudioQuality(quality) };
  },

  async setPublishFallback(args, ctx) {
    ctx.registry.handle(whoOf(args)).client().setPublishFallback(bool(args.on, true));
    return {};
  },

  async stats(args, ctx) {
    const handle = ctx.registry.handle(whoOf(args));
    const client = handle.client();
    const [send, recv] = await Promise.all([entriesOf(priv(client).sendTransport), entriesOf(priv(client).recvTransport)]);
    return { connectionState: client.connectionState, ...shapeStats(send, recv, statsMaps(handle, client)) };
  },

  async leaks() {
    return leakCounters();
  },

  async screenShare(args, ctx) {
    const handle = ctx.registry.handle(whoOf(args));
    const local = handle.local();
    if (bool(args.on, true)) {
      const stream = await local.startScreenShare();
      const video = stream.getVideoTracks()[0];
      return { producerId: producerIdOfTrack(handle.client(), video?.id) ?? undefined };
    }
    await local.stopScreenShare();
    return {};
  },
};
