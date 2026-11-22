import { useEffect, useMemo, useState } from 'react';
import { accessToken } from '../lib/auth';
import { categoryForKind } from '../lib/categorize';
import { fetchEmail } from '../lib/gmail';
import { AMOUNT_RE, findDate, normaliseText } from '../lib/parsers/common';
import { buildTemplate, FIELD_LABELS, type BuildResult, type Spans, type TaughtField } from '../lib/parsers/taught';
import { rereadNow } from '../lib/sync';
import { db } from '../lib/db';
import { BANK_LABELS, KIND_LABELS, type BankId, type Direction, type PaymentMethod, type TxnKind } from '../lib/types';
import { Sheet } from './components';
import { formatDate, formatINR, uid } from './format';
import { useStore } from './store';

export type TeachSource = { kind: 'email'; id: string; bank: BankId; subject?: string } | { kind: 'text'; text: string; bank: BankId };

const FIELDS: TaughtField[] = ['amount', 'payee', 'date', 'account', 'payeeAccount'];
const FIELD_COLORS: Record<TaughtField, string> = { amount: '#0f766e', payee: '#7c3aed', date: '#2563eb', account: '#b45309', payeeAccount: '#db2777' };
const METHODS: Array<PaymentMethod | ''> = ['', 'Credit Card', 'Debit Card', 'UPI', 'Bank Transfer', 'Net Banking', 'ATM', 'Account'];
const KIND_HINTS: Array<TxnKind | ''> = ['', 'refund', 'cc_payment', 'transfer', 'cash', 'fee', 'investment'];

interface Token {
  text: string;
  start: number;
  end: number;
  space: boolean;
}

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const re = /\s+|[^\s]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ text: m[0], start: m.index, end: m.index + m[0].length, space: /^\s/.test(m[0]) });
  return out;
}

/** Trim punctuation that sticks to words ("SWIGGY," / "8611.") off a marked range. */
function tidy(text: string, [a, b]: [number, number], field: TaughtField): [number, number] {
  while (b > a && /[.,;:!)\]]/.test(text[b - 1]) && !(field === 'amount' && /\d\.\d?$/.test(text.slice(a, b - 1)))) b--;
  while (a < b && /[(\[“"']/.test(text[a])) a++;
  return [a, b];
}

/** Guess the obvious fields so the user mostly confirms rather than marks. */
function suggest(text: string): { spans: Spans; direction: Direction } {
  const spans: Spans = {};
  const am = AMOUNT_RE.exec(text);
  if (am) spans.amount = [am.index, am.index + am[0].length];
  const d = findDate(am ? text.slice(am.index) : text);
  if (d) {
    const off = am ? am.index : 0;
    spans.date = [off + d.index, off + d.index + d.length];
  }
  const acct = /(?:your|from)\s+(?:a\/c|account|acct|card)[^\n.]{0,25}?([xX*•]{2,}\s*\d{3,6})/i.exec(text);
  if (acct) {
    const i = acct.index + acct[0].lastIndexOf(acct[1]);
    spans.account = [i, i + acct[1].length];
  }
  const around = am ? text.slice(Math.max(0, am.index - 80), am.index + 120) : text;
  const direction: Direction = /\b(credited to your|received|refund|reversal)\b/i.test(around) && !/\bdebited from your\b/i.test(around) ? 'credit' : 'debit';
  return { spans, direction };
}

export function TeachSheet({ source, onClose }: { source: TeachSource | null; onClose: () => void }) {
  const { addTemplate, rules, settings, reload, toast, setTask } = useStore();
  const [text, setText] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [spans, setSpans] = useState<Spans>({});
  const [active, setActive] = useState<TaughtField>('amount');
  const [direction, setDirection] = useState<Direction>('debit');
  const [method, setMethod] = useState<PaymentMethod | ''>('');
  const [kindHint, setKindHint] = useState<TxnKind | ''>('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [templateId] = useState(uid);

  useEffect(() => {
    setText(null);
    setLoadErr(null);
    setSpans({});
    setActive('amount');
    setMethod('');
    setKindHint('');
    setName('');
    if (!source) return;
    const init = (t: string) => {
      const n = normaliseText(t);
      setText(n);
      const s = suggest(n);
      setSpans(s.spans);
      setDirection(s.direction);
    };
    if (source.kind === 'text') return init(source.text);
    const token = accessToken();
    if (!token) {
      setLoadErr('Connect Gmail first (tap Sync → Connect), then open Teach again. The email is read from Gmail on this device only.');
      return;
    }
    fetchEmail(source.id, token)
      .then((e) => init(e.body))
      .catch((e: Error) => setLoadErr(e.message));
  }, [source]);

  const tokens = useMemo(() => (text ? tokenize(text) : []), [text]);

  const result = useMemo((): { ok: BuildResult } | { error: string } | null => {
    if (!text || !source || !spans.amount) return null;
    try {
      return { ok: buildTemplate({ id: templateId, bank: source.bank, text, spans, direction, method: method || undefined, kindHint: kindHint || undefined, name }) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [text, source, spans, direction, method, kindHint, name, templateId]);

  if (!source) return null;

  const fieldAt = (tok: Token): TaughtField | undefined => FIELDS.find((f) => spans[f] && tok.start < spans[f]![1] && tok.end > spans[f]![0]);

  const tap = (tok: Token) => {
    if (!text || tok.space) return;
    const cur = spans[active];
    if (cur && tok.start < cur[1] && tok.end > cur[0]) {
      // Tapping inside the current mark clears it.
      setSpans((s) => ({ ...s, [active]: undefined }));
      return;
    }
    const next = tidy(text, cur ? [Math.min(cur[0], tok.start), Math.max(cur[1], tok.end)] : [tok.start, tok.end], active);
    // A field can't overlap another: drop the other mark.
    setSpans((s) => {
      const out: Spans = { ...s, [active]: next };
      for (const f of FIELDS) if (f !== active && out[f] && out[f]![0] < next[1] && next[0] < out[f]![1]) out[f] = undefined;
      return out;
    });
  };

  const save = async () => {
    if (!result || !('ok' in result)) return;
    setBusy('Saving…');
    try {
      const tpl = result.ok.template;
      await addTemplate(tpl);
      onClose();
      if (!accessToken()) {
        toast('Template saved · it will be applied on your next Sync');
        return;
      }
      // Re-read this bank's not-understood emails in the background, same subject first.
      const subject = source.kind === 'email' ? source.subject : undefined;
      const sameSubject = new Set(subject ? (await db.allUnparsed()).filter((u) => u.subject === subject).map((u) => u.id) : []);
      setTask({ label: `Re-reading ${BANK_LABELS[source.bank]} emails`, done: 0, total: 0 });
      rereadNow({ rules, settings, scope: { bank: source.bank }, first: (id) => sameSubject.has(id), onProgress: (p) => setTask({ label: `Re-reading ${BANK_LABELS[source.bank]} emails`, done: p.fetched, total: p.total }) })
        .then(async (r) => {
          await reload();
          const read = r.added + r.updated;
          toast(`Template saved · ${read} email${read === 1 ? '' : 's'} now read${r.stillUnparsed ? ` · ${r.stillUnparsed} still not understood` : ''}`);
        })
        .catch((e: Error) => toast(`Template saved, but re-reading stopped: ${e.message} It will continue on your next Sync.`))
        .finally(() => setTask(null));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(null);
    }
  };

  const preview = result && 'ok' in result ? result.ok.preview : null;
  const previewKind = kindHint || (direction === 'credit' ? 'income' : 'expense');

  return (
    <Sheet open onClose={busy ? () => undefined : onClose} title="Teach the app">
      <p className="hint">
        {BANK_LABELS[source.bank]}
        {source.kind === 'email' && source.subject ? ` · “${source.subject}”` : ''}. Pick a field below, then tap the words in the email that hold it. Tap a marked word again to clear it.
      </p>

      {loadErr && <p className="error">{loadErr}</p>}
      {!text && !loadErr && <p className="hint">Loading the email from Gmail…</p>}

      {text && (
        <>
          <div className="field-chips" role="radiogroup" aria-label="Field to mark">
            {FIELDS.map((f) => (
              <button key={f} className={`field-chip ${active === f ? 'on' : ''}`} style={{ ['--c' as string]: FIELD_COLORS[f] }} onClick={() => setActive(f)} role="radio" aria-checked={active === f}>
                <span className="dot" />
                {FIELD_LABELS[f]}
                {f === 'amount' && ' *'}
                {spans[f] && <small>{text.slice(spans[f]![0], spans[f]![1]).slice(0, 18)}</small>}
              </button>
            ))}
          </div>

          <div className="email-text" aria-label="Email text">
            {tokens.map((tok, i) => {
              if (tok.space) return /\n/.test(tok.text) ? <br key={i} /> : <span key={i}> </span>;
              const f = fieldAt(tok);
              return (
                <span key={i} className={`tok ${f ? 'marked' : ''}`} style={f ? { ['--c' as string]: FIELD_COLORS[f] } : undefined} onClick={() => tap(tok)}>
                  {tok.text}
                </span>
              );
            })}
          </div>

          <div className="form">
            <div className="seg" role="radiogroup" aria-label="Direction">
              <label className={direction === 'debit' ? 'on' : ''}>
                <input type="radio" checked={direction === 'debit'} onChange={() => setDirection('debit')} /> Money out
              </label>
              <label className={direction === 'credit' ? 'on' : ''}>
                <input type="radio" checked={direction === 'credit'} onChange={() => setDirection('credit')} /> Money in
              </label>
            </div>
            <div className="row-2">
              <label>
                This kind of email is
                <select value={kindHint} onChange={(e) => setKindHint(e.target.value as TxnKind | '')}>
                  {KIND_HINTS.map((k) => (
                    <option key={k} value={k}>
                      {k ? KIND_LABELS[k] : direction === 'credit' ? 'Money received (auto)' : 'Spending (auto)'}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Paid by
                <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod | '')}>
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m || 'Detect from email'}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Template name (optional)
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HDFC IMPS sent" maxLength={60} />
            </label>
          </div>

          {result && 'error' in result && <p className="error">{result.error}</p>}
          {!spans.amount && <p className="hint">Mark the amount to continue.</p>}
          {preview && (
            <div className="notice">
              <p>
                <strong>Reads as:</strong> {preview.direction === 'credit' ? '+' : '−'}
                {formatINR(preview.amountPaise, { decimals: true })} · {preview.payee ?? (preview.payeeAccount ? `account ••${preview.payeeAccount}` : 'no payee')} · {formatDate(preview.date, { time: preview.hasTime, year: true })}
                {preview.accountLast4 ? ` · your ••${preview.accountLast4}` : ''} · {preview.method} · {KIND_LABELS[previewKind]} ({categoryForKind(previewKind, undefined)})
              </p>
              {result && 'ok' in result && result.ok.template.sample ? (
                <p className="hint">Shareable version (what an export to GitHub contains): “{result.ok.template.sample}”</p>
              ) : (
                <p className="hint">This template will work on your devices but can’t be exported to GitHub.</p>
              )}
            </div>
          )}

          <button className="btn primary" onClick={save} disabled={!preview || !!busy}>
            {busy ?? 'Save template'}
          </button>
          <p className="hint">Saved templates apply to every email with the same wording from {BANK_LABELS[source.bank]}, are kept with your settings (and synced via Drive), and can be exported to GitHub from Settings.</p>
        </>
      )}
    </Sheet>
  );
}
