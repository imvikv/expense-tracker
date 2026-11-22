import { last4, make, rx, runTemplates, toPaise, type BankParser, type Template } from './common';
import type { ParsedTxn } from '../types';

const INFO_END = String.raw`(?:\.\s|\.$|\n|$)`;

const T: Template[] = [
  {
    name: 'icici.cc.used',
    re: rx(String.raw`ICICI Bank Credit Card (?:XX|ending )?(\d{4}) has been used for a transaction of {AMT} on [\s\S]{0,40}?Info:\s*(.+?)${INFO_END}`),
    direction: 'debit',
    method: 'Credit Card',
    amount: 2,
    account: 1,
    merchant: 3,
  },
  {
    name: 'icici.card.refund',
    re: rx(String.raw`(?:reversal|refund) of {AMT} has been credited to your ICICI Bank (?:Credit|Debit) Card (?:XX|ending )?(\d{4})[\s\S]*?(?:Info:\s*(.+?)${INFO_END}|$)`),
    direction: 'credit',
    kindHint: 'refund',
    amount: 1,
    account: 2,
    merchant: 3,
    merchantConst: 'Card refund',
  },
  {
    // "We have received payment of Rs 8376.5 for your ICICI Bank Credit Card Account XX 6252 by NEFT on ..."
    name: 'icici.cc.payment.received',
    re: rx(String.raw`received (?:your )?payment of {AMT} (?:for|towards|on) your ICICI Bank Credit Card(?: Account)? (?:XX|ending )?\s*(\d{4})`),
    direction: 'credit',
    method: 'Credit Card',
    kindHint: 'cc_payment',
    amount: 1,
    account: 2,
    merchantConst: 'ICICI Credit Card bill payment',
  },
  {
    name: 'icici.cc.payment',
    re: rx(String.raw`payment of {AMT} has been received (?:on|towards|for) your ICICI Bank Credit Card(?: Account)? (?:XX|ending )?(\d{4})`),
    direction: 'credit',
    method: 'Credit Card',
    kindHint: 'cc_payment',
    amount: 1,
    account: 2,
    merchantConst: 'ICICI Credit Card bill payment',
  },
  {
    name: 'icici.dc.used',
    re: rx(String.raw`ICICI Bank Debit Card (?:XX|ending )?(\d{4}) has been used for {AMT} at (.+?) on \d`),
    direction: 'debit',
    method: 'Debit Card',
    amount: 2,
    account: 1,
    merchant: 3,
  },
  {
    name: 'icici.acct.debit',
    re: rx(String.raw`ICICI Bank Acc(?:oun)?t XX(\d{3,4}) (?:is |has been )?debited (?:for|with) {AMT} on [^;]+; (.+?) credited`),
    direction: 'debit',
    amount: 2,
    account: 1,
    merchant: 3,
  },
  {
    name: 'icici.acct.debit.info',
    re: rx(String.raw`ICICI Bank Acc(?:oun)?t XX(\d{3,4}) (?:is |has been )?debited (?:for|with) {AMT} on [\s\S]{0,30}?Info:\s*(.+?)${INFO_END}`),
    direction: 'debit',
    amount: 2,
    account: 1,
    merchant: 3,
  },
  {
    name: 'icici.acct.credit',
    re: rx(String.raw`ICICI Bank Acc(?:oun)?t XX(\d{3,4}) (?:is |has been )?credited with {AMT} on [\s\S]{0,30}?(?:Info:\s*(.+?)${INFO_END}|; (.+?) debited)`),
    direction: 'credit',
    amount: 2,
    account: 1,
    merchant: [3, 4],
  },
];

/**
 * Card bill paid by auto-debit (standing instruction) from a bank account:
 * "We have received payment of Rs 8376.5 for your ICICI Bank Credit Card Account XX 6252
 *  by Auto Debit from your bank Account XX8510 on October 30,2026."
 * From your side this is money leaving account ••8510, so it is recorded as a debit of that
 * account with the card as the payee.
 */
const AUTO_DEBIT = rx(
  String.raw`received (?:your )?payment of {AMT} (?:for|towards|on) your ICICI Bank Credit Card(?: Account)? (?:XX|ending )?\s*(\d{4}) by (Auto\s?-?Debit|Standing Instruction|E-?mandate|NACH|Auto\s?Pay)[\s\S]{0,40}?from your (?:bank )?(?:Account|A/c) (?:no\.? )?[X*]*\s*(\d{3,6})`,
);

function parseAutoDebit(body: string, receivedAt: string): ParsedTxn | null {
  const m = AUTO_DEBIT.exec(body);
  if (!m) return null;
  const amountPaise = toPaise(m[1]);
  if (!amountPaise) return null;
  const card = last4(m[2]);
  const t = make('ICICI', 'icici.cc.autodebit', {
    text: body,
    direction: 'debit',
    amountPaise,
    merchantRaw: `ICICI Credit Card ••${card} bill (auto debit)`,
    hasPayee: false,
    method: 'Account',
    accountLast4: last4(m[4]),
    kindHint: 'cc_payment',
    receivedAt,
    at: m.index,
    atEnd: m.index + m[0].length,
  });
  return { ...t, payee: `ICICI Credit Card ••${card}`, payeeAccount: card, payeeTypeHint: 'own' };
}

export const iciciParser: BankParser = {
  bank: 'ICICI',
  parse(email) {
    const hit = parseAutoDebit(email.body, email.receivedAt) ?? runTemplates('ICICI', T, email.body, email.receivedAt);
    if (hit) return [hit];
    return [];
  },
};
