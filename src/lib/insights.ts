import { addMonths, formatINR, groupSpend, inMonth, monthLabel, spendPaise } from './analytics';
import { payeeKey } from './categorize';
import type { Category, PayeeType, Transaction } from './types';

/** A counterparty with everything we know about them. */
export interface PayeeGroup {
  key: string;
  name: string;
  /** Name as the bank wrote it, when different from the display name. */
  raw?: string;
  vpa?: string;
  account?: string;
  type: PayeeType;
  spendPaise: number;
  count: number;
  lastDate: string;
  firstDate: string;
  categories: Category[];
  txns: Transaction[];
}

/** Group spending by who was paid (UPI ID when known, else account, else merchant name). */
export function payeeGroups(txns: Transaction[], filter: (t: Transaction) => boolean = () => true): PayeeGroup[] {
  const map = new Map<string, PayeeGroup>();
  for (const t of txns) {
    const v = spendPaise(t);
    if (v <= 0 || !filter(t)) continue;
    const key = payeeKey(t);
    let g = map.get(key);
    if (!g) {
      g = { key, name: t.merchant, raw: t.payee && t.payee.toLowerCase() !== t.merchant.toLowerCase() ? t.payee : undefined, vpa: t.payeeVpa, account: t.payeeAccount, type: t.payeeType ?? 'unknown', spendPaise: 0, count: 0, lastDate: t.date, firstDate: t.date, categories: [], txns: [] };
      map.set(key, g);
    }
    g.spendPaise += v;
    g.count++;
    g.txns.push(t);
    if (t.date > g.lastDate) {
      g.lastDate = t.date;
      g.name = t.merchant;
    }
    if (t.date < g.firstDate) g.firstDate = t.date;
    if (!g.categories.includes(t.category)) g.categories.push(t.category);
  }
  return [...map.values()].sort((a, b) => b.spendPaise - a.spendPaise);
}

/** Spending that still needs identifying: counted, uncategorised purchases the user hasn't touched. */
export function isUnclear(t: Transaction): boolean {
  return spendPaise(t) > 0 && t.kind === 'expense' && t.category === 'Uncategorized' && !t.userEdited;
}

export interface CategoryDelta {
  category: string;
  currentPaise: number;
  previousPaise: number;
  deltaPaise: number;
}

export function categoryDeltas(txns: Transaction[], month: string): CategoryDelta[] {
  const cur = new Map(groupSpend(txns.filter((t) => inMonth(t, month)), (t) => t.category).map((g) => [g.key, g.spendPaise]));
  const prevMonth = addMonths(month, -1);
  const prev = new Map(groupSpend(txns.filter((t) => inMonth(t, prevMonth)), (t) => t.category).map((g) => [g.key, g.spendPaise]));
  const cats = new Set([...cur.keys(), ...prev.keys()]);
  return [...cats]
    .map((c) => ({ category: c, currentPaise: cur.get(c) ?? 0, previousPaise: prev.get(c) ?? 0, deltaPaise: (cur.get(c) ?? 0) - (prev.get(c) ?? 0) }))
    .sort((a, b) => Math.abs(b.deltaPaise) - Math.abs(a.deltaPaise));
}

export type InsightAction = { to: 'review' } | { to: 'txns'; category?: string; payee?: string; search?: string };

export interface Insight {
  id: string;
  tone: 'info' | 'warn' | 'up' | 'down';
  text: string;
  action?: InsightAction;
}

const pct = (a: number, b: number) => Math.round((a / b) * 100);

/** Plain-language observations about one month, most useful first. */
export function monthInsights(txns: Transaction[], month: string, today = new Date()): Insight[] {
  const out: Insight[] = [];
  const monthTxns = txns.filter((t) => inMonth(t, month));
  const total = monthTxns.reduce((s, t) => s + Math.max(0, spendPaise(t)), 0);
  if (total === 0) return [{ id: 'none', tone: 'info', text: `No spending recorded for ${monthLabel(month, 'long')}.` }];

  // Pace for the current month.
  const curKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  if (month === curKey && today.getDate() >= 5) {
    const days = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const projected = Math.round((total / today.getDate()) * days);
    out.push({ id: 'pace', tone: 'info', text: `At this pace you'll spend about ${formatINR(projected)} by month-end (${formatINR(total)} in ${today.getDate()} days).` });
  }

  // How much is still unidentified.
  const unclear = monthTxns.filter(isUnclear);
  if (unclear.length > 0) {
    const amt = unclear.reduce((s, t) => s + t.amountPaise, 0);
    const payees = new Set(unclear.map(payeeKey)).size;
    out.push({
      id: 'unclear',
      tone: 'warn',
      text: `${formatINR(amt)} (${pct(amt, total)}%) isn't identified yet: ${unclear.length} payment${unclear.length === 1 ? '' : 's'} to ${payees} payee${payees === 1 ? '' : 's'}. Name them once and future payments are sorted automatically.`,
      action: { to: 'review' },
    });
  }

  // Money sent to people.
  const people = payeeGroups(monthTxns, (t) => t.payeeType === 'person');
  if (people.length > 0) {
    const amt = people.reduce((s, g) => s + g.spendPaise, 0);
    const top = people[0];
    out.push({
      id: 'people',
      tone: 'info',
      text: `${formatINR(amt)} went to ${people.length} ${people.length === 1 ? 'person' : 'people'} directly — most to ${top.name} (${formatINR(top.spendPaise)}${top.count > 1 ? `, ${top.count} payments` : ''}).`,
      action: { to: 'txns', payee: top.key },
    });
  }

  // Biggest category moves vs last month.
  const deltas = categoryDeltas(txns, month).filter((d) => d.category !== 'Uncategorized' && Math.abs(d.deltaPaise) >= 50000);
  const up = deltas.filter((d) => d.deltaPaise > 0)[0];
  const down = deltas.filter((d) => d.deltaPaise < 0)[0];
  const prevName = monthLabel(addMonths(month, -1), 'short');
  if (up) {
    out.push({
      id: 'up',
      tone: 'up',
      text: `${up.category} is up ${formatINR(up.deltaPaise)} vs ${prevName}${up.previousPaise > 0 ? ` (+${pct(up.deltaPaise, up.previousPaise)}%)` : ' (new this month)'}.`,
      action: { to: 'txns', category: up.category },
    });
  }
  if (down) {
    out.push({ id: 'down', tone: 'down', text: `${down.category} is down ${formatINR(-down.deltaPaise)} vs ${prevName}.`, action: { to: 'txns', category: down.category } });
  }

  // First-time payees (only meaningful with some history).
  const hasHistory = txns.some((t) => t.date < `${addMonths(month, -2)}-01`);
  if (hasHistory) {
    const all = payeeGroups(txns.filter((t) => t.date < `${addMonths(month, 1)}-01`));
    const fresh = all.filter((g) => g.firstDate.startsWith(month));
    if (fresh.length > 0) {
      const amt = fresh.reduce((s, g) => s + g.txns.filter((t) => inMonth(t, month)).reduce((a, t) => a + spendPaise(t), 0), 0);
      out.push({ id: 'new', tone: 'info', text: `${fresh.length} new payee${fresh.length === 1 ? '' : 's'} this month (${formatINR(amt)}), e.g. ${fresh.slice(0, 2).map((g) => g.name).join(', ')}.` });
    }
  }

  // Largest single payment.
  const biggest = monthTxns.filter((t) => spendPaise(t) > 0).sort((a, b) => b.amountPaise - a.amountPaise)[0];
  if (biggest && biggest.amountPaise >= total * 0.1) {
    out.push({
      id: 'biggest',
      tone: 'info',
      text: `Largest payment: ${formatINR(biggest.amountPaise)} to ${biggest.merchant} on ${new Date(biggest.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} (${pct(biggest.amountPaise, total)}% of the month).`,
      action: { to: 'txns', payee: payeeKey(biggest) },
    });
  }
  return out;
}
