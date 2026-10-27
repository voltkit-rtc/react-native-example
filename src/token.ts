// token.ts: ask your backend for a room token right before joining (docs: React Native SDK, "Get a token from your
// backend"). The app sends your own sign-in, never the RTC secret; the backend answers with the token and the wsUrl.
import { TOKEN_SERVER_URL } from './config';

export type Credentials = { token: string; wsUrl: string; expiresAt?: number | null };

export async function fetchCredentials(callId: string, accessToken: string): Promise<Credentials> {
  const res = await fetch(`${TOKEN_SERVER_URL}/calls/${encodeURIComponent(callId)}/token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` }, // your app's sign-in, never the RTC secret
  });
  if (!res.ok) throw new Error(`Could not get a token (${res.status}).`);
  return (await res.json()) as Credentials;
}

/** The audio room's token: the backend decides the role; this example's server takes the one asked for. */
export async function fetchRoomCredentials(roomId: string, accessToken: string, role: 'host' | 'viewer'): Promise<Credentials> {
  const res = await fetch(`${TOKEN_SERVER_URL}/rooms/${encodeURIComponent(roomId)}/token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw new Error(`Could not get a token (${res.status}).`);
  return (await res.json()) as Credentials;
}
