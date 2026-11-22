import { useMemo } from 'react';
import { cardBillSummary } from '../lib/categorize';
import { BANK_LABELS, type BankId } from '../lib/types';
import { formatINR } from './format';
import { useStore } from './store';

/**
 * Per-card switch: count this card's bill payments (paid from your bank account) as spending.
 * Only right for cards whose individual purchases aren't tracked — otherwise spending doubles.
 * With `suggestOnly`, lists just the cards that have bills but no purchase alerts and are still off.
 */
export function CardBills({ suggestOnly }: { suggestOnly?: boolean }) {
  const { txns, settings, setBillSpendCards, toast } = useStore();
  const cards = useMemo(() => cardBillSummary(txns, settings), [txns, settings]);
  const shown = suggestOnly ? cards.filter((c) => c.purchases === 0 && !c.countsAsSpending) : cards;
  if (shown.length === 0) return suggestOnly ? null : <p className="hint">No card bills paid from a bank account found yet.</p>;

  const toggle = async (card: string, on: boolean) => {
    const cur = settings.billSpendCards ?? [];
    const next = on ? [...new Set([...cur, card])] : cur.filter((c) => c !== card);
    const n = await setBillSpendCards(next);
    toast(on ? `Card ••${card} bills now count as spending (${n} updated)` : `Card ••${card} bills no longer count as spending`);
  };

  return (
    <ul className="rows">
      {shown.map((c) => (
        <li key={c.card} className="row static">
          <span className="row-main">
            <strong>
              {BANK_LABELS[c.bank as BankId] ?? c.bank} card ••{c.card}
            </strong>
            <small>
              {c.bills} bill payment{c.bills === 1 ? '' : 's'} ({formatINR(c.billPaise)}) · {c.purchases === 0 ? 'no purchase alerts found' : `${c.purchases} purchase alert${c.purchases === 1 ? '' : 's'} found`}
            </small>
            {c.countsAsSpending && c.purchases > 0 && <small className="warn-text">Purchases are tracked too — this card's spending is probably counted twice.</small>}
          </span>
          <label className="switch">
            <input type="checkbox" checked={c.countsAsSpending} onChange={(e) => toggle(c.card, e.target.checked)} aria-label={`Count card ${c.card} bills as spending`} />
            <span />
          </label>
        </li>
      ))}
    </ul>
  );
}
