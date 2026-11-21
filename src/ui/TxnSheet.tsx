import { useEffect, useState } from 'react';
import { categoryForKind } from '../lib/categorize';
import { gmailLink } from '../lib/gmail';
import { spendPaise } from '../lib/analytics';
import { BANK_LABELS, CATEGORIES, KIND_LABELS, type Category, type Transaction, type TxnKind } from '../lib/types';
import { Sheet } from './components';
import { formatDate, formatINR, uid } from './format';
import { useStore } from './store';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

export function TxnSheet({ txn, onClose }: { txn: Transaction | null; onClose: () => void }) {
  const { txns, updateTxns, addRule, toast } = useStore();
  const [category, setCategory] = useState<Category>('Uncategorized');
  const [kind, setKind] = useState<TxnKind>('expense');
  const [excluded, setExcluded] = useState(false);
  const [note, setNote] = useState('');
  const [applyAll, setApplyAll] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!txn) return;
    setCategory(txn.category);
    setKind(txn.kind);
    setExcluded(txn.excluded);
    setNote(txn.note ?? '');
    setApplyAll(false);
  }, [txn?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!txn) return null;
  const original = txn.duplicateOf ? txns.find((t) => t.id === txn.duplicateOf) : undefined;
  const sameMerchant = txns.filter((t) => t.merchant === txn.merchant).length;
  const dirty = category !== txn.category || kind !== txn.kind || excluded !== txn.excluded || note !== (txn.note ?? '');

  const save = async () => {
    setBusy(true);
    try {
      const updated: Transaction = { ...txn, category, kind, excluded, note: note.trim() || undefined, userEdited: txn.userEdited || category !== txn.category || kind !== txn.kind, confidence: 'high' };
      await updateTxns([updated]);
      if (applyAll) {
        const n = await addRule({
          id: uid(),
          pattern: `/^${escapeRe(txn.merchant)}$/`,
          category,
          kind: kind !== txn.kind || txn.userEdited ? kind : undefined,
          createdAt: new Date().toISOString(),
        });
        toast(`Rule saved · ${n} other transaction${n === 1 ? '' : 's'} updated`);
      } else toast('Saved');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const setDup = async (status: Transaction['duplicateStatus']) => {
    await updateTxns([{ ...txn, duplicateStatus: status }]);
    toast(status === 'duplicate' ? 'Marked as duplicate — removed from totals' : 'Kept as a separate transaction');
    onClose();
  };

  const onKind = (k: TxnKind) => {
    setKind(k);
    setCategory((c) => (k === 'expense' ? (c === 'Transfers' || c === 'Income' || c === 'Credit Card Payment' ? 'Uncategorized' : c) : categoryForKind(k, c)));
  };

  return (
    <Sheet open onClose={onClose} title={txn.merchant}>
      <div className="detail-amount">
        <span className={txn.direction === 'credit' ? 'pos' : ''}>
          {txn.direction === 'credit' ? '+' : '−'}
          {formatINR(txn.amountPaise, { decimals: true })}
        </span>
        <small>{spendPaise(txn) === 0 ? 'Not counted in spending' : spendPaise(txn) < 0 ? 'Reduces spending' : 'Counted in spending'}</small>
      </div>

      {txn.duplicateStatus === 'suspected' && (
        <div className="notice warn">
          <p>
            <strong>Possible duplicate</strong> of {original ? `${original.merchant}, ${formatINR(original.amountPaise)} on ${formatDate(original.date, { time: original.hasTime })} (${BANK_LABELS[original.bank]})` : 'another transaction'}. Is this the same payment reported twice?
          </p>
          <div className="btn-row">
            <button className="btn" onClick={() => setDup('duplicate')}>
              Same payment
            </button>
            <button className="btn ghost" onClick={() => setDup('not_duplicate')}>
              Different
            </button>
          </div>
        </div>
      )}
      {txn.duplicateStatus === 'duplicate' && (
        <div className="notice">
          <p>
            Hidden as a duplicate{original ? ` of ${original.merchant} on ${formatDate(original.date)}` : ''} (same reference number).
          </p>
          <button className="btn ghost" onClick={() => setDup('not_duplicate')}>
            Not a duplicate — count it
          </button>
        </div>
      )}

      <dl className="details">
        <dt>Date</dt>
        <dd>{formatDate(txn.date, { time: txn.hasTime, year: true })}</dd>
        <dt>Bank</dt>
        <dd>{BANK_LABELS[txn.bank]}</dd>
        <dt>Method</dt>
        <dd>
          {txn.method}
          {txn.accountLast4 ? ` ••${txn.accountLast4}` : ''}
        </dd>
        <dt>As written</dt>
        <dd>{txn.merchantRaw || '—'}</dd>
        {txn.reference && (
          <>
            <dt>Reference</dt>
            <dd>{txn.reference}</dd>
          </>
        )}
        <dt>Confidence</dt>
        <dd className={`conf ${txn.confidence}`}>{txn.confidence}</dd>
        <dt>Source</dt>
        <dd>
          {txn.source === 'gmail' ? (
            <a href={gmailLink(txn.sourceMessageId)} target="_blank" rel="noopener noreferrer">
              Open email in Gmail
            </a>
          ) : txn.source === 'sample' ? (
            'Demo data'
          ) : (
            'Imported backup'
          )}
        </dd>
      </dl>

      <div className="form">
        <label>
          Type
          <select value={kind} onChange={(e) => onKind(e.target.value as TxnKind)}>
            {(Object.keys(KIND_LABELS) as TxnKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Note
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" maxLength={200} />
        </label>
        <label className="check">
          <input type="checkbox" checked={excluded} onChange={(e) => setExcluded(e.target.checked)} />
          Exclude from all totals
        </label>
        <label className="check">
          <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} />
          Always use this for “{txn.merchant}” ({sameMerchant} transaction{sameMerchant === 1 ? '' : 's'}, including future ones)
        </label>
        <button className="btn primary" onClick={save} disabled={busy || (!dirty && !applyAll)}>
          Save
        </button>
      </div>
    </Sheet>
  );
}
