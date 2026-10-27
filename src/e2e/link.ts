/**
 * The link to the host runner (scripts/test/rn-e2e/run.mjs): /config, /token, /next, /sleep and /event, every
 * request carrying this launch's run tag.
 *
 * XMLHttpRequest only, never fetch and never a JS timer: React Native's fetch (whatwg-fetch) settles through
 * setTimeout(0), and JS timers stop while the app is in the background, with the screen off and during permission
 * dialogs, which is exactly when the host still needs answers. An XHR's onload is a native event and arrives then too
 * (Phase 0 S5). Pauses go through GET /sleep, or the SDK's native timers (registry.ts delay()).
 */

export type Reply<T> = { status: number; body: T | null };

/** The host holds a `/next` poll up to 20 s; one still unanswered after this is stranded and given up (see HostLink.next). */
export const POLL_TIMEOUT_MS = 25_000;

export function xhr<T = unknown>(method: 'GET' | 'POST', url: string, body?: unknown, timeoutMs = 0, hold?: (req: XMLHttpRequest) => void): Promise<Reply<T>> {
  return new Promise((resolve, reject) => {
    const req = new XMLHttpRequest();
    hold?.(req);
    req.open(method, url);
    req.setRequestHeader('Content-Type', 'application/json');
    if (timeoutMs > 0) req.timeout = timeoutMs;
    req.onload = () => {
      let parsed: T | null = null;
      try {
        parsed = req.responseText ? (JSON.parse(req.responseText) as T) : null;
      } catch {
        parsed = null;
      }
      resolve({ status: req.status, body: parsed });
    };
    const path = url.replace(/\?.*$/, '');
    req.onerror = () => reject(new Error(`network error: ${method} ${path}`));
    req.ontimeout = () => reject(new Error(`timed out: ${method} ${path}`));
    req.onabort = () => reject(new Error(`aborted: ${method} ${path}`));
    req.send(body === undefined ? null : JSON.stringify(body));
  });
}

/** GET /config: the run, the scenario, the room, the identities and whether this is a LAN run. */
export interface RunConfig {
  run: string;
  scenario: string;
  room: string;
  ids: Record<string, string>;
  lan: boolean;
}

/** POST /token: a room token the host minted with the API key (the app never holds the key). */
export interface TokenReply {
  token: string;
  wsUrl: string;
  identity: string;
  role: string;
  room: string;
  expiresAt: number | null;
}

export interface Command {
  id: string;
  cmd: string;
  args?: Record<string, unknown>;
}

/** The host answered 410: this launch is over (a newer one took its place) or was never started. */
export class GoneError extends Error {
  constructor(what: string) {
    super(`${what}: the host says this launch is over (410)`);
    this.name = 'GoneError';
  }
}

export class HostLink {
  readonly host: string;
  readonly run: string;
  /** The `/next` poll in flight, for abortPoll. */
  private polling: XMLHttpRequest | null = null;

  constructor(host: string, run: string) {
    this.host = host;
    this.run = run;
  }

  url(path: string, query = ''): string {
    return `${this.host}${path}?run=${encodeURIComponent(this.run)}${query}`;
  }

  async config(): Promise<RunConfig> {
    const r = await xhr<RunConfig & { error?: string }>('GET', this.url('/config'), undefined, 20000);
    if (r.status === 410) throw new GoneError('config');
    if (r.status !== 200 || !r.body || typeof r.body.room !== 'string') throw new Error(`config: HTTP ${r.status} ${r.body?.error ?? ''}`.trim());
    return r.body;
  }

  /** A token for client `who` (A or B) with `role`, minted by the host for the scenario's current room. */
  async token(who: string, role: string): Promise<TokenReply> {
    const r = await xhr<TokenReply & { error?: string }>('POST', this.url('/token'), { who, role }, 30000);
    if (r.status === 410) throw new GoneError('token');
    if (r.status !== 200 || !r.body?.token || !r.body.wsUrl) throw new Error(`token for ${who} (${role}): HTTP ${r.status} ${r.body?.error ?? ''}`.trim());
    return r.body;
  }

  /**
   * The next command: the host holds the poll up to 20 s. null when none came; 'gone' when the launch is over. A poll
   * still unanswered after POLL_TIMEOUT_MS is stranded (the network handle it was sent on went away under it, which
   * neither side can see) and rejects, so the loop polls again on whatever network there is now.
   */
  async next(): Promise<Command | null | 'gone'> {
    const r = await xhr<Command>('GET', this.url('/next'), undefined, POLL_TIMEOUT_MS, (req) => {
      this.polling = req;
    });
    if (r.status === 410) return 'gone';
    if (r.status === 200 && r.body && typeof r.body.cmd === 'string' && typeof r.body.id === 'string') return r.body;
    return null;
  }

  /** Cut the poll in flight (the network came back, or the app did): next() rejects as aborted and the loop polls again at once. */
  abortPoll(): void {
    const req = this.polling;
    this.polling = null;
    if (req && req.readyState !== 4) req.abort();
  }

  /** A pause that needs no timer: the host answers after `ms`. */
  async sleep(ms: number): Promise<void> {
    await xhr('GET', this.url('/sleep', `&ms=${Math.max(0, Math.round(ms))}`), undefined, ms + 15000).catch(() => undefined);
  }

  /** POST /event with one or more events. Resolves false when the host could not be reached (logcat still carried them). */
  async postEvents(events: unknown[]): Promise<boolean> {
    try {
      const r = await xhr('POST', this.url('/event'), events, 20000);
      if (r.status === 410) throw new GoneError('event');
      return r.status === 200;
    } catch (err) {
      if (err instanceof GoneError) throw err;
      return false;
    }
  }
}
