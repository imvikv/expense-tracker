import { isCounted, spendPaise } from './analytics';
import type { Transaction } from './types';

export type SortKey = 'newest' | 'oldest' | 'spend_desc' | 'amount_desc' | 'amount_asc';

export const SORT_LABELS: Record<SortKey, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  spend_desc: 'Biggest spending first',
  amount_desc: 'Amount: high to low (all)',
  amount_asc: 'Amount: low to high',
};

export function sortTxns(list: Transaction[], sort: SortKey): Transaction[] {
  const out = [...list];
  switch (sort) {
    case 'oldest':
      return out.sort((a, b) => a.date.localeCompare(b.date));
    case 'spend_desc': {
      // Spending (purchases, cash, fees) by size; income, transfers, card bills etc. after.
      const isSpend = (t: Transaction) => (spendPaise(t) > 0 ? 0 : 1);
      return out.sort((a, b) => isSpend(a) - isSpend(b) || b.amountPaise - a.amountPaise || b.date.localeCompare(a.date));
    }
    case 'amount_desc':
      return out.sort((a, b) => b.amountPaise - a.amountPaise || b.date.localeCompare(a.date));
    case 'amount_asc':
      return out.sort((a, b) => a.amountPaise - b.amountPaise || b.date.localeCompare(a.date));
    default:
      return out.sort((a, b) => b.date.localeCompare(a.date));
  }
}

export interface ListTotals {
  outPaise: number;
  outCount: number;
  inPaise: number;
  inCount: number;
  /** Net spending (purchases + cash + fees − refunds) within the list. */
  spendPaise: number;
  /** Excluded or confirmed-duplicate rows, shown but not totalled. */
  skipped: number;
}

/** Totals for exactly the transactions currently listed (after filters). */
export function listTotals(list: Transaction[]): ListTotals {
  const r: ListTotals = { outPaise: 0, outCount: 0, inPaise: 0, inCount: 0, spendPaise: 0, skipped: 0 };
  for (const t of list) {
    if (!isCounted(t)) {
      r.skipped++;
      continue;
    }
    if (t.direction === 'debit') {
      r.outPaise += t.amountPaise;
      r.outCount++;
    } else {
      r.inPaise += t.amountPaise;
      r.inCount++;
    }
    r.spendPaise += spendPaise(t);
  }
  return r;
}
