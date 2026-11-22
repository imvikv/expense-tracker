import type { Transaction } from './types';

const MINUTE = 60_000;
/** Window for "same transaction reported twice" when both emails carry a time. */
export const DUPLICATE_WINDOW_MS = 15 * MINUTE;

function ts(t: Transaction): number {
  return new Date(t.date).getTime();
}

function dayOf(t: Transaction): string {
  return t.date.slice(0, 10);
}

function closeInTime(a: Transaction, b: Transaction): boolean {
  if (a.hasTime && b.hasTime) return Math.abs(ts(a) - ts(b)) <= DUPLICATE_WINDOW_MS;
  return dayOf(a) === dayOf(b);
}

export type DuplicateVerdict = 'duplicate' | 'suspected' | 'distinct';

/** Compare two transactions from different emails. */
export function compare(a: Transaction, b: Transaction): DuplicateVerdict {
  if (a.sourceMessageId === b.sourceMessageId && a.source === b.source) return 'distinct';
  if (a.amountPaise !== b.amountPaise || a.direction !== b.direction) return 'distinct';

  // A shared UPI reference / RRN is unambiguous, regardless of timing.
  if (a.reference && b.reference) {
    if (a.reference === b.reference) return 'duplicate';
    return 'distinct';
  }
  if (!closeInTime(a, b)) return 'distinct';

  const sameInstrument = a.bank === b.bank && !!a.accountLast4 && a.accountLast4 === b.accountLast4;
  // A card bill auto-debit is reported by the card bank and by the paying bank: same account, different senders.
  const sameBillDebit = a.kind === 'cc_payment' && b.kind === 'cc_payment' && !!a.accountLast4 && a.accountLast4 === b.accountLast4;
  if (sameBillDebit) return 'suspected';
  const sameMerchant = a.merchant !== 'Unknown' && a.merchant.toLowerCase() === b.merchant.toLowerCase();
  if (sameInstrument || sameMerchant) return 'suspected';
  return 'distinct';
}

/**
 * Scan all transactions and flag duplicates. Only transactions whose status is
 * still `none` are changed, so user decisions are never overwritten.
 * Returns the transactions that changed.
 *
 * - Same reference number + amount → marked `duplicate` (excluded from totals, reversible).
 * - Same amount/direction close in time on the same card/account or merchant → `suspected`
 *   (still counted, shown in Review for the user to decide).
 */
export function findDuplicates(all: Transaction[]): Transaction[] {
  const sorted = [...all].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const byAmount = new Map<string, Transaction[]>();
  for (const t of sorted) {
    const k = `${t.direction}:${t.amountPaise}`;
    const list = byAmount.get(k);
    if (list) list.push(t);
    else byAmount.set(k, [t]);
  }

  const changed = new Map<string, Transaction>();
  for (const group of byAmount.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      const t = changed.get(group[i].id) ?? group[i];
      if (t.duplicateStatus !== 'none') continue;
      for (let j = 0; j < i; j++) {
        const earlier = changed.get(group[j].id) ?? group[j];
        if (earlier.duplicateStatus === 'duplicate') continue;
        const verdict = compare(earlier, t);
        if (verdict === 'distinct') continue;
        // Never flag a pair the user already said were different.
        if (earlier.duplicateStatus === 'not_duplicate' && earlier.duplicateOf === t.id) continue;
        changed.set(t.id, { ...t, duplicateStatus: verdict, duplicateOf: earlier.id });
        break;
      }
    }
  }
  return [...changed.values()];
}
