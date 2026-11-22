import { accessToken, dropToken } from './auth';
import { buildTransaction, mergeDetails } from './categorize';
import { db, type ProcessedRecord } from './db';
import { findDuplicates } from './dedupe';
import { AuthError, fetchEmail, GmailError, listMessageIds } from './gmail';
import { gmailQuery, parseEmail, type EmailInput } from './parsers';
import { DETAIL_VERSION, PARSER_BUILD, type MerchantRule, type Settings, type Transaction, type UnparsedEmail } from './types';

export interface SyncProgress {
  phase: 'listing' | 'fetching' | 'updating' | 'finishing' | 'done';
  found: number;
  skipped: number;
  fetched: number;
  total: number;
  added: number;
  /** Older transactions that received new payee details. */
  updated: number;
}

export interface SyncResult extends SyncProgress {
  unparsed: number;
  ignored: number;
  duplicatesFlagged: number;
}

export interface IngestResult {
  added: number;
  updated: number;
  unparsed: number;
  ignored: number;
}

/**
 * Turn emails into stored transactions. Shared by Gmail sync, the detail backfill
 * and the demo loader. New transactions are inserted; stored ones parsed by an
 * older parser version get the new payee details merged in (user edits are kept).
 */
export async function ingest(
  emails: EmailInput[],
  opts: { source: Transaction['source']; rules: MerchantRule[]; settings: Settings },
): Promise<IngestResult> {
  const fresh: Transaction[] = [];
  const processed: ProcessedRecord[] = [];
  const unparsed: UnparsedEmail[] = [];
  const nowParsed: string[] = [];
  let ignored = 0;
  const now = new Date().toISOString();
  for (const e of emails) {
    const r = parseEmail(e);
    processed.push({ id: e.id, status: r.status, at: now });
    if (r.status === 'parsed') {
      nowParsed.push(e.id);
      r.txns.forEach((p, i) => fresh.push(buildTransaction(p, { messageId: e.id, index: i, source: opts.source, rules: opts.rules, settings: opts.settings, subject: e.subject })));
    } else if (r.status === 'unparsed' && r.bank) {
      unparsed.push({ id: e.id, from: e.from.slice(0, 120), subject: e.subject.slice(0, 160), date: e.receivedAt, bank: r.bank });
    } else ignored++;
  }
  const existing = await db.getTransactions(fresh.map((t) => t.id));
  const toInsert = fresh.filter((t) => !existing.has(t.id));
  const toUpdate = fresh
    .filter((t) => {
      const old = existing.get(t.id);
      if (!old) return false;
      // Older parser generation, or a generic low-confidence read that a bank template now understands.
      return (old.detailVersion ?? 1) < DETAIL_VERSION || (old.template === 'generic' && (old.parserBuild ?? 1) < PARSER_BUILD);
    })
    .map((t) => mergeDetails(existing.get(t.id)!, t));
  const added = await db.insertNewTransactions(toInsert);
  await db.putTransactions(toUpdate);
  await db.putUnparsed(unparsed);
  await db.deleteUnparsedMany(nowParsed);
  await db.putProcessed(processed);
  return { added, updated: toUpdate.length, unparsed: unparsed.length, ignored };
}

/** Gmail message ids whose transactions predate the current payee-detail parser, plus emails no template understood. */
export async function backfillCandidates(): Promise<string[]> {
  const [txns, unparsed] = await Promise.all([db.allTransactions(), db.allUnparsed()]);
  const ids = new Set<string>();
  for (const t of txns) if (t.source === 'gmail' && ((t.detailVersion ?? 1) < DETAIL_VERSION || (t.template === 'generic' && (t.parserBuild ?? 1) < PARSER_BUILD))) ids.add(t.sourceMessageId);
  for (const u of unparsed) if (!u.id.startsWith('sample') && !u.id.startsWith('fx')) ids.add(u.id);
  return [...ids];
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
  const progress: SyncProgress = { phase: 'listing', found: 0, skipped: 0, fetched: 0, total: 0, added: 0, updated: 0 };
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
  const onBatch = (r: IngestResult) => {
    progress.added += r.added;
    progress.updated += r.updated;
    unparsed += r.unparsed;
    ignored += r.ignored;
  };
  await fetchAndIngest(todo, opts, progress, report, onBatch);

  // Re-read older emails so their transactions gain payee details (one-time after an upgrade),
  // and retry emails that no template understood before.
  const fetchedNow = new Set(todo);
  const backfill = (await backfillCandidates()).filter((id) => !fetchedNow.has(id));
  if (backfill.length > 0 && !opts.signal?.aborted) {
    progress.phase = 'updating';
    progress.fetched = 0;
    progress.total = backfill.length;
    report();
    const missing = await fetchAndIngest(backfill, opts, progress, report, onBatch);
    await markGone(missing);
  }

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

/** Fetch messages with a small worker pool and ingest them in batches. Progress is saved as it goes. */
async function fetchAndIngest(
  ids: string[],
  opts: { rules: MerchantRule[]; settings: Settings; signal?: AbortSignal; concurrency?: number },
  progress: SyncProgress,
  report: () => void,
  onBatch: (r: IngestResult) => void,
): Promise<string[]> {
  const missing: string[] = [];
  const batch: EmailInput[] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    onBatch(await ingest(batch.splice(0), { source: 'gmail', rules: opts.rules, settings: opts.settings }));
    report();
  };
  let next = 0;
  let failure: unknown = null;
  const worker = async () => {
    while (!failure && next < ids.length) {
      if (opts.signal?.aborted) return;
      const id = ids[next++];
      try {
        batch.push(await fetchEmail(id, requireToken(), opts.signal));
        progress.fetched++;
        if (batch.length >= 25) await flush();
        else if (progress.fetched % 5 === 0) report();
      } catch (e) {
        // A message deleted from Gmail since the last sync: skip it.
        if (e instanceof GmailError && e.status === 404) {
          missing.push(id);
          progress.fetched++;
          continue;
        }
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
  return missing;
}

/** Emails deleted from Gmail can't be re-read: keep their transactions as they are and stop retrying. */
async function markGone(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const set = new Set(ids);
  const txns = (await db.allTransactions()).filter((t) => set.has(t.sourceMessageId) && (t.detailVersion ?? 1) < DETAIL_VERSION);
  await db.putTransactions(txns.map((t) => ({ ...t, detailVersion: DETAIL_VERSION })));
  await db.deleteUnparsedMany(ids);
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
