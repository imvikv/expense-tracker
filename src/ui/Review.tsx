import { useMemo, useState } from 'react';
import { isCounted } from '../lib/analytics';
import { gmailLink } from '../lib/gmail';
import { BANK_LABELS, type Transaction } from '../lib/types';
import { Card, Empty } from './components';
import { formatDate, formatINR } from './format';
import { isUnclear, payeeGroups } from '../lib/insights';
import { PayeeSheet, PayeeTag } from './Payee';
import type { TxnFilter } from './Transactions';
import { useStore } from './store';
import { TxnRow } from './Transactions';
import { TxnSheet } from './TxnSheet';

export function Review({ go }: { go: (tab: 'txns', f: TxnFilter) => void }) {
  const { txns, unparsed, dismissUnparsed } = useStore();
  const [open, setOpen] = useState<Transaction | null>(null);

  const sections = useMemo(() => {
    const suspected = txns.filter((t) => t.duplicateStatus === 'suspected');
    const low = txns.filter((t) => t.confidence === 'low' && !t.userEdited && t.duplicateStatus !== 'duplicate');
    const transfers = txns.filter((t) => t.kind === 'transfer' && t.confidence === 'medium' && !t.userEdited && isCounted(t));
    return [
      { key: 'dup', title: 'Possible duplicates', hint: 'Same amount on the same card/merchant within minutes. Still counted until you decide.', items: suspected },
      { key: 'low', title: 'Low confidence', hint: 'Parsed with the generic reader or from an unverified sender. Check the amount and merchant.', items: low },
      { key: 'xfer', title: 'Bank transfers to check', hint: 'NEFT/IMPS to accounts we don’t recognise are treated as transfers (not spending). Mark rent or payments as Spending.', items: transfers },
    ];
  }, [txns]);

  const unclear = useMemo(() => payeeGroups(txns, isUnclear), [txns]);
  const unclearTotal = unclear.reduce((s, g) => s + g.spendPaise, 0);
  const [payee, setPayee] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const current = open ? txns.find((t) => t.id === open.id) ?? open : null;
  const nothing = sections.every((s) => s.items.length === 0) && unparsed.length === 0 && unclear.length === 0;

  return (
    <div className="page">
      {nothing && <Empty>All clear — nothing needs review.</Empty>}
      {unclear.length > 0 && (
        <Card title={`Identify who you paid (${unclear.length})`}>
          <p className="hint">
            {formatINR(unclearTotal)} of spending has no category yet. Name each payee once — by UPI ID where the bank gives one — and every past and future payment to them is sorted.
          </p>
          <ul className="rows">
            {(showAll ? unclear : unclear.slice(0, 15)).map((g) => (
              <li key={g.key}>
                <button className="row" onClick={() => setPayee(g.key)}>
                  <span className="row-main">
                    <strong>
                      {g.name} <PayeeTag type={g.type} />
                    </strong>
                    <small>{[g.raw, g.vpa ?? (g.account ? `A/c ••${g.account}` : undefined)].filter(Boolean).join(' · ') || g.txns[0].narration?.slice(0, 70)}</small>
                    <small>
                      {g.count} payment{g.count === 1 ? '' : 's'} · last {formatDate(g.lastDate)}
                    </small>
                  </span>
                  <span className="row-amt">{formatINR(g.spendPaise)}</span>
                </button>
              </li>
            ))}
          </ul>
          {unclear.length > 15 && !showAll && (
            <button className="link" onClick={() => setShowAll(true)}>
              Show all {unclear.length}
            </button>
          )}
        </Card>
      )}
      {sections
        .filter((s) => s.items.length > 0)
        .map((s) => (
          <Card key={s.key} title={`${s.title} (${s.items.length})`}>
            <p className="hint">{s.hint}</p>
            <div className="flush-list">
              {s.items.slice(0, 50).map((t) => (
                <TxnRow key={t.id} t={t} onOpen={setOpen} />
              ))}
            </div>
            {s.items.length > 50 && <p className="hint">Showing 50 of {s.items.length}.</p>}
          </Card>
        ))}
      {unparsed.length > 0 && (
        <Card title={`Bank emails not understood (${unparsed.length})`}>
          <p className="hint">These came from a bank address and mention a transaction, but no template matched, so nothing was recorded. Only the sender, subject and date are stored. You can test the text with the parser tester in Settings.</p>
          <ul className="rows">
            {unparsed.slice(0, 50).map((u) => (
              <li key={u.id} className="row static">
                <span className="row-main">
                  <strong>{u.subject || '(no subject)'}</strong>
                  <small>
                    {u.bank ? BANK_LABELS[u.bank] : u.from} · {formatDate(u.date, { year: true })}
                  </small>
                </span>
                <span className="row-actions">
                  {!u.id.startsWith('sample') && !u.id.startsWith('fx') && (
                    <a className="link" href={gmailLink(u.id)} target="_blank" rel="noopener noreferrer">
                      Open
                    </a>
                  )}
                  <button className="link" onClick={() => dismissUnparsed(u.id)}>
                    Dismiss
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <TxnSheet
        txn={current}
        onClose={() => setOpen(null)}
        onShowPayee={(k) => {
          setOpen(null);
          setPayee(k);
        }}
      />
      <PayeeSheet
        payee={payee}
        onClose={() => setPayee(null)}
        onShowAll={(k) => {
          setPayee(null);
          go('txns', { payee: k });
        }}
      />
    </div>
  );
}
