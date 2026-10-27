/**
 * What the app tells the host: every event framed with `seq` (a counter per launch) and `run` (the launch's tag),
 * mirrored to logcat as `VKRN-RESULT {json}` and posted to the host over the link in order, one request in flight at
 * a time. The host reads both channels and keeps each `seq` once; a launch's events never answer another launch.
 *
 * An event too long for a logcat line travels over HTTP only, and a short `log` event in logcat says so.
 */
import { GoneError, type HostLink } from './link';
import { compact, logcatLine, LOGCAT_TAG, wireError, type Envelope } from './protocol';

export type EventName = 'hello' | 'result' | 'client' | 'view' | 'native' | 'log';

export class Reporter {
  private seq = 0;
  private readonly queue: Envelope[] = [];
  private sending = false;
  private stopped = false;
  /** Set when the host answered 410: this launch is over. */
  onGone: (() => void) | null = null;

  constructor(
    private readonly link: HostLink,
    readonly run: string,
  ) {}

  /** One event: compacted, numbered, mirrored to logcat, queued for the host. */
  event(name: EventName, fields: Record<string, unknown> = {}): Envelope {
    const safe = compact(fields) as Record<string, unknown>;
    const envelope: Envelope = { name, ...safe, seq: ++this.seq, run: this.run, at: Date.now() };
    const line = logcatLine(envelope);
    if (line) {
      console.log(line);
    } else {
      const bytes = JSON.stringify(envelope).length;
      const stub: Envelope = { name: 'log', level: 'info', message: `event ${envelope.seq} (${name}${name === 'result' ? ` ${String(envelope.id)}` : ''}) is ${bytes} bytes: sent over HTTP only`, seq: ++this.seq, run: this.run, at: Date.now() };
      console.log(`${LOGCAT_TAG} ${JSON.stringify(stub)}`);
    }
    if (!this.stopped) {
      this.queue.push(envelope);
      void this.flush();
    }
    return envelope;
  }

  /** A command's answer. */
  result(id: string, ok: true, result: unknown): void;
  result(id: string, ok: false, error: unknown): void;
  result(id: string, ok: boolean, payload: unknown): void {
    if (ok) this.event('result', { id, ok: true, result: payload ?? {} });
    else this.event('result', { id, ok: false, error: wireError(payload) });
  }

  /** A StreamClient event of client `who`. */
  client(who: string, event: string, data: unknown): void {
    this.event('client', { who, event, data });
  }

  /** A VideoTrack's onDimensionsChange. */
  view(who: string, view: 'local' | 'remote', identity: string | null, source: string | null, size: { width: number; height: number }): void {
    const fields: Record<string, unknown> = { who, view, event: 'dimensions', w: size.width, h: size.height };
    if (identity) fields.identity = identity;
    if (source) fields.source = source;
    this.event('view', fields);
  }

  /** The native side: the call service, the audio output, visibility, the network. */
  native(event: string, data: unknown = {}): void {
    this.event('native', { event, data });
  }

  log(level: 'info' | 'warn', message: string): void {
    this.event('log', { level, message: message.slice(0, 1000) });
  }

  /** No more posting (the launch ended); logcat mirroring goes on for whatever still happens. */
  stop(): void {
    this.stopped = true;
    this.queue.length = 0;
  }

  private async flush(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.queue.length > 0 && !this.stopped) {
        const batch = this.queue.splice(0, 50);
        try {
          await this.link.postEvents(batch);
        } catch (err) {
          if (err instanceof GoneError) {
            this.stop();
            this.onGone?.();
          }
          // Otherwise the host was unreachable: logcat carried the batch.
        }
      }
    } finally {
      this.sending = false;
    }
  }
}
