import { useMemo, useState } from 'react';
import { accessToken } from '../lib/auth';
import { subjectKey } from '../lib/parsers/ignore';
import { collectFormats, formatsAsText } from '../lib/shareFormats';
import { Card, Sheet } from './components';
import { useStore } from './store';

/** Review card: gather one anonymised example of each email kind the app can't read well. */
export function ShareFormatsCard() {
  const { unparsed, txns, toast, setTask } = useStore();
  const [text, setText] = useState<string | null>(null);

  const kinds = useMemo(() => {
    const keys = new Set<string>();
    for (const u of unparsed) if (u.bank && !u.id.startsWith('sample')) keys.add(`${u.bank}|${subjectKey(u.subject)}`);
    for (const t of txns) if (t.source === 'gmail' && !t.userEdited && (t.template === 'generic' || t.merchant === 'Unknown')) keys.add(`${t.bank}|${subjectKey(t.subject ?? '')}`);
    return keys.size;
  }, [unparsed, txns]);

  if (kinds === 0) return null;

  const run = async () => {
    if (!accessToken()) {
      toast('Tap Sync → Connect first, then try again');
      return;
    }
    setTask({ label: 'Collecting email formats', done: 0, total: kinds });
    try {
      const samples = await collectFormats((done, total) => setTask({ label: 'Collecting email formats', done, total }));
      setText(formatsAsText(samples));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not collect formats');
    } finally {
      setTask(null);
    }
  };

  return (
    <Card title={`Help the app read your bank emails (${kinds} kind${kinds === 1 ? '' : 's'})`}>
      <p className="hint">
        Collects <strong>one example of each kind</strong> of bank email the app can’t read (or shows as Unknown), with names, numbers, UPI IDs and amounts removed, so you can paste them to get proper templates added. Nothing is sent anywhere by the app.
      </p>
      <button className="btn" onClick={run}>
        Copy formats to share
      </button>
      <Sheet open={text !== null} onClose={() => setText(null)} title="Email formats to share">
        <p className="hint">Check that nothing personal is left (names show as PAYEE NAME, digits as 0), then copy and paste it into your chat.</p>
        <pre className="formats">{text}</pre>
        <div className="btn-row">
          <button
            className="btn primary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text ?? '');
                toast('Copied');
              } catch {
                toast('Copy failed — select the text and copy it manually');
              }
            }}
          >
            Copy
          </button>
        </div>
      </Sheet>
    </Card>
  );
}
