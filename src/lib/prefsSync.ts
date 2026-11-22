import { accessToken, hasDriveAccess } from './auth';
import { reapplyRules } from './categorize';
import { db } from './db';
import { findPrefsFile, readPrefsFile, writePrefsFile } from './drive';
import { applyEdit, editOf, emptyDoc, mergeDocs, parseDoc, sameDoc, settingsPart, type PrefsDoc } from './prefs';

/** Everything this device knows: the stored document plus current rules, settings and edits. */
export async function localDoc(): Promise<PrefsDoc> {
  const [stored, rules, settings, txns] = await Promise.all([db.prefsDoc(), db.allRules(), db.settings(), db.allTransactions()]);
  const current = emptyDoc();
  current.rules = rules;
  current.settings = settingsPart(settings);
  for (const t of txns) {
    if (t.source === 'sample') continue;
    const e = editOf(t);
    if (e) current.edits[t.id] = e;
  }
  return mergeDocs(stored, current);
}

/** Make the local database reflect a merged document. Returns how many transactions changed. */
export async function applyDoc(doc: PrefsDoc): Promise<number> {
  const rules = await db.allRules();
  const have = new Set(rules.map((r) => r.id));
  for (const r of doc.rules) if (!have.has(r.id)) await db.putRule(r);
  for (const id of Object.keys(doc.deletedRules)) if (have.has(id)) await db.deleteRule(id);

  let settings = await db.settings();
  if (doc.settings && (doc.settings.at ?? '') > (settings.settingsAt ?? '')) {
    settings = { ...settings, ownIdentifiers: doc.settings.ownIdentifiers, billSpendCards: doc.settings.billSpendCards, syncMonths: doc.settings.syncMonths, settingsAt: doc.settings.at };
    await db.saveSettings(settings);
  }
  await db.savePrefsDoc(doc);

  const txns = await db.allTransactions();
  const removed = txns.filter((t) => doc.edits[t.id]?.removed);
  if (removed.length) await db.removeTransactions(removed);
  const changedEdits = txns.filter((t) => doc.edits[t.id] && !doc.edits[t.id].removed).flatMap((t) => {
    const next = applyEdit(t, doc.edits[t.id]);
    return next === t ? [] : [next];
  });
  await db.putTransactions(changedEdits);

  const after = await db.allTransactions();
  const reclassified = reapplyRules(after, await db.allRules(), settings);
  await db.putTransactions(reclassified);
  return removed.length + changedEdits.length + reclassified.length;
}

export interface PrefsSyncResult {
  status: 'synced' | 'skipped';
  changed: number;
}

let running: Promise<PrefsSyncResult> | null = null;

/**
 * Two-way sync with the app's file in Google Drive: download, merge with what this
 * device has, apply the result locally, upload if anything changed.
 */
export function syncPrefs(): Promise<PrefsSyncResult> {
  if (running) return running;
  running = (async () => {
    const settings = await db.settings();
    const token = accessToken();
    if (settings.prefsSync === false || !token || !hasDriveAccess()) return { status: 'skipped' as const, changed: 0 };
    const id = await findPrefsFile(token);
    const remote = id ? parseDoc(await readPrefsFile(token, id)) : emptyDoc();
    const local = await localDoc();
    let merged = mergeDocs(local, remote);
    const changed = await applyDoc(merged);
    if (!id || !sameDoc(merged, remote)) {
      merged = { ...merged, updatedAt: new Date().toISOString() };
      await writePrefsFile(token, id, JSON.stringify(merged));
      await db.savePrefsDoc(merged);
    }
    await db.saveSettings({ ...(await db.settings()), prefsSyncedAt: new Date().toISOString() });
    return { status: 'synced' as const, changed };
  })().finally(() => {
    running = null;
  });
  return running;
}

let timer: number | undefined;
/** Push local changes shortly after the user edits something (only while signed in with Drive access). */
export function schedulePrefsSync(after?: () => void): void {
  if (!hasDriveAccess()) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    syncPrefs()
      .then((r) => r.changed && after?.())
      .catch(() => undefined);
  }, 2500);
}
