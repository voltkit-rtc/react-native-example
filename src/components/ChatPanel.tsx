// Chat in the room (docs: React Native SDK, "Chat"): there are no chat hooks; listen with useVoltkitEvent and send
// with the client useVoltkitClient() returns. Render it inside the provider.
import { useEffect, useState } from 'react';
import { Button, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { RpcError, type ChatMessage } from '@voltkit-rtc/client';
import { useVoltkitClient, useVoltkitEvent } from '@voltkit-rtc/react-native';

export function ChatPanel() {
  const client = useVoltkitClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  useVoltkitEvent('message', (m) => setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]))); // yours included
  useVoltkitEvent('messageDeleted', ({ id }) => setMessages((list) => list.filter((m) => m.id !== id)));

  // Earlier messages, once joined.
  useEffect(() => {
    if (!client) return;
    let live = true;
    client
      .getMessages({ limit: 50 })
      .then((history) => {
        if (live) setMessages((list) => [...history.filter((h) => !list.some((m) => m.id === h.id)), ...list]);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [client]);

  async function send() {
    if (!client || !draft.trim()) return;
    try {
      await client.sendMessage(draft);
      setDraft('');
      setNotice(null);
    } catch (err) {
      if (err instanceof RpcError && err.code === 'chat-muted') setNotice('A moderator has muted you in this chat.');
      else if (err instanceof RpcError && err.code === 'rate-limited') setNotice('Slow down a little.');
      else setNotice('Your message was not sent.');
    }
  }

  return (
    <View style={styles.panel}>
      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => (
          <Text style={styles.message}>
            <Text style={styles.from}>{item.from}</Text> {item.text}
          </Text>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No messages yet.</Text>}
      />
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <View style={styles.compose}>
        <TextInput value={draft} onChangeText={setDraft} onSubmitEditing={() => void send()} placeholder="Message" style={styles.input} />
        <Button title="Send" onPress={() => void send()} disabled={!client} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, padding: 12 },
  message: { fontSize: 14, color: '#111827', marginBottom: 4 },
  from: { fontWeight: 'bold' },
  empty: { color: '#6b7280', fontStyle: 'italic' },
  notice: { color: '#b91c1c', marginVertical: 4 },
  compose: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
});
