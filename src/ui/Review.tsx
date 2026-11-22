import { useMemo, useState } from 'react';
import { isCounted } from '../lib/analytics';
import { gmailLink } from '../lib/gmail';
import { BANK_LABELS, type Transaction } from '../lib/types';
import { Card, Empty } from './components';
import { formatDate, formatINR } from './format';
import { isUnclear, payeeGroups } from '../lib/insights';
import { PayeeSheet, PayeeTag } from './Payee';
import { CardBills } from './CardBills';
import { TeachSheet, type TeachSource } from './Teach';
import { ShareFormatsCard } from './ShareFormats';
import { cardBillSummary } from '../lib/categorize';
import type { TxnFilter } from './Transactions';
import { useStore } from './store';
import { TxnRow } from './Transactions';
import { TxnSheet } from './TxnSheet';

export function Review({ go }: { go: (tab: 'txns', f: TxnFilter) => void }) {
  const { txns, unparsed, dismissUnparsed, settings, ignoreLike, toast } = useStore();
  const [open, setOpen] = useState<Transaction | null>(null);

  const sections = useMemo(() => {
    const suspected = txns.filter((t) => t.duplicateStatus === 'suspected');
    const low = txns.filter((t) => t.confidence === 'low' && !t.userEdited && t.duplicateStatus !== 'duplicate');
    const transfers = txns.filter((t) => t.kind === 'transfer' && t.confidence === 'medium' && !t.userEdited && isCounted(t));
    return [
      { key: 'dup', title: 'Possible duplicates', hint: 'Same amount on the same card/merchant within minutes. Still counted until you decide.', items: suspected },
      { key: 'low', title: 'Low confidence', hint: 'Parsed with the generic reader or from an unverified sender. Check the amount and merchant.', items: low },
      { key: 'xfer', title: 'Bank transfers to check', hint: 'NEFT/IMPS to accounts we don’t recognise are treated as transfers (not spending). Mark rent or payments as Spending.', items: transfers },
    ];
  }, [txns]);

  const unclear = useMemo(() => payeeGroups(txns, isUnclear), [txns]);
  const unclearTotal = unclear.reduce((s, g) => s + g.spendPaise, 0);
  const [payee, setPayee] = useState<string | null>(null);
  const [teach, setTeach] = useState<TeachSource | null>(null);
  const [showAll, setShowAll] = useState(false);

  const hasBillSuggestion = useMemo(() => cardBillSummary(txns, settings).some((c) => c.purchases === 0 && !c.countsAsSpending), [txns, settings]);
  const current = open ? txns.find((t) => t.id === open.id) ?? open : null;
  const nothing = sections.every((s) => s.items.length === 0) && unparsed.length === 0 && unclear.length === 0;

  return (
    <div className="page">
      {nothing && !hasBillSuggestion && <Empty>All clear — nothing needs review.</Empty>}
      {hasBillSuggestion && (
        <Card title="Card bills without purchase alerts">
          <p className="hint">
            Bills for these cards were paid, but no purchases on them were found. Bill payments are ignored because purchases are normally counted individually — so this card's spending may be missing. Check that you get transaction alert emails for it; if you can't, switch it on to count the bill instead.
          </p>
          <CardBills suggestOnly />
        </Card>
      )}
      {unclear.length > 0 && (
        <Card title={`Identify who you paid (${unclear.length})`}>
          <p className="hint">
            {formatINR(unclearTotal)} of spending has no category yet. Name each payee once — by UPI ID where the bank gives one — and every past and future payment to them is sorted.
          </p>
          <ul className="rows">
            {(showAll ? unclear : unclear.slice(0, 15)).map((g) => (
              <li key={g.key}>
                <button className="row" onClick={() => setPayee(g.key)}>
                  <span className="row-main">
                    <strong>
                      {g.name} <PayeeTag type={g.type} />
                    </strong>
                    <small>{[g.raw, g.vpa ?? (g.account ? `A/c ••${g.account}` : undefined)].filter(Boolean).join(' · ') || g.txns[0].narration?.slice(0, 70)}</small>
                    <small>
                      {g.count} payment{g.count === 1 ? '' : 's'} · last {formatDate(g.lastDate)}
                    </small>
                  </span>
                  <span className="row-amt">{formatINR(g.spendPaise)}</span>
                </button>
              </li>
            ))}
          </ul>
          {unclear.length > 15 && !showAll && (
            <button className="link" onClick={() => setShowAll(true)}>
              Show all {unclear.length}
            </button>
          )}
        </Card>
      )}
      {sections
        .filter((s) => s.items.length > 0)
        .map((s) => (
          <Card key={s.key} title={`${s.title} (${s.items.length})`}>
            <p className="hint">{s.hint}</p>
            <div className="flush-list">
              {s.items.slice(0, 50).map((t) => (
                <TxnRow key={t.id} t={t} onOpen={setOpen} />
              ))}
            </div>
            {s.items.length > 50 && <p className="hint">Showing 50 of {s.items.length}.</p>}
          </Card>
        ))}
      <ShareFormatsCard />
      {unparsed.length > 0 && (
        <Card title={`Bank emails not understood (${unparsed.length})`}>
          <p className="hint">These came from a bank address and mention a transaction, but no template matched, so nothing was recorded. Tap <strong>Teach</strong> to show the app where the amount and payee are; every email with the same wording is then read. Statements, notices and reminders: <strong>Ignore all like this</strong> skips every email from that bank with the same kind of subject (numbers and dates can differ); <strong>Dismiss</strong> hides just one.</p>
          <ul className="rows">
            {unparsed.slice(0, 50).map((u) => (
              <li key={u.id} className="row static">
                <span className="row-main">
                  <strong>{u.subject || '(no subject)'}</strong>
                  <small>
                    {u.bank ? BANK_LABELS[u.bank] : u.from} · {formatDate(u.date, { year: true })}
                  </small>
                </span>
                <span className="row-actions">
                  {!u.id.startsWith('sample') && !u.id.startsWith('fx') && (
                    <a className="link" href={gmailLink(u.id)} target="_blank" rel="noopener noreferrer">
                      Open
                    </a>
                  )}
                  {u.bank && !u.id.startsWith('sample') && !u.id.startsWith('fx') && (
                    <button className="link" onClick={() => setTeach({ kind: 'email', id: u.id, bank: u.bank!, subject: u.subject })}>
                      Teach
                    </button>
                  )}
                  <button className="link" onClick={() => dismissUnparsed(u.id)}>
                    Dismiss
                  </button>
                  {u.bank && u.subject.trim() && (
                    <button
                      className="link"
                      onClick={async () => {
                        const n = await ignoreLike(u.bank!, u.subject);
                        toast(`Ignoring “${u.subject.slice(0, 40)}” emails from ${BANK_LABELS[u.bank!]} · ${n} cleared`);
                      }}
                    >
                      Ignore all like this
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <TxnSheet
        txn={current}
        onClose={() => setOpen(null)}
        onShowPayee={(k) => {
          setOpen(null);
          setPayee(k);
        }}
      />
      <TeachSheet source={teach} onClose={() => setTeach(null)} />
      <PayeeSheet
        payee={payee}
        onClose={() => setPayee(null)}
        onShowAll={(k) => {
          setPayee(null);
          go('txns', { payee: k });
        }}
      />
    </div>
  );
}
