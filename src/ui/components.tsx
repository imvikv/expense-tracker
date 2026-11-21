import { useEffect, type ReactNode } from 'react';
import { formatINR } from './format';
import type { Category } from '../lib/types';

/* ---------------- Icons (inline SVG, no icon font or CDN) ---------------- */

const paths: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  check: 'M9 12l2 2 4-4M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  sync: 'M21 12a9 9 0 0 1-15.5 6.2M3 12A9 9 0 0 1 18.5 5.8M18.5 2v3.8h-3.8M5.5 22v-3.8h3.8',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  chevL: 'M15 18l-6-6 6-6',
  chevR: 'M9 18l6-6-6-6',
  close: 'M18 6 6 18M6 6l12 12',
  filter: 'M3 5h18M6 12h12M10 19h4',
  download: 'M12 3v12m0 0 4-4m-4 4-4-4M4 21h16',
  lock: 'M6 11V8a6 6 0 1 1 12 0v3M5 11h14v10H5z',
  alert: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  mail: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm0 1 8 7 8-7',
};

export function Icon({ name, size = 22 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name] ?? ''} />
    </svg>
  );
}

/* ---------------- Category colours ---------------- */

const CAT_COLORS: Partial<Record<Category, string>> = {
  Groceries: '#22a06b',
  'Food Delivery': '#f97316',
  Restaurants: '#e2483d',
  Shopping: '#8b5cf6',
  Transport: '#0ea5e9',
  Fuel: '#a16207',
  Travel: '#06b6d4',
  Utilities: '#eab308',
  'Mobile & Internet': '#6366f1',
  'Rent and Housing': '#64748b',
  Healthcare: '#ec4899',
  Entertainment: '#d946ef',
  Subscriptions: '#7c3aed',
  Education: '#2563eb',
  Insurance: '#0d9488',
  Investments: '#16a34a',
  Taxes: '#b91c1c',
  'Bank Charges': '#dc2626',
  'Cash Withdrawals': '#78716c',
  Transfers: '#94a3b8',
  'Credit Card Payment': '#94a3b8',
  Income: '#16a34a',
  Refunds: '#16a34a',
  Uncategorized: '#9ca3af',
};

export function catColor(c: string): string {
  return CAT_COLORS[c as Category] ?? '#9ca3af';
}

export function CatDot({ category }: { category: string }) {
  return <span className="cat-dot" style={{ background: catColor(category) }} />;
}

/* ---------------- Layout pieces ---------------- */

export function Card({ title, action, children, className = '' }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

/* ---------------- Charts (plain SVG/CSS) ---------------- */

export function MonthBars({ data, onSelect, selected }: { data: Array<{ key: string; label: string; value: number }>; onSelect?: (key: string) => void; selected?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const nonZero = data.filter((d) => d.value > 0);
  const avg = nonZero.length ? nonZero.reduce((s, d) => s + d.value, 0) / nonZero.length : 0;
  return (
    <div className="month-bars">
      <div className="mb-area" role="img" aria-label="Monthly spending chart">
        {avg > 0 && (
          <div className="avg-line" style={{ bottom: `${(avg / max) * 100}%` }}>
            <span>avg {formatINR(avg, { compact: true })}</span>
          </div>
        )}
        {data.map((d) => (
          <button key={d.key} className={`mb-col ${selected === d.key ? 'sel' : ''}`} onClick={() => onSelect?.(d.key)} aria-label={`${d.label}: ${formatINR(d.value)}`}>
            <span className="mb-bar" style={{ height: `${Math.max(d.value > 0 ? 2 : 0, (d.value / max) * 100)}%` }} />
          </button>
        ))}
      </div>
      <div className="mb-labels">
        {data.map((d) => (
          <span key={d.key} className={selected === d.key ? 'sel' : ''}>
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function HBars({ rows, total, color, onSelect, limit = 8 }: { rows: Array<{ key: string; value: number; count: number }>; total?: number; color?: (k: string) => string; onSelect?: (k: string) => void; limit?: number }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const sum = total ?? rows.reduce((s, r) => s + r.value, 0);
  if (rows.length === 0) return <Empty>No spending in this period.</Empty>;
  return (
    <ul className="hbars">
      {rows.slice(0, limit).map((r) => (
        <li key={r.key}>
          <button className="hbar-row" onClick={() => onSelect?.(r.key)} disabled={!onSelect}>
            <span className="hbar-top">
              <span className="hbar-name">
                {color && <span className="cat-dot" style={{ background: color(r.key) }} />}
                {r.key}
              </span>
              <span className="hbar-amt">
                {formatINR(r.value)} <small>{sum > 0 ? Math.round((r.value / sum) * 100) : 0}%</small>
              </span>
            </span>
            <span className="hbar-track">
              <span className="hbar-fill" style={{ width: `${(r.value / max) * 100}%`, background: color?.(r.key) }} />
            </span>
            <span className="hbar-sub">
              {r.count} transaction{r.count === 1 ? '' : 's'}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
