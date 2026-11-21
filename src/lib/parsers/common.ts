import type { BankId, Confidence, Direction, ParsedTxn, PaymentMethod, TxnKind } from '../types';

/** Input every bank parser receives. The body is plain text (HTML already stripped). */
export interface EmailInput {
  id: string;
  from: string;
  subject: string;
  /** Plain-text body. Never persisted. */
  body: string;
  /** Email received time (ISO), used when the body has no date. */
  receivedAt: string;
  /** True when Gmail's Authentication-Results header showed DMARC/DKIM pass for the sender domain. */
  authenticated?: boolean;
}

export interface BankParser {
  bank: BankId;
  parse(email: EmailInput): ParsedTxn[];
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** Normalise whitespace, NBSPs and the rupee sign so regexes stay simple. */
export function normaliseText(text: string): string {
  return text
    .replace(/ /g, ' ')
    .replace(/[​-‍﻿]/g, '')
    .replace(/₹/g, 'Rs. ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

const AMOUNT_SRC = String.raw`(?:Rs\.?|INR|Rupees)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)`;
export const AMOUNT_RE = new RegExp(AMOUNT_SRC, 'i');

/** Parse "1,23,456.50" -> 12345650 paise. Returns null for invalid/zero values. */
export function toPaise(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [rupees, frac = ''] = cleaned.split('.');
  const paise = Number(rupees) * 100 + Number((frac + '00').slice(0, 2));
  return Number.isFinite(paise) && paise > 0 ? paise : null;
}

export function findAmount(text: string): number | null {
  const m = AMOUNT_RE.exec(text);
  return m ? toPaise(m[1]) : null;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function validDate(y: number, mo: number, d: number): boolean {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function fullYear(y: string): number {
  const n = Number(y);
  return y.length === 2 ? 2000 + n : n;
}

export interface FoundDate {
  date: string; // YYYY-MM-DD
  index: number;
  length: number;
}

/**
 * Find the first date in text. Indian banks use day-first formats, so
 * 05-11-2026 is read as 5 November.
 */
export function findDate(text: string): FoundDate | null {
  const patterns: Array<{ re: RegExp; get: (m: RegExpExecArray) => [number, number, number] | null }> = [
    // 2026-11-21
    { re: /\b(20\d{2})-(\d{2})-(\d{2})\b/, get: (m) => [Number(m[1]), Number(m[2]), Number(m[3])] },
    // 21-11-2026, 21/11/26, 21.11.2026
    { re: /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/, get: (m) => [fullYear(m[3]), Number(m[2]), Number(m[1])] },
    // 21-Nov-26, 21 Nov, 2026, 21 Nov 2026, 21NOV26, 21-Nov-2026
    {
      re: /\b(\d{1,2})[-\s]?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*[-,\s]*'?(\d{4}|\d{2})\b/i,
      get: (m) => {
        const mo = MONTHS[m[2].toLowerCase()];
        return mo ? [fullYear(m[3]), mo, Number(m[1])] : null;
      },
    },
    // Nov 21, 2026
    {
      re: /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})\b/i,
      get: (m) => {
        const mo = MONTHS[m[1].toLowerCase()];
        return mo ? [Number(m[3]), mo, Number(m[2])] : null;
      },
    },
  ];
  let best: FoundDate | null = null;
  for (const { re, get } of patterns) {
    const m = re.exec(text);
    if (!m) continue;
    const parts = get(m);
    if (!parts) continue;
    const [y, mo, d] = parts;
    if (!validDate(y, mo, d)) continue;
    if (!best || m.index < best.index) {
      best = { date: `${y}-${pad(mo)}-${pad(d)}`, index: m.index, length: m[0].length };
    }
  }
  return best;
}

/** Find a time like 10:15, 10:15:32, 10:15 PM. Returns HH:MM:SS (24h). */
export function findTime(text: string): string | null {
  const m = /\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\s*(AM|PM)?\b/i.exec(text);
  if (!m) return null;
  let h = Number(m[1]);
  const ampm = m[4]?.toUpperCase();
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return `${pad(h)}:${m[2]}:${m[3] ?? '00'}`;
}

/** Convert an ISO timestamp to a local (IST-agnostic) YYYY-MM-DDTHH:MM:SS string. */
export function toLocalIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 19);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Resolve the transaction date: prefer the date in the body (searched after `fromIndex`
 * when given), fall back to the email received time.
 */
export function resolveDate(text: string, receivedAt: string): { date: string; hasTime: boolean; fromBody: boolean } {
  const found = findDate(text);
  if (found) {
    const after = text.slice(found.index + found.length, found.index + found.length + 40);
    const time = findTime(after) ?? findTime(text.slice(Math.max(0, found.index - 30), found.index));
    return { date: `${found.date}T${time ?? '00:00:00'}`, hasTime: Boolean(time), fromBody: true };
  }
  return { date: toLocalIso(receivedAt), hasTime: true, fromBody: false };
}

/** Keep only the last four digits of a masked or full card/account number. */
export function last4(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 3 ? digits.slice(-4) : undefined;
}

export function findAccountLast4(text: string): string | undefined {
  const m =
    /(?:card|a\/c|acct|account)(?:\s+(?:no\.?|number|ending(?:\s+with)?|ending in))?[\s:.]*(?:[Xx*]+\s*)?([Xx*]*\d{3,6})\b/i.exec(text) ??
    /\b[Xx*]{2,}\s*(\d{3,4})\b/.exec(text);
  return last4(m?.[1]);
}

/** Strip anything that looks like a long number (account/card) from merchant strings. */
export function scrubDigits(s: string): string {
  return s.replace(/\d{9,}/g, (d) => `••${d.slice(-4)}`);
}

export function cleanMerchant(raw: string): string {
  const s = scrubDigits(raw)
    .replace(/\s+/g, ' ')
    .replace(/^[\s:,.-]+|[\s:,.-]+$/g, '')
    .replace(/\s+(on|at|dated)$/i, '')
    .trim();
  return s.slice(0, 80);
}

/** Build a RegExp from a template string where {AMT} is a currency + amount with one capture group. */
export function rx(source: string, flags = 'i'): RegExp {
  return new RegExp(source.replace(/\{AMT\}/g, AMOUNT_SRC).replace(/ /g, String.raw`\s+`), flags);
}

const INFO_NOISE = /^(UPI|P2M|P2A|POS|ECOM|ECOM PUR|PUR|IMPS|NEFT|RTGS|MMT|BIL|ONL|INB|ACH|NACH|CMS|BBPS|VPS|IPS|MOB|NFS|ATW|CAW|DR|CR)$/i;

/**
 * Bank "transaction info" strings look like UPI/P2M/632477712345/ZEPTO MARKETPLACE or
 * NEFT-CITIN26305123456-ACME TECH. Pull out the counterparty name.
 */
export function merchantFromInfo(info: string): string {
  const s = info.trim();
  let parts: string[] | null = null;
  if (s.includes('/')) parts = s.split('/');
  else if (/^(NEFT|IMPS|RTGS|UPI|ACH|NACH)-/i.test(s)) parts = s.split('-');
  if (!parts) return s.replace(/^(UPI|NEFT|IMPS|RTGS)\s+(from|to)\s+/i, '');
  const kept = parts
    .map((p) => p.trim())
    .filter((p) => p && !INFO_NOISE.test(p) && !/\d{6,}/.test(p) && !p.includes('••') && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(p) && !/^[A-Z]{4,6}[0-9•]{6,}$/i.test(p));
  return kept[0] ?? s;
}

export function findUpiRef(text: string): string | undefined {
  const m =
    /(?:UPI\s*(?:transaction\s*)?(?:reference|ref)(?:\s*(?:number|no\.?))?|UPI\s*Ref\s*No\.?|RRN|Ref\s*No\.?)\s*(?:is|:)?\s*([0-9]{9,16})/i.exec(text) ??
    /\bUPI[/:-](?:P2[AM][/:-])?([0-9]{12})\b/i.exec(text);
  return m?.[1];
}

export function findAuthCode(text: string): string | undefined {
  const m = /authori[sz]ation\s*code\s*[:\-–]*\s*([A-Z0-9]{4,10})/i.exec(text);
  return m?.[1];
}

/** Text looks like an OTP / security message rather than a transaction. */
export function isOtpOrSecurity(text: string): boolean {
  return /\b(one[\s-]?time\s*password|OTP\s*(is|for)|is your OTP|verification code)\b/i.test(text);
}

/** Text looks like a declined/failed transaction, which should not be counted. */
export function isDeclined(text: string): boolean {
  return /\b(declined|has failed|was unsuccessful|could not be processed|transaction failed)\b/i.test(text);
}

export function isPromotional(subject: string, text: string): boolean {
  if (/\b(offer|cashback offer|pre-approved|upgrade|win|reward points? statement|e-?statement|statement for)\b/i.test(subject)) {
    return !AMOUNT_RE.test(text) || !/\b(debited|credited|spent|used|withdrawn|paid)\b/i.test(text);
  }
  return false;
}

export function detectMethod(text: string): PaymentMethod {
  if (/\bcredit\s*card\b/i.test(text)) return 'Credit Card';
  if (/\bdebit\s*card\b/i.test(text)) return 'Debit Card';
  if (/\bUPI\b|\bVPA\b/i.test(text)) return 'UPI';
  if (/\bATM\b|cash withdrawal/i.test(text)) return 'ATM';
  if (/\b(NEFT|IMPS|RTGS)\b/i.test(text)) return 'Bank Transfer';
  if (/net\s*banking|netbanking|internet banking/i.test(text)) return 'Net Banking';
  if (/\b(a\/c|account|acct)\b/i.test(text)) return 'Account';
  return 'Unknown';
}

export function detectKindHint(text: string, direction: Direction, method: PaymentMethod): TxnKind | undefined {
  if (/\b(refund|reversal|reversed|refunded|chargeback)\b/i.test(text) && direction === 'credit') return 'refund';
  if (method === 'ATM' || /\bATM\b.*\bwithdraw|cash withdrawal|withdrawn\b.*\bATM\b/i.test(text)) return direction === 'debit' ? 'cash' : undefined;
  if (/\b(annual fee|late payment fee|finance charges?|GST on|service charges?|SMS charges|penal charges|processing fee|non[\s-]?maintenance)\b/i.test(text) && direction === 'debit') return 'fee';
  if (/payment\s+(of\s+)?.{0,40}\s+(has been\s+)?received\s+towards\s+your\s+.{0,30}credit\s*card|thank you for (your )?payment|payment received.{0,40}credit card/i.test(text)) return 'cc_payment';
  return undefined;
}

export function make(
  bank: BankId,
  template: string,
  fields: {
    text: string;
    direction: Direction;
    amountPaise: number;
    merchantRaw: string;
    method?: PaymentMethod;
    accountLast4?: string;
    reference?: string;
    confidence?: Confidence;
    kindHint?: TxnKind;
    receivedAt: string;
    dateText?: string;
  },
): ParsedTxn {
  const method = fields.method ?? detectMethod(fields.text);
  const { date, hasTime, fromBody } = resolveDate(fields.dateText ?? fields.text, fields.receivedAt);
  let confidence: Confidence = fields.confidence ?? 'high';
  if (!fromBody && confidence === 'high') confidence = 'medium';
  const merchant = cleanMerchant(fields.merchantRaw);
  if (!merchant && confidence === 'high') confidence = 'medium';
  return {
    bank,
    method,
    direction: fields.direction,
    amountPaise: fields.amountPaise,
    date,
    hasTime,
    merchantRaw: merchant,
    accountLast4: fields.accountLast4 ?? findAccountLast4(fields.text),
    reference: fields.reference ?? findUpiRef(fields.text) ?? findAuthCode(fields.text),
    kindHint: fields.kindHint ?? detectKindHint(fields.text, fields.direction, method),
    confidence,
    template,
  };
}

/** Helper: run a list of regex templates and return the first that matches. */
export interface Template {
  name: string;
  re: RegExp;
  direction: Direction;
  method?: PaymentMethod;
  kindHint?: TxnKind;
  /** Group indexes. */
  amount: number;
  /** Group index (or several, first non-empty wins). */
  merchant?: number | number[];
  /** Fixed merchant label when the email has none (e.g. card bill payments). */
  merchantConst?: string;
  account?: number;
  /** Optional explicit date group. */
  date?: number;
}

export function runTemplates(bank: BankId, templates: Template[], text: string, receivedAt: string): ParsedTxn | null {
  for (const t of templates) {
    const m = t.re.exec(text);
    if (!m) continue;
    const amountPaise = toPaise(m[t.amount]);
    if (!amountPaise) continue;
    const groups = t.merchant === undefined ? [] : Array.isArray(t.merchant) ? t.merchant : [t.merchant];
    const merchantRaw = groups.map((g) => (m[g] ?? '').trim()).find((v) => v.length > 0) ?? t.merchantConst ?? '';
    return make(bank, t.name, {
      text,
      direction: t.direction,
      amountPaise,
      merchantRaw: merchantFromInfo(merchantRaw),
      method: t.method,
      accountLast4: t.account ? last4(m[t.account]) : undefined,
      kindHint: t.kindHint,
      receivedAt,
      dateText: t.date ? m[t.date] + ' ' + text.slice(m.index) : text.slice(m.index),
    });
  }
  return null;
}

/**
 * Last-resort parser used when no bank template matches. Only produces a
 * low-confidence result when the text clearly states one amount and a direction.
 */
export function genericParse(bank: BankId, text: string, receivedAt: string): ParsedTxn | null {
  const amounts = [...text.matchAll(new RegExp(AMOUNT_SRC, 'gi'))];
  if (amounts.length === 0) return null;
  const debit = /\b(debited|spent|withdrawn|paid|used for|purchase)\b/i.test(text);
  const credit = /\b(credited|received|refund(ed)?|reversed)\b/i.test(text);
  if (debit === credit) return null; // ambiguous or neither
  // Ignore available balance / limit amounts.
  const first = amounts.find((a) => {
    const before = text.slice(Math.max(0, (a.index ?? 0) - 30), a.index ?? 0);
    return !/(avail|balance|limit|bal\.?)\s*[:\-]?\s*(is\s*)?$/i.test(before);
  });
  if (!first) return null;
  const amountPaise = toPaise(first[1]);
  if (!amountPaise) return null;
  const merchantMatch =
    /\b(?:at|to|towards|Info[:.]?)\s+([A-Za-z0-9&@._*' -]{2,40}?)(?=\s+(?:on|dated|via|using|ref|\.|,)|[.,\n]|$)/i.exec(text.slice(first.index));
  return make(bank, 'generic', {
    text,
    direction: debit ? 'debit' : 'credit',
    amountPaise,
    merchantRaw: merchantMatch?.[1] ?? '',
    confidence: 'low',
    receivedAt,
  });
}
