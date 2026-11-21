import { accessToken, dropToken } from './auth';
import { buildTransaction } from './categorize';
import { db, type ProcessedRecord } from './db';
import { findDuplicates } from './dedupe';
import { AuthError, fetchEmail, listMessageIds } from './gmail';
import { gmailQuery, parseEmail, type EmailInput } from './parsers';
import type { MerchantRule, Settings, Transaction, UnparsedEmail } from './types';

export interface SyncProgress {
  phase: 'listing' | 'fetching' | 'finishing' | 'done';
  found: number;
  skipped: number;
  fetched: number;
  total: number;
  added: number;
}

export interface SyncResult extends SyncProgress {
  unparsed: number;
  ignored: number;
  duplicatesFlagged: number;
}

/** Turn emails into stored transactions. Shared by Gmail sync and the demo loader. */
export async function ingest(
  emails: EmailInput[],
  opts: { source: Transaction['source']; rules: MerchantRule[]; settings: Settings },
): Promise<{ added: number; unparsed: number; ignored: number }> {
  const txns: Transaction[] = [];
  const processed: ProcessedRecord[] = [];
  const unparsed: UnparsedEmail[] = [];
  let ignored = 0;
  const now = new Date().toISOString();
  for (const e of emails) {
    const r = parseEmail(e);
    processed.push({ id: e.id, status: r.status, at: now });
    if (r.status === 'parsed') {
      r.txns.forEach((p, i) => txns.push(buildTransaction(p, { messageId: e.id, index: i, source: opts.source, rules: opts.rules, settings: opts.settings })));
    } else if (r.status === 'unparsed' && r.bank) {
      unparsed.push({ id: e.id, from: e.from.slice(0, 120), subject: e.subject.slice(0, 160), date: e.receivedAt, bank: r.bank });
    } else ignored++;
  }
  const added = await db.insertNewTransactions(txns);
  await db.putUnparsed(unparsed);
  await db.putProcessed(processed);
  return { added, unparsed: unparsed.length, ignored };
}

/** Run duplicate detection across everything stored. */
export async function refreshDuplicates(): Promise<number> {
  const all = await db.allTransactions();
  const changed = findDuplicates(all);
  await db.putTransactions(changed);
  return changed.length;
}

function requireToken(): string {
  const t = accessToken();
  if (!t) throw new AuthError();
  return t;
}

/**
 * Fetch transaction emails between `from` and `to` (inclusive) and store the
 * parsed transactions. Messages processed in an earlier sync are skipped, so
 * running this repeatedly is cheap (incremental sync).
 */
export async function syncGmail(opts: {
  from: Date;
  to?: Date;
  settings: Settings;
  rules: MerchantRule[];
  onProgress?: (p: SyncProgress) => void;
  signal?: AbortSignal;
  concurrency?: number;
}): Promise<SyncResult> {
  const progress: SyncProgress = { phase: 'listing', found: 0, skipped: 0, fetched: 0, total: 0, added: 0 };
  const report = () => opts.onProgress?.({ ...progress });
  report();

  const before = opts.to ? new Date(opts.to.getFullYear(), opts.to.getMonth(), opts.to.getDate() + 1) : undefined;
  const q = gmailQuery(opts.from, before);
  const seen = await db.processedIds();
  const todo: string[] = [];
  try {
    for await (const ids of listMessageIds(q, requireToken, opts.signal)) {
      progress.found += ids.length;
      for (const id of ids) {
        if (seen.has(id)) progress.skipped++;
        else todo.push(id);
      }
      report();
    }
  } catch (e) {
    if (e instanceof AuthError) dropToken();
    throw e;
  }

  progress.phase = 'fetching';
  progress.total = todo.length;
  report();

  let unparsed = 0;
  let ignored = 0;
  const batch: EmailInput[] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    const r = await ingest(batch.splice(0), { source: 'gmail', rules: opts.rules, settings: opts.settings });
    progress.added += r.added;
    unparsed += r.unparsed;
    ignored += r.ignored;
    report();
  };

  let next = 0;
  let failure: unknown = null;
  const worker = async () => {
    while (!failure && next < todo.length) {
      if (opts.signal?.aborted) return;
      const id = todo[next++];
      try {
        const email = await fetchEmail(id, requireToken(), opts.signal);
        batch.push(email);
        progress.fetched++;
        if (batch.length >= 25) await flush();
        else if (progress.fetched % 5 === 0) report();
      } catch (e) {
        failure = e;
      }
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 4 }, worker));
  await flush(); // keep whatever we fetched even if something failed

  if (failure) {
    if (failure instanceof AuthError) dropToken();
    throw failure;
  }
  if (opts.signal?.aborted) throw new DOMException('Sync cancelled', 'AbortError');

  progress.phase = 'finishing';
  report();
  const duplicatesFlagged = await refreshDuplicates();

  const nowIso = new Date().toISOString();
  const s = await db.settings();
  const fromIso = opts.from.toISOString();
  await db.saveSettings({
    ...s,
    lastSyncAt: nowIso,
    syncedFrom: !s.syncedFrom || fromIso < s.syncedFrom ? fromIso : s.syncedFrom,
    syncedThrough: opts.to ? (s.syncedThrough && s.syncedThrough > opts.to.toISOString() ? s.syncedThrough : opts.to.toISOString()) : nowIso,
  });

  progress.phase = 'done';
  report();
  return { ...progress, unparsed, ignored, duplicatesFlagged };
}

/**
 * Default range for "Sync now": from the last sync (minus a 3-day overlap for
 * delayed emails) or, on first run, `months` back from today.
 */
export function defaultSyncStart(settings: Settings, now = new Date()): Date {
  if (settings.syncedThrough) {
    const d = new Date(settings.syncedThrough);
    d.setDate(d.getDate() - 3);
    return d;
  }
  return new Date(now.getFullYear(), now.getMonth() - settings.syncMonths, now.getDate());
}
