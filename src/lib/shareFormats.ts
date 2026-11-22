/**
 * "Copy formats to share": one anonymised example of each kind of bank email the
 * app couldn't read (or could only guess at), so the user can paste them to whoever
 * maintains the templates. Runs on the device; nothing is sent anywhere by the app.
 */
import { accessToken } from './auth';
import { db } from './db';
import { fetchEmail } from './gmail';
import { normaliseText } from './parsers/common';
import { subjectKey } from './parsers/ignore';
import { BANK_LABELS, type BankId } from './types';

const KEEP = /^(VPA|UPI|IMPS|NEFT|RTGS|HDFC|ICICI|AXIS|HSBC|BANK|CARD|CREDIT|DEBIT|A\/C|ACCOUNT|ACCT|INR|RS\.?|NO\.?|XX\S*|ON|VIA|THE|YOUR|INFO:?|REF\S*|ATM|POS|ECOM|NACH|ACH|SI|AUTO)$/i;

/** Replace anything personal while keeping the wording and the shape of numbers. */
export function redactForShare(raw: string): string {
  let s = normaliseText(raw);
  s = s.replace(/[a-z0-9][a-z0-9._%+-]*@[a-z0-9-]+(?:\.[a-z0-9-]+)*/gi, 'name@bank'); // UPI IDs and emails
  s = s.replace(/\b(Dear|Hi|Hello)\s+[^,\n]{1,40},/gi, '$1 Customer,'); // greetings with names
  // Names after "at / to / by / from / Name:" (upper-case or brand-like tokens), keeping bank words.
  s = s.replace(/\b(at|to|towards|by|from|Name\s*:|Info\s*:|beneficiary|remitter|payee)([ \t]+)((?:[A-Z0-9][\w*&.'/-]*[ \t]?){1,6})/g, (m, kw: string, sp: string, words: string) => {
    // Replace name tokens up to the first bank/keyword token ("Axis Bank …", "on", "via").
    const tokens = words.split(/(?<=\s)/);
    let i = 0;
    // Numbers (times, phone numbers, "72 hours") aren't names: leave them for the digit pass.
    while (i < tokens.length && !KEEP.test(tokens[i].trim()) && /[A-Za-z]/.test(tokens[i])) i++;
    if (i === 0) return m;
    const kept = tokens.slice(i).join('');
    const tail = /\s$/.test(tokens[i - 1]) ? ' ' : '';
    return `${kw}${sp}PAYEE NAME${tail}${kept}`;
  });
  s = s.replace(/\d/g, '0'); // amounts, dates, accounts, references: keep shape, drop values
  return s;
}

export interface FormatSample {
  bank: BankId;
  subject: string;
  count: number;
  text: string;
}

/** Collect one redacted example per bank + subject among not-understood and weakly-read emails. */
export async function collectFormats(onProgress?: (done: number, total: number) => void, max = 30): Promise<FormatSample[]> {
  const token = accessToken();
  if (!token) throw new Error('Connect Gmail first (tap Sync → Connect).');
  const [unparsed, txns] = await Promise.all([db.allUnparsed(), db.allTransactions()]);
  const groups = new Map<string, { bank: BankId; subject: string; ids: string[] }>();
  const add = (bank: BankId | undefined, subject: string | undefined, id: string) => {
    if (!bank || id.startsWith('sample') || id.startsWith('fx')) return;
    const key = `${bank}|${subjectKey(subject ?? '')}`;
    const g = groups.get(key) ?? { bank, subject: subject ?? '', ids: [] };
    g.ids.push(id);
    groups.set(key, g);
  };
  for (const u of unparsed) add(u.bank, u.subject, u.id);
  for (const t of txns) if (t.source === 'gmail' && !t.userEdited && (t.template === 'generic' || t.merchant === 'Unknown')) add(t.bank, t.subject, t.sourceMessageId);

  const list = [...groups.values()].sort((a, b) => b.ids.length - a.ids.length).slice(0, max);
  const out: FormatSample[] = [];
  let done = 0;
  for (const g of list) {
    onProgress?.(done, list.length);
    try {
      const e = await fetchEmail(g.ids[0], token);
      const text = redactForShare(e.body).slice(0, 900);
      out.push({ bank: g.bank, subject: redactForShare(g.subject), count: g.ids.length, text });
    } catch {
      /* skip emails that can't be fetched */
    }
    done++;
  }
  onProgress?.(done, list.length);
  return out;
}

export function formatsAsText(samples: FormatSample[]): string {
  return samples.map((s, i) => `#${i + 1} [${BANK_LABELS[s.bank]}] (${s.count} email${s.count === 1 ? '' : 's'})\nSubject: ${s.subject}\n${s.text}`).join('\n\n---\n\n');
}
