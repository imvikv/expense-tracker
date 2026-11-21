import type { Transaction } from './types';

/** Transactions that should be considered at all (not excluded, not a confirmed duplicate). */
export function isCounted(t: Transaction): boolean {
  return !t.excluded && t.duplicateStatus !== 'duplicate';
}

/**
 * Contribution to spending in paise: purchases, cash and fees add; refunds subtract.
 * Transfers, income, investments and card bill payments contribute nothing.
 */
export function spendPaise(t: Transaction): number {
  if (!isCounted(t)) return 0;
  if (t.kind === 'refund') return -t.amountPaise;
  if ((t.kind === 'expense' || t.kind === 'cash' || t.kind === 'fee') && t.direction === 'debit') return t.amountPaise;
  return 0;
}

export function isSpending(t: Transaction): boolean {
  return spendPaise(t) !== 0;
}

export function monthKey(date: string | Date): string {
  if (typeof date === 'string') return date.slice(0, 7);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function addMonths(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthKey(d);
}

export function monthLabel(key: string, style: 'short' | 'long' = 'short'): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', style === 'short' ? { month: 'short' } : { month: 'long', year: 'numeric' });
}

export function inMonth(t: Transaction, key: string): boolean {
  return t.date.startsWith(key);
}

export interface MonthTotal {
  month: string;
  spendPaise: number;
  count: number;
}

export function monthlyTotals(txns: Transaction[], endMonth: string, months = 12): MonthTotal[] {
  const keys = Array.from({ length: months }, (_, i) => addMonths(endMonth, i - months + 1));
  const map = new Map(keys.map((k) => [k, { month: k, spendPaise: 0, count: 0 }]));
  for (const t of txns) {
    const row = map.get(monthKey(t.date));
    const v = spendPaise(t);
    if (row && v !== 0) {
      row.spendPaise += v;
      if (v > 0) row.count++;
    }
  }
  return keys.map((k) => map.get(k)!);
}

export interface Group {
  key: string;
  spendPaise: number;
  count: number;
}

export function groupSpend(txns: Transaction[], keyOf: (t: Transaction) => string): Group[] {
  const map = new Map<string, Group>();
  for (const t of txns) {
    const v = spendPaise(t);
    if (v === 0) continue;
    const k = keyOf(t);
    const g = map.get(k) ?? { key: k, spendPaise: 0, count: 0 };
    g.spendPaise += v;
    if (v > 0) g.count++;
    map.set(k, g);
  }
  return [...map.values()].filter((g) => g.spendPaise > 0).sort((a, b) => b.spendPaise - a.spendPaise);
}

export function methodBucket(t: Transaction): string {
  if (t.method === 'Credit Card') return 'Credit card';
  if (t.method === 'Debit Card' || t.method === 'ATM') return 'Debit card';
  if (t.method === 'UPI') return 'UPI';
  return 'Bank / other';
}

export interface Summary {
  month: string;
  thisMonthPaise: number;
  lastMonthPaise: number;
  /** Percentage change vs last month, or null when last month is zero. */
  momChangePct: number | null;
  avgMonthlyPaise: number;
  /** Months used for the average (complete months with data, up to 12). */
  avgMonths: number;
  largestCategory: Group | null;
  txnCount: number;
}

export function summarise(txns: Transaction[], month: string): Summary {
  const totals = monthlyTotals(txns, month, 13);
  const current = totals[totals.length - 1];
  const previous = totals[totals.length - 2];
  const history = totals.slice(0, -1).filter((t) => t.count > 0);
  const avg = history.length ? Math.round(history.reduce((s, t) => s + t.spendPaise, 0) / history.length) : 0;
  const cats = groupSpend(
    txns.filter((t) => inMonth(t, month)),
    (t) => t.category,
  );
  return {
    month,
    thisMonthPaise: current.spendPaise,
    lastMonthPaise: previous.spendPaise,
    momChangePct: previous.spendPaise > 0 ? ((current.spendPaise - previous.spendPaise) / previous.spendPaise) * 100 : null,
    avgMonthlyPaise: avg,
    avgMonths: history.length,
    largestCategory: cats[0] ?? null,
    txnCount: current.count,
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface Recurring {
  merchant: string;
  category: string;
  typicalPaise: number;
  occurrences: number;
  lastDate: string;
  nextExpected: string;
  cadence: 'monthly' | 'yearly';
}

/**
 * Detect recurring payments: the same merchant charged a similar amount
 * (within 15% of the median) in at least 3 different months at ~monthly intervals,
 * or anything in the Subscriptions category seen at least twice.
 */
export function detectRecurring(txns: Transaction[]): Recurring[] {
  const byMerchant = new Map<string, Transaction[]>();
  for (const t of txns) {
    if (spendPaise(t) <= 0 || t.merchant === 'Unknown') continue;
    const list = byMerchant.get(t.merchant) ?? [];
    list.push(t);
    byMerchant.set(t.merchant, list);
  }
  const out: Recurring[] = [];
  for (const [merchant, list] of byMerchant) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const med = median(list.map((t) => t.amountPaise));
    const similar = list.filter((t) => Math.abs(t.amountPaise - med) <= med * 0.15);
    const months = new Set(similar.map((t) => monthKey(t.date)));
    const isSub = list[0].category === 'Subscriptions';
    if (months.size < 3 && !(isSub && months.size >= 2)) continue;
    // Intervals between consecutive similar charges.
    const gaps: number[] = [];
    for (let i = 1; i < similar.length; i++) gaps.push((new Date(similar[i].date).getTime() - new Date(similar[i - 1].date).getTime()) / 86_400_000);
    const g = gaps.length ? median(gaps) : 30;
    let cadence: Recurring['cadence'] | null = null;
    if (g >= 25 && g <= 35) cadence = 'monthly';
    else if (g >= 350 && g <= 380) cadence = 'yearly';
    else if (isSub) cadence = 'monthly';
    // Several similar charges per month (e.g. regular grocery orders) are habits, not subscriptions.
    if (!cadence || similar.length > months.size + 1 || list.length > months.size * 1.5) continue;
    const last = similar[similar.length - 1];
    const next = new Date(last.date);
    if (cadence === 'monthly') next.setMonth(next.getMonth() + 1);
    else next.setFullYear(next.getFullYear() + 1);
    out.push({
      merchant,
      category: last.category,
      typicalPaise: Math.round(med),
      occurrences: similar.length,
      lastDate: last.date,
      nextExpected: next.toISOString().slice(0, 10),
      cadence,
    });
  }
  return out.sort((a, b) => b.typicalPaise - a.typicalPaise);
}

/**
 * Unusually large spending: at least ₹5,000 and at least 3× the median for its category
 * (or the top 5 largest when a category has too little history).
 */
export function detectUnusual(txns: Transaction[], from: string): Transaction[] {
  const spending = txns.filter((t) => spendPaise(t) > 0);
  const byCat = new Map<string, number[]>();
  for (const t of spending) {
    const arr = byCat.get(t.category) ?? [];
    arr.push(t.amountPaise);
    byCat.set(t.category, arr);
  }
  const MIN = 5000_00;
  return spending
    .filter((t) => t.date >= from && t.amountPaise >= MIN)
    .filter((t) => {
      const arr = byCat.get(t.category) ?? [];
      if (arr.length < 5) return t.amountPaise >= MIN * 2;
      return t.amountPaise >= median(arr) * 3;
    })
    .sort((a, b) => b.amountPaise - a.amountPaise)
    .slice(0, 10);
}

export function formatINR(paise: number, opts: { decimals?: boolean; compact?: boolean } = {}): string {
  const rupees = paise / 100;
  if (opts.compact && Math.abs(rupees) >= 1_00_000) {
    return `₹${(rupees / 1_00_000).toLocaleString('en-IN', { maximumFractionDigits: 1 })}L`;
  }
  if (opts.compact && Math.abs(rupees) >= 1000) {
    return `₹${(rupees / 1000).toLocaleString('en-IN', { maximumFractionDigits: 1 })}k`;
  }
  return `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: opts.decimals ? 2 : 0, maximumFractionDigits: opts.decimals ? 2 : 0 })}`;
}
