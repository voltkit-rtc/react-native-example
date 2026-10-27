// An audio room with a stage (docs: React Native SDK, "Moderation, seats and audio rooms"; Group audio rooms): the
// host and co-hosts publish their microphone and take seats, listeners raise a hand, the host brings them on stage,
// mutes, removes, or ends the room; chat for everyone; the output picker for where sound plays.
import { useEffect, useRef, useState } from 'react';
import { Button, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { VoltkitProvider, useActiveSpeakers, useLocalMedia, useParticipants, useRoom, useVoltkitClient } from '@voltkit-rtc/react-native';
import { fetchRoomCredentials, type Credentials } from '../token';
import { ChatPanel } from '../components/ChatPanel';
import { Controls } from '../components/Controls';
import { ENDED, EndedBanner } from '../components/EndedBanner';
import { OutputPicker } from '../components/OutputPicker';

const SEATS = ['seat-1', 'seat-2', 'seat-3', 'seat-4', 'seat-5', 'seat-6'];

export function AudioRoomScreen({ roomId, accessToken, host, onBack }: { roomId: string; accessToken: string; host: boolean; onBack?: () => void }) {
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function join() {
    setBusy(true);
    setNotice(null);
    try {
      setCredentials(await fetchRoomCredentials(roomId, accessToken, host ? 'host' : 'viewer'));
      setAttempt((n) => n + 1);
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!credentials) {
    return <EndedBanner notice={notice} actionLabel={busy ? 'Joining…' : `Join ${roomId} as ${host ? 'host' : 'listener'}`} onAction={() => void join()} onBack={onBack} />;
  }

  return (
    <VoltkitProvider
      key={attempt}
      wsUrl={credentials.wsUrl}
      token={credentials.token}
      audio={{ speakerphone: true }}
      onError={(err) => console.warn('[voltkit]', err.message)}
      onClosed={(reason) => {
        setCredentials(null);
        setNotice(ENDED[reason]);
      }}
    >
      <Room onRetry={() => void join()} />
    </VoltkitProvider>
  );
}

function Room({ onRetry }: { onRetry: () => void }) {
  const client = useVoltkitClient();
  const { state, info, error } = useRoom();
  const local = useLocalMedia();
  const participants = useParticipants();
  const speakers = useActiveSpeakers();
  const [tab, setTab] = useState<'room' | 'chat'>('room');
  const [problem, setProblem] = useState<string | null>(null);
  const report = (err: Error) => setProblem(err.message);
  const published = useRef(false);

  const me = info?.identity ?? null;
  const role = info?.role;
  const onStage = role === 'host' || role === 'cohost';
  const moderator = role === 'host' || role === 'moderator';
  const myHand = participants.find((p) => p.identity === me)?.handRaised ?? false;

  // On stage: the microphone goes on once, when the room is joined or the role changes to one that may speak.
  useEffect(() => {
    if (state !== 'connected' || !onStage || published.current || local.publishing) return;
    published.current = true;
    local.publish({ video: false }).catch((err: Error) => {
      published.current = false;
      report(err);
    });
  }, [state, onStage, local]);

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

  const claims = info?.claims ?? [];
  const blocked = new Set(info?.blockedSlots ?? []);

  function tapSeat(key: string) {
    if (!client) return;
    const claim = claims.find((c) => c.key === key);
    if (claim?.identity === me) client.release(key).catch(report);
    else if (!claim && !blocked.has(key) && onStage) client.claim(key).catch(report);
    else if (blocked.has(key) && moderator) client.unblockSlot(key).catch(report);
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>{info?.roomId}</Text>
        <Text style={styles.sub}>
          {me} · {role}
          {state === 'reconnecting' ? ' · reconnecting…' : ''}
        </Text>
        <View style={styles.tabs}>
          <Button title="Room" onPress={() => setTab('room')} color={tab === 'room' ? '#111827' : '#9ca3af'} />
          <Button title="Chat" onPress={() => setTab('chat')} color={tab === 'chat' ? '#111827' : '#9ca3af'} />
        </View>
      </View>
      {problem && <Text style={styles.problem}>{problem}</Text>}

      {tab === 'chat' ? (
        <ChatPanel />
      ) : (
        <ScrollView style={styles.body}>
          <Text style={styles.section}>Stage</Text>
          <View style={styles.seats}>
            {SEATS.map((key) => {
              const claim = claims.find((c) => c.key === key);
              const holder = claim?.identity ?? null;
              return (
                <Pressable key={key} onPress={() => tapSeat(key)} style={[styles.seat, holder && styles.taken, claim?.state === 'away' && styles.away, blocked.has(key) && styles.blocked, holder && speakers.includes(holder) && styles.speaking]}>
                  <Text style={styles.seatText} numberOfLines={1}>
                    {blocked.has(key) ? 'locked' : (holder ?? key)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.section}>People ({participants.length})</Text>
          {participants.map((p) => (
            <View key={p.identity} style={styles.person}>
              <Text style={styles.personText}>
                {p.identity} · {p.role}
                {p.handRaised ? ' · hand raised' : ''}
                {p.muted ? ' · muted' : ''}
              </Text>
              {moderator && p.identity !== me ? (
                <View style={styles.actions}>
                  {p.handRaised && p.role === 'viewer' ? <Button title="Bring on stage" onPress={() => client?.promote(p.identity, 'cohost').catch(report)} /> : null}
                  {p.role === 'cohost' ? <Button title="To listener" onPress={() => client?.promote(p.identity, 'viewer').catch(report)} /> : null}
                  {p.role !== 'viewer' ? <Button title="Mute" onPress={() => client?.forceMute(p.identity, 'audio').catch(report)} /> : null}
                  <Button title="Remove" color="#dc2626" onPress={() => client?.kick(p.identity, 'removed by the host').catch(report)} />
                </View>
              ) : null}
            </View>
          ))}

          <Text style={styles.section}>Sound</Text>
          <OutputPicker onProblem={report} />
        </ScrollView>
      )}

      <View style={styles.footer}>
        {!onStage ? <Button title={myHand ? 'Lower hand' : 'Raise hand'} onPress={() => (myHand ? client?.lowerHand() : client?.raiseHand({ requestRole: 'cohost' }))?.catch(report)} /> : null}
        <Controls onProblem={report} video={false} />
        {role === 'host' ? <Button title="End room" color="#dc2626" onPress={() => client?.endRoom().catch(report)} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#ffffff' },
  screen: { flex: 1, backgroundColor: '#ffffff' },
  header: { padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#d1d5db' },
  title: { fontSize: 18, fontWeight: '600', color: '#111827' },
  sub: { color: '#6b7280', marginBottom: 6 },
  tabs: { flexDirection: 'row', gap: 8 },
  problem: { color: '#b91c1c', padding: 8, textAlign: 'center' },
  body: { flex: 1, paddingHorizontal: 12 },
  section: { fontSize: 13, fontWeight: '600', color: '#374151', marginTop: 14, marginBottom: 6, textTransform: 'uppercase' },
  seats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  seat: { width: 96, height: 56, borderRadius: 8, borderWidth: 1, borderColor: '#9ca3af', alignItems: 'center', justifyContent: 'center', padding: 4 },
  taken: { backgroundColor: '#e0e7ff', borderColor: '#6366f1' },
  away: { opacity: 0.5 },
  blocked: { backgroundColor: '#f3f4f6', borderStyle: 'dashed' },
  speaking: { borderColor: '#22c55e', borderWidth: 2 },
  seatText: { fontSize: 12, color: '#111827' },
  person: { paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5e7eb' },
  personText: { color: '#111827' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#d1d5db', paddingVertical: 6, alignItems: 'center' },
});
