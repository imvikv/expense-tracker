/**
 * Portable preferences: everything the user has taught or told the app, so another
 * browser/device can rebuild the same view after syncing Gmail. Kept as one small JSON
 * document, merged item-by-item (newest change wins) so two devices never clobber
 * each other. Transactions themselves are NOT included — each device re-reads Gmail.
 */
import { validateTemplate, type CustomTemplate } from './parsers/taught';
import { validateIgnoreRule, type IgnoreRule } from './parsers/ignore';
import { CATEGORIES, KIND_LABELS, type Category, type DuplicateStatus, type MerchantRule, type Settings, type Transaction, type TxnKind } from './types';

/** A user decision about one transaction, keyed by its stable id (gmail:<messageId>:<n>). */
export interface TxnEdit {
  at: string;
  category?: Category;
  kind?: TxnKind;
  userEdited?: boolean;
  excluded?: boolean;
  note?: string;
  duplicateStatus?: DuplicateStatus;
  duplicateOf?: string;
  /** "Not a transaction — remove". */
  removed?: boolean;
}

export interface SyncedSettings {
  at: string;
  ownIdentifiers: string[];
  billSpendCards: string[];
  syncMonths: number;
}

export interface PrefsDoc {
  app: 'expense-tracker-prefs';
  version: 1;
  updatedAt: string;
  settings?: SyncedSettings;
  rules: MerchantRule[];
  /** Deleted rule ids → when. */
  deletedRules: Record<string, string>;
  edits: Record<string, TxnEdit>;
  /** Bank-email templates taught in the app. */
  templates: CustomTemplate[];
  deletedTemplates: Record<string, string>;
  /** "Ignore all like this" rules. */
  ignore: IgnoreRule[];
  deletedIgnore: Record<string, string>;
}

export function emptyDoc(): PrefsDoc {
  return { app: 'expense-tracker-prefs', version: 1, updatedAt: new Date(0).toISOString(), rules: [], deletedRules: {}, edits: {}, templates: [], deletedTemplates: {}, ignore: [], deletedIgnore: {} };
}

/** The user-made parts of a transaction, or null when it carries no user decision. */
export function editOf(t: Transaction): TxnEdit | null {
  // Edits made before sync existed have no timestamp: date them by creation so any newer edit wins.
  const legacy = !t.editedAt && (t.userEdited || t.excluded || !!t.note || t.duplicateStatus === 'not_duplicate');
  if (!t.editedAt && !legacy) return null;
  return {
    at: t.editedAt ?? t.createdAt,
    category: t.userEdited ? t.category : undefined,
    kind: t.userEdited ? t.kind : undefined,
    userEdited: t.userEdited || undefined,
    excluded: t.excluded || undefined,
    note: t.note || undefined,
    duplicateStatus: t.duplicateStatus === 'duplicate' || t.duplicateStatus === 'not_duplicate' ? t.duplicateStatus : undefined,
    duplicateOf: t.duplicateOf,
  };
}

/** Apply a synced edit to a transaction (only if the edit is newer than what's there). */
export function applyEdit(t: Transaction, e: TxnEdit): Transaction {
  if (t.editedAt && t.editedAt >= e.at) return t;
  return {
    ...t,
    category: e.userEdited && e.category ? e.category : t.category,
    kind: e.userEdited && e.kind ? e.kind : t.kind,
    userEdited: t.userEdited || !!e.userEdited,
    confidence: e.userEdited ? 'high' : t.confidence,
    excluded: !!e.excluded,
    note: e.note,
    duplicateStatus: e.duplicateStatus ?? t.duplicateStatus,
    duplicateOf: e.duplicateStatus ? e.duplicateOf : t.duplicateOf,
    editedAt: e.at,
  };
}

const newer = (a?: string, b?: string) => (a ?? '') >= (b ?? '');

/** Merge two documents: union of rules minus deletions, newest settings, newest edit per transaction. */
export function mergeDocs(a: PrefsDoc, b: PrefsDoc): PrefsDoc {
  const deletedRules: Record<string, string> = { ...a.deletedRules };
  for (const [id, at] of Object.entries(b.deletedRules)) if (!deletedRules[id] || at > deletedRules[id]) deletedRules[id] = at;
  const rules = new Map<string, MerchantRule>();
  for (const r of [...a.rules, ...b.rules]) if (!deletedRules[r.id]) rules.set(r.id, r);
  const edits: Record<string, TxnEdit> = { ...a.edits };
  for (const [id, e] of Object.entries(b.edits)) if (!edits[id] || e.at > edits[id].at) edits[id] = e;
  const deletedTemplates: Record<string, string> = { ...a.deletedTemplates };
  for (const [id, at] of Object.entries(b.deletedTemplates ?? {})) if (!deletedTemplates[id] || at > deletedTemplates[id]) deletedTemplates[id] = at;
  const templates = new Map<string, CustomTemplate>();
  for (const t of [...(a.templates ?? []), ...(b.templates ?? [])]) if (!deletedTemplates[t.id]) templates.set(t.id, t);
  const deletedIgnore: Record<string, string> = { ...(a.deletedIgnore ?? {}) };
  for (const [id, at] of Object.entries(b.deletedIgnore ?? {})) if (!deletedIgnore[id] || at > deletedIgnore[id]) deletedIgnore[id] = at;
  const ignore = new Map<string, IgnoreRule>();
  for (const r of [...(a.ignore ?? []), ...(b.ignore ?? [])]) if (!deletedIgnore[r.id]) ignore.set(r.id, r);
  const settings = !a.settings ? b.settings : !b.settings ? a.settings : newer(a.settings.at, b.settings.at) ? a.settings : b.settings;
  return {
    app: 'expense-tracker-prefs',
    version: 1,
    updatedAt: newer(a.updatedAt, b.updatedAt) ? a.updatedAt : b.updatedAt,
    settings,
    rules: [...rules.values()].sort((x, y) => x.createdAt.localeCompare(y.createdAt)),
    deletedRules,
    edits,
    templates: [...templates.values()].sort((x, y) => x.createdAt.localeCompare(y.createdAt)),
    deletedTemplates,
    ignore: [...ignore.values()].sort((x, y) => x.createdAt.localeCompare(y.createdAt)),
    deletedIgnore,
  };
}

/** Same content (ignoring updatedAt)? Used to skip needless uploads. */
export function sameDoc(a: PrefsDoc, b: PrefsDoc): boolean {
  const strip = (d: PrefsDoc) => JSON.stringify({ ...d, updatedAt: '' });
  return strip(a) === strip(b);
}

const isCat = (c: unknown): c is Category => typeof c === 'string' && (CATEGORIES as readonly string[]).includes(c);
const isKind = (k: unknown): k is TxnKind => typeof k === 'string' && k in KIND_LABELS;

/** Validate a document read from Drive (it is user-controlled data). */
export function parseDoc(json: string): PrefsDoc {
  const d = JSON.parse(json) as Partial<PrefsDoc>;
  if (d.app !== 'expense-tracker-prefs' || d.version !== 1) throw new Error('Unrecognised settings file in Google Drive.');
  const out = emptyDoc();
  out.updatedAt = typeof d.updatedAt === 'string' ? d.updatedAt : out.updatedAt;
  if (d.settings && typeof d.settings.at === 'string') {
    out.settings = {
      at: d.settings.at,
      ownIdentifiers: Array.isArray(d.settings.ownIdentifiers) ? d.settings.ownIdentifiers.filter((x) => typeof x === 'string').slice(0, 200) : [],
      billSpendCards: Array.isArray(d.settings.billSpendCards) ? d.settings.billSpendCards.filter((x) => typeof x === 'string' && /^\d{3,4}$/.test(x)) : [],
      syncMonths: Number.isFinite(d.settings.syncMonths) ? Math.min(60, Math.max(1, Number(d.settings.syncMonths))) : 12,
    };
  }
  out.rules = (Array.isArray(d.rules) ? d.rules : []).filter(
    (r): r is MerchantRule => !!r && typeof r.id === 'string' && typeof r.pattern === 'string' && typeof r.createdAt === 'string' && (r.category === undefined || isCat(r.category)) && (r.kind === undefined || isKind(r.kind)),
  );
  for (const [id, at] of Object.entries(d.deletedRules ?? {})) if (typeof at === 'string') out.deletedRules[id] = at;
  out.templates = (Array.isArray(d.templates) ? d.templates : []).map(validateTemplate).filter((t): t is CustomTemplate => t !== null).slice(0, 200);
  for (const [id, at] of Object.entries(d.deletedTemplates ?? {})) if (typeof at === 'string') out.deletedTemplates[id] = at;
  out.ignore = (Array.isArray(d.ignore) ? d.ignore : []).map(validateIgnoreRule).filter((r): r is IgnoreRule => r !== null).slice(0, 500);
  for (const [id, at] of Object.entries(d.deletedIgnore ?? {})) if (typeof at === 'string') out.deletedIgnore[id] = at;
  for (const [id, e] of Object.entries(d.edits ?? {})) {
    if (!e || typeof e.at !== 'string') continue;
    out.edits[id] = {
      at: e.at,
      category: isCat(e.category) ? e.category : undefined,
      kind: isKind(e.kind) ? e.kind : undefined,
      userEdited: e.userEdited === true || undefined,
      excluded: e.excluded === true || undefined,
      note: typeof e.note === 'string' ? e.note.slice(0, 200) : undefined,
      duplicateStatus: e.duplicateStatus === 'duplicate' || e.duplicateStatus === 'not_duplicate' ? e.duplicateStatus : undefined,
      duplicateOf: typeof e.duplicateOf === 'string' ? e.duplicateOf : undefined,
      removed: e.removed === true || undefined,
    };
  }
  return out;
}

export function settingsPart(s: Settings): SyncedSettings | undefined {
  if (!s.settingsAt) return undefined;
  return { at: s.settingsAt, ownIdentifiers: s.ownIdentifiers, billSpendCards: s.billSpendCards ?? [], syncMonths: s.syncMonths };
}
