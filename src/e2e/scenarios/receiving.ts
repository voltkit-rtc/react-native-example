/**
 * Receiving scenarios (R1-R7, B6, C10, H4): the views the host asks for. A remote VideoTrack with its producerId
 * (adaptive stream from the tile's size and visibility), the mirrored local preview, an AudioTrack's volume and mute,
 * the newest audio levels, and a VideoTrack with a null track before any client exists (C12).
 */
import type { Handler } from '../commands';
import { delay, RunnerError, viewKey, whoOf, type ViewSpec } from '../registry';

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !v) throw new RunnerError('bad-params', `${name} must be a non-empty string`);
  return v;
};

export const receiving: Record<string, Handler> = {
  async showRemote(args, ctx) {
    const who = whoOf(args);
    const identity = str(args.identity, 'identity');
    const source = typeof args.source === 'string' ? args.source : 'camera';
    const visible = typeof args.visible === 'boolean' ? args.visible : true;
    const size = args.size === 'small' ? 'small' : 'large';
    ctx.control.updateViews(who, (views): ViewSpec => {
      const key = viewKey(identity, source);
      const remotes = views.remotes.filter((r) => viewKey(r.identity, r.source) !== key);
      remotes.push({ identity, source, visible, size });
      return { ...views, remotes };
    });
    await delay(50);
    return {};
  },

  async localPreview(args, ctx) {
    const who = whoOf(args);
    const mounted = typeof args.mounted === 'boolean' ? args.mounted : true;
    const mirror = Boolean(args.mirror);
    ctx.control.updateViews(who, (views): ViewSpec => ({ ...views, localPreview: mounted ? { mirror } : null }));
    ctx.registry.handle(who).localMounted = mounted;
    await delay(50);
    return {};
  },

  async audioTrack(args, ctx) {
    const who = whoOf(args);
    const handle = ctx.registry.handle(who);
    const identity = str(args.identity, 'identity');
    const mounted = typeof args.mounted === 'boolean' ? args.mounted : true;
    const volume = typeof args.volume === 'number' && Number.isFinite(args.volume) ? Math.min(1, Math.max(0, args.volume)) : undefined;
    const muted = typeof args.muted === 'boolean' ? args.muted : undefined;
    ctx.control.updateViews(who, (views): ViewSpec => {
      const audio = views.audio.filter((a) => a.identity !== identity);
      if (mounted) audio.push({ identity, ...(typeof args.volume === 'number' ? { volume: args.volume } : {}), ...(muted !== undefined ? { muted } : {}) });
      return { ...views, audio };
    });
    // The AudioTrack's effects run after the commit; one frame and a short wait are enough to read the track.
    await delay(250);
    const track = handle.latest.tracks.find((t) => t.kind === 'audio' && t.identity === identity && t.source === 'mic')?.track;
    return { volume: volume ?? null, enabled: track ? track.enabled : null, mounted };
  },

  async views(_args, ctx) {
    const { handles, views } = ctx.registry;
    const remotes = (['A', 'B'] as const).flatMap((who) =>
      views[who].remotes.map((spec) => {
        const track = handles[who].latest.tracks.find((t) => t.kind === 'video' && t.identity === spec.identity && t.source === spec.source);
        return {
          who,
          identity: spec.identity,
          source: spec.source,
          producerId: track?.producerId ?? handles[who].remoteProducers.get(viewKey(spec.identity, spec.source)) ?? null,
          visible: spec.visible,
          size: spec.size,
          dims: handles[who].remoteDims.get(viewKey(spec.identity, spec.source)) ?? [],
        };
      }),
    );
    const localOf = (['A', 'B'] as const).find((who) => views[who].localPreview) ?? 'A';
    return { local: { who: localOf, mounted: Boolean(views[localOf].localPreview), dims: handles[localOf].localDims }, remotes };
  },

  async levels(args, ctx) {
    const handle = ctx.registry.handle(whoOf(args));
    handle.ensureLevels(handle.client());
    const { levels } = handle;
    return {
      levels: levels.levels.map((l) => ({ identity: l.identity, source: l.source, level: l.level, speaking: l.speaking, local: l.local })),
      speakers: levels.speakers,
      ageMs: levels.at ? Date.now() - levels.at : null,
    };
  },

  async nullVideoTrack(_args, ctx) {
    ctx.control.setNullTrack(true);
    await delay(300);
    return { mounted: true };
  },
};
