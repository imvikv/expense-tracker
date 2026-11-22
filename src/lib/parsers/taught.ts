/**
 * Templates taught in the app ("Teach the app"): the user marks the amount, payee,
 * date and accounts in one real email, and we turn the surrounding wording into a
 * regular expression that matches every email of that kind.
 *
 * Two sources, tried after the built-in bank templates:
 *   1. taught-templates.json in the repo — templates exported from the app and committed
 *      to GitHub, so every device gets them in the build.
 *   2. The user's own templates, stored locally and synced with their settings.
 *
 * Templates contain only the wording pattern plus a redacted sample; never the
 * user's own numbers or names (unless they were left unmarked in the wording —
 * the UI shows the sample so the user can check before exporting).
 */
import { BANK_LABELS, KIND_LABELS, type BankId, type Direction, type ParsedTxn, type PaymentMethod, type TxnKind } from '../types';
import { findDate, last4, make, parseInfo, toPaise } from './common';
import repoTemplates from './taught-templates.json';

export type TaughtField = 'amount' | 'payee' | 'date' | 'account' | 'payeeAccount';

export const FIELD_LABELS: Record<TaughtField, string> = {
  amount: 'Amount',
  payee: 'Paid to / from',
  date: 'Date',
  account: 'My account / card',
  payeeAccount: 'Their account',
};

export interface CustomTemplate {
  id: string;
  name: string;
  bank: BankId;
  createdAt: string;
  /** Regular expression source (case-insensitive). */
  source: string;
  direction: Direction;
  method?: PaymentMethod;
  kindHint?: TxnKind;
  /** Capture group index per field. */
  groups: Partial<Record<TaughtField, number>> & { amount: number };
  /** The matched wording with personal values replaced, used for tests and review. */
  sample: string;
  /** What the template reads from `sample` (checked by the test suite). */
  expect: { amountPaise: number; payee?: string; account?: string; payeeAccount?: string; date?: string };
}

export const SAMPLE_RECEIVED_AT = '2026-01-15T06:00:00.000Z';
const METHODS: PaymentMethod[] = ['Credit Card', 'Debit Card', 'UPI', 'Net Banking', 'Bank Transfer', 'ATM', 'Account', 'Unknown'];

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const repo: CustomTemplate[] = (repoTemplates as unknown[]).map(validateTemplate).filter((t): t is CustomTemplate => t !== null);
let local: CustomTemplate[] = [];
const compiled = new Map<string, RegExp>();

function re(t: CustomTemplate): RegExp {
  let r = compiled.get(t.source);
  if (!r) {
    r = new RegExp(t.source, 'i');
    compiled.set(t.source, r);
  }
  return r;
}

export function setLocalTemplates(list: CustomTemplate[]): void {
  local = list.map(validateTemplate).filter((t): t is CustomTemplate => t !== null);
}

/** Templates with a working anonymised sample can be committed to GitHub. */
export function isExportable(t: CustomTemplate): boolean {
  return !!t.sample;
}

export function repoTaughtTemplates(): CustomTemplate[] {
  return repo;
}

export function localTaughtTemplates(): CustomTemplate[] {
  return local;
}

/** Try the repo-shared templates, then the user's own, for this bank. */
export function applyTaughtTemplates(bank: BankId, text: string, receivedAt: string): ParsedTxn[] {
  const seen = new Set<string>();
  for (const t of [...repo, ...local]) {
    if (t.bank !== bank || seen.has(t.source)) continue;
    seen.add(t.source);
    const p = applyTemplate(t, text, receivedAt);
    if (p) return [p];
  }
  return [];
}

export function applyTemplate(t: CustomTemplate, text: string, receivedAt: string): ParsedTxn | null {
  let m: RegExpExecArray | null;
  try {
    m = re(t).exec(text);
  } catch {
    return null;
  }
  if (!m) return null;
  const g = t.groups;
  const amountPaise = toPaise(m[g.amount] ?? '');
  if (!amountPaise) return null;
  const payeeRaw = g.payee ? (m[g.payee] ?? '').trim() : '';
  const info = parseInfo(payeeRaw);
  return make(t.bank, `taught:${t.name}`, {
    text,
    direction: t.direction,
    amountPaise,
    merchantRaw: payeeRaw ? info.name : '',
    hasPayee: !!payeeRaw || !!g.payeeAccount,
    method: t.method,
    accountLast4: g.account ? last4(m[g.account]) : undefined,
    payeeAccount: g.payeeAccount ? last4(m[g.payeeAccount]) : undefined,
    kindHint: t.kindHint,
    location: info.location,
    payeeTypeHint: info.typeHint,
    receivedAt,
    dateText: g.date ? m[g.date] : text.slice(m.index),
    at: m.index,
    atEnd: m.index + m[0].length,
    confidence: 'high',
  });
}

// ---------------------------------------------------------------------------
// Building a template from marked spans
// ---------------------------------------------------------------------------

export type Spans = Partial<Record<TaughtField, [number, number]>>;

const CURRENCY = String.raw`(?:INR|Rs\.?|Rupees)`;
const NUMBER = String.raw`([0-9][0-9,]*(?:\.[0-9]{1,2})?)`;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Turn fixed wording into a pattern: spaces flexible, numbers and masks generic, currency words interchangeable. */
export function literal(s: string): string {
  return s
    .split(/(\s+|\d+|[xX*•]{3,}|\*{2,}|\bINR\b|\bRs\.?|\bRupees\b|[a-z0-9][a-z0-9._-]*@[a-z][a-z0-9.]*)/i)
    .map((piece) => {
      if (!piece) return '';
      if (/^\s+$/.test(piece)) return String.raw`\s+`;
      if (/^\d+$/.test(piece)) return String.raw`\d+`;
      if (/^([xX*•]{3,}|\*{2,})$/.test(piece)) return String.raw`[xX*•]+`;
      if (/^(INR|Rs\.?|Rupees)$/i.test(piece)) return CURRENCY;
      if (/@/.test(piece)) return String.raw`\S+@\S+`;
      return escape(piece);
    })
    .join('');
}

/** Shape of a date as written ("05-11-26", "October 30,2026") as a capture. */
function dateShape(s: string): string {
  const inner = s
    .trim()
    .split(/([A-Za-z]+|\d+|\s+)/)
    .map((p) => (!p ? '' : /^[A-Za-z]+$/.test(p) ? '[A-Za-z]+' : /^\d+$/.test(p) ? String.raw`\d{1,4}` : /^\s+$/.test(p) ? String.raw`\s*` : escape(p)))
    .join('');
  return `(${inner})`;
}

function capture(field: TaughtField, selected: string, isLast: boolean): string {
  const s = selected.trim();
  switch (field) {
    case 'amount': {
      if (!/^(?:(?:INR|Rs\.?|Rupees)\s*)?[0-9][0-9,]*(?:\.[0-9]{1,2})?$/i.test(s)) throw new Error('Mark only the amount, e.g. “62,000.00” or “INR 62,000.00”.');
      return /^(INR|Rs|Rupees)/i.test(s) ? `${CURRENCY}\\s*${NUMBER}` : NUMBER;
    }
    case 'account':
    case 'payeeAccount': {
      if (!/\d{3,}$/.test(s)) throw new Error('Mark the account/card number including its last digits, e.g. “xxxx8848”.');
      // Words marked along with the number ("A/c XX1234") are kept as fixed wording.
      const m = /^([\s\S]*?)([xX*•]*\s*\d{3,6})$/.exec(s)!;
      return literal(m[1]) + String.raw`[xX*•]*\s*(\d{3,6})`;
    }
    case 'date':
      if (!findDate(s)) throw new Error('That doesn’t look like a date. Mark just the date, e.g. “05-11-26”.');
      return dateShape(s);
    case 'payee':
      if (s.length < 2) throw new Error('Mark the name of who was paid (or who paid you).');
      // Names can wrap onto the next line in HTML emails.
      return isLast ? String.raw`([^\n]+?(?:\n[^\n]+?)?)(?=\s+(?:on|via|dated|ref|for|at|using)\b|[.,;\n]|$)` : String.raw`([^\n]+?(?:\n[^\n]+?)?)`;
  }
}

export interface BuildInput {
  bank: BankId;
  text: string;
  spans: Spans;
  direction: Direction;
  method?: PaymentMethod;
  kindHint?: TxnKind;
  name?: string;
  id: string;
}

export interface BuildResult {
  template: CustomTemplate;
  /** What the new template reads from the original email. */
  preview: ParsedTxn;
}

/** Create a template from marked spans and check it reads the original email back. */
export function buildTemplate(input: BuildInput): BuildResult {
  const { text, spans } = input;
  if (!spans.amount) throw new Error('Mark the amount first.');
  const ordered = (Object.entries(spans) as Array<[TaughtField, [number, number]]>).filter(([, r]) => r && r[1] > r[0]).sort((a, b) => a[1][0] - b[1][0]);
  for (let i = 1; i < ordered.length; i++) if (ordered[i][1][0] < ordered[i - 1][1][1]) throw new Error(`${FIELD_LABELS[ordered[i - 1][0]]} and ${FIELD_LABELS[ordered[i][0]]} overlap.`);

  // Start a little before the first marked value, within its sentence, on a word boundary.
  const first = ordered[0][1][0];
  const before = text.slice(0, first);
  const sentence = Math.max(before.lastIndexOf('\n') + 1, ...[...before.matchAll(/[.!?]\s+(?=[A-Z])/g)].map((m) => (m.index ?? 0) + m[0].length));
  let start = Math.max(sentence, first - 60);
  if (start > sentence) {
    const ws = text.slice(start, first).search(/\s/);
    start = ws === -1 ? first : start + ws + 1;
  }
  // Never start or end on whitespace: line breaks and indentation vary between emails.
  while (start < first && /\s/.test(text[start])) start++;
  // End a little after the last value, within its sentence.
  const lastEnd = ordered[ordered.length - 1][1][1];
  const after = text.slice(lastEnd, lastEnd + 30);
  const stop = after.search(/\n|\.(\s|$)/);
  let suffix = stop === -1 ? after : after.slice(0, stop);
  if (stop === -1) suffix = suffix.replace(/\s+\S*$/, ''); // don't end mid-word
  suffix = suffix.replace(/\s+$/, '');

  let source = '';
  let sample = '';
  let wording = '';
  let cursor = start;
  const groups: CustomTemplate['groups'] = { amount: 0 };
  ordered.forEach(([field, [a, b]], i) => {
    const lit = text.slice(cursor, a);
    wording += ` ${lit}`;
    source += literal(lit);
    sample += redactLiteral(lit);
    const isLast = i === ordered.length - 1 && suffix.trim() === '';
    source += capture(field, text.slice(a, b), isLast);
    sample += redactValue(field, text.slice(a, b));
    groups[field] = i + 1;
    cursor = b;
  });
  source += literal(suffix);
  sample += redactLiteral(suffix);

  const template: CustomTemplate = {
    id: input.id,
    // Named from the bank's fixed wording only — never from the marked (personal) values.
    name: (input.name?.trim() || defaultName(input.bank, `${wording} ${suffix}`)).slice(0, 60),
    bank: input.bank,
    createdAt: new Date().toISOString(),
    source,
    direction: input.direction,
    method: input.method,
    kindHint: input.kindHint,
    groups,
    sample,
    expect: { amountPaise: 0 },
  };

  const preview = applyTemplate(template, text, new Date().toISOString());
  if (!preview) throw new Error('The template didn’t read this email back. Try marking the values again.');
  const fromSample = applyTemplate(template, template.sample, SAMPLE_RECEIVED_AT);
  if (!fromSample) {
    // The template itself works; only the anonymised copy for GitHub doesn't. Save it as device-only.
    template.sample = '';
    template.expect = { amountPaise: preview.amountPaise };
    compiled.delete(source);
    return { template, preview };
  }
  template.expect = {
    amountPaise: fromSample.amountPaise,
    payee: fromSample.payee,
    account: fromSample.accountLast4,
    payeeAccount: fromSample.payeeAccount,
    date: fromSample.date.slice(0, 10),
  };
  compiled.delete(source);
  return { template, preview };
}

function defaultName(bank: BankId, wording: string): string {
  const words = wording
    .replace(/[0-9,.*xX•]{3,}/g, ' ')
    .replace(/\b(INR|Rs\.?)\b/gi, ' ')
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]{3,}$/.test(w))
    .slice(0, 5)
    .join(' ')
    .toLowerCase();
  return `${BANK_LABELS[bank].split(' ')[0]}: ${words || 'taught template'}`;
}

/** Replace numbers and UPI IDs in fixed wording so the sample carries nothing personal. */
function redactLiteral(s: string): string {
  return s.replace(/[a-z0-9][a-z0-9._-]*@[a-z][a-z0-9.]*/gi, 'name@bank').replace(/\d+/g, (d) => '0'.repeat(d.length));
}

function redactValue(field: TaughtField, s: string): string {
  switch (field) {
    case 'amount': {
      const cur = /^((?:INR|Rs\.?|Rupees)\s*)/i.exec(s.trim());
      return `${cur ? cur[1] : ''}1,234.00`;
    }
    case 'payee':
      return 'SAMPLE PAYEE';
    case 'account':
    case 'payeeAccount': {
      const m = /^([\s\S]*?)([xX*•]*\s*)(\d{3,6})$/.exec(s.trim());
      if (!m) return s;
      return redactLiteral(m[1]) + m[2] + (field === 'account' ? '1234' : '5678');
    }
    case 'date':
      return s;
  }
}

// ---------------------------------------------------------------------------
// Validation (templates come from Drive, imports and the repo file)
// ---------------------------------------------------------------------------

export function validateTemplate(x: unknown): CustomTemplate | null {
  const t = x as CustomTemplate;
  if (!t || typeof t !== 'object') return null;
  if (typeof t.id !== 'string' || typeof t.source !== 'string' || t.source.length > 1500 || !(t.bank in BANK_LABELS)) return null;
  if (t.direction !== 'debit' && t.direction !== 'credit') return null;
  if (!t.groups || !Number.isInteger(t.groups.amount) || t.groups.amount < 1) return null;
  for (const v of Object.values(t.groups)) if (v !== undefined && (!Number.isInteger(v) || v < 1 || v > 20)) return null;
  if (t.method !== undefined && !METHODS.includes(t.method)) return null;
  if (t.kindHint !== undefined && !(t.kindHint in KIND_LABELS)) return null;
  try {
    new RegExp(t.source, 'i');
  } catch {
    return null;
  }
  return {
    id: t.id,
    name: typeof t.name === 'string' ? t.name.slice(0, 60) : 'Taught template',
    bank: t.bank,
    createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date(0).toISOString(),
    source: t.source,
    direction: t.direction,
    method: t.method,
    kindHint: t.kindHint,
    groups: t.groups,
    sample: typeof t.sample === 'string' ? t.sample.slice(0, 1200) : '',
    expect: t.expect && typeof t.expect.amountPaise === 'number' ? t.expect : { amountPaise: 0 },
  };
}
