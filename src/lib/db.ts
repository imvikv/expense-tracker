/**
 * Minimal IndexedDB layer. Everything stays in this browser profile on this device.
 * Stores:
 *   transactions – normalised transactions (no email bodies)
 *   rules        – user merchant rules
 *   processed    – Gmail message ids already handled (id + status only), so sync never refetches them
 *   unparsed     – headers (sender, subject, date) of bank emails no template understood
 *   meta         – settings
 */
import { emptyDoc, type PrefsDoc } from './prefs';
import { DEFAULT_SETTINGS, type MerchantRule, type Settings, type Transaction, type UnparsedEmail } from './types';

const DB_NAME = 'expense-tracker';
const DB_VERSION = 1;

export type StoreName = 'transactions' | 'rules' | 'processed' | 'unparsed' | 'meta';

export interface ProcessedRecord {
  id: string;
  status: 'parsed' | 'ignored' | 'unparsed' | 'untrusted';
  at: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser does not support IndexedDB (private browsing on some browsers disables it).'));
      return;
    }
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('transactions')) {
        const s = db.createObjectStore('transactions', { keyPath: 'id' });
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('rules')) db.createObjectStore('rules', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('processed')) db.createObjectStore('processed', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('unparsed')) db.createObjectStore('unparsed', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    open.onsuccess = () => {
      const db = open.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error('Database upgrade blocked: close other tabs of this app and reload.'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  return req(db.transaction(store).objectStore(store).getAll()) as Promise<T[]>;
}

async function putMany<T>(store: StoreName, items: T[]): Promise<void> {
  if (items.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const s = tx.objectStore(store);
  for (const it of items) s.put(it);
  await done(tx);
}

async function del(store: StoreName, key: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await done(tx);
}

export const db = {
  allTransactions: () => getAll<Transaction>('transactions'),
  putTransactions: (t: Transaction[]) => putMany('transactions', t),

  /**
   * Insert new transactions without overwriting existing ones (which may carry
   * user edits). Returns how many were actually new.
   */
  async insertNewTransactions(items: Transaction[]): Promise<number> {
    if (items.length === 0) return 0;
    const db = await openDb();
    const tx = db.transaction('transactions', 'readwrite');
    const s = tx.objectStore('transactions');
    let added = 0;
    for (const it of items) {
      const r = s.add(it);
      r.onsuccess = () => added++;
      r.onerror = (e) => {
        // ConstraintError: already stored — keep the stored copy.
        e.preventDefault();
        e.stopPropagation();
      };
    }
    await done(tx);
    return added;
  },

  /** Fetch stored transactions by id (missing ids are skipped). */
  async getTransactions(ids: string[]): Promise<Map<string, Transaction>> {
    const out = new Map<string, Transaction>();
    if (ids.length === 0) return out;
    const db = await openDb();
    const store = db.transaction('transactions').objectStore('transactions');
    await Promise.all(
      ids.map(async (id) => {
        const t = (await req(store.get(id))) as Transaction | undefined;
        if (t) out.set(id, t);
      }),
    );
    return out;
  },

  /** Delete transactions and remember their emails as "not a transaction" so sync never re-adds them. */
  async removeTransactions(txns: Transaction[]): Promise<void> {
    if (txns.length === 0) return;
    const db = await openDb();
    const tx = db.transaction(['transactions', 'processed'], 'readwrite');
    const at = new Date().toISOString();
    for (const t of txns) {
      tx.objectStore('transactions').delete(t.id);
      tx.objectStore('processed').put({ id: t.sourceMessageId, status: 'ignored', at });
    }
    await done(tx);
    // Remember the removal so other devices (via the synced preferences) skip it too.
    const d = await this.prefsDoc();
    for (const t of txns) if (t.source !== 'sample') d.edits[t.id] = { at, removed: true };
    await this.savePrefsDoc(d);
  },

  allRules: () => getAll<MerchantRule>('rules'),
  putRule: (r: MerchantRule) => putMany('rules', [r]),
  async deleteRule(id: string): Promise<void> {
    await del('rules', id);
    const d = await this.prefsDoc();
    d.deletedRules[id] = new Date().toISOString();
    await this.savePrefsDoc(d);
  },

  async processedIds(): Promise<Set<string>> {
    const db = await openDb();
    const keys = await req(db.transaction('processed').objectStore('processed').getAllKeys());
    return new Set(keys.map(String));
  },
  putProcessed: (p: ProcessedRecord[]) => putMany('processed', p),

  allUnparsed: () => getAll<UnparsedEmail>('unparsed'),
  putUnparsed: (u: UnparsedEmail[]) => putMany('unparsed', u),
  deleteUnparsed: (id: string) => del('unparsed', id),
  async deleteUnparsedMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await openDb();
    const tx = db.transaction('unparsed', 'readwrite');
    for (const id of ids) tx.objectStore('unparsed').delete(id);
    await done(tx);
  },

  async settings(): Promise<Settings> {
    const db = await openDb();
    const s = (await req(db.transaction('meta').objectStore('meta').get('settings'))) as Settings | undefined;
    return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
  },
  async saveSettings(s: Settings): Promise<void> {
    const db = await openDb();
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(s, 'settings');
    await done(tx);
  },

  async prefsDoc(): Promise<PrefsDoc> {
    const db = await openDb();
    const d = (await req(db.transaction('meta').objectStore('meta').get('prefs'))) as PrefsDoc | undefined;
    return d ?? emptyDoc();
  },
  async savePrefsDoc(d: PrefsDoc): Promise<void> {
    const db = await openDb();
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(d, 'prefs');
    await done(tx);
  },

  /** Remove every stored record (transactions, rules, sync state, settings). */
  async clearAll(): Promise<void> {
    const db = await openDb();
    const stores: StoreName[] = ['transactions', 'rules', 'processed', 'unparsed', 'meta'];
    const tx = db.transaction(stores, 'readwrite');
    for (const s of stores) tx.objectStore(s).clear();
    await done(tx);
  },

  /** Remove only data that came from the demo, leaving real data alone. */
  async clearSample(): Promise<void> {
    const all = await getAll<Transaction>('transactions');
    const db = await openDb();
    const tx = db.transaction(['transactions', 'processed'], 'readwrite');
    for (const t of all) {
      if (t.source === 'sample') {
        tx.objectStore('transactions').delete(t.id);
        tx.objectStore('processed').delete(t.sourceMessageId);
      }
    }
    await done(tx);
  },
};

/** Ask the browser not to evict our storage under pressure (Safari may still clear it after long inactivity). */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* ignore */
  }
  return null;
}

export async function storageEstimate(): Promise<{ usage: number; quota: number; persisted: boolean | null } | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null;
    return { usage: e.usage ?? 0, quota: e.quota ?? 0, persisted };
  } catch {
    return null;
  }
}
