// CallScreen.tsx: the client side of a call (docs: React Native SDK, "A call screen"). Join, your camera and
// microphone, everyone's video, mute, camera off, flip, loudspeaker and leave. Remote sound needs no component:
// react-native-webrtc plays it.
import { useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import { VoltkitProvider, useActiveSpeakers, useLocalMedia, useRemoteTracks, useRoom } from '@voltkit-rtc/react-native';
import { fetchCredentials, type Credentials } from '../token';
import { Controls } from '../components/Controls';
import { ENDED, EndedBanner } from '../components/EndedBanner';
import { Tile } from '../components/Tile';

export function CallScreen({ callId, accessToken, onBack }: { callId: string; accessToken: string; onBack?: () => void }) {
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function join() {
    setBusy(true);
    setNotice(null);
    try {
      setCredentials(await fetchCredentials(callId, accessToken));
      setAttempt((n) => n + 1); // a new key: a new provider with a fresh client
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!credentials) {
    return <EndedBanner notice={notice} actionLabel={busy ? 'Joining…' : `Join ${callId}`} onAction={() => void join()} onBack={onBack} />;
  }

  return (
    <VoltkitProvider
      key={attempt}
      wsUrl={credentials.wsUrl}
      token={credentials.token}
      onError={(err) => console.warn('[voltkit]', err.message)} // warnings too: see Errors
      onClosed={(reason) => {
        setCredentials(null);
        setNotice(ENDED[reason]);
      }}
    >
      <Call onRetry={() => void join()} />
    </VoltkitProvider>
  );
}

function Call({ onRetry }: { onRetry: () => void }) {
  const { state, info, error } = useRoom();
  const local = useLocalMedia();
  const videos = useRemoteTracks({ kind: 'video' });
  const speakers = useActiveSpeakers();
  const [problem, setProblem] = useState<string | null>(null);
  const report = (err: Error) => setProblem(err.message);

  if (state === 'idle' && error) {
    return (
      <View style={styles.center}>
        <Text>Could not join: {error.message}</Text>
        <Button title="Try again" onPress={onRetry} />
      </View>
    );
  }
  if (state === 'idle' || state === 'connecting') {
    return (
      <View style={styles.center}>
        <Text>Joining…</Text>
      </View>
    );
  }

  const canPublish = info?.role === 'host' || info?.role === 'cohost';
  const camera = local.stream?.getVideoTracks()[0];

  return (
    <View style={styles.screen}>
      {state === 'reconnecting' && <Text style={styles.banner}>Reconnecting…</Text>}
      {problem && <Text style={styles.banner}>{problem}</Text>}

      <View style={styles.tiles}>
        {camera && <Tile track={camera} label={`${info?.identity ?? 'you'} (you)`} mirror={local.facingMode === 'user'} speaking={speakers.includes(info?.identity ?? '')} />}
        {videos.map((t) => (
          <Tile key={t.producerId} track={t.track} producerId={t.producerId} label={t.source === 'screen' ? `${t.identity}'s screen` : t.identity} speaking={speakers.includes(t.identity)} />
        ))}
        {!camera && videos.length === 0 && <Text style={styles.empty}>Nobody is on camera yet.</Text>}
      </View>

      <View style={styles.controls}>
        {canPublish && !local.stream && <Button title="Start camera and microphone" onPress={() => local.publish().catch(report)} />}
        <Controls onProblem={report} />
        {state === 'connected' && !canPublish && <Text style={styles.hint}>You are watching as a viewer.</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#ffffff' },
  screen: { flex: 1, backgroundColor: '#000' },
  banner: { color: '#fbbf24', textAlign: 'center', padding: 6 },
  tiles: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignContent: 'flex-start' },
  empty: { color: '#9ca3af', padding: 16 },
  controls: { backgroundColor: '#ffffff', paddingBottom: 12 },
  hint: { color: '#6b7280', textAlign: 'center' },
});
