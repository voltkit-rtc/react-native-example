/**
 * The in-app scenario runner: opened by the host runner's deep link (voltkitrn://scenario?name=ID&run=TAG&host=URL),
 * it mounts up to two VoltkitProviders (clients A and B) with tokens the host mints, the views the host asks for,
 * and answers the host's commands through the SDK's public API (src/e2e/scenarios/*). The contract with the host is
 * scripts/test/rn-e2e/README.md, "The host and the in-app runner".
 *
 * The React tree here is the docs' call screen taken apart: a provider per client with the same props, hooks read in
 * a probe and handed to the command loop, VideoTrack and AudioTrack for what the host wants to see and hear.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Animated, Easing, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { CLIENT_EVENTS, type ClosedReason, type RemoteTrack, type StreamClient } from '@voltkit-rtc/client';
import {
  AudioTrack,
  VideoTrack,
  VoltkitProvider,
  useAudioOutput,
  useCallService,
  useLocalMedia,
  useRemoteTracks,
  useRoom,
  useVoltkitClient,
} from '@voltkit-rtc/react-native';
import { eventData, wireError, type Launch } from './protocol';
import { emptyViews, installLeakCounters, Registry, viewKey, WHOS, type ClientHandle, type RemoteViewSpec, type RunnerControl, type SlotSpec, type ViewSpec, type Who } from './registry';
import { startSession } from './session';

// Before any client exists: the client copies the platform's members when it is made.
installLeakCounters();

type Slots = Record<Who, SlotSpec | null>;
type Views = Record<Who, ViewSpec>;

export function ScenarioRunner({ launch }: { launch: Launch }): ReactElement {
  const registry = useMemo(() => new Registry(), []);
  const [slots, setSlots] = useState<Slots>({ A: null, B: null });
  const [views, setViews] = useState<Views>({ A: emptyViews(), B: emptyViews() });
  const viewsRef = useRef<Views>(views);
  const [nullTrack, setNullTrack] = useState(false);
  const [callServiceOn, setCallServiceOn] = useState(true);

  const control = useMemo<RunnerControl>(
    () => ({
      mountSlot: (spec) => setSlots((s) => ({ ...s, [spec.who]: spec })),
      unmountSlot: (who) => setSlots((s) => ({ ...s, [who]: null })),
      updateViews: (who, update) => {
        const next = update(viewsRef.current[who]);
        viewsRef.current = { ...viewsRef.current, [who]: next };
        registry.views[who] = next;
        setViews(viewsRef.current);
      },
      setNullTrack: (mounted) => {
        registry.nullTrackMounted = mounted;
        setNullTrack(mounted);
      },
      setCallServiceOn: (on) => {
        registry.callServiceOn = on;
        setCallServiceOn(on);
      },
      releaseAll: () => {
        setSlots({ A: null, B: null });
        viewsRef.current = { A: emptyViews(), B: emptyViews() };
        registry.views.A = viewsRef.current.A;
        registry.views.B = viewsRef.current.B;
        setViews(viewsRef.current);
        registry.nullTrackMounted = false;
        setNullTrack(false);
      },
    }),
    [registry],
  );

  useEffect(() => {
    const session = startSession(launch, registry, control);
    return () => session.stop();
    // A new launch (a new run tag) remounts the runner: App keys it by the tag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launch.run, registry, control]);

  return (
    <View style={styles.page}>
      <StatusBar barStyle="light-content" />
      <GlobalProbe registry={registry} />
      <Text style={styles.title}>VoltKit RTC · scenario {launch.scenario}</Text>
      <Text style={styles.sub} numberOfLines={2}>
        run {launch.run} · {launch.host}
      </Text>
      {nullTrack ? <VideoTrack track={null} style={styles.small} testID="null-track" /> : null}
      <ScrollView contentContainerStyle={styles.slots}>
        {WHOS.map((who) => {
          const spec = slots[who];
          return spec ? <ClientSlot key={`${who}-${spec.key}`} spec={spec} views={views[who]} callServiceOn={callServiceOn} registry={registry} /> : null;
        })}
      </ScrollView>
    </View>
  );
}

// ------------------------------------------------------------------------------------------------ global hooks

/** useAudioOutput() and useCallService(), kept in the registry for the commands, their changes posted as native events. */
function GlobalProbe({ registry }: { registry: Registry }): null {
  const audio = useAudioOutput();
  const service = useCallService();
  const mounted = useRef(false);
  useEffect(() => {
    registry.global.audio = audio;
    registry.global.callService = service;
  });
  const currentId = audio.current?.deviceId ?? null;
  useEffect(() => {
    if (!mounted.current) return;
    const device = audio.current ? { id: audio.current.deviceId, type: audio.current.type ?? null, name: audio.current.label } : null;
    registry.reporter?.native('audioOutputChanged', { device, speakerphone: audio.speakerphone });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);
  const types = service.types.join(',');
  useEffect(() => {
    if (!mounted.current) return;
    registry.reporter?.native(service.running ? 'callServiceStarted' : 'callServiceStopped', { declared: service.declared, types: service.types });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service.running, types]);
  useEffect(() => {
    mounted.current = true;
  }, []);
  return null;
}

// ------------------------------------------------------------------------------------------------- one client

function ClientSlot({ spec, views, callServiceOn, registry }: { spec: SlotSpec; views: ViewSpec; callServiceOn: boolean; registry: Registry }): ReactElement {
  const handle = registry.handle(spec.who);
  return (
    <VoltkitProvider
      wsUrl={spec.wsUrl}
      token={spec.token}
      background={spec.background}
      audio={spec.audio}
      callService={callServiceOn && spec.callService !== false}
      onConnected={(result) => handle.onConnected(result)}
      onError={(error) => {
        registry.reporter?.client(spec.who, 'providerError', wireError(error));
        handle.onError(error);
      }}
      onClosed={(reason) => handle.onClosed(reason)}
    >
      <ClientProbe who={spec.who} identity={spec.identity} role={spec.role} views={views} registry={registry} />
    </VoltkitProvider>
  );
}

/**
 * Mirrors the StreamClient's events to the host and records the closed reason. Not mirrored: the sampled events
 * (audioLevels and activeSpeakers, which the `levels` command subscribes to when a scenario asks; networkQuality,
 * videoLimited and cpuConstrained), each of which would cost a getStats every few hundred milliseconds for the whole
 * run and which no scenario waits for.
 */
const SAMPLED = new Set<string>(['audioLevels', 'activeSpeakers', 'networkQuality', 'videoLimited', 'cpuConstrained']);

function attach(client: StreamClient, handle: ClientHandle, registry: Registry): () => void {
  const on = client.on.bind(client) as unknown as (event: string, listener: (...args: unknown[]) => void) => () => void;
  const offs: (() => void)[] = [];
  for (const event of CLIENT_EVENTS) {
    if (SAMPLED.has(event)) continue;
    offs.push(on(event, (...args) => {
      if (event === 'closed') handle.onClosed(args[0] as ClosedReason);
      registry.reporter?.client(handle.who, event, eventData(event, args));
    }));
  }
  return () => {
    for (const off of offs) off();
  };
}

function ClientProbe({ who, identity, role, views, registry }: { who: Who; identity: string; role: string; views: ViewSpec; registry: Registry }): ReactElement {
  const client = useVoltkitClient();
  const local = useLocalMedia();
  const room = useRoom();
  const tracks = useRemoteTracks();
  const handle = registry.handle(who);

  useEffect(() => {
    handle.latest = { client, local, room, tracks };
  });

  useEffect(() => {
    if (!client) return;
    return attach(client, handle, registry);
  }, [client, handle, registry]);

  const camera = local.stream?.getVideoTracks()[0] ?? null;
  const onLocalDimensions = useCallback(
    (size: { width: number; height: number }) => {
      handle.dims('local', null, null, size);
      registry.reporter?.view(who, 'local', null, null, size);
    },
    [handle, registry, who],
  );

  return (
    <View style={styles.slot}>
      <Text style={styles.line}>
        {who} · {identity} · {role} · {room.state}
        {local.publishing ? ' · publishing' : ''}
        {local.screenSharing ? ' · sharing' : ''}
      </Text>
      {views.localPreview && camera ? (
        <VideoTrack track={camera} mirror={views.localPreview.mirror} objectFit="cover" style={styles.local} onDimensionsChange={onLocalDimensions} testID={`${who}-local`} />
      ) : null}
      {local.screenSharing ? <SharePulse /> : null}
      <View style={styles.tiles}>
        {views.remotes.map((spec) => (
          <RemoteTile
            key={viewKey(spec.identity, spec.source)}
            who={who}
            spec={spec}
            track={tracks.find((t) => t.kind === 'video' && t.identity === spec.identity && t.source === spec.source) ?? null}
            handle={handle}
            registry={registry}
          />
        ))}
      </View>
      {views.audio.map((spec) => {
        const t = tracks.find((track) => track.kind === 'audio' && track.identity === spec.identity && track.source === 'mic');
        return t ? <AudioTrack key={spec.identity} track={t.track} volume={spec.volume} muted={spec.muted} /> : null;
      })}
    </View>
  );
}

/**
 * Something moving on the screen while it is shared: Android's screen capturer emits a frame only when the display
 * changes, and the runner's screen is otherwise still (1-2 frames/s in Phase 3's first H8 run), too few to judge how
 * many of the shared frames reach a viewer. A bar slides back and forth on the native driver: a new frame every vsync.
 */
function SharePulse(): ReactElement {
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(x, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(x, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [x]);
  const translateX = x.interpolate({ inputRange: [0, 1], outputRange: [0, 220] });
  return (
    <View style={styles.pulseTrack} testID="share-pulse">
      <Animated.View style={[styles.pulse, { transform: [{ translateX }] }]} />
    </View>
  );
}

function RemoteTile({ who, spec, track, handle, registry }: { who: Who; spec: RemoteViewSpec; track: RemoteTrack | null; handle: ClientHandle; registry: Registry }): ReactElement {
  const producerId = track?.producerId;
  useEffect(() => {
    if (producerId) handle.remoteProducers.set(viewKey(spec.identity, spec.source), producerId);
  }, [handle, producerId, spec.identity, spec.source]);
  const onDimensions = useCallback(
    (size: { width: number; height: number }) => {
      handle.dims('remote', spec.identity, spec.source, size);
      registry.reporter?.view(who, 'remote', spec.identity, spec.source, size);
    },
    [handle, registry, who, spec.identity, spec.source],
  );
  return (
    <View style={styles.tileBox}>
      <VideoTrack
        track={track?.track ?? null}
        producerId={producerId}
        visible={spec.visible}
        objectFit="cover"
        style={spec.size === 'large' ? styles.large : styles.small}
        onDimensionsChange={onDimensions}
        testID={`${who}-${spec.identity}-${spec.source}`}
      />
      <Text style={styles.caption}>
        {spec.identity} · {spec.source} · {spec.size}
        {spec.visible ? '' : ' · hidden'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#0b1020', paddingTop: (StatusBar.currentHeight ?? 0) + 8, paddingHorizontal: 12 },
  title: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  sub: { color: '#8f9bb3', fontSize: 11, marginBottom: 8 },
  slots: { paddingBottom: 24 },
  slot: { marginBottom: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#2a3350', paddingTop: 8 },
  line: { color: '#c8d0e0', fontSize: 12, marginBottom: 6 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tileBox: { alignItems: 'flex-start' },
  local: { width: 150, height: 200, backgroundColor: '#111a33', marginBottom: 8 },
  large: { width: 300, height: 400, backgroundColor: '#111a33' },
  small: { width: 96, height: 128, backgroundColor: '#111a33' },
  caption: { color: '#8f9bb3', fontSize: 10, marginTop: 2 },
  pulseTrack: { width: 300, height: 48, backgroundColor: '#1b2444', borderRadius: 6, marginBottom: 8, overflow: 'hidden' },
  pulse: { width: 80, height: 48, backgroundColor: '#7c9cff', borderRadius: 6 },
});
