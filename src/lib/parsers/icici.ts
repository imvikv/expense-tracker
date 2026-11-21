import { genericParse, rx, runTemplates, type BankParser, type Template } from './common';

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

export const iciciParser: BankParser = {
  bank: 'ICICI',
  parse(email) {
    const hit = runTemplates('ICICI', T, email.body, email.receivedAt);
    if (hit) return [hit];
    const g = genericParse('ICICI', email.body, email.receivedAt);
    return g ? [g] : [];
  },
};
