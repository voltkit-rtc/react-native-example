/**
 * The pure part of the in-app scenario runner: the deep link the host runner opens, the event envelope the host reads
 * (`seq`, the run tag, the size a logcat line may have), the compaction that keeps media objects and tokens out of
 * what is reported, and the shaping of raw RTCStats into what the host's `stats` command expects.
 *
 * No React Native import: `node --test src/e2e/__tests__` runs this file as it is (Node strips the types). The host
 * side of the contract is scripts/test/rn-e2e/README.md ("The host and the in-app runner").
 */

// ------------------------------------------------------------------------------------------------- the deep link

/** voltkitrn://scenario?name=<ID>&run=<tag>&host=http://10.0.2.2:<port> */
export interface Launch {
  scenario: string;
  /** The launch's tag: sent back as `run=` on every request and in every event. */
  run: string;
  /** The app server, without a trailing slash. */
  host: string;
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part.replace(/\+/g, ' '));
  } catch {
    return part;
  }
}

/** The query of a URL as a map (React Native's URLSearchParams is incomplete, so by hand). */
export function parseQuery(query: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const i = pair.indexOf('=');
    const key = decode(i < 0 ? pair : pair.slice(0, i));
    out.set(key, i < 0 ? '' : decode(pair.slice(i + 1)));
  }
  return out;
}

/** The scenario launch in a deep link, or null for any other URL (the app then shows its home screen). */
export function parseLaunchUrl(url: string | null | undefined): Launch | null {
  if (!url) return null;
  const m = /^voltkitrn:\/\/scenario\/?(?:\?(.*))?$/i.exec(url.trim());
  if (!m) return null;
  const params = parseQuery(m[1] ?? '');
  const scenario = params.get('name') ?? '';
  const run = params.get('run') ?? '';
  const host = (params.get('host') ?? '').replace(/\/+$/, '');
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(scenario) || !/^[A-Za-z0-9._-]{1,120}$/.test(run)) return null;
  if (!/^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(host)) return null;
  return { scenario, run, host };
}

// --------------------------------------------------------------------------------------------------- compaction

/** Keys whose values never leave the app, whatever they hold. */
const SECRET_KEY = /^(token|accesstoken|apikey|api_key|secret|authorization|password|jwt|controltoken|admintoken)$/i;
/** A JWT, wherever it appears as a string. */
const JWT = /^eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}$/;

const MAX_STRING = 400;
const MAX_ITEMS = 24;
const MAX_KEYS = 48;
const MAX_DEPTH = 6;

interface TrackLike {
  id: string;
  kind: string;
  readyState: string;
  enabled?: boolean;
}

function isTrackLike(value: object): value is TrackLike {
  const t = value as Partial<TrackLike>;
  return typeof t.id === 'string' && typeof t.kind === 'string' && typeof t.readyState === 'string';
}

function isStreamLike(value: object): value is { id?: unknown; getTracks(): unknown[] } {
  return typeof (value as { getTracks?: unknown }).getTracks === 'function';
}

function isErrorLike(value: object): value is { name?: unknown; message: unknown; code?: unknown; data?: unknown } {
  return value instanceof Error || (typeof (value as { message?: unknown }).message === 'string' && 'stack' in value);
}

/** A failure as the host reads it: `{ code, message, data }`. Any RpcError keeps its registry code. */
export function wireError(error: unknown): { code: string; message: string; data?: unknown } {
  if (typeof error === 'string') return { code: 'error', message: error.slice(0, MAX_STRING) };
  if (error && typeof error === 'object') {
    const e = error as { code?: unknown; name?: unknown; message?: unknown; data?: unknown };
    const code = typeof e.code === 'string' && e.code ? e.code : typeof e.name === 'string' && e.name && e.name !== 'Error' ? e.name : 'error';
    const message = typeof e.message === 'string' ? e.message : String(error);
    const out: { code: string; message: string; data?: unknown } = { code, message: message.slice(0, MAX_STRING) };
    if (e.data !== undefined) out.data = compact(e.data);
    return out;
  }
  return { code: 'error', message: String(error).slice(0, MAX_STRING) };
}

/**
 * A value as it may be reported: no token (by key or by shape), no native media object (a track or a stream becomes
 * its id and kind), no function, strings and collections capped. JSON-safe.
 */
export function compact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value === null ? null : undefined;
  switch (typeof value) {
    case 'boolean':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : null;
    case 'bigint':
      return Number(value);
    case 'string':
      if (JWT.test(value)) return '[token]';
      return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…(${value.length})` : value;
    case 'function':
    case 'symbol':
      return undefined;
    default:
  }
  if (depth >= MAX_DEPTH) return '[…]';
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((item) => compact(item, depth + 1) ?? null);
    if (value.length > MAX_ITEMS) items.push(`…+${value.length - MAX_ITEMS}`);
    return items;
  }
  const obj = value as object;
  if (isErrorLike(obj)) return wireError(obj);
  if (isStreamLike(obj)) {
    const tracks = obj.getTracks().map((t) => (t && typeof t === 'object' && isTrackLike(t) ? { id: t.id, kind: t.kind, readyState: t.readyState } : '?'));
    return { stream: typeof obj.id === 'string' ? obj.id : undefined, tracks };
  }
  if (isTrackLike(obj)) return { id: obj.id, kind: obj.kind, readyState: obj.readyState, enabled: obj.enabled };
  if (obj instanceof Map) return compact([...obj.entries()], depth);
  if (obj instanceof Set) return compact([...obj.values()], depth);
  const out: Record<string, unknown> = {};
  let keys = 0;
  for (const key of Object.keys(obj)) {
    if (SECRET_KEY.test(key)) continue;
    const v = compact((obj as Record<string, unknown>)[key], depth + 1);
    if (v === undefined) continue;
    if (++keys > MAX_KEYS) {
      out['…'] = `+${Object.keys(obj).length - MAX_KEYS} keys`;
      break;
    }
    out[key] = v;
  }
  return out;
}

/**
 * What a StreamClient event carries, as the host matches it (`expectClient(who, event, match)` looks at `data`): a
 * primitive argument becomes `{ reason }` or `{ value }`, the join result is summarised, and everything else is
 * compacted.
 */
export function eventData(event: string, args: unknown[]): unknown {
  const [first] = args;
  switch (event) {
    case 'closed':
    case 'disconnected':
      return { reason: typeof first === 'string' ? first : compact(first) };
    case 'joined': {
      const j = (first ?? {}) as { roomId?: unknown; identity?: unknown; role?: unknown; nodeId?: unknown; participants?: unknown[]; producers?: unknown[] };
      return { roomId: j.roomId, identity: j.identity, role: j.role, nodeId: j.nodeId, participants: j.participants?.length ?? 0, producers: j.producers?.length ?? 0 };
    }
    case 'audioLevels':
      return { count: Array.isArray(first) ? first.length : 0 };
    default:
  }
  if (args.length === 0) return {};
  if (args.length === 1) {
    if (first === null || typeof first !== 'object') return { value: compact(first) ?? null };
    return compact(first);
  }
  return { args: compact(args) };
}

// ------------------------------------------------------------------------------------------------- the envelope

/** Every event the app sends: `name`, the fields, `seq` (a counter per launch), `run` (the launch's tag), `at`. */
export interface Envelope {
  name: string;
  seq: number;
  run: string;
  at: number;
  [field: string]: unknown;
}

/** Logcat cuts long lines; the host drops a cut one. Events longer than this travel over HTTP only. */
export const LOGCAT_LIMIT = 3800;
export const LOGCAT_TAG = 'VKRN-RESULT';

/** The logcat mirror of an event, or null when the line would be too long for logcat (a stub is logged instead). */
export function logcatLine(event: Envelope): string | null {
  const json = JSON.stringify(event);
  return json.length <= LOGCAT_LIMIT ? `${LOGCAT_TAG} ${json}` : null;
}

// ----------------------------------------------------------------------------------------------- shaping stats

/** One entry of an RTCStatsReport, as react-native-webrtc serialises it (libwebrtc's names). */
export type StatsEntry = Record<string, unknown> & { type?: string; id?: string };

/** What the runner knows about the tracks, so the host can name each RTP stream. */
export interface StatsMaps {
  /** Every remote track the client receives: its producer, publisher, source and track id (inbound `trackIdentifier`). */
  remote: { producerId: string; identity: string; source: string; trackId: string | null; mid?: string | null }[];
  /** The client's own tracks: camera, microphone and screen, with the producer id when known. */
  local: { trackId: string; source: 'camera' | 'mic' | 'screen' | 'screen-audio'; kind: 'audio' | 'video'; producerId: string | null }[];
}

export interface InboundVideo {
  producerId: string | null;
  identity: string | null;
  source: string;
  mid: string | null;
  framesDecoded: number | null;
  framesReceived: number | null;
  framesPerSecond: number | null;
  frameWidth: number | null;
  frameHeight: number | null;
  bytesReceived: number | null;
  codec: string | null;
}

export interface InboundAudio {
  producerId: string | null;
  identity: string | null;
  source: string;
  mid: string | null;
  bytesReceived: number | null;
  audioLevel: number | null;
}

/** What the server reported back about one outbound stream (remote-inbound-rtp): what the publisher fallback judges. */
export interface RemoteReport {
  packetsSent: number | null;
  /** Packets the server counted lost (cumulative). */
  remoteLost: number | null;
  /** The server's latest fraction lost (0..1). */
  remoteFractionLost: number | null;
  rttMs: number | null;
}

export interface OutboundVideo extends RemoteReport {
  producerId: string | null;
  source: 'camera' | 'screen';
  rid: string | null;
  framesSent: number | null;
  bytesSent: number | null;
  frameWidth: number | null;
  frameHeight: number | null;
  framesPerSecond: number | null;
  active: boolean | null;
  scalabilityMode: string | null;
  qualityLimitationReason: string | null;
  codec: string | null;
}

export interface OutboundAudio extends RemoteReport {
  producerId: string | null;
  source: string;
  bytesSent: number | null;
}

export interface ShapedStats {
  inbound: { video: InboundVideo[]; audio: InboundAudio[] };
  outbound: { video: OutboundVideo[]; audio: OutboundAudio[]; micLevel: number | null };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const kindOf = (e: StatsEntry): string | null => str(e.kind) ?? str(e.mediaType);

function codecName(entries: StatsEntry[], codecId: unknown): string | null {
  if (typeof codecId !== 'string') return null;
  const codec = entries.find((e) => e.id === codecId);
  const mime = str(codec?.mimeType);
  return mime ? mime.replace(/^(audio|video)\//, '') : null;
}

/** The host's `stats` shape from the send and receive transports' RTCStats. Entries with mid `probator` are skipped. */
export function shapeStats(send: StatsEntry[], recv: StatsEntry[], maps: StatsMaps): ShapedStats {
  const inbound: ShapedStats['inbound'] = { video: [], audio: [] };
  for (const e of recv) {
    if (e.type !== 'inbound-rtp') continue;
    const mid = str(e.mid);
    if (mid === 'probator') continue;
    const trackId = str(e.trackIdentifier);
    const remote = maps.remote.find((r) => r.trackId !== null && r.trackId === trackId) ?? maps.remote.find((r) => r.mid != null && r.mid === mid) ?? null;
    const kind = kindOf(e);
    const base = { producerId: remote?.producerId ?? null, identity: remote?.identity ?? null, mid };
    if (kind === 'video') {
      inbound.video.push({
        ...base,
        source: remote?.source ?? 'camera',
        framesDecoded: num(e.framesDecoded),
        framesReceived: num(e.framesReceived),
        framesPerSecond: num(e.framesPerSecond),
        frameWidth: num(e.frameWidth),
        frameHeight: num(e.frameHeight),
        bytesReceived: num(e.bytesReceived),
        codec: codecName(recv, e.codecId),
      });
    } else if (kind === 'audio') {
      inbound.audio.push({ ...base, source: remote?.source ?? 'mic', bytesReceived: num(e.bytesReceived), audioLevel: num(e.audioLevel) });
    }
  }

  const outbound: ShapedStats['outbound'] = { video: [], audio: [], micLevel: null };
  const sources = send.filter((e) => e.type === 'media-source');
  const remotes = send.filter((e) => e.type === 'remote-inbound-rtp');
  const reportOf = (e: StatsEntry): RemoteReport => {
    const r = remotes.find((x) => x.localId === e.id) ?? null;
    const rtt = r ? num(r.roundTripTime) : null;
    return { packetsSent: num(e.packetsSent), remoteLost: r ? num(r.packetsLost) : null, remoteFractionLost: r ? num(r.fractionLost) : null, rttMs: rtt === null ? null : Math.round(rtt * 1000) };
  };
  const localOf = (e: StatsEntry) => {
    const source = sources.find((s) => s.id === e.mediaSourceId);
    const trackId = str(source?.trackIdentifier);
    return { source, local: maps.local.find((l) => l.trackId === trackId) ?? null };
  };
  for (const e of send) {
    if (e.type !== 'outbound-rtp') continue;
    if (str(e.mid) === 'probator') continue;
    const { local } = localOf(e);
    const kind = kindOf(e);
    if (kind === 'video') {
      outbound.video.push({
        producerId: local?.producerId ?? null,
        source: local?.source === 'screen' ? 'screen' : 'camera',
        rid: str(e.rid),
        framesSent: num(e.framesSent),
        bytesSent: num(e.bytesSent),
        ...reportOf(e),
        frameWidth: num(e.frameWidth),
        frameHeight: num(e.frameHeight),
        framesPerSecond: num(e.framesPerSecond),
        active: typeof e.active === 'boolean' ? e.active : null,
        scalabilityMode: str(e.scalabilityMode),
        qualityLimitationReason: str(e.qualityLimitationReason),
        codec: codecName(send, e.codecId),
      });
    } else if (kind === 'audio') {
      outbound.audio.push({ producerId: local?.producerId ?? null, source: local?.source ?? 'mic', bytesSent: num(e.bytesSent), ...reportOf(e) });
    }
  }
  const mic = sources.find((s) => kindOf(s) === 'audio' && maps.local.some((l) => l.source === 'mic' && l.trackId === s.trackIdentifier)) ?? sources.find((s) => kindOf(s) === 'audio');
  outbound.micLevel = mic ? num(mic.audioLevel) : null;
  return { inbound, outbound };
}

// ------------------------------------------------------------------------------------------------------ tokens

/**
 * A token that no longer verifies, for the `badToken` join and the `badToken` preflight: the first character of its
 * signature changed. Not the last one: a base64url segment's last character can carry only padding bits (an HS256
 * signature is 43 characters for 32 bytes, so its last character holds 2 bits of signature and 4 of padding), which a
 * lenient decoder ignores, and a token "corrupted" there still verified (Phase 3, C1 on the final pass).
 */
export function corruptToken(token: string): string {
  if (!token) return 'not-a-token';
  const parts = token.split('.');
  const target = parts.length === 3 && parts[2].length > 0 ? 2 : 0;
  const segment = parts[target] ?? token;
  const first = segment[0];
  const swap = first === 'a' ? 'b' : 'a';
  parts[target] = swap + segment.slice(1);
  return parts.join('.');
}
