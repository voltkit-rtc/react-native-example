import { registerRootComponent } from 'expo';

import App from './App';

// Importing @voltkit-rtc/react-native (App does) registers react-native-webrtc's globals before any client exists.
// registerRootComponent calls AppRegistry.registerComponent('main', () => App) and sets the environment up the same
// way in a development build and a release build.
registerRootComponent(App);
