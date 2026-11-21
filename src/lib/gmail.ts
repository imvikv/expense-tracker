/**
 * Thin Gmail REST client. Requests go straight from the browser to
 * gmail.googleapis.com over HTTPS with the in-memory access token.
 */
import type { EmailInput } from './parsers/common';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export class AuthError extends Error {
  constructor(message = 'Your Gmail session expired. Tap Connect Gmail to continue.') {
    super(message);
    this.name = 'AuthError';
  }
}

export class GmailError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'GmailError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET with retries for rate limits (429/403 rateLimitExceeded) and transient 5xx errors. */
async function gmailGet<T>(path: string, token: string, signal?: AbortSignal): Promise<T> {
  let attempt = 0;
  for (;;) {
    let res: Response;
    try {
      res = await fetch(`${API}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      if (attempt++ < 4) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw new GmailError('Network error talking to Gmail. Check your connection and try again.', 0);
    }
    if (res.ok) return (await res.json()) as T;
    if (res.status === 401) throw new AuthError();
    let reason = '';
    try {
      const body = (await res.json()) as { error?: { message?: string; errors?: Array<{ reason?: string }> } };
      reason = body.error?.errors?.[0]?.reason ?? '';
      if (res.status === 403 && /insufficient|scope/i.test(body.error?.message ?? '')) {
        throw new AuthError('Gmail read permission was not granted. Reconnect and allow access to Gmail.');
      }
      if (res.status === 403 && !/rateLimit|userRateLimit/i.test(reason)) {
        throw new GmailError(body.error?.message ?? 'Gmail refused the request (403).', 403);
      }
    } catch (e) {
      if (e instanceof AuthError || e instanceof GmailError) throw e;
    }
    const retryable = res.status === 429 || res.status === 403 || res.status >= 500;
    if (retryable && attempt++ < 6) {
      const after = Number(res.headers.get('Retry-After'));
      await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : Math.min(32_000, 1000 * 2 ** attempt + Math.random() * 500));
      continue;
    }
    throw new GmailError(`Gmail request failed (${res.status}${reason ? `: ${reason}` : ''}).`, res.status);
  }
}

interface ListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

/** Iterate over every message id matching `q`, page by page. */
export async function* listMessageIds(q: string, token: () => string, signal?: AbortSignal): AsyncGenerator<string[]> {
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ q, maxResults: '500', includeSpamTrash: 'false' });
    if (pageToken) params.set('pageToken', pageToken);
    const page = await gmailGet<ListResponse>(`/messages?${params}`, token(), signal);
    yield (page.messages ?? []).map((m) => m.id);
    pageToken = page.nextPageToken;
  } while (pageToken);
}

interface Header {
  name: string;
  value: string;
}

interface Part {
  mimeType?: string;
  filename?: string;
  headers?: Header[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: Part[];
}

interface Message {
  id: string;
  internalDate?: string;
  payload?: Part;
}

function b64urlDecode(data: string): string {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function header(headers: Header[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function collect(part: Part | undefined, out: { plain: string[]; html: string[] }): void {
  if (!part) return;
  if (part.filename) return; // skip attachments
  if (part.body?.data) {
    if (part.mimeType === 'text/plain') out.plain.push(b64urlDecode(part.body.data));
    else if (part.mimeType === 'text/html') out.html.push(b64urlDecode(part.body.data));
  }
  for (const p of part.parts ?? []) collect(p, out);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', '#8377': '₹', '#x20b9': '₹', '#39': "'" };

/** Convert email HTML to readable text without touching the DOM (no script/image loading). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head|title)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|table)>/gi, '\n')
    .replace(/<\/(td|th)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      const k = e.toLowerCase();
      if (ENTITIES[k]) return ENTITIES[k];
      if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
      if (k.startsWith('#')) return String.fromCodePoint(Number(k.slice(1)));
      return m;
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n');
}

/**
 * Did Gmail record SPF/DKIM/DMARC success for the From domain?
 * Returns undefined when the header is absent (can't tell).
 */
export function senderAuthenticated(headers: Header[] | undefined, fromAddr: string): boolean | undefined {
  const ar = headers?.filter((h) => h.name.toLowerCase() === 'authentication-results').map((h) => h.value.toLowerCase());
  if (!ar || ar.length === 0) return undefined;
  const domain = fromAddr.split('@')[1]?.toLowerCase() ?? '';
  const joined = ar.join(' ; ');
  const d = domain.replace(/\./g, '\\.');
  if (domain && new RegExp(`dmarc=pass[^;]*header\\.from=([\\w.-]+\\.)?${d}\\b`).test(joined)) return true;
  if (domain && new RegExp(`dkim=pass[^;]*header\\.(?:i|d)=@?([\\w.-]+\\.)?${d}\\b`).test(joined)) return true;
  if (/dmarc=fail|spf=fail|dkim=fail/.test(joined)) return false;
  return undefined;
}

/** Fetch one message and reduce it to what the parser needs. The body is returned, never stored. */
export async function fetchEmail(id: string, token: string, signal?: AbortSignal): Promise<EmailInput> {
  const m = await gmailGet<Message>(`/messages/${encodeURIComponent(id)}?format=full`, token, signal);
  const headers = m.payload?.headers;
  const from = header(headers, 'From');
  const out = { plain: [] as string[], html: [] as string[] };
  collect(m.payload, out);
  // Prefer HTML converted to text: banks often put a stub in text/plain.
  const htmlText = out.html.map(htmlToText).join('\n');
  const plain = out.plain.join('\n');
  const body = htmlText.trim().length > plain.trim().length ? htmlText : plain;
  const addr = (/<([^>]+)>/.exec(from)?.[1] ?? from).trim();
  return {
    id: m.id,
    from,
    subject: header(headers, 'Subject'),
    body,
    receivedAt: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : new Date().toISOString(),
    authenticated: senderAuthenticated(headers, addr),
  };
}

export function gmailLink(messageId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(messageId)}`;
}
