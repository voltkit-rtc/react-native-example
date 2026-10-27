// Where call audio plays (docs: React Native SDK, "Audio routing"): the loudspeaker, the earpiece and the headsets
// connected now. Nothing on iOS (preview) and in the media audio mode, where supported is false.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAudioOutput } from '@voltkit-rtc/react-native';

const NAMES: Record<string, string> = { speaker: 'Loudspeaker', earpiece: 'Phone', wiredHeadset: 'Headset', bluetooth: 'Bluetooth', usb: 'USB' };

export function OutputPicker({ onProblem }: { onProblem?: (err: Error) => void }) {
  const audio = useAudioOutput();
  if (!audio.supported) return null; // false on iOS (preview) and in the media audio mode
  return (
    <View style={styles.row}>
      {audio.outputs.map((device) => {
        const current = device.deviceId === audio.current?.deviceId;
        return (
          <Pressable key={device.deviceId} onPress={() => audio.select(device.deviceId).catch((err: Error) => onProblem?.(err))} style={[styles.chip, current && styles.current]}>
            <Text style={[styles.text, current && styles.currentText]}>{device.label || NAMES[device.type ?? ''] || device.deviceId}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12 },
  chip: { borderWidth: 1, borderColor: '#9ca3af', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  current: { backgroundColor: '#111827', borderColor: '#111827' },
  text: { color: '#111827', fontSize: 13 },
  currentText: { color: '#ffffff', fontWeight: '600' },
});
