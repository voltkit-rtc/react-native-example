/**
 * Token scenarios (T1-T5): an app-driven token refresh. The pushed refresh (tokenRefreshed) needs nothing from the
 * app: the client swaps the token in, and the host reads the `client` events. The bad-token join is `join` with
 * `badToken: true` (connection.ts).
 */
import type { Handler } from '../commands';
import { RunnerError, whoOf } from '../registry';

export const tokens: Record<string, Handler> = {
  /** A fresh token from the host for the same identity and role, handed to the client with updateToken. */
  async updateToken(args, ctx) {
    const who = whoOf(args);
    const handle = ctx.registry.handle(who);
    const client = handle.client();
    if (!handle.role) throw new RunnerError('not-connected', `client ${who} has not joined`);
    const minted = await ctx.link.token(who, handle.role);
    const { expiresAt } = await client.updateToken(minted.token);
    return { expiresAt };
  },
};
