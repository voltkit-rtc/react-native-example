// The call's controls (docs: "How to add video calling to a React Native app", step 7): each is one call on the
// hooks, and every component that uses them follows.
import { Button, StyleSheet, View } from 'react-native';
import { useAudioOutput, useLocalMedia, useRoom } from '@voltkit-rtc/react-native';

export function Controls({ onProblem, video = true }: { onProblem: (err: Error) => void; video?: boolean }) {
  const local = useLocalMedia();
  const audio = useAudioOutput();
  const { leave } = useRoom();
  return (
    <View style={styles.row}>
      {local.stream ? (
        <>
          <Button title={local.micEnabled ? 'Mute' : 'Unmute'} onPress={() => local.setMicEnabled(!local.micEnabled).catch(onProblem)} />
          {video ? <Button title={local.camEnabled ? 'Camera off' : 'Camera on'} onPress={() => local.setCamEnabled(!local.camEnabled).catch(onProblem)} /> : null}
          {video ? <Button title="Flip" onPress={() => local.switchCamera().catch(onProblem)} /> : null}
        </>
      ) : null}
      {audio.supported ? (
        <Button title={audio.speakerphone ? 'Earpiece' : 'Loudspeaker'} onPress={() => audio.setSpeakerphoneOn(!audio.speakerphone).catch(onProblem)} />
      ) : null}
      <Button title="Leave" onPress={leave} color="#dc2626" />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, padding: 12 },
});
