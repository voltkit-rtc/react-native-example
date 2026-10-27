/**
 * Room scenarios (G1, I1): hands, seats, metadata and chat, on the client useVoltkitClient() returns, as the docs'
 * audio room does. Moderation (promote, forceMute, kick, endRoom) comes from the host runner's observer.
 */
import type { Handler } from '../commands';
import { RunnerError, whoOf } from '../registry';

const metadataOf = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);

export const room: Record<string, Handler> = {
  async raiseHand(args, ctx) {
    await ctx.registry.handle(whoOf(args)).client().raiseHand(metadataOf(args.metadata));
    return {};
  },

  async lowerHand(args, ctx) {
    await ctx.registry.handle(whoOf(args)).client().lowerHand(typeof args.identity === 'string' ? args.identity : undefined);
    return {};
  },

  async claim(args, ctx) {
    if (typeof args.key !== 'string' || !args.key) throw new RunnerError('bad-params', 'key must be a non-empty string');
    await ctx.registry.handle(whoOf(args)).client().claim(args.key);
    return {};
  },

  async release(args, ctx) {
    if (typeof args.key !== 'string' || !args.key) throw new RunnerError('bad-params', 'key must be a non-empty string');
    await ctx.registry.handle(whoOf(args)).client().release(args.key);
    return {};
  },

  async setMetadata(args, ctx) {
    const metadata = metadataOf(args.metadata);
    if (!metadata) throw new RunnerError('bad-params', 'metadata must be an object');
    await ctx.registry.handle(whoOf(args)).client().setMetadata(metadata);
    return {};
  },

  async sendMessage(args, ctx) {
    if (typeof args.text !== 'string') throw new RunnerError('bad-params', 'text must be a string');
    const clientMsgId = typeof args.clientMsgId === 'string' ? args.clientMsgId : undefined;
    const sent = await ctx.registry.handle(whoOf(args)).client().sendMessage(args.text, clientMsgId ? { clientMsgId } : {});
    return { ...sent, ...(clientMsgId ? { clientMsgId } : {}) };
  },
};
