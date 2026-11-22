import { spendPaise } from './analytics';
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
