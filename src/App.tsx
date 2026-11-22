import { useCallback, useEffect, useState } from 'react';
import { prepare } from './lib/auth';
import { generateSampleEmails } from './lib/sampleEmails';
import { ingest, refreshDuplicates } from './lib/sync';
import { Icon } from './ui/components';
import { Dashboard } from './ui/Dashboard';
import { Review } from './ui/Review';
import { Settings } from './ui/Settings';
import { StoreProvider, useStore } from './ui/store';
import { SyncSheet, useConnected } from './ui/SyncSheet';
import { Transactions, type TxnFilter } from './ui/Transactions';

type Tab = 'home' | 'txns' | 'review' | 'settings';

const TITLES: Record<Tab, string> = { home: 'Spending', txns: 'Transactions', review: 'Review', settings: 'Settings' };

function Welcome({ onSync, onSettings }: { onSync: () => void; onSettings: () => void }) {
  const { settings, rules, reload, toast } = useStore();
  const demo = async () => {
    const r = await ingest(generateSampleEmails(new Date()), { source: 'sample', rules, settings });
    await refreshDuplicates();
    await reload();
    toast(`Loaded ${r.added} demo transactions`);
  };
  return (
    <div className="page welcome">
      <div className="welcome-icon">
        <Icon name="lock" size={34} />
      </div>
      <h1>Your spending, privately</h1>
      <p>Reads transaction alerts from HDFC, ICICI, Axis and HSBC in your Gmail and builds a spending dashboard. Everything is processed and stored in this browser — nothing is sent to any server.</p>
      <div className="btn-col">
        {settings.clientId ? (
          <button className="btn primary" onClick={onSync}>
            Connect Gmail
          </button>
        ) : (
          <button className="btn primary" onClick={onSettings}>
            Set up Gmail access
          </button>
        )}
        <button className="btn" onClick={demo}>
          Try with demo data
        </button>
      </div>
      <p className="hint">Demo data is invented and can be removed anytime from Settings.</p>
    </div>
  );
}

function Shell() {
  const { ready, error, txns, settings, toastMsg } = useStore();
  const [tab, setTab] = useState<Tab>('home');
  const [filter, setFilter] = useState<TxnFilter>({});
  const [syncOpen, setSyncOpen] = useState(false);
  const connected = useConnected();

  // Load Google sign-in early so the Connect tap can open the popup immediately (iOS requirement).
  useEffect(() => {
    if (settings.clientId) prepare(settings.clientId).catch(() => undefined);
  }, [settings.clientId]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);

  const go = useCallback((t: 'txns' | 'review', f?: TxnFilter) => {
    if (f) setFilter(f);
    setTab(t);
  }, []);

  const reviewCount = txns.filter((t) => t.duplicateStatus === 'suspected' || (t.confidence === 'low' && !t.userEdited)).length;

  if (!ready) return <div className="splash">Loading…</div>;

  return (
    <div className="app">
      <header className="topbar">
        <h1>{TITLES[tab]}</h1>
        <button className={`sync-btn ${connected ? 'on' : ''}`} onClick={() => setSyncOpen(true)} aria-label="Sync Gmail">
          <span className="dot" />
          <Icon name="sync" size={18} />
          <span>Sync</span>
        </button>
      </header>

      <main>
        {error && <p className="error page">Storage error: {error}</p>}
        {tab === 'home' && (txns.length === 0 ? <Welcome onSync={() => setSyncOpen(true)} onSettings={() => setTab('settings')} /> : <Dashboard go={go} />)}
        {tab === 'txns' && <Transactions initial={filter} />}
        {tab === 'review' && <Review go={go} />}
        {tab === 'settings' && <Settings />}
      </main>

      <nav className="tabbar" aria-label="Sections">
        {(
          [
            ['home', 'home', 'Home'],
            ['txns', 'list', 'Activity'],
            ['review', 'check', 'Review'],
            ['settings', 'gear', 'Settings'],
          ] as Array<[Tab, string, string]>
        ).map(([t, icon, label]) => (
          <button
            key={t}
            className={tab === t ? 'on' : ''}
            onClick={() => {
              if (t === 'txns' && tab !== 'txns') setFilter({});
              setTab(t);
            }}
            aria-current={tab === t ? 'page' : undefined}
          >
            <span className="tab-icon">
              <Icon name={icon} />
              {t === 'review' && reviewCount > 0 && <span className="tab-badge">{reviewCount > 99 ? '99+' : reviewCount}</span>}
            </span>
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <SyncSheet open={syncOpen} onClose={() => setSyncOpen(false)} openSettings={() => setTab('settings')} />
      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
