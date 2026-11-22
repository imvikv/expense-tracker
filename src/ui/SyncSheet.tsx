import { useEffect, useRef, useState } from 'react';
import { connect, isConnected, isPrepared, onAuthChange, prepare } from '../lib/auth';
import { AuthError } from '../lib/gmail';
import { defaultSyncStart, syncGmail, type SyncProgress } from '../lib/sync';
import { Sheet } from './components';
import { relativeTime, toInputDate } from './format';
import { useStore } from './store';

type Mode = 'new' | 'months' | 'custom';

export function useConnected(): boolean {
  const [c, setC] = useState(isConnected());
  useEffect(() => {
    const off = onAuthChange(() => setC(isConnected()));
    const t = window.setInterval(() => setC(isConnected()), 30_000);
    return () => {
      off();
      window.clearInterval(t);
    };
  }, []);
  return c;
}

export function SyncSheet({ open, onClose, openSettings }: { open: boolean; onClose: () => void; openSettings: () => void }) {
  const { settings, rules, reload, toast } = useStore();
  const connected = useConnected();
  const [ready, setReady] = useState(isPrepared());
  const [mode, setMode] = useState<Mode>(settings.syncedThrough ? 'new' : 'months');
  const [months, setMonths] = useState(settings.syncMonths);
  const today = toInputDate(new Date());
  const [from, setFrom] = useState(toInputDate(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)));
  const [to, setTo] = useState(today);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open || !settings.clientId) return;
    prepare(settings.clientId, settings.prefsSync !== false)
      .then(() => setReady(true))
      .catch((e: Error) => setErr(e.message));
  }, [open, settings.clientId, settings.prefsSync]);

  useEffect(() => {
    if (open) setMode(settings.syncedThrough ? 'new' : 'months');
  }, [open, settings.syncedThrough]);

  const range = (): { start: Date; end?: Date } => {
    if (mode === 'new') return { start: defaultSyncStart(settings) };
    if (mode === 'months') {
      const n = new Date();
      return { start: new Date(n.getFullYear(), n.getMonth() - months, n.getDate()) };
    }
    return { start: new Date(from + 'T00:00:00'), end: new Date(to + 'T00:00:00') };
  };

  const run = async () => {
    setErr(null);
    setRunning(true);
    abort.current = new AbortController();
    try {
      const { start, end } = range();
      if (end && end < start) throw new Error('The end date is before the start date.');
      const r = await syncGmail({ from: start, to: end, settings, rules, onProgress: setProgress, signal: abort.current.signal });
      await reload();
      toast(`Sync done · ${r.added} new transaction${r.added === 1 ? '' : 's'}${r.updated ? ` · ${r.updated} updated` : ''}${r.removed ? ` · ${r.removed} non-transactions removed` : ''}${r.duplicatesFlagged ? ` · ${r.duplicatesFlagged} duplicate${r.duplicatesFlagged === 1 ? '' : 's'} flagged` : ''}`);
      if (r.prefsError) window.setTimeout(() => toast(`Settings backup: ${r.prefsError}`), 3300);
      onClose();
    } catch (e) {
      await reload();
      if (e instanceof DOMException && e.name === 'AbortError') setErr('Sync cancelled. Everything fetched so far was saved.');
      else if (e instanceof AuthError) setErr(`${e.message} Progress so far was saved.`);
      else setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      abort.current = null;
    }
  };

  // Must run inside the tap handler so iOS Safari allows the Google popup.
  const connectAndRun = () => {
    setErr(null);
    connect()
      .then(() => run())
      .catch((e: Error) => setErr(e.message));
  };

  const pct = progress && progress.total > 0 ? Math.round((progress.fetched / progress.total) * 100) : 0;

  return (
    <Sheet open={open} onClose={running ? () => undefined : onClose} title="Sync Gmail">
      {!settings.clientId ? (
        <div className="notice">
          <p>Add your Google OAuth client ID first. It’s a one-time setup in Google Cloud (about 10 minutes); the README walks through it.</p>
          <button
            className="btn primary"
            onClick={() => {
              onClose();
              openSettings();
            }}
          >
            Open Settings
          </button>
        </div>
      ) : (
        <>
          <p className="hint">Last sync: {relativeTime(settings.lastSyncAt)}. Only emails from HDFC, ICICI, Axis and HSBC sender addresses are fetched. Email text is read in memory and discarded; only the parsed transaction is saved on this device.</p>
          <fieldset className="seg" disabled={running}>
            {settings.syncedThrough && (
              <label className={mode === 'new' ? 'on' : ''}>
                <input type="radio" name="mode" checked={mode === 'new'} onChange={() => setMode('new')} /> New emails
              </label>
            )}
            <label className={mode === 'months' ? 'on' : ''}>
              <input type="radio" name="mode" checked={mode === 'months'} onChange={() => setMode('months')} /> Last {months} months
            </label>
            <label className={mode === 'custom' ? 'on' : ''}>
              <input type="radio" name="mode" checked={mode === 'custom'} onChange={() => setMode('custom')} /> Custom
            </label>
          </fieldset>
          {mode === 'months' && (
            <label className="form-line">
              Months
              <select value={months} onChange={(e) => setMonths(Number(e.target.value))} disabled={running}>
                {[1, 3, 6, 12, 18, 24, 36].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          )}
          {mode === 'custom' && (
            <div className="row-2">
              <label>
                From
                <input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} disabled={running} />
              </label>
              <label>
                To
                <input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} disabled={running} />
              </label>
            </div>
          )}

          {progress && running && (
            <div className="progress">
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progress.phase === 'listing' ? 5 : progress.phase === 'finishing' ? 100 : pct}%` }} />
              </div>
              <p className="hint">
                {progress.phase === 'listing' && `Searching Gmail… ${progress.found} matching emails`}
                {progress.phase === 'fetching' && `Reading ${progress.fetched} of ${progress.total} new emails · ${progress.added} transactions${progress.skipped ? ` · ${progress.skipped} already synced` : ''}`}
                {progress.phase === 'updating' && `Adding payee details to earlier transactions… ${progress.fetched} of ${progress.total}`}
                {progress.phase === 'finishing' && 'Checking for duplicates…'}
              </p>
            </div>
          )}

          {err && <p className="error">{err}</p>}

          <div className="btn-row">
            {running ? (
              <button className="btn" onClick={() => abort.current?.abort()}>
                Cancel
              </button>
            ) : connected ? (
              <button className="btn primary" onClick={run}>
                Start sync
              </button>
            ) : (
              <button className="btn primary" onClick={connectAndRun} disabled={!ready}>
                {ready ? 'Connect Gmail & sync' : 'Loading Google sign-in…'}
              </button>
            )}
          </div>
          {!connected && !running && <p className="hint">Google will ask for read-only Gmail access{settings.prefsSync !== false ? ' and for a private app folder in your Drive (to keep your names, rules and edits in sync across devices)' : ''}. The sign-in lasts about an hour and is never saved; you’ll reconnect next time.</p>}
        </>
      )}
    </Sheet>
  );
}
