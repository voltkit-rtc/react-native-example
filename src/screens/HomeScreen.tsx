// The home screen: who you are (this example's stand-in for a sign-in), which call or room, and the two demos.
import { useState } from 'react';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { DEFAULT_CALL_ID, DEFAULT_NAME, DEFAULT_ROOM_ID, TOKEN_SERVER_URL } from '../config';

export type Destination = { kind: 'call'; id: string; name: string } | { kind: 'room'; id: string; name: string; host: boolean };

export function HomeScreen({ onOpen }: { onOpen: (destination: Destination) => void }) {
  const [name, setName] = useState(DEFAULT_NAME);
  const [callId, setCallId] = useState(DEFAULT_CALL_ID);
  const [roomId, setRoomId] = useState(DEFAULT_ROOM_ID);
  const who = name.trim() || DEFAULT_NAME;
  return (
    <View style={styles.page}>
      <Text style={styles.title}>VoltKit RTC</Text>
      <Text style={styles.sub}>React Native example · tokens from {TOKEN_SERVER_URL}</Text>

      <Text style={styles.label}>Your name</Text>
      <TextInput value={name} onChangeText={setName} autoCapitalize="none" style={styles.input} />

      <Text style={styles.section}>Video call</Text>
      <TextInput value={callId} onChangeText={setCallId} autoCapitalize="none" style={styles.input} placeholder="call id" />
      <Button title="Join the video call" onPress={() => onOpen({ kind: 'call', id: callId.trim() || DEFAULT_CALL_ID, name: who })} />

      <Text style={styles.section}>Audio room</Text>
      <TextInput value={roomId} onChangeText={setRoomId} autoCapitalize="none" style={styles.input} placeholder="room id" />
      <View style={styles.row}>
        <Button title="Open as host" onPress={() => onOpen({ kind: 'room', id: roomId.trim() || DEFAULT_ROOM_ID, name: who, host: true })} />
        <Button title="Listen" onPress={() => onOpen({ kind: 'room', id: roomId.trim() || DEFAULT_ROOM_ID, name: who, host: false })} />
      </View>

      <Text style={styles.footnote}>
        The device tests open this app through voltkitrn://scenario?… from scripts/test/rn-e2e; the token server is server/token-server.mjs.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#ffffff', padding: 20, paddingTop: 48, gap: 8 },
  title: { fontSize: 24, fontWeight: '700', color: '#111827' },
  sub: { color: '#6b7280', marginBottom: 12 },
  label: { color: '#374151', fontSize: 13 },
  section: { color: '#111827', fontSize: 16, fontWeight: '600', marginTop: 18 },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, color: '#111827' },
  row: { flexDirection: 'row', gap: 12 },
  footnote: { color: '#9ca3af', fontSize: 11, marginTop: 'auto' },
});
