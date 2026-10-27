// App.tsx: the docs' sample app (a video call and an audio room, tokens from your backend) plus the in-app scenario
// runner the device tests open through a deep link (voltkitrn://scenario?name=ID&run=TAG&host=URL).
import { useEffect, useState } from 'react';
import { Linking, StatusBar, StyleSheet, View } from 'react-native';
import { ScenarioRunner } from './src/e2e/ScenarioRunner';
import { parseLaunchUrl, type Launch } from './src/e2e/protocol';
import { AudioRoomScreen } from './src/screens/AudioRoomScreen';
import { CallScreen } from './src/screens/CallScreen';
import { HomeScreen, type Destination } from './src/screens/HomeScreen';

type Route = { kind: 'home' } | { kind: 'scenario'; launch: Launch } | Destination;

export default function App() {
  const [route, setRoute] = useState<Route>({ kind: 'home' });

  // The host runner's deep link: on a cold start (getInitialURL) and while the app runs (the url event).
  useEffect(() => {
    let live = true;
    const open = (url: string | null | undefined) => {
      const launch = parseLaunchUrl(url);
      if (launch && live) setRoute({ kind: 'scenario', launch });
    };
    Linking.getInitialURL()
      .then(open)
      .catch(() => undefined);
    const subscription = Linking.addEventListener('url', ({ url }) => open(url));
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);

  const home = () => setRoute({ kind: 'home' });

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      {route.kind === 'scenario' ? (
        <ScenarioRunner key={route.launch.run} launch={route.launch} />
      ) : route.kind === 'call' ? (
        <CallScreen callId={route.id} accessToken={route.name} onBack={home} />
      ) : route.kind === 'room' ? (
        <AudioRoomScreen roomId={route.id} accessToken={route.name} host={route.host} onBack={home} />
      ) : (
        <HomeScreen onOpen={setRoute} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#ffffff' },
});
