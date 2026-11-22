import { useEffect, useState } from 'react';
import { disconnect, isConnected } from '../lib/auth';
import { buildTransaction } from '../lib/categorize';
import { db, requestPersistence, storageEstimate } from '../lib/db';
import { download, makeBackup, restoreBackup, toCsv } from '../lib/exporters';
import { BANK_SENDER_DOMAINS, parseEmail } from '../lib/parsers';
import { generateSampleEmails } from '../lib/sampleEmails';
import { ingest, refreshDuplicates } from '../lib/sync';
import { BANK_LABELS, CATEGORIES, KIND_LABELS, type BankId, type Category, type TxnKind } from '../lib/types';
import { Card } from './components';
import { CardBills } from './CardBills';
import { formatINR, relativeTime, uid } from './format';
import { useStore } from './store';
import { useConnected } from './SyncSheet';

function ConfirmButton({ label, confirmLabel, onConfirm, danger }: { label: string; confirmLabel: string; onConfirm: () => void | Promise<void>; danger?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={`btn ${danger ? 'danger' : ''} ${armed ? 'armed' : ''}`}
      onClick={async () => {
        if (!armed) return setArmed(true);
        setArmed(false);
        await onConfirm();
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

export function Settings() {
  const store = useStore();
  const { settings, saveSettings, rules, addRule, deleteRule, txns, reload, toast } = store;
  const connected = useConnected();
  const [clientId, setClientId] = useState(settings.clientId);
  const [own, setOwn] = useState(settings.ownIdentifiers.join('\n'));
  const [rulePattern, setRulePattern] = useState('');
  const [ruleCat, setRuleCat] = useState<Category>('Shopping');
  const [ruleKind, setRuleKind] = useState<TxnKind | ''>('');
  const [est, setEst] = useState<Awaited<ReturnType<typeof storageEstimate>>>(null);
  const [testFrom, setTestFrom] = useState<BankId>('HDFC');
  const [testText, setTestText] = useState('');

  useEffect(() => setClientId(settings.clientId), [settings.clientId]);
  useEffect(() => setOwn(settings.ownIdentifiers.join('\n')), [settings.ownIdentifiers]);
  useEffect(() => {
    void storageEstimate().then(setEst);
  }, [txns.length]);

  const envId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '';
  const validId = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(clientId.trim());

  const testResult = (() => {
    if (!testText.trim()) return null;
    const r = parseEmail({ id: 'tester', from: `test@${BANK_SENDER_DOMAINS[testFrom][0]}`, subject: '', body: testText, receivedAt: new Date().toISOString() });
    if (r.status !== 'parsed') return { ok: false as const, msg: r.reason ?? r.status };
    const t = buildTransaction(r.txns[0], { messageId: 'tester', index: 0, source: 'import', rules, settings });
    return { ok: true as const, t };
  })();

  const loadDemo = async () => {
    const emails = generateSampleEmails(new Date());
    const r = await ingest(emails, { source: 'sample', rules, settings });
    await refreshDuplicates();
    await reload();
    toast(`Loaded ${r.added} demo transactions`);
  };

  const hasSample = txns.some((t) => t.source === 'sample');

  return (
    <div className="page">
      <Card title="Gmail connection">
        <p className="hint">
          Status: <strong>{connected ? 'connected (this session only)' : 'not connected'}</strong> · last sync {relativeTime(settings.lastSyncAt)}
        </p>
        <label className="form-line col">
          Google OAuth client ID
          <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234567890-abc123.apps.googleusercontent.com" autoCapitalize="off" autoCorrect="off" spellCheck={false} inputMode="url" />
        </label>
        {clientId && !validId && <p className="error">That doesn’t look like an OAuth web client ID (it ends with .apps.googleusercontent.com).</p>}
        <p className="hint">The client ID is public by design (it identifies the app to Google, it is not a password). {envId ? 'A default was built into this deployment.' : 'It can also be baked into the build with the GOOGLE_CLIENT_ID repository variable.'}</p>
        <div className="btn-row">
          <button
            className="btn primary"
            disabled={!validId || clientId.trim() === settings.clientId}
            onClick={async () => {
              await saveSettings({ clientId: clientId.trim() });
              toast('Client ID saved');
            }}
          >
            Save client ID
          </button>
          <button
            className="btn"
            disabled={!connected && !isConnected()}
            onClick={async () => {
              await disconnect();
              toast('Gmail disconnected and access revoked');
            }}
          >
            Disconnect Gmail
          </button>
        </div>
        <p className="hint">
          Disconnect revokes this session’s token with Google. To remove the app’s access completely, also visit{' '}
          <a href="https://myaccount.google.com/connections" target="_blank" rel="noopener noreferrer">
            Google Account → Third-party connections
          </a>
          .
        </p>
        <label className="form-line">
          First sync covers
          <select value={settings.syncMonths} onChange={(e) => saveSettings({ syncMonths: Number(e.target.value) })}>
            {[3, 6, 12, 18, 24, 36].map((m) => (
              <option key={m} value={m}>
                {m} months
              </option>
            ))}
          </select>
        </label>
      </Card>

      <Card title="Your own accounts">
        <p className="hint">Names, UPI IDs or account last-4 digits that belong to you (one per line). Payments to these are treated as transfers, not spending.</p>
        <textarea rows={3} value={own} onChange={(e) => setOwn(e.target.value)} placeholder={'Your name as banks show it\nyourname@okhdfcbank\n9012'} />
        <button
          className="btn"
          onClick={async () => {
            const list = own
              .split(/[\n,]/)
              .map((s) => s.trim())
              .filter((s) => s.length >= 3);
            await saveSettings({ ownIdentifiers: list });
            toast('Saved. New syncs will use this; edit past transactions from the list.');
          }}
        >
          Save
        </button>
      </Card>

      <Card title="Credit card bills">
        <p className="hint">
          Card bill payments (auto-debit, CRED, net banking) are kept out of spending because each purchase on the card is already counted from its own alert. Switch a card on only if you don't get purchase alerts for it — then its bill is the only record of that spending.
        </p>
        <CardBills />
      </Card>

      <Card title={`Category rules (${rules.length})`}>
        <p className="hint">Rules match the merchant name, the payee name the bank shows, or their UPI ID (case-insensitive text, or /regex/). Payees you name from a transaction or the Review tab appear here too. Newest rule wins, and rules re-apply to past transactions you haven’t edited by hand.</p>
        <div className="rule-form">
          <input value={rulePattern} onChange={(e) => setRulePattern(e.target.value)} placeholder="Merchant text, e.g. amazon fresh" autoCapitalize="off" />
          <select value={ruleCat} onChange={(e) => setRuleCat(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select value={ruleKind} onChange={(e) => setRuleKind(e.target.value as TxnKind | '')}>
            <option value="">Keep type</option>
            {(Object.keys(KIND_LABELS) as TxnKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
          <button
            className="btn primary"
            disabled={rulePattern.trim().length < 2}
            onClick={async () => {
              const n = await addRule({ id: uid(), pattern: rulePattern.trim(), category: ruleCat, kind: ruleKind || undefined, createdAt: new Date().toISOString() });
              setRulePattern('');
              toast(`Rule added · ${n} transaction${n === 1 ? '' : 's'} updated`);
            }}
          >
            Add rule
          </button>
        </div>
        {rules.length > 0 && (
          <ul className="rows">
            {[...rules]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map((r) => (
                <li key={r.id} className="row static">
                  <span className="row-main">
                    <strong>{r.pattern}</strong>
                    <small>
                      {[r.label && `shown as “${r.label}”`, r.category && `→ ${r.category}`, r.kind && KIND_LABELS[r.kind], r.payeeType && r.payeeType !== 'unknown' && (r.payeeType === 'own' ? 'my account' : r.payeeType === 'merchant' ? 'business' : 'person')]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </span>
                  <button className="link" onClick={() => deleteRule(r.id)}>
                    Delete
                  </button>
                </li>
              ))}
          </ul>
        )}
      </Card>

      <Card title="Your data">
        <p className="hint">
          {txns.length} transactions stored in this browser on this device{est ? ` (${(est.usage / 1024 / 1024).toFixed(1)} MB used${est.persisted ? ', persistent' : ''})` : ''}. Nothing is uploaded anywhere. Data does not sync between devices; each device rebuilds its history from Gmail, or you can move a backup file.
        </p>
        <div className="btn-grid">
          <button className="btn" onClick={() => download(`all-transactions-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(txns), 'text/csv;charset=utf-8')} disabled={txns.length === 0}>
            Export CSV
          </button>
          <button
            className="btn"
            onClick={async () => download(`expense-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await makeBackup()), 'application/json')}
            disabled={txns.length === 0 && rules.length === 0}
          >
            Export backup
          </button>
          <label className="btn file-btn">
            Import backup
            <input
              type="file"
              accept="application/json,.json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  const r = await restoreBackup(await file.text());
                  await refreshDuplicates();
                  await reload();
                  toast(`Imported ${r.transactions} transactions and ${r.rules} rules`);
                } catch (err) {
                  toast(err instanceof Error ? err.message : 'Import failed');
                }
              }}
            />
          </label>
          <button
            className="btn"
            onClick={async () => {
              const ok = await requestPersistence();
              setEst(await storageEstimate());
              toast(ok ? 'Storage marked persistent' : 'The browser declined; add the app to your Home Screen and try again');
            }}
          >
            Keep data persistent
          </button>
        </div>
        <p className="hint">Backup files are plain JSON with your transactions — keep them somewhere private. Safari can delete website data that isn’t used for a few weeks; adding the app to your Home Screen and keeping a backup protects against that.</p>
        <div className="btn-grid">
          {hasSample ? (
            <button
              className="btn"
              onClick={async () => {
                await db.clearSample();
                await reload();
                toast('Demo data removed');
              }}
            >
              Remove demo data
            </button>
          ) : (
            <button className="btn" onClick={loadDemo}>
              Load demo data
            </button>
          )}
          <ConfirmButton
            danger
            label="Clear all local data"
            confirmLabel="Tap again to erase everything"
            onConfirm={async () => {
              await disconnect();
              await db.clearAll();
              await reload();
              toast('All local data erased');
            }}
          />
        </div>
      </Card>

      <Card title="Parser tester">
        <p className="hint">Paste the text of a bank alert (redact anything you like) to see how it would be read. This runs only on this device and is not saved.</p>
        <select value={testFrom} onChange={(e) => setTestFrom(e.target.value as BankId)}>
          {(Object.keys(BANK_LABELS) as BankId[]).map((b) => (
            <option key={b} value={b}>
              {BANK_LABELS[b]}
            </option>
          ))}
        </select>
        <textarea rows={5} value={testText} onChange={(e) => setTestText(e.target.value)} placeholder="Rs.850.00 is debited from your HDFC Bank Credit Card ending 4321 towards SWIGGY on 21 Nov, 2026 at 10:15:32." />
        {testResult &&
          (testResult.ok ? (
            <dl className="details">
              <dt>Amount</dt>
              <dd>
                {formatINR(testResult.t.amountPaise, { decimals: true })} ({testResult.t.direction})
              </dd>
              <dt>Merchant</dt>
              <dd>
                {testResult.t.merchant} <small className="muted">“{testResult.t.merchantRaw}”</small>
              </dd>
              <dt>Date</dt>
              <dd>{testResult.t.date.replace('T', ' ')}</dd>
              <dt>Method</dt>
              <dd>
                {testResult.t.method} {testResult.t.accountLast4 ? `••${testResult.t.accountLast4}` : ''}
              </dd>
              <dt>Type</dt>
              <dd>
                {KIND_LABELS[testResult.t.kind]} · {testResult.t.category}
              </dd>
              <dt>Template</dt>
              <dd>
                {testResult.t.template} ({testResult.t.confidence})
              </dd>
            </dl>
          ) : (
            <p className="error">Not parsed: {testResult.msg}</p>
          ))}
      </Card>

      <Card title="Privacy">
        <ul className="bullets">
          <li>No server, analytics, ads or AI services. The app is static files on GitHub Pages; your browser talks directly to Google.</li>
          <li>Gmail access is read-only and the token is kept in memory only.</li>
          <li>Email bodies are never stored. Only the parsed amount, date, merchant, bank, card/account last 4 digits and Gmail message ID are kept, in this browser’s IndexedDB.</li>
          <li>OTPs, declined transactions, promotions and mail from look-alike domains are ignored.</li>
          <li>The offline cache holds only the app’s own code, never Gmail responses.</li>
        </ul>
        <p className="hint">Accepted sender domains: {Object.values(BANK_SENDER_DOMAINS).flat().join(', ')}.</p>
      </Card>
      <p className="version">Personal Expense Tracker · build {__BUILD_ID__}</p>
    </div>
  );
}
