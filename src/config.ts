// Where this example gets its tokens: the example's own token server (server/token-server.mjs) on the development
// machine. The Android emulator reaches the machine as 10.0.2.2; a phone on the same Wi-Fi uses the machine's LAN
// address (put it here). The app never holds the VoltKit API secret: the token server does.
import { Platform } from 'react-native';

export const TOKEN_SERVER_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8787' : 'http://127.0.0.1:8787';

/** The call the home screen offers first; any id works, and everyone who enters the same id meets in the same call. */
export const DEFAULT_CALL_ID = 'call-42';

/** The room the audio-room screen offers first. */
export const DEFAULT_ROOM_ID = 'room-7';

/**
 * This example's "sign-in": the name typed on the home screen is sent as the bearer token, and the example token
 * server takes it as the user's identity. A real app sends its own session token, and its backend decides the
 * identity, the room and the role.
 */
export const DEFAULT_NAME = 'alice';
