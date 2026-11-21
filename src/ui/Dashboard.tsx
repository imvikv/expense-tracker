import { useMemo, useState } from 'react';
import { addMonths, detectRecurring, detectUnusual, groupSpend, inMonth, isCounted, methodBucket, monthKey, monthLabel, monthlyTotals, summarise } from '../lib/analytics';
import { BANK_LABELS, KIND_LABELS, type TxnKind } from '../lib/types';
import { Card, catColor, Empty, HBars, Icon, MonthBars } from './components';
import { formatDate, formatINR } from './format';
import { useStore } from './store';
import type { TxnFilter } from './Transactions';

export function Dashboard({ go }: { go: (tab: 'txns' | 'review', filter?: TxnFilter) => void }) {
  const { txns } = useStore();
  const latest = txns[0]?.date ? monthKey(txns[0].date) : monthKey(new Date());
  const thisMonth = monthKey(new Date());
  const [month, setMonth] = useState<string>(latest > thisMonth ? latest : thisMonth);

  const s = useMemo(() => summarise(txns, month), [txns, month]);
  const trend = useMemo(() => monthlyTotals(txns, month, 12), [txns, month]);
  const monthTxns = useMemo(() => txns.filter((t) => inMonth(t, month)), [txns, month]);
  const cats = useMemo(() => groupSpend(monthTxns, (t) => t.category), [monthTxns]);
  const merchants = useMemo(() => groupSpend(monthTxns, (t) => t.merchant), [monthTxns]);
  const banks = useMemo(() => groupSpend(monthTxns, (t) => BANK_LABELS[t.bank]), [monthTxns]);
  const methods = useMemo(() => groupSpend(monthTxns, methodBucket), [monthTxns]);
  const recurring = useMemo(() => detectRecurring(txns), [txns]);
  const unusual = useMemo(() => detectUnusual(txns.filter((t) => t.date < addMonths(month, 1)), addMonths(month, -2)), [txns, month]);
  const flows = useMemo(() => {
    const out: Partial<Record<TxnKind, number>> = {};
    for (const t of monthTxns) {
      if (!isCounted(t) || t.kind === 'expense' || t.kind === 'cash' || t.kind === 'fee') continue;
      out[t.kind] = (out[t.kind] ?? 0) + t.amountPaise;
    }
    return out;
  }, [monthTxns]);
  const review = useMemo(
    () => ({
      uncategorized: txns.filter((t) => isCounted(t) && t.category === 'Uncategorized' && t.kind === 'expense').length,
      suspected: txns.filter((t) => t.duplicateStatus === 'suspected').length,
      low: txns.filter((t) => t.confidence === 'low' && !t.userEdited).length,
    }),
    [txns],
  );

  const mom = s.momChangePct;
  const canNext = month < thisMonth || month < latest;

  return (
    <div className="page">
      <div className="month-switch">
        <button className="icon-btn" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">
          <Icon name="chevL" />
        </button>
        <span>{monthLabel(month, 'long')}</span>
        <button className="icon-btn" onClick={() => setMonth(addMonths(month, 1))} disabled={!canNext} aria-label="Next month">
          <Icon name="chevR" />
        </button>
      </div>

      <section className="hero">
        <p className="hero-label">Spent this month</p>
        <p className="hero-amount">{formatINR(s.thisMonthPaise)}</p>
        <p className="hero-sub">
          {mom === null ? (
            'No spending last month to compare'
          ) : (
            <>
              <span className={mom > 0 ? 'up' : 'down'}>
                {mom > 0 ? '▲' : '▼'} {Math.abs(mom).toFixed(0)}%
              </span>{' '}
              vs {monthLabel(addMonths(month, -1))} ({formatINR(s.lastMonthPaise)})
            </>
          )}
        </p>
      </section>

      <div className="kpis">
        <div className="kpi">
          <span>Avg / month</span>
          <strong>{formatINR(s.avgMonthlyPaise)}</strong>
          <small>{s.avgMonths ? `over ${s.avgMonths} month${s.avgMonths > 1 ? 's' : ''}` : 'no history yet'}</small>
        </div>
        <div className="kpi">
          <span>Transactions</span>
          <strong>{s.txnCount}</strong>
          <small>counted as spending</small>
        </div>
        <div className="kpi wide">
          <span>Top category</span>
          <strong>{s.largestCategory ? s.largestCategory.key : '—'}</strong>
          <small>{s.largestCategory ? formatINR(s.largestCategory.spendPaise) : ''}</small>
        </div>
      </div>

      {(review.uncategorized > 0 || review.suspected > 0 || review.low > 0) && (
        <button className="review-banner" onClick={() => go('review')}>
          <Icon name="alert" size={20} />
          <span>
            {[review.suspected && `${review.suspected} possible duplicate${review.suspected > 1 ? 's' : ''}`, review.uncategorized && `${review.uncategorized} uncategorised`, review.low && `${review.low} low-confidence`]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <Icon name="chevR" size={18} />
        </button>
      )}

      <Card title="Monthly trend">
        <MonthBars data={trend.map((t) => ({ key: t.month, label: monthLabel(t.month).slice(0, 3), value: t.spendPaise }))} selected={month} onSelect={setMonth} />
      </Card>

      <Card title="By category" action={<button className="link" onClick={() => go('txns', { month })}>All</button>}>
        <HBars rows={cats.map((c) => ({ key: c.key, value: c.spendPaise, count: c.count }))} color={catColor} onSelect={(k) => go('txns', { month, category: k })} />
      </Card>

      <Card title="Top merchants">
        <HBars rows={merchants.map((c) => ({ key: c.key, value: c.spendPaise, count: c.count }))} onSelect={(k) => go('txns', { month, search: k })} limit={6} />
      </Card>

      <div className="grid-2">
        <Card title="By bank">
          <HBars rows={banks.map((c) => ({ key: c.key, value: c.spendPaise, count: c.count }))} />
        </Card>
        <Card title="Card vs UPI">
          <HBars rows={methods.map((c) => ({ key: c.key, value: c.spendPaise, count: c.count }))} />
        </Card>
      </div>

      <Card title="Subscriptions & recurring">
        {recurring.length === 0 ? (
          <Empty>Nothing recurring detected yet. This needs a few months of history.</Empty>
        ) : (
          <ul className="rows">
            {recurring.slice(0, 10).map((r) => (
              <li key={r.merchant}>
                <button className="row" onClick={() => go('txns', { search: r.merchant })}>
                  <span className="row-main">
                    <strong>{r.merchant}</strong>
                    <small>
                      {r.cadence} · next ~{formatDate(r.nextExpected)}
                    </small>
                  </span>
                  <span className="row-amt">{formatINR(r.typicalPaise)}</span>
                </button>
              </li>
            ))}
            <li className="rows-total">
              <span>Monthly total</span>
              <strong>{formatINR(recurring.reduce((s, r) => s + (r.cadence === 'monthly' ? r.typicalPaise : r.typicalPaise / 12), 0))}</strong>
            </li>
          </ul>
        )}
      </Card>

      <Card title="Unusual or large expenses" action={<small className="muted">last 3 months</small>}>
        {unusual.length === 0 ? (
          <Empty>No unusually large expenses.</Empty>
        ) : (
          <ul className="rows">
            {unusual.map((t) => (
              <li key={t.id}>
                <button className="row" onClick={() => go('txns', { search: t.merchant, month: monthKey(t.date) })}>
                  <span className="row-main">
                    <strong>{t.merchant}</strong>
                    <small>
                      {formatDate(t.date)} · {t.category}
                    </small>
                  </span>
                  <span className="row-amt">{formatINR(t.amountPaise)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Not counted as spending" action={<small className="muted">{monthLabel(month)}</small>}>
        {Object.keys(flows).length === 0 ? (
          <Empty>No income, transfers or bill payments this month.</Empty>
        ) : (
          <ul className="rows">
            {(Object.entries(flows) as Array<[TxnKind, number]>).map(([k, v]) => (
              <li key={k}>
                <button className="row" onClick={() => go('txns', { month, kind: k })}>
                  <span className="row-main">
                    <strong>{KIND_LABELS[k]}</strong>
                    <small>{k === 'refund' ? 'already subtracted from spending' : 'excluded from spending totals'}</small>
                  </span>
                  <span className={`row-amt ${k === 'income' || k === 'refund' ? 'pos' : ''}`}>{formatINR(v)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
