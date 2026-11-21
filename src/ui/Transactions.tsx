import { useEffect, useMemo, useState } from 'react';
import { isCounted, monthKey, monthLabel, spendPaise } from '../lib/analytics';
import { download, toCsv } from '../lib/exporters';
import { BANK_LABELS, CATEGORIES, KIND_LABELS, type BankId, type Transaction, type TxnKind } from '../lib/types';
import { CatDot, Empty, Icon } from './components';
import { dayHeading, formatINR } from './format';
import { useStore } from './store';
import { TxnSheet } from './TxnSheet';

export interface TxnFilter {
  search?: string;
  month?: string;
  from?: string;
  to?: string;
  bank?: BankId;
  category?: string;
  kind?: TxnKind;
  method?: string;
}

const PAGE = 200;

export function applyFilter(txns: Transaction[], f: TxnFilter): Transaction[] {
  const q = f.search?.trim().toLowerCase();
  return txns.filter((t) => {
    if (f.month && !t.date.startsWith(f.month)) return false;
    if (f.from && t.date.slice(0, 10) < f.from) return false;
    if (f.to && t.date.slice(0, 10) > f.to) return false;
    if (f.bank && t.bank !== f.bank) return false;
    if (f.category && t.category !== f.category) return false;
    if (f.kind && t.kind !== f.kind) return false;
    if (f.method && t.method !== f.method) return false;
    if (q && !(t.merchant.toLowerCase().includes(q) || t.merchantRaw.toLowerCase().includes(q) || (t.note ?? '').toLowerCase().includes(q))) return false;
    return true;
  });
}

export function TxnRow({ t, onOpen }: { t: Transaction; onOpen: (t: Transaction) => void }) {
  const credit = t.direction === 'credit';
  const muted = !isCounted(t) || spendPaise(t) === 0;
  return (
    <button className={`txn ${muted ? 'muted-row' : ''}`} onClick={() => onOpen(t)}>
      <CatDot category={t.category} />
      <span className="txn-main">
        <span className="txn-merchant">{t.merchant}</span>
        <span className="txn-sub">
          {t.category} · {BANK_LABELS[t.bank].replace(' Bank', '').replace(' India', '')} {t.method === 'Unknown' ? '' : t.method}
          {t.accountLast4 ? ` ••${t.accountLast4}` : ''}
        </span>
        <span className="badges">
          {t.excluded && <span className="badge">excluded</span>}
          {t.duplicateStatus === 'duplicate' && <span className="badge warn">duplicate</span>}
          {t.duplicateStatus === 'suspected' && <span className="badge warn">possible duplicate</span>}
          {t.confidence === 'low' && !t.userEdited && <span className="badge warn">check</span>}
          {t.kind !== 'expense' && <span className="badge">{KIND_LABELS[t.kind]}</span>}
        </span>
      </span>
      <span className={`txn-amt ${credit ? 'pos' : ''}`}>
        {credit ? '+' : '−'}
        {formatINR(t.amountPaise, { decimals: t.amountPaise % 100 !== 0 })}
      </span>
    </button>
  );
}

export function Transactions({ initial }: { initial: TxnFilter }) {
  const { txns } = useStore();
  const [f, setF] = useState<TxnFilter>(initial);
  const [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<Transaction | null>(null);

  useEffect(() => setF(initial), [initial]);
  useEffect(() => setLimit(PAGE), [f]);

  const months = useMemo(() => [...new Set(txns.map((t) => monthKey(t.date)))].sort().reverse(), [txns]);
  const list = useMemo(() => applyFilter(txns, f), [txns, f]);
  const total = useMemo(() => list.reduce((s, t) => s + spendPaise(t), 0), [list]);
  const groups = useMemo(() => {
    const out: Array<{ day: string; items: Transaction[] }> = [];
    for (const t of list.slice(0, limit)) {
      const day = t.date.slice(0, 10);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(t);
      else out.push({ day, items: [t] });
    }
    return out;
  }, [list, limit]);

  const current = open ? txns.find((t) => t.id === open.id) ?? open : null;
  const active = Object.entries(f).filter(([k, v]) => v && k !== 'search').length;
  const set = (patch: Partial<TxnFilter>) => setF((cur) => ({ ...cur, ...patch }));

  return (
    <div className="page">
      <div className="search-bar">
        <Icon name="search" size={18} />
        <input type="search" placeholder="Search merchant or note" value={f.search ?? ''} onChange={(e) => set({ search: e.target.value || undefined })} enterKeyHint="search" />
        <button className={`chip ${active ? 'on' : ''}`} onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
          <Icon name="filter" size={16} /> {active ? active : 'Filter'}
        </button>
      </div>

      {showFilters && (
        <div className="filters card">
          <label>
            Month
            <select value={f.month ?? ''} onChange={(e) => set({ month: e.target.value || undefined, from: undefined, to: undefined })}>
              <option value="">All time</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m, 'long')}
                </option>
              ))}
            </select>
          </label>
          <div className="row-2">
            <label>
              From
              <input type="date" value={f.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined, month: undefined })} />
            </label>
            <label>
              To
              <input type="date" value={f.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined, month: undefined })} />
            </label>
          </div>
          <label>
            Bank
            <select value={f.bank ?? ''} onChange={(e) => set({ bank: (e.target.value || undefined) as BankId | undefined })}>
              <option value="">All banks</option>
              {(Object.keys(BANK_LABELS) as BankId[]).map((b) => (
                <option key={b} value={b}>
                  {BANK_LABELS[b]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select value={f.category ?? ''} onChange={(e) => set({ category: e.target.value || undefined })}>
              <option value="">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select value={f.kind ?? ''} onChange={(e) => set({ kind: (e.target.value || undefined) as TxnKind | undefined })}>
              <option value="">All types</option>
              {(Object.keys(KIND_LABELS) as TxnKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Payment method
            <select value={f.method ?? ''} onChange={(e) => set({ method: e.target.value || undefined })}>
              <option value="">All methods</option>
              {['Credit Card', 'Debit Card', 'UPI', 'Bank Transfer', 'Net Banking', 'ATM', 'Account'].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <button className="btn ghost" onClick={() => setF({})}>
            Clear filters
          </button>
        </div>
      )}

      <div className="list-summary">
        <span>
          {list.length} transaction{list.length === 1 ? '' : 's'} · spending {formatINR(total)}
        </span>
        <button className="link" onClick={() => download(`transactions-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(list), 'text/csv;charset=utf-8')} disabled={list.length === 0}>
          <Icon name="download" size={16} /> CSV
        </button>
      </div>

      {list.length === 0 ? (
        <Empty>{txns.length === 0 ? 'No transactions yet. Sync Gmail or load the demo data from Settings.' : 'No transactions match these filters.'}</Empty>
      ) : (
        <div className="txn-groups">
          {groups.map((g) => (
            <section key={g.day}>
              <h3 className="day-head">{dayHeading(g.day)}</h3>
              <div className="card flush">
                {g.items.map((t) => (
                  <TxnRow key={t.id} t={t} onOpen={setOpen} />
                ))}
              </div>
            </section>
          ))}
          {list.length > limit && (
            <button className="btn ghost" onClick={() => setLimit((l) => l + PAGE)}>
              Show more ({list.length - limit} left)
            </button>
          )}
        </div>
      )}

      <TxnSheet txn={current} onClose={() => setOpen(null)} />
    </div>
  );
}
