// Envoi d'une notification à un appareil de l'app (Firebase Cloud Messaging, API HTTP v1).
// Secret Supabase FCM_SERVICE_ACCOUNT : contenu complet du JSON de compte de service du projet Firebase « Sillage »
// (jamais dans le dépôt). Le jeton d'accès Google est gardé en mémoire jusqu'à son expiration.

type ServiceAccount = { client_email: string; private_key: string; project_id: string };

let SA: ServiceAccount | null | undefined;
let tokenCache: { at: string; exp: number } | null = null;

export function fcmReady(): boolean { return !!loadSa(); }

function loadSa(): ServiceAccount | null {
  if (SA !== undefined) return SA;
  try { SA = JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT') ?? '') as ServiceAccount; if (!SA.private_key || !SA.client_email) SA = null; } catch (_) { SA = null; }
  return SA;
}

function b64url(input: ArrayBuffer | string) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = ''; bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp - 60 > now) return tokenCache.at;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${b64url(sig)}` }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('jeton Google refusé');
  tokenCache = { at: data.access_token, exp: now + (Number(data.expires_in) || 3600) };
  return data.access_token;
}

// Renvoie le statut HTTP de FCM (200 = envoyé ; 404 / 400 = jeton périmé ou invalide : à supprimer ; autre = échec passager).
export async function sendFcm(deviceToken: string, msg: { title?: unknown; body?: unknown; url?: unknown; tag?: unknown }): Promise<number> {
  const sa = loadSa(); if (!sa) return 0;
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST', headers: { Authorization: `Bearer ${await accessToken(sa)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: {
      token: deviceToken,
      notification: { title: String(msg.title ?? 'Sillage'), body: String(msg.body ?? '') },
      data: { url: String(msg.url ?? '') },
      android: { notification: { tag: String(msg.tag ?? 'sillage-alert') }, priority: 'HIGH' },
      apns: { payload: { aps: { sound: 'default' } }, headers: { 'apns-collapse-id': String(msg.tag ?? 'sillage-alert').slice(0, 60) } },
    } }),
  });
  await res.arrayBuffer();
  return res.status;
}
