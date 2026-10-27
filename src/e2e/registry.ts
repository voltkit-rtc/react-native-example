/**
 * What the command handlers share with the React tree of the scenario runner: the latest hook values of each
 * client (A and B), the promises a join or a leave waits on, the newest audio levels, every mounted video view and
 * its onDimensionsChange history, the global hooks (audio output, call service), and the controls that mount and
 * unmount providers and views. Plain objects, mutated from render effects, read by the command loop.
 *
 * Also here: a timer-free delay (the SDK's native timers, which keep running in the background), and the leak
 * counters the `leaks` command reports, taken at the one public seam the platform has: the shared
 * `reactNativePlatform()` object, whose capture and release members are wrapped before any client is made.
 */
import type { AudioLevel, ClientPlatform, ClosedReason, JoinResult, RemoteTrack, StreamClient } from '@voltkit-rtc/client';
import { reactNativePlatform, type AudioOutput, type CallServiceState, type LocalMedia, type RoomState } from '@voltkit-rtc/react-native';
import type { Reporter } from './report';

export type Who = 'A' | 'B';

export const WHOS: readonly Who[] = ['A', 'B'];

export function whoOf(args: Record<string, unknown>): Who {
  const w = args.who;
  if (w === undefined || w === 'A') return 'A';
  if (w === 'B') return 'B';
  throw new RunnerError('bad-params', `who must be A or B, not ${JSON.stringify(w)}`);
}

/** A refusal of the runner's own, with a code the host can match. */
export class RunnerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'RunnerError';
  }
}

// ----------------------------------------------------------------------------------------------------- timers

const fallbackTimers = {
  setTimeout: (fn: () => void, ms: number): unknown => setTimeout(fn, ms),
  clearTimeout: (handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** The SDK's timers: native on Android with the module, so they fire in the background too. */
function timers(): { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void } {
  return (reactNativePlatform() as ClientPlatform).timers ?? fallbackTimers;
}

/** A pause on the SDK's timers (never a bare JS timer: those stop in the background). */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    timers().setTimeout(resolve, Math.max(0, ms));
  });
}

/** Resolves when `pred()` is truthy, polling every `everyMs`; rejects after `timeoutMs`. */
export async function waitUntil<T>(pred: () => T | null | undefined | false, timeoutMs: number, what: string, everyMs = 100): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = pred();
    if (value) return value;
    if (Date.now() >= end) throw new RunnerError('timeout', `${what}: not within ${Math.round(timeoutMs / 1000)} s`);
    await delay(everyMs);
  }
}

/** A promise with its settle functions exposed. */
export function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// --------------------------------------------------------------------------------------------------- the views

export interface Dim {
  w: number;
  h: number;
  at: number;
}

export interface RemoteViewSpec {
  identity: string;
  source: string;
  visible: boolean;
  size: 'large' | 'small';
}

export interface AudioViewSpec {
  identity: string;
  volume?: number;
  muted?: boolean;
}

export interface ViewSpec {
  localPreview: { mirror: boolean } | null;
  remotes: RemoteViewSpec[];
  audio: AudioViewSpec[];
}

export const emptyViews = (): ViewSpec => ({ localPreview: null, remotes: [], audio: [] });

export const viewKey = (identity: string, source: string) => `${identity}|${source}`;

// -------------------------------------------------------------------------------------------------- the clients

/** What `join` mounts: a VoltkitProvider with these props. */
export interface SlotSpec {
  who: Who;
  /** A new key mounts a new provider (a new client), as the docs' call screen does to join again. */
  key: number;
  wsUrl: string;
  token: string;
  identity: string;
  role: string;
  background?: { pauseCamera?: boolean; pauseMic?: boolean };
  callService?: boolean;
  audio?: { speakerphone?: boolean; manage?: boolean } | false;
}

export interface Latest {
  client: StreamClient | null;
  local: LocalMedia | null;
  room: RoomState | null;
  tracks: RemoteTrack[];
}

/** One client slot (A or B), as the command handlers see it. */
export class ClientHandle {
  latest: Latest = { client: null, local: null, room: null, tracks: [] };
  /** The identity and role the slot was joined with. */
  identity: string | null = null;
  role: string | null = null;
  /** The newest audioLevels and activeSpeakers events, once a scenario asked for levels (ensureLevels). */
  levels: { levels: AudioLevel[]; speakers: string[]; at: number } = { levels: [], speakers: [], at: 0 };
  private levelsClient: StreamClient | null = null;
  /** The last `closed` event's reason. */
  closed: ClosedReason | null = null;
  connected = false;
  private join: ReturnType<typeof deferred<JoinResult>> | null = null;
  private closing: ReturnType<typeof deferred<ClosedReason>> | null = null;
  readonly localDims: Dim[] = [];
  localMounted = false;
  readonly remoteDims = new Map<string, Dim[]>();
  readonly remoteProducers = new Map<string, string>();

  constructor(readonly who: Who) {}

  /** Before a provider is mounted: the next join's promise. */
  expectJoin(): Promise<JoinResult> {
    this.join = deferred<JoinResult>();
    this.closing = null;
    this.closed = null;
    this.connected = false;
    this.localDims.length = 0;
    this.remoteDims.clear();
    this.remoteProducers.clear();
    return this.join.promise;
  }

  expectClose(): Promise<ClosedReason> {
    if (this.closed) return Promise.resolve(this.closed);
    this.closing = deferred<ClosedReason>();
    return this.closing.promise;
  }

  onConnected(result: JoinResult): void {
    this.connected = true;
    this.join?.resolve(result);
    this.join = null;
  }

  onError(error: Error): void {
    if (!this.join || this.connected) return;
    const pending = this.join;
    // A failed connect: the provider reports it, and the client is not connected a moment later. Warnings during a
    // connect in progress (none expected) would be reported too; a settled join ignores them.
    void delay(300).then(() => {
      if (pending !== this.join || this.connected) return;
      const state = this.latest.client?.connectionState ?? 'idle';
      if (state === 'connected' || state === 'connecting' || state === 'reconnecting') return;
      this.join = null;
      pending.reject(error);
    });
  }

  onClosed(reason: ClosedReason): void {
    this.closed = reason;
    this.closing?.resolve(reason);
    this.closing = null;
    if (this.join) {
      this.join.reject(new RunnerError('closed', `closed before the join finished: ${reason}`));
      this.join = null;
    }
  }

  /**
   * Start listening to this client's audio levels and active speakers (the client samples them only while someone
   * listens: on React Native from the receive transport's stats every 500 ms). Once per client.
   */
  ensureLevels(client: StreamClient): void {
    if (this.levelsClient === client) return;
    this.levelsClient = client;
    this.levels = { levels: [], speakers: [], at: 0 };
    client.on('audioLevels', (levels) => {
      this.levels = { ...this.levels, levels, at: Date.now() };
    });
    client.on('activeSpeakers', ({ speakers }) => {
      this.levels = { ...this.levels, speakers, at: Date.now() };
    });
  }

  /** The client, or a refusal the host can read. */
  client(): StreamClient {
    const client = this.latest.client;
    if (!client) throw new RunnerError('not-connected', `client ${this.who} is not joined`);
    return client;
  }

  local(): LocalMedia {
    const local = this.latest.local;
    if (!local || !this.latest.client) throw new RunnerError('not-connected', `client ${this.who} is not joined`);
    return local;
  }

  dims(view: 'local' | 'remote', identity: string | null, source: string | null, size: { width: number; height: number }): void {
    const entry: Dim = { w: size.width, h: size.height, at: Date.now() };
    if (view === 'local') {
      this.localDims.push(entry);
    } else {
      const key = viewKey(identity ?? '', source ?? 'camera');
      const list = this.remoteDims.get(key) ?? [];
      list.push(entry);
      this.remoteDims.set(key, list);
    }
  }
}

// ------------------------------------------------------------------------------------------------- the registry

export interface GlobalState {
  audio: AudioOutput | null;
  callService: CallServiceState | null;
}

/** What the React tree lets the command handlers change. */
export interface RunnerControl {
  mountSlot(spec: SlotSpec): void;
  unmountSlot(who: Who): void;
  updateViews(who: Who, update: (views: ViewSpec) => ViewSpec): void;
  setNullTrack(mounted: boolean): void;
  setCallServiceOn(on: boolean): void;
  releaseAll(): void;
}

export class Registry {
  readonly handles: Record<Who, ClientHandle> = { A: new ClientHandle('A'), B: new ClientHandle('B') };
  readonly global: GlobalState = { audio: null, callService: null };
  /** A mirror of each slot's view specs (the React state the controls change), for the `views` command. */
  readonly views: Record<Who, ViewSpec> = { A: emptyViews(), B: emptyViews() };
  reporter: Reporter | null = null;
  nullTrackMounted = false;
  callServiceOn = true;

  handle(who: Who): ClientHandle {
    return this.handles[who];
  }

  /** The audio output snapshot as the host reads it. */
  audioOutput(): { supported: boolean; outputs: { id: string; type: string | null; name: string }[]; current: { id: string; type: string | null; name: string } | null; speakerphone: boolean } {
    const a = this.global.audio;
    const device = (d: { deviceId: string; type?: string; label: string }) => ({ id: d.deviceId, type: d.type ?? null, name: d.label });
    if (!a) return { supported: false, outputs: [], current: null, speakerphone: false };
    return { supported: a.supported, outputs: a.outputs.map(device), current: a.current ? device(a.current) : null, speakerphone: a.speakerphone };
  }

  callService(): { declared: boolean; running: boolean; types: string[] } {
    const s = this.global.callService;
    return s ? { declared: s.declared, running: s.running, types: [...s.types] } : { declared: false, running: false, types: [] };
  }
}

// ------------------------------------------------------------------------------------------------ leak counters

export interface LeakCounters {
  streamsMade: number;
  streamsReleased: number;
  tracksStopped: number;
  tracksReleased: number;
  liveStreams: number;
  liveTracks: number;
}

interface CountedTrack {
  id: string;
  remote?: boolean;
}

interface CountedStream {
  getTracks(): CountedTrack[];
}

const counts = { streamsMade: 0, streamsReleased: 0, tracksStopped: 0, tracksReleased: 0 };
/** Local tracks captured through the platform and not stopped yet. */
const liveTracks = new Set<CountedTrack>();
/** Capture streams (getUserMedia, getDisplayMedia) and the tracks of each still alive: empty means released. */
const captures = new Map<CountedStream, Set<CountedTrack>>();
/** Streams already counted as released: a capture emptied by stopTrack and then given to releaseStream counts once. */
const releasedStreams = new WeakSet<object>();
let installed = false;

function countReleased(stream: object): void {
  if (releasedStreams.has(stream)) return;
  releasedStreams.add(stream);
  counts.streamsReleased += 1;
}

/**
 * Count what the client asks the platform for and gives back. Installed once, before any client exists (the client
 * copies the platform's members when it is made): every capture and every createStream is a stream made; a
 * releaseStream, or a capture whose last track was stopped, is a stream released; stopTrack on a local track is a
 * track stopped and released (the platform releases what it stops).
 */
export function installLeakCounters(): void {
  if (installed) return;
  installed = true;
  const platform = reactNativePlatform();
  const members = platform as unknown as Record<string, unknown>;
  const wrap = <K extends 'createStream' | 'releaseStream' | 'getUserMedia' | 'getDisplayMedia' | 'stopTrack'>(name: K, make: (original: NonNullable<ClientPlatform[K]>) => ClientPlatform[K]) => {
    const original = platform[name] as NonNullable<ClientPlatform[K]> | undefined;
    if (typeof original !== 'function') return;
    members[name] = make(original);
  };
  const captured = (stream: unknown) => {
    counts.streamsMade += 1;
    const s = stream as CountedStream;
    const tracks = new Set<CountedTrack>(s.getTracks());
    captures.set(s, tracks);
    for (const t of tracks) liveTracks.add(t);
    return stream;
  };
  wrap('createStream', (original) => (tracks) => {
    counts.streamsMade += 1;
    return original(tracks);
  });
  wrap('releaseStream', (original) => (stream) => {
    countReleased(stream as unknown as object);
    return original(stream);
  });
  wrap('getUserMedia', (original) => async (constraints) => captured(await original(constraints)) as Awaited<ReturnType<typeof original>>);
  wrap('getDisplayMedia', (original) => async (options) => captured(await original(options)) as Awaited<ReturnType<typeof original>>);
  wrap('stopTrack', (original) => (track) => {
    const t = track as unknown as CountedTrack;
    if (!t.remote) {
      counts.tracksStopped += 1;
      counts.tracksReleased += 1;
      liveTracks.delete(t);
      for (const [stream, tracks] of captures) {
        if (!tracks.delete(t) || tracks.size > 0) continue;
        captures.delete(stream);
        countReleased(stream);
      }
    }
    return original(track);
  });
}

export function leakCounters(): LeakCounters {
  return { ...counts, liveStreams: counts.streamsMade - counts.streamsReleased, liveTracks: liveTracks.size };
}
