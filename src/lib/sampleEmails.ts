/**
 * Synthetic bank alert emails used by unit tests and the "Load sample data" demo.
 * They imitate the structure of real Indian bank alerts but every name, number
 * and reference here is invented.
 */
import type { EmailInput } from './parsers/common';
import type { BankId, Direction, PaymentMethod, TxnKind } from './types';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n: number) => String(n).padStart(2, '0');

export const fmt = {
  dmy: (d: Date) => `${p2(d.getDate())}-${p2(d.getMonth() + 1)}-${d.getFullYear()}`,
  dmy2: (d: Date) => `${p2(d.getDate())}-${p2(d.getMonth() + 1)}-${String(d.getFullYear()).slice(2)}`,
  dMonY: (d: Date) => `${p2(d.getDate())} ${MON[d.getMonth()]}, ${d.getFullYear()}`,
  dMonYNoComma: (d: Date) => `${p2(d.getDate())} ${MON[d.getMonth()]} ${d.getFullYear()}`,
  monDY: (d: Date) => `${MON[d.getMonth()]} ${p2(d.getDate())}, ${d.getFullYear()}`,
  dMonY2: (d: Date) => `${p2(d.getDate())}-${MON[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`,
  compact: (d: Date) => `${p2(d.getDate())}${MON[d.getMonth()].toUpperCase()}${String(d.getFullYear()).slice(2)}`,
  time: (d: Date) => `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`,
  hm: (d: Date) => `${p2(d.getHours())}:${p2(d.getMinutes())}`,
  inr: (paise: number) => (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  plain: (paise: number) => (paise / 100).toFixed(2),
};

export interface Expectation {
  bank: BankId;
  direction: Direction;
  amountPaise: number;
  merchant: string;
  method?: PaymentMethod;
  kind?: TxnKind;
  category?: string;
  last4?: string;
  date: string;
  reference?: string;
}

export interface Fixture {
  name: string;
  email: EmailInput;
  /** `null` means the email must not produce a transaction. */
  expect: Expectation | null;
}

const FOOTER = '\n\nIf you did not authorise this transaction, please call our 24x7 customer care immediately. This is a system-generated email; please do not reply.';

let seq = 0;
function email(from: string, subject: string, body: string, receivedAt: string, id?: string): EmailInput {
  seq++;
  return { id: id ?? `fx${String(seq).padStart(4, '0')}`, from, subject, body: body + FOOTER, receivedAt, authenticated: true };
}

// ---------------------------------------------------------------------------
// Fixtures with known answers (used by tests)
// ---------------------------------------------------------------------------

const H = 'HDFC Bank InstaAlerts <alerts@hdfcbank.net>';
const H2 = 'HDFC Bank <alerts@hdfcbank.bank.in>';
const I_CC = 'ICICI Bank <credit_cards@icicibank.com>';
const I = 'ICICI Bank Alerts <customernotification@icicibank.com>';
const A = 'Axis Bank Alerts <alerts@axisbank.com>';
const A_CC = 'Axis Bank <cc.alerts@axis.bank.in>';
const S = 'HSBC India <hsbc@mail.hsbc.co.in>';

export const FIXTURES: Fixture[] = [
  // ---------------- HDFC ----------------
  {
    name: 'HDFC credit card (new template)',
    email: email(H, 'Alert : Update on your HDFC Bank Credit Card', 'Dear Customer,\n\nRs.850.00 is debited from your HDFC Bank Credit Card ending 4321 towards SWIGGY on 21 Nov, 2026 at 10:15:32.', '2026-11-21T04:46:00Z'),
    expect: { bank: 'HDFC', direction: 'debit', amountPaise: 85000, merchant: 'Swiggy', method: 'Credit Card', kind: 'expense', category: 'Food Delivery', last4: '4321', date: '2026-11-21T10:15:32' },
  },
  {
    name: 'HDFC credit card (older template, Indian digit grouping)',
    email: email(H, 'Alert : Update on your HDFC Bank Credit Card', 'Dear Card Member,\n\nThank you for using your HDFC Bank Credit Card ending 4321 for Rs 2,499.00 at AMAZON PAY INDIA PRIVATE on 18-11-2026 19:42:10. Authorization code:- 004512\n\nAfter the above transaction, the available balance on your card is Rs 1,45,230.00.', '2026-11-18T14:13:00Z'),
    expect: { bank: 'HDFC', direction: 'debit', amountPaise: 249900, merchant: 'Amazon', method: 'Credit Card', kind: 'expense', category: 'Shopping', last4: '4321', date: '2026-11-18T19:42:10', reference: '004512' },
  },
  {
    name: 'HDFC UPI debit',
    email: email(H, 'You have done a UPI txn. Check details!', 'Dear Customer,\n\nRs.340.00 has been debited from account **7788 to VPA zomato.payu@hdfcbank ZOMATO LIMITED on 20-11-26. Your UPI transaction reference number is 632415987001.', '2026-11-20T15:02:00Z'),
    expect: { bank: 'HDFC', direction: 'debit', amountPaise: 34000, merchant: 'Zomato', method: 'UPI', kind: 'expense', category: 'Food Delivery', last4: '7788', date: '2026-11-20T00:00:00', reference: '632415987001' },
  },
  {
    name: 'HDFC UPI credit (money received)',
    email: email(H2, 'You have received money via UPI', 'Dear Customer,\n\nRs. 15000.00 is successfully credited to your account **7788 by VPA rahul.k@okaxis RAHUL KUMAR on 19-11-26. Your UPI transaction reference number is 632398765432.\n\nThank you for banking with us.', '2026-11-19T06:30:00Z'),
    expect: { bank: 'HDFC', direction: 'credit', amountPaise: 1500000, merchant: 'Rahul Kumar', method: 'UPI', kind: 'income', last4: '7788', date: '2026-11-19T00:00:00', reference: '632398765432' },
  },
  {
    name: 'HDFC debit card purchase',
    email: email(H, 'Alert : Update on your HDFC Bank Debit Card', 'Dear Customer,\n\nThank you for using HDFC Bank Debit Card ending 1122 for Rs 1,250.00 at DMART AVENUE SUPERMARTS on 17-11-2026 18:05:44. Authorization code:- 553201', '2026-11-17T12:36:00Z'),
    expect: { bank: 'HDFC', direction: 'debit', amountPaise: 125000, merchant: 'DMart', method: 'Debit Card', kind: 'expense', category: 'Groceries', last4: '1122', date: '2026-11-17T18:05:44' },
  },
  {
    name: 'HDFC ATM withdrawal',
    email: email(H, 'Alert : Cash withdrawal from your account', 'Dear Customer,\n\nRs.5000.00 has been withdrawn from your account **7788 using HDFC Bank Debit Card ending 1122 at ATM S1ANDL23 CONNAUGHT PLACE on 16-11-2026 11:20:05.', '2026-11-16T05:51:00Z'),
    expect: { bank: 'HDFC', direction: 'debit', amountPaise: 500000, merchant: 'Atm S1andl23 Connaught Place', method: 'ATM', kind: 'cash', category: 'Cash Withdrawals', last4: '7788', date: '2026-11-16T11:20:05' },
  },
  {
    name: 'HDFC card bill payment received',
    email: email(H, 'Payment received on your HDFC Bank Credit Card', 'Dear Customer,\n\nPayment of Rs. 32,500.00 has been received towards your HDFC Bank Credit Card ending 4321 on 15-11-2026. Thank you.', '2026-11-15T09:00:00Z'),
    expect: { bank: 'HDFC', direction: 'credit', amountPaise: 3250000, merchant: 'Credit card bill', method: 'Credit Card', kind: 'cc_payment', category: 'Credit Card Payment', last4: '4321', date: '2026-11-15T00:00:00' },
  },
  {
    name: 'HDFC UPI to CRED (card bill paid from bank account)',
    email: email(H, 'You have done a UPI txn. Check details!', 'Dear Customer,\n\nRs.32500.00 has been debited from account **7788 to VPA cred.club@axisb CRED on 15-11-26. Your UPI transaction reference number is 632311119999.', '2026-11-15T08:58:00Z'),
    expect: { bank: 'HDFC', direction: 'debit', amountPaise: 3250000, merchant: 'CRED', method: 'UPI', kind: 'cc_payment', category: 'Credit Card Payment', last4: '7788', date: '2026-11-15T00:00:00', reference: '632311119999' },
  },
  {
    name: 'HDFC card refund',
    email: email(H, 'Refund credited to your HDFC Bank Credit Card', 'Dear Card Member,\n\nA refund of Rs 499.00 from MYNTRA DESIGNS has been credited to your HDFC Bank Credit Card ending 4321 on 12-11-2026.', '2026-11-12T10:00:00Z'),
    expect: { bank: 'HDFC', direction: 'credit', amountPaise: 49900, merchant: 'Myntra', method: 'Credit Card', kind: 'refund', category: 'Shopping', last4: '4321', date: '2026-11-12T00:00:00' },
  },
  {
    name: 'HDFC IMPS transfer to another account',
    email: email(H, 'Alert : Update on your HDFC Bank account', 'Dear Customer,\n\nRs.20000.00 has been debited from account **7788 to account **9012 (IMPS) on 14-11-26. IMPS Ref No. 632311112222.', '2026-11-14T07:00:00Z'),
    expect: { bank: 'HDFC', direction: 'debit', amountPaise: 2000000, merchant: 'Account ••9012', method: 'Bank Transfer', kind: 'transfer', category: 'Transfers', last4: '7788', date: '2026-11-14T00:00:00', reference: '632311112222' },
  },
  // ---------------- ICICI ----------------
  {
    name: 'ICICI credit card',
    email: email(I_CC, 'Transaction alert for your ICICI Bank Credit Card', 'Dear Customer,\n\nYour ICICI Bank Credit Card XX5566 has been used for a transaction of INR 649.00 on Nov 20, 2026 at 21:14:09. Info: NETFLIX.COM. The Available Credit Limit on your card is INR 2,10,450.00 and Total Credit Limit is INR 3,00,000.00.', '2026-11-20T15:44:00Z'),
    expect: { bank: 'ICICI', direction: 'debit', amountPaise: 64900, merchant: 'Netflix', method: 'Credit Card', kind: 'expense', category: 'Subscriptions', last4: '5566', date: '2026-11-20T21:14:09' },
  },
  {
    name: 'ICICI account UPI debit',
    email: email(I, 'Transaction alert for your ICICI Bank Account', 'Dear Customer,\n\nICICI Bank Acct XX908 debited for Rs 1,180.00 on 19-Nov-26; BLINKIT credited. UPI:632455501234. Call 18002662 for dispute. SMS BLOCK 908 to 9215676766.', '2026-11-19T12:00:00Z'),
    expect: { bank: 'ICICI', direction: 'debit', amountPaise: 118000, merchant: 'Blinkit', method: 'UPI', kind: 'expense', category: 'Groceries', last4: '908', date: '2026-11-19T00:00:00', reference: '632455501234' },
  },
  {
    name: 'ICICI salary credit (NEFT)',
    email: email(I, 'Transaction alert for your ICICI Bank Account', 'Dear Customer,\n\nYour ICICI Bank Account XX908 has been credited with INR 1,25,000.00 on 01-Nov-26. Info: NEFT-CITIN26305123456-ACME TECH PVT LTD. The Available Balance is INR 2,34,567.00.', '2026-11-01T05:00:00Z'),
    expect: { bank: 'ICICI', direction: 'credit', amountPaise: 12500000, merchant: 'Acme', method: 'Bank Transfer', kind: 'income', category: 'Income', last4: '908', date: '2026-11-01T00:00:00' },
  },
  {
    name: 'ICICI debit card',
    email: email(I, 'Transaction alert for your ICICI Bank Debit Card', 'Dear Customer,\n\nYour ICICI Bank Debit Card XX3344 has been used for INR 2,340.00 at RELIANCE FRESH on 13-Nov-26 at 17:30:11.', '2026-11-13T12:01:00Z'),
    expect: { bank: 'ICICI', direction: 'debit', amountPaise: 234000, merchant: 'Reliance Fresh', method: 'Debit Card', kind: 'expense', category: 'Groceries', last4: '3344', date: '2026-11-13T17:30:11' },
  },
  {
    name: 'ICICI credit card reversal',
    email: email(I_CC, 'Reversal credited to your ICICI Bank Credit Card', 'Dear Customer,\n\nA reversal of INR 649.00 has been credited to your ICICI Bank Credit Card XX5566 on 10-Nov-26. Info: UBER INDIA.', '2026-11-10T10:00:00Z'),
    expect: { bank: 'ICICI', direction: 'credit', amountPaise: 64900, merchant: 'Uber', method: 'Credit Card', kind: 'refund', category: 'Transport', last4: '5566', date: '2026-11-10T00:00:00' },
  },
  {
    name: 'ICICI card bill payment received',
    email: email(I_CC, 'Payment received - ICICI Bank Credit Card', 'Dear Customer,\n\nPayment of INR 18,000.00 has been received on your ICICI Bank Credit Card Account XX5566 on 05-Nov-26. Thank you.', '2026-11-05T10:00:00Z'),
    expect: { bank: 'ICICI', direction: 'credit', amountPaise: 1800000, merchant: 'Credit card bill', method: 'Credit Card', kind: 'cc_payment', last4: '5566', date: '2026-11-05T00:00:00' },
  },
  // ---------------- Axis ----------------
  {
    name: 'Axis credit card',
    email: email(A_CC, 'Transaction alert on Axis Bank Credit Card no. XX7890', 'Transaction alert on Axis Bank Credit Card no. XX7890\n\nINR 450 spent at UBER INDIA SYSTEMS on 21-11-2026 08:42:19 IST. Available limit: INR 98,550.', '2026-11-21T03:13:00Z'),
    expect: { bank: 'AXIS', direction: 'debit', amountPaise: 45000, merchant: 'Uber', method: 'Credit Card', kind: 'expense', category: 'Transport', last4: '7890', date: '2026-11-21T08:42:19' },
  },
  {
    name: 'Axis account UPI debit (key/value)',
    email: email(A, 'Debit transaction alert for Axis Bank A/c', 'Dear Customer,\n\nAmount Debited: INR 299.00\nAccount Number: XX2468\nDate & Time: 20-11-26, 13:05:47 IST\nTransaction Info: UPI/P2M/632477712345/ZEPTO MARKETPLACE\n\nIf this transaction was not initiated by you, please call us.', '2026-11-20T07:36:00Z'),
    expect: { bank: 'AXIS', direction: 'debit', amountPaise: 29900, merchant: 'Zepto', method: 'UPI', kind: 'expense', category: 'Groceries', last4: '2468', date: '2026-11-20T13:05:47', reference: '632477712345' },
  },
  {
    name: 'Axis account UPI credit (key/value)',
    email: email(A, 'Credit transaction alert for Axis Bank A/c', 'Dear Customer,\n\nAmount Credited: INR 2,000.00\nAccount Number: XX2468\nDate & Time: 18-11-26, 09:10:00 IST\nTransaction Info: UPI/P2A/632466654321/PRIYA S\n\nIf this transaction was not initiated by you, please call us.', '2026-11-18T03:40:00Z'),
    expect: { bank: 'AXIS', direction: 'credit', amountPaise: 200000, merchant: 'Priya S', method: 'UPI', kind: 'income', last4: '2468', date: '2026-11-18T09:10:00' },
  },
  {
    name: 'Axis debit card e-commerce (key/value)',
    email: email(A, 'Debit transaction alert for Axis Bank A/c', 'Dear Customer,\n\nAmount Debited: INR 1,999.00\nAccount Number: XX2468\nDate & Time: 15-11-26, 20:22:10 IST\nTransaction Info: ECOM PUR/BOOKMYSHOW/MUMBAI\n\nIf this transaction was not initiated by you, please call us.', '2026-11-15T14:52:00Z'),
    expect: { bank: 'AXIS', direction: 'debit', amountPaise: 199900, merchant: 'BookMyShow', method: 'Debit Card', kind: 'expense', category: 'Entertainment', last4: '2468', date: '2026-11-15T20:22:10' },
  },
  {
    name: 'Axis bank fee',
    email: email(A, 'Debit transaction alert for Axis Bank A/c', 'Dear Customer,\n\nAmount Debited: INR 590.00\nAccount Number: XX2468\nDate & Time: 01-11-26, 00:05:00 IST\nTransaction Info: DEBIT CARD ANNUAL FEE INCL GST\n\nIf this transaction was not initiated by you, please call us.', '2026-10-31T18:35:00Z'),
    expect: { bank: 'AXIS', direction: 'debit', amountPaise: 59000, merchant: 'Debit Card Annual Fee Incl Gst', kind: 'fee', category: 'Bank Charges', last4: '2468', date: '2026-11-01T00:05:00' },
  },
  // ---------------- HSBC ----------------
  {
    name: 'HSBC credit card',
    email: email(S, 'HSBC Credit Card transaction alert', 'Dear Customer,\n\nYour HSBC Credit Card ending with 1357 has been used for INR 3,200.00 at TATA CLIQ on 19 Nov 2026 at 15:40. If you have not done this transaction, please call PhoneBanking.', '2026-11-19T10:11:00Z'),
    expect: { bank: 'HSBC', direction: 'debit', amountPaise: 320000, merchant: 'Tata CLiQ', method: 'Credit Card', kind: 'expense', category: 'Shopping', last4: '1357', date: '2026-11-19T15:40:00' },
  },
  {
    name: 'HSBC account debit to broker (investment)',
    email: email(S, 'HSBC account debit alert', 'Dear Customer,\n\nYour account XXXXXX4680 is debited for INR 12,000.00 on 10NOV26 towards ZERODHA BROKING LTD via NEFT. Avl Bal INR 85,000.00.', '2026-11-10T06:00:00Z'),
    expect: { bank: 'HSBC', direction: 'debit', amountPaise: 1200000, merchant: 'Zerodha', method: 'Bank Transfer', kind: 'investment', category: 'Investments', last4: '4680', date: '2026-11-10T00:00:00' },
  },
  {
    name: 'HSBC account credit via UPI',
    email: email(S, 'HSBC account credit alert', 'Dear Customer,\n\nYour account XXXXXX4680 is credited with INR 500.00 on 08NOV26 by UPI from AMIT V. UPI Ref 632400011122.', '2026-11-08T06:00:00Z'),
    expect: { bank: 'HSBC', direction: 'credit', amountPaise: 50000, merchant: 'Amit V', method: 'UPI', kind: 'income', last4: '4680', date: '2026-11-08T00:00:00', reference: '632400011122' },
  },
  {
    name: 'HSBC UPI debit',
    email: email(S, 'HSBC account debit alert', 'Dear Customer,\n\nINR 899.00 has been debited from your account XXXXXX4680 on 07NOV26 for UPI payment to AIRTEL PAYMENTS. UPI Ref 632398877665.', '2026-11-07T06:00:00Z'),
    expect: { bank: 'HSBC', direction: 'debit', amountPaise: 89900, merchant: 'Airtel', method: 'UPI', kind: 'expense', category: 'Mobile & Internet', last4: '4680', date: '2026-11-07T00:00:00', reference: '632398877665' },
  },
  {
    name: 'HSBC card bill payment received',
    email: email(S, 'Payment received', 'Dear Customer,\n\nWe have received payment of INR 3,200.00 towards your HSBC Credit Card ending with 1357 on 12NOV26.', '2026-11-12T06:00:00Z'),
    expect: { bank: 'HSBC', direction: 'credit', amountPaise: 320000, merchant: 'Credit card bill', method: 'Credit Card', kind: 'cc_payment', last4: '1357', date: '2026-11-12T00:00:00' },
  },
  // ---------------- Emails that must be ignored ----------------
  {
    name: 'OTP email',
    email: email(H, 'OTP for transaction', 'Dear Customer,\n\n482913 is your OTP for a transaction of Rs. 4,999.00 at FLIPKART on your HDFC Bank Credit Card ending 4321. Do not share it with anyone.', '2026-11-20T10:00:00Z'),
    expect: null,
  },
  {
    name: 'Declined transaction',
    email: email(A_CC, 'Transaction declined', 'Your transaction of INR 12,000 at CROMA on Axis Bank Credit Card no. XX7890 was declined due to incorrect PIN.', '2026-11-20T10:00:00Z'),
    expect: null,
  },
  {
    name: 'Phishing email from a look-alike domain',
    email: email('HDFC Bank <alerts@hdfcbank-secure.com>', 'Alert : Update on your HDFC Bank Credit Card', 'Rs.85,000.00 is debited from your HDFC Bank Credit Card ending 4321 towards GIFT CARDS on 21 Nov, 2026 at 10:15:32. Click here to dispute.', '2026-11-21T04:46:00Z'),
    expect: null,
  },
  {
    name: 'Promotional email',
    email: email(I_CC, 'Exclusive offer: pre-approved personal loan', 'Dear Customer, you are eligible for a pre-approved personal loan of up to Rs 5,00,000 at attractive rates.', '2026-11-20T10:00:00Z'),
    expect: null,
  },
];

// ---------------------------------------------------------------------------
// Year of synthetic history for the demo
// ---------------------------------------------------------------------------

type Gen = (d: Date, paise: number, id: string) => EmailInput;

function at(d: Date, h: number, m: number): Date {
  const x = new Date(d);
  x.setHours(h, m, (h * 7 + m) % 60, 0);
  return x;
}

const gens: Record<string, (merchant: string) => Gen> = {
  hdfcCC: (merchant) => (d, paise, id) =>
    email(H, 'Alert : Update on your HDFC Bank Credit Card', `Dear Customer,\n\nRs.${fmt.plain(paise)} is debited from your HDFC Bank Credit Card ending 4321 towards ${merchant} on ${fmt.dMonY(d)} at ${fmt.time(d)}.`, d.toISOString(), id),
  hdfcUPI: (merchant) => (d, paise, id) =>
    email(H, 'You have done a UPI txn. Check details!', `Dear Customer,\n\nRs.${fmt.plain(paise)} has been debited from account **7788 to VPA ${merchant.toLowerCase().replace(/\s+/g, '')}@ybl ${merchant} on ${fmt.dmy2(d)}. Your UPI transaction reference number is ${id.replace(/\D/g, '').padStart(12, '6').slice(-12)}.`, d.toISOString(), id),
  iciciCC: (merchant) => (d, paise, id) =>
    email(I_CC, 'Transaction alert for your ICICI Bank Credit Card', `Dear Customer,\n\nYour ICICI Bank Credit Card XX5566 has been used for a transaction of INR ${fmt.inr(paise)} on ${fmt.monDY(d)} at ${fmt.time(d)}. Info: ${merchant}. The Available Credit Limit on your card is INR 2,10,450.00.`, d.toISOString(), id),
  axisUPI: (merchant) => (d, paise, id) =>
    email(A, 'Debit transaction alert for Axis Bank A/c', `Dear Customer,\n\nAmount Debited: INR ${fmt.inr(paise)}\nAccount Number: XX2468\nDate & Time: ${fmt.dmy2(d)}, ${fmt.time(d)} IST\nTransaction Info: UPI/P2M/${id.replace(/\D/g, '').padStart(12, '7').slice(-12)}/${merchant}\n\nIf this transaction was not initiated by you, please call us.`, d.toISOString(), id),
  hdfcP2P: (who) => (d, paise, id) =>
    email(H, 'You have done a UPI txn. Check details!', `Dear Customer,\n\nRs.${fmt.plain(paise)} has been debited from account **7788 to VPA ${who.split(' ')[0].toLowerCase()}.${who.split(' ')[1]?.toLowerCase() ?? 'x'}@oksbi ${who} on ${fmt.dmy2(d)}. Your UPI transaction reference number is ${id.replace(/\D/g, '').padStart(12, '5').slice(-12)}.`, d.toISOString(), id),
  axisP2A: (who) => (d, paise, id) =>
    email(A, 'Debit transaction alert for Axis Bank A/c', `Dear Customer,\n\nAmount Debited: INR ${fmt.inr(paise)}\nAccount Number: XX2468\nDate & Time: ${fmt.dmy2(d)}, ${fmt.time(d)} IST\nTransaction Info: UPI/P2A/${id.replace(/\D/g, '').padStart(12, '8').slice(-12)}/${who}\n\nIf this transaction was not initiated by you, please call us.`, d.toISOString(), id),
  axisCC: (merchant) => (d, paise, id) =>
    email(A_CC, 'Transaction alert on Axis Bank Credit Card no. XX7890', `Transaction alert on Axis Bank Credit Card no. XX7890\n\nINR ${fmt.inr(paise)} spent at ${merchant} on ${fmt.dmy(d)} ${fmt.time(d)} IST. Available limit: INR 98,550.`, d.toISOString(), id),
  hsbcCC: (merchant) => (d, paise, id) =>
    email(S, 'HSBC Credit Card transaction alert', `Dear Customer,\n\nYour HSBC Credit Card ending with 1357 has been used for INR ${fmt.inr(paise)} at ${merchant} on ${fmt.dMonYNoComma(d)} at ${fmt.hm(d)}.`, d.toISOString(), id),
};

interface Pattern {
  gen: Gen;
  /** Days of month (1-28) the charge happens; or a count of random days. */
  days: number[] | number;
  base: number; // rupees
  jitter: number; // fraction
  hour: number;
}

/** Deterministic pseudo-random generator so the demo looks the same every time. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Generate about a year of synthetic alert emails ending at `now`. */
export function generateSampleEmails(now: Date, months = 12): EmailInput[] {
  const r = rng(42);
  const patterns: Pattern[] = [
    { gen: gens.hdfcCC('SWIGGY'), days: 6, base: 420, jitter: 0.5, hour: 20 },
    { gen: gens.hdfcUPI('ZOMATO'), days: 3, base: 380, jitter: 0.5, hour: 21 },
    { gen: gens.axisUPI('BLINKIT'), days: 4, base: 650, jitter: 0.6, hour: 18 },
    { gen: gens.axisUPI('ZEPTO MARKETPLACE'), days: 3, base: 480, jitter: 0.5, hour: 19 },
    { gen: gens.axisCC('UBER INDIA SYSTEMS'), days: 5, base: 310, jitter: 0.6, hour: 9 },
    { gen: gens.iciciCC('NETFLIX.COM'), days: [5], base: 649, jitter: 0, hour: 6 },
    { gen: gens.iciciCC('SPOTIFY INDIA'), days: [11], base: 119, jitter: 0, hour: 7 },
    { gen: gens.hsbcCC('AIRTEL PAYMENTS'), days: [8], base: 999, jitter: 0, hour: 10 },
    { gen: gens.hdfcCC('AMAZON PAY INDIA'), days: 2, base: 1800, jitter: 0.8, hour: 22 },
    { gen: gens.hsbcCC('MYNTRA DESIGNS'), days: 1, base: 2200, jitter: 0.6, hour: 13 },
    { gen: gens.hdfcUPI('BSES RAJDHANI'), days: [14], base: 2600, jitter: 0.35, hour: 11 },
    { gen: gens.iciciCC('INDIAN OIL'), days: 2, base: 2500, jitter: 0.2, hour: 8 },
    { gen: gens.hdfcUPI('DMART'), days: 2, base: 2100, jitter: 0.4, hour: 17 },
    { gen: gens.axisCC('STARBUCKS'), days: 2, base: 520, jitter: 0.3, hour: 16 },
    { gen: gens.hdfcCC('APOLLO PHARMACY'), days: 1, base: 900, jitter: 0.7, hour: 12 },
    // Payments to people: these are what the "Identify payees" review is for.
    { gen: gens.hdfcP2P('SUNITA DEVI'), days: [2], base: 6000, jitter: 0, hour: 9 },
    { gen: gens.axisP2A('RAMESH KUMAR'), days: 4, base: 320, jitter: 0.5, hour: 8 },
    { gen: gens.hdfcP2P('MOHAN LAL'), days: 1, base: 1500, jitter: 0.6, hour: 18 },
    { gen: gens.axisUPI('SHARMA GENERAL STORE'), days: 2, base: 450, jitter: 0.5, hour: 19 },
  ];
  const out: EmailInput[] = [];
  let n = 0;
  for (let mi = months - 1; mi >= 0; mi--) {
    const first = new Date(now.getFullYear(), now.getMonth() - mi, 1);
    const lastDay = mi === 0 ? now.getDate() : new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    for (const p of patterns) {
      const days = Array.isArray(p.days) ? p.days : Array.from({ length: p.days }, () => 1 + Math.floor(r() * 28));
      for (const day of days) {
        if (day > lastDay) continue;
        const d = at(new Date(first.getFullYear(), first.getMonth(), day), p.hour, Math.floor(r() * 60));
        const rupees = Math.max(50, Math.round(p.base * (1 + (r() * 2 - 1) * p.jitter)));
        out.push(p.gen(d, rupees * 100, `sample${String(++n).padStart(5, '0')}`));
      }
    }
    // Salary, rent, card bill payments and an occasional big purchase.
    const d1 = at(new Date(first.getFullYear(), first.getMonth(), 1), 9, 0);
    out.push(email(I, 'Transaction alert for your ICICI Bank Account', `Dear Customer,\n\nYour ICICI Bank Account XX908 has been credited with INR 1,25,000.00 on ${fmt.dMonY2(d1)}. Info: NEFT-CITIN26305${String(n).padStart(6, '0')}-ACME TECH PVT LTD.`, d1.toISOString(), `sample${String(++n).padStart(5, '0')}`));
    if (lastDay >= 3) {
      const d3 = at(new Date(first.getFullYear(), first.getMonth(), 3), 10, 15);
      out.push(gens.hdfcUPI('NOBROKER RENT')(d3, 28000_00, `sample${String(++n).padStart(5, '0')}`));
    }
    if (lastDay >= 15) {
      const d15 = at(new Date(first.getFullYear(), first.getMonth(), 15), 9, 30);
      const bill = Math.round((15000 + r() * 12000) * 100);
      out.push(email(H, 'You have done a UPI txn. Check details!', `Dear Customer,\n\nRs.${fmt.plain(bill)} has been debited from account **7788 to VPA cred.club@axisb CRED on ${fmt.dmy2(d15)}. Your UPI transaction reference number is 6323${String(n).padStart(8, '0')}.`, d15.toISOString(), `sample${String(++n).padStart(5, '0')}`));
      out.push(email(H, 'Payment received on your HDFC Bank Credit Card', `Dear Customer,\n\nPayment of Rs. ${fmt.inr(bill)} has been received towards your HDFC Bank Credit Card ending 4321 on ${fmt.dmy(d15)}. Thank you.`, d15.toISOString(), `sample${String(++n).padStart(5, '0')}`));
    }
    if (lastDay >= 20 && mi % 4 === 1) {
      const d20 = at(new Date(first.getFullYear(), first.getMonth(), 20), 15, 5);
      out.push(gens.hdfcCC('CROMA INFINITI RETAIL')(d20, Math.round((18000 + r() * 30000)) * 100, `sample${String(++n).padStart(5, '0')}`));
    }
    if (lastDay >= 10) {
      const d10 = at(new Date(first.getFullYear(), first.getMonth(), 10), 11, 0);
      out.push(email(S, 'HSBC account debit alert', `Dear Customer,\n\nYour account XXXXXX4680 is debited for INR 10,000.00 on ${fmt.compact(d10)} towards ZERODHA BROKING LTD via NEFT. Avl Bal INR 85,000.00.`, d10.toISOString(), `sample${String(++n).padStart(5, '0')}`));
    }
  }
  // A duplicate alert: the same Axis card swipe reported twice by two sender addresses.
  const dup = out.find((e) => e.from === A_CC);
  if (dup) out.push({ ...dup, id: `sample${String(++n).padStart(5, '0')}`, from: 'Axis Bank <alerts@axisbank.com>' });
  return out;
}
