import { useMemo, useState } from 'react';
import { isCounted } from '../lib/analytics';
import { gmailLink } from '../lib/gmail';
import { BANK_LABELS, type Transaction } from '../lib/types';
import { Card, Empty } from './components';
import { formatDate } from './format';
import { useStore } from './store';
import { TxnRow } from './Transactions';
import { TxnSheet } from './TxnSheet';

export function Review() {
  const { txns, unparsed, dismissUnparsed } = useStore();
  const [open, setOpen] = useState<Transaction | null>(null);

  const sections = useMemo(() => {
    const suspected = txns.filter((t) => t.duplicateStatus === 'suspected');
    const low = txns.filter((t) => t.confidence === 'low' && !t.userEdited && t.duplicateStatus !== 'duplicate');
    const transfers = txns.filter((t) => t.kind === 'transfer' && t.confidence === 'medium' && !t.userEdited && isCounted(t));
    const uncategorized = txns.filter((t) => isCounted(t) && t.kind === 'expense' && t.category === 'Uncategorized' && !t.userEdited);
    return [
      { key: 'dup', title: 'Possible duplicates', hint: 'Same amount on the same card/merchant within minutes. Still counted until you decide.', items: suspected },
      { key: 'low', title: 'Low confidence', hint: 'Parsed with the generic reader or from an unverified sender. Check the amount and merchant.', items: low },
      { key: 'xfer', title: 'Bank transfers to check', hint: 'NEFT/IMPS to accounts we don’t recognise are treated as transfers (not spending). Mark rent or payments as Spending.', items: transfers },
      { key: 'unc', title: 'Uncategorised spending', hint: 'Pick a category and tick “Always use this” to teach the app.', items: uncategorized },
    ];
  }, [txns]);

  const current = open ? txns.find((t) => t.id === open.id) ?? open : null;
  const nothing = sections.every((s) => s.items.length === 0) && unparsed.length === 0;

  return (
    <div className="page">
      {nothing && <Empty>All clear — nothing needs review.</Empty>}
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
      <TxnSheet txn={current} onClose={() => setOpen(null)} />
    </div>
  );
}
