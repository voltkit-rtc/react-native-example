// One video tile: a VideoTrack with a name. Pass producerId for a remote video (adaptive stream: received at the
// tile's size, paused while hidden or in the background); mirror your own front camera.
import { StyleSheet, Text, View } from 'react-native';
import { VideoTrack } from '@voltkit-rtc/react-native';

export function Tile({ track, producerId, label, mirror = false, speaking = false }: { track: MediaStreamTrack | null | undefined; producerId?: string; label: string; mirror?: boolean; speaking?: boolean }) {
  return (
    <View style={[styles.tile, speaking && styles.speaking]}>
      <VideoTrack track={track} producerId={producerId} mirror={mirror} objectFit="cover" style={styles.video} />
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { width: '50%', aspectRatio: 3 / 4, padding: 2 },
  speaking: { borderWidth: 2, borderColor: '#22c55e' },
  video: { flex: 1, backgroundColor: '#111827' },
  label: { position: 'absolute', left: 8, bottom: 8, color: '#ffffff', fontSize: 12, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 6, borderRadius: 4 },
});
