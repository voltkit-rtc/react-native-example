// Why a session ended, in words, with a way back in (docs: React Native SDK, "A call screen" and "Errors").
import { Button, StyleSheet, Text, View } from 'react-native';
import type { ClosedReason } from '@voltkit-rtc/react-native';

export const ENDED: Record<ClosedReason, string> = {
  left: 'You left the call.',
  kicked: 'You were removed from the call.',
  'room-closed': 'The call has ended.',
  replaced: 'You joined this call from another device.',
  'gave-up': 'The connection was lost.',
};

export function EndedBanner({ notice, actionLabel, onAction, onBack }: { notice: string | null; actionLabel: string; onAction: () => void; onBack?: () => void }) {
  return (
    <View style={styles.center}>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <Button title={actionLabel} onPress={onAction} />
      {onBack ? <Button title="Back" onPress={onBack} color="#6b7280" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, backgroundColor: '#ffffff' },
  notice: { fontSize: 16, textAlign: 'center', color: '#111827' },
});
