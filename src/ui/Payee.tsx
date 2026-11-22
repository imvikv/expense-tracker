import { useEffect, useMemo, useState } from 'react';
import { categoryForKind, payeeKey, payeeRulePattern } from '../lib/categorize';
import { spendPaise } from '../lib/analytics';
import { gmailLink } from '../lib/gmail';
import { BANK_LABELS, CATEGORIES, KIND_LABELS, type Category, type PayeeType, type Transaction, type TxnKind } from '../lib/types';
import { Sheet } from './components';
import { formatDate, formatINR, uid } from './format';
import { useStore } from './store';

export const PAYEE_TYPE_LABELS: Record<PayeeType, string> = {
  person: 'Person',
  merchant: 'Business',
  own: 'My account',
  unknown: 'Unknown',
};

/** Small label for people / own accounts (businesses are the default, so only shown when `all`). */
export function PayeeTag({ type, all }: { type?: PayeeType; all?: boolean }) {
  if (!type || type === 'unknown' || (type === 'merchant' && !all)) return null;
  return <span className={`badge payee-${type}`}>{PAYEE_TYPE_LABELS[type]}</span>;
}

/** Where the money went, as the bank described it. */
export function PayeeDetails({ t }: { t: Transaction }) {
  const rows: Array<[string, string | undefined]> = [
    ['As written', t.payee && t.payee.toLowerCase() !== t.merchant.toLowerCase() ? t.payee : undefined],
    ['UPI ID', t.payeeVpa],
    ['Their account', t.payeeAccount ? `••${t.payeeAccount}` : undefined],
    ['Location', t.location],
  ];
  const shown = rows.filter(([, v]) => v);
  return (
    <div className="payee-box">
      <div className="payee-head">
        <strong>{t.direction === 'credit' ? 'From' : 'To'}: {t.merchant}</strong>
        <PayeeTag type={t.payeeType} all />
      </div>
      {shown.length > 0 && (
        <dl className="details tight">
          {shown.map(([k, v]) => (
            <div key={k} className="dl-row">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {t.narration && <blockquote className="narration">{t.narration}</blockquote>}
      {t.subject && <p className="hint subject">Email: “{t.subject}”</p>}
    </div>
  );
}

/**
 * Name a payee once and apply it to every past and future payment to them
 * (matched by UPI ID when available, otherwise by the name the bank uses).
 */
export function IdentifyPayee({ sample, count, onDone }: { sample: Transaction; count: number; onDone: () => void }) {
  const { addRule, toast } = useStore();
  const [label, setLabel] = useState('');
  const [ptype, setPtype] = useState<PayeeType>(sample.payeeType && sample.payeeType !== 'unknown' ? sample.payeeType : 'person');
  const [kind, setKind] = useState<TxnKind>(sample.kind);
  const [category, setCategory] = useState<Category>(sample.category);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLabel('');
    setKind(sample.kind);
    setCategory(sample.category);
  }, [sample.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onType = (p: PayeeType) => {
    setPtype(p);
    if (p === 'own') {
      setKind('transfer');
      setCategory('Transfers');
    } else if (kind === 'transfer' && ptype === 'own') {
      setKind('expense');
      setCategory('Uncategorized');
    }
  };
  const onKind = (k: TxnKind) => {
    setKind(k);
    if (k !== 'expense') setCategory((c) => categoryForKind(k, c));
    else if (['Transfers', 'Income', 'Credit Card Payment', 'Investments'].includes(category)) setCategory('Uncategorized');
  };

  const matchBy = sample.payeeVpa ? `UPI ID ${sample.payeeVpa}` : sample.payeeAccount ? `the name “${sample.merchantRaw}”` : `the name “${sample.merchantRaw || sample.merchant}”`;

  const save = async () => {
    setBusy(true);
    try {
      const n = await addRule({
        id: uid(),
        pattern: payeeRulePattern(sample),
        label: label.trim() || undefined,
        payeeType: ptype,
        category,
        kind: kind !== 'expense' || sample.kind !== 'expense' ? kind : undefined,
        createdAt: new Date().toISOString(),
      });
      toast(`Saved · ${n} payment${n === 1 ? '' : 's'} updated`);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form identify">
      <label>
        What do you call them?
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={`e.g. ${ptype === 'person' ? 'Sunita (house help)' : 'Corner grocery'}`} maxLength={40} />
      </label>
      <div className="seg" role="radiogroup" aria-label="Who is this">
        {(['person', 'merchant', 'own'] as PayeeType[]).map((p) => (
          <label key={p} className={ptype === p ? 'on' : ''}>
            <input type="radio" checked={ptype === p} onChange={() => onType(p)} /> {PAYEE_TYPE_LABELS[p]}
          </label>
        ))}
      </div>
      <div className="row-2">
        <label>
          These payments are
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
      <p className="hint">
        Applies to all {count} payment{count === 1 ? '' : 's'} matched by {matchBy}, and to future ones. Manual edits on single transactions are kept.
      </p>
      <button className="btn primary" onClick={save} disabled={busy}>
        Save for all payments to this payee
      </button>
    </div>
  );
}

/** Everything about one payee: totals, recent payments with the bank's wording, and the identify form. */
export function PayeeSheet({ payee, onClose, onShowAll }: { payee: string | null; onClose: () => void; onShowAll?: (key: string) => void }) {
  const { txns } = useStore();
  const list = useMemo(() => (payee ? txns.filter((t) => payeeKey(t) === payee) : []), [txns, payee]);
  if (!payee || list.length === 0) return null;
  const latest = list[0];
  const spent = list.reduce((s, t) => s + Math.max(0, spendPaise(t)), 0);
  const banks = [...new Set(list.map((t) => BANK_LABELS[t.bank]))].join(', ');
  return (
    <Sheet open onClose={onClose} title={latest.merchant}>
      <div className="payee-stats">
        <div>
          <strong>{formatINR(spent)}</strong>
          <small>spent</small>
        </div>
        <div>
          <strong>{list.length}</strong>
          <small>payment{list.length === 1 ? '' : 's'}</small>
        </div>
        <div>
          <strong>{new Date(list[list.length - 1].date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</strong>
          <small>first seen</small>
        </div>
      </div>
      <PayeeDetails t={latest} />
      <p className="hint">Via {banks}</p>
      <h3 className="sub-head">Recent payments</h3>
      <ul className="rows compact">
        {list.slice(0, 6).map((t) => (
          <li key={t.id} className="row static">
            <span className="row-main">
              <strong>{formatDate(t.date, { time: t.hasTime, year: true })}</strong>
              <small>
                {t.category} · {BANK_LABELS[t.bank]} {t.method}
                {t.note ? ` · ${t.note}` : ''}
              </small>
            </span>
            <span className="row-amt">{formatINR(t.amountPaise)}</span>
            {t.source === 'gmail' && (
              <a className="link" href={gmailLink(t.sourceMessageId)} target="_blank" rel="noopener noreferrer" aria-label="Open email">
                ✉︎
              </a>
            )}
          </li>
        ))}
      </ul>
      {list.length > 6 && onShowAll && (
        <button className="link" onClick={() => onShowAll(payee)}>
          See all {list.length} payments
        </button>
      )}
      <h3 className="sub-head">Identify this payee</h3>
      <IdentifyPayee sample={latest} count={list.length} onDone={onClose} />
    </Sheet>
  );
}
