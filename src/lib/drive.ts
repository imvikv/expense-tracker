/**
 * Minimal Google Drive client for the app's hidden "appDataFolder": a per-app folder
 * in the user's own Drive that only this app can see. Holds one file, prefs.json.
 */
import { AuthError } from './gmail';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const NAME = 'prefs.json';

async function call(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` }, cache: 'no-store', referrerPolicy: 'no-referrer' });
  if (res.status === 401) throw new AuthError();
  if (res.status === 403) throw new Error('Google Drive access was not granted, so settings can’t be backed up. Reconnect and tick the Drive (app data) box.');
  if (!res.ok) throw new Error(`Google Drive request failed (${res.status}).`);
  return res;
}

export async function findPrefsFile(token: string): Promise<string | null> {
  const q = new URLSearchParams({ spaces: 'appDataFolder', q: `name = '${NAME}'`, fields: 'files(id,modifiedTime)', pageSize: '10' });
  const res = await call(`${FILES}?${q}`, token);
  const body = (await res.json()) as { files?: Array<{ id: string; modifiedTime: string }> };
  const files = (body.files ?? []).sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
  return files[0]?.id ?? null;
}

export async function readPrefsFile(token: string, id: string): Promise<string> {
  const res = await call(`${FILES}/${encodeURIComponent(id)}?alt=media`, token);
  return res.text();
}

export async function writePrefsFile(token: string, id: string | null, json: string): Promise<string> {
  if (id) {
    await call(`${UPLOAD}/${encodeURIComponent(id)}?uploadType=media`, token, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: json });
    return id;
  }
  const boundary = `b${Math.random().toString(36).slice(2)}`;
  const body = [`--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify({ name: NAME, parents: ['appDataFolder'] }), `--${boundary}`, 'Content-Type: application/json', '', json, `--${boundary}--`, ''].join('\r\n');
  const res = await call(`${UPLOAD}?uploadType=multipart&fields=id`, token, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  return ((await res.json()) as { id: string }).id;
}

/** Delete the backup (used by "Clear all local data" when the user also wants the cloud copy gone). */
export async function deletePrefsFile(token: string): Promise<void> {
  const id = await findPrefsFile(token);
  if (id) await call(`${FILES}/${encodeURIComponent(id)}`, token, { method: 'DELETE' });
}
