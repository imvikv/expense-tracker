export type BankId = 'HDFC' | 'ICICI' | 'AXIS' | 'HSBC';

export const BANK_LABELS: Record<BankId, string> = {
  HDFC: 'HDFC Bank',
  ICICI: 'ICICI Bank',
  AXIS: 'Axis Bank',
  HSBC: 'HSBC India',
};

export type PaymentMethod =
  | 'Credit Card'
  | 'Debit Card'
  | 'UPI'
  | 'Net Banking'
  | 'Bank Transfer'
  | 'ATM'
  | 'Account'
  | 'Unknown';

export type Direction = 'debit' | 'credit';

/**
 * What a transaction means for spending totals.
 * Only `expense`, `cash` and `fee` count as spending; `refund` reduces it.
 */
export type TxnKind =
  | 'expense'
  | 'income'
  | 'refund'
  | 'transfer'
  | 'cc_payment'
  | 'investment'
  | 'cash'
  | 'fee';

export const KIND_LABELS: Record<TxnKind, string> = {
  expense: 'Spending',
  income: 'Income',
  refund: 'Refund',
  transfer: 'Transfer',
  cc_payment: 'Card bill payment',
  investment: 'Investment',
  cash: 'Cash withdrawal',
  fee: 'Bank charge',
};

export const CATEGORIES = [
  'Groceries',
  'Food Delivery',
  'Restaurants',
  'Shopping',
  'Transport',
  'Fuel',
  'Travel',
  'Utilities',
  'Mobile & Internet',
  'Rent and Housing',
  'Healthcare',
  'Entertainment',
  'Subscriptions',
  'Education',
  'Insurance',
  'Investments',
  'Taxes',
  'Bank Charges',
  'Cash Withdrawals',
  'Transfers',
  'Credit Card Payment',
  'Income',
  'Refunds',
  'Uncategorized',
] as const;

export type Category = (typeof CATEGORIES)[number];

export type Confidence = 'high' | 'medium' | 'low';

export type DuplicateStatus = 'none' | 'suspected' | 'duplicate' | 'not_duplicate';

/** Output of a bank parser, before categorisation and storage. */
export interface ParsedTxn {
  bank: BankId;
  method: PaymentMethod;
  direction: Direction;
  /** Amount in paise (integer) to avoid floating point errors. */
  amountPaise: number;
  /** ISO 8601 local datetime, e.g. 2026-11-21T10:15:00 (time may be 00:00:00 if unknown). */
  date: string;
  /** True when the email included a time of day. */
  hasTime: boolean;
  merchantRaw: string;
  /** Last four digits of the card/account only. */
  accountLast4?: string;
  /** UPI reference / RRN / authorisation code when available. */
  reference?: string;
  /** Hint from the parser about the kind (e.g. ATM, refund, card bill payment). */
  kindHint?: TxnKind;
  confidence: Confidence;
  /** Which template matched, for debugging. */
  template: string;
}

export interface Transaction {
  id: string;
  date: string;
  hasTime: boolean;
  bank: BankId;
  method: PaymentMethod;
  direction: Direction;
  amountPaise: number;
  merchant: string;
  merchantRaw: string;
  kind: TxnKind;
  category: Category;
  accountLast4?: string;
  reference?: string;
  /** Kind suggested by the bank template (refund, card bill payment, ATM, fee). */
  parserKind?: TxnKind;
  source: 'gmail' | 'sample' | 'import';
  sourceMessageId: string;
  confidence: Confidence;
  template: string;
  /** User chose to leave this out of all totals. */
  excluded: boolean;
  /** Category/kind were set by the user — never overwritten by rules. */
  userEdited: boolean;
  duplicateStatus: DuplicateStatus;
  /** For suspected/confirmed duplicates: the id of the transaction it duplicates. */
  duplicateOf?: string;
  /** Free-text note from the user. */
  note?: string;
  createdAt: string;
}

export interface MerchantRule {
  id: string;
  /** Case-insensitive substring or /regex/ matched against the normalised merchant. */
  pattern: string;
  category: Category;
  kind?: TxnKind;
  createdAt: string;
}

/** A bank email that looked like a transaction but could not be parsed. Only headers are kept. */
export interface UnparsedEmail {
  id: string;
  from: string;
  subject: string;
  date: string;
  bank?: BankId;
}

export interface Settings {
  clientId: string;
  /** Names / VPAs / account last-4s that belong to the user, used for transfer detection. */
  ownIdentifiers: string[];
  syncMonths: number;
  lastSyncAt?: string;
  /** Latest email date seen during sync (ISO), used for incremental sync. */
  syncedThrough?: string;
  syncedFrom?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  clientId: '',
  ownIdentifiers: [],
  syncMonths: 12,
};
