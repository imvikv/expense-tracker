/**
 * Google OAuth 2.0 using Google Identity Services' browser token model.
 *
 * - Only the public OAuth *client ID* is used; there is no client secret anywhere.
 * - The access token lives only in this module's memory. It is never written to
 *   localStorage/IndexedDB, never put in a URL and never logged. Reloading the
 *   page forgets it; tokens expire after ~1 hour and the user simply reconnects.
 */

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}

interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (r: TokenResponse) => void;
    error_callback?: (e: { type: string; message?: string }) => void;
  }): TokenClient;
  revoke(token: string, done?: () => void): void;
  hasGrantedAllScopes(r: TokenResponse, ...scopes: string[]): boolean;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } };
  }
}

let token: { value: string; expiresAt: number } | null = null;
let client: TokenClient | null = null;
let clientFor = '';
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;
let loadPromise: Promise<GoogleOAuth2> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function onAuthChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Load the Google Identity Services script (once). */
export function loadGis(): Promise<GoogleOAuth2> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google.accounts.oauth2);
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => {
      const o = window.google?.accounts?.oauth2;
      if (o) resolve(o);
      else reject(new Error('Google sign-in library loaded but is unavailable.'));
    };
    s.onerror = () => {
      loadPromise = null;
      reject(new Error('Could not load Google sign-in. Check your connection or content blockers.'));
    };
    document.head.appendChild(s);
  });
  return loadPromise;
}

/** Prepare the token client ahead of time so the click handler can open the popup synchronously (required by iOS Safari). */
export async function prepare(clientId: string): Promise<void> {
  if (!clientId) return;
  const oauth2 = await loadGis();
  if (client && clientFor === clientId) return;
  clientFor = clientId;
  client = oauth2.initTokenClient({
    client_id: clientId,
    scope: GMAIL_SCOPE,
    callback: (r) => {
      const p = pending;
      pending = null;
      if (r.error || !r.access_token) {
        p?.reject(new Error(r.error_description || r.error || 'Google did not return an access token.'));
        return;
      }
      if (!oauth2.hasGrantedAllScopes(r, GMAIL_SCOPE)) {
        p?.reject(new Error('Gmail read access was not granted. Tick the Gmail permission on the consent screen.'));
        return;
      }
      const secs = Number(r.expires_in ?? 3600);
      token = { value: r.access_token, expiresAt: Date.now() + (secs - 60) * 1000 };
      emit();
      p?.resolve(r.access_token);
    },
    error_callback: (e) => {
      const p = pending;
      pending = null;
      const msg =
        e.type === 'popup_closed' ? 'The Google sign-in window was closed.' : e.type === 'popup_failed_to_open' ? 'The Google sign-in popup was blocked. Allow pop-ups for this site and try again.' : e.message || e.type;
      p?.reject(new Error(msg));
    },
  });
}

export function isPrepared(): boolean {
  return client !== null;
}

/**
 * Open Google's consent popup. Must be called directly from a user gesture
 * (tap/click) after `prepare()` has finished.
 */
export function connect(): Promise<string> {
  if (!client) return Promise.reject(new Error('Google sign-in is not ready yet. Add your OAuth client ID in Settings.'));
  if (pending) pending.reject(new Error('Superseded by a new sign-in request.'));
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    client!.requestAccessToken({ prompt: token ? '' : undefined });
  });
}

export function accessToken(): string | null {
  if (token && Date.now() < token.expiresAt) return token.value;
  if (token) {
    token = null;
    emit();
  }
  return null;
}

export function isConnected(): boolean {
  return accessToken() !== null;
}

export function tokenExpiresAt(): number | null {
  return token?.expiresAt ?? null;
}

/** Forget the token locally (e.g. after a 401). */
export function dropToken(): void {
  token = null;
  emit();
}

/** Revoke the grant at Google and forget the token. */
export async function disconnect(): Promise<void> {
  const t = token?.value;
  token = null;
  emit();
  if (t) {
    try {
      const oauth2 = await loadGis();
      await new Promise<void>((r) => oauth2.revoke(t, () => r()));
    } catch {
      /* the token is gone locally either way */
    }
  }
}
