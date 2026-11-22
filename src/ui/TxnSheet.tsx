import { useEffect, useState } from 'react';
import { categoryForKind, payeeKey } from '../lib/categorize';
import { gmailLink } from '../lib/gmail';
import { spendPaise } from '../lib/analytics';
import { BANK_LABELS, CATEGORIES, KIND_LABELS, type Category, type Transaction, type TxnKind } from '../lib/types';
import { Sheet } from './components';
import { formatDate, formatINR } from './format';
import { IdentifyPayee, PayeeDetails } from './Payee';
import { useStore } from './store';

export function TxnSheet({ txn, onClose, onShowPayee }: { txn: Transaction | null; onClose: () => void; onShowPayee?: (key: string) => void }) {
  const { txns, updateTxns, toast } = useStore();
  const [category, setCategory] = useState<Category>('Uncategorized');
  const [kind, setKind] = useState<TxnKind>('expense');
  const [excluded, setExcluded] = useState(false);
  const [note, setNote] = useState('');
  const [identify, setIdentify] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!txn) return;
    setCategory(txn.category);
    setKind(txn.kind);
    setExcluded(txn.excluded);
    setNote(txn.note ?? '');
    setIdentify(txn.category === 'Uncategorized' && txn.kind === 'expense');
  }, [txn?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!txn) return null;
  const original = txn.duplicateOf ? txns.find((t) => t.id === txn.duplicateOf) : undefined;
  const key = payeeKey(txn);
  const samePayee = txns.filter((t) => payeeKey(t) === key).length;
  const dirty = category !== txn.category || kind !== txn.kind || excluded !== txn.excluded || note !== (txn.note ?? '');

  const save = async () => {
    setBusy(true);
    try {
      const changedClass = category !== txn.category || kind !== txn.kind;
      await updateTxns([{ ...txn, category, kind, excluded, note: note.trim() || undefined, userEdited: txn.userEdited || changedClass, confidence: changedClass ? 'high' : txn.confidence }]);
      toast('Saved');
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
    setCategory((c) => (k === 'expense' ? (['Transfers', 'Income', 'Credit Card Payment'].includes(c) ? 'Uncategorized' : c) : categoryForKind(k, c)));
  };

  return (
    <Sheet open onClose={onClose} title={txn.merchant}>
      <div className="detail-amount">
        <span className={txn.direction === 'credit' ? 'pos' : ''}>
          {txn.direction === 'credit' ? '+' : '−'}
          {formatINR(txn.amountPaise, { decimals: true })}
        </span>
        <small>
          {formatDate(txn.date, { time: txn.hasTime, year: true })} · {spendPaise(txn) === 0 ? 'not counted in spending' : spendPaise(txn) < 0 ? 'reduces spending' : 'counted in spending'}
        </small>
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
          <p>Hidden as a duplicate{original ? ` of ${original.merchant} on ${formatDate(original.date)}` : ''} (same reference number).</p>
          <button className="btn ghost" onClick={() => setDup('not_duplicate')}>
            Not a duplicate — count it
          </button>
        </div>
      )}

      <PayeeDetails t={txn} />
      <div className="btn-row tight">
        {samePayee > 1 && onShowPayee && (
          <button className="btn ghost" onClick={() => onShowPayee(key)}>
            All {samePayee} payments to them
          </button>
        )}
        <button className={`btn ${identify ? 'ghost' : ''}`} onClick={() => setIdentify((v) => !v)} aria-expanded={identify}>
          {identify ? 'Hide' : 'Name / categorise payee'}
        </button>
      </div>
      {identify && (
        <div className="card inset">
          <IdentifyPayee sample={txn} count={samePayee} onDone={onClose} />
        </div>
      )}

      <dl className="details">
        <dt>Bank</dt>
        <dd>
          {BANK_LABELS[txn.bank]} · {txn.method}
          {txn.accountLast4 ? ` ••${txn.accountLast4}` : ''}
        </dd>
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

      <h3 className="sub-head">Just this transaction</h3>
      <div className="form">
        <div className="row-2">
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
        </div>
        <label>
          Note
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Diwali gifts, school trip" maxLength={200} />
        </label>
        <label className="check">
          <input type="checkbox" checked={excluded} onChange={(e) => setExcluded(e.target.checked)} />
          Exclude from all totals
        </label>
        <button className="btn primary" onClick={save} disabled={busy || !dirty}>
          Save this transaction
        </button>
      </div>
    </Sheet>
  );
}
