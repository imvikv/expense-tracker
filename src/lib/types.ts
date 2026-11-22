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

export type PayeeType = 'merchant' | 'person' | 'own' | 'unknown';

/** Who the money went to (or came from), as far as the email tells us. */
export interface PayeeInfo {
  /** Counterparty name as the bank wrote it (e.g. "RAHUL KUMAR", "ZOMATO LIMITED"). */
  payee?: string;
  /** UPI ID of the counterparty, e.g. zomato.payu@hdfcbank. */
  payeeVpa?: string;
  /** Last 4 digits of the counterparty's bank account (NEFT/IMPS). */
  payeeAccount?: string;
  /** P2A/P2M hint from the bank narration, when present. */
  payeeTypeHint?: PayeeType;
  /** The bank's own description of the transaction, long numbers masked. */
  narration?: string;
  /** City/location when the bank includes one (card and ATM alerts). */
  location?: string;
}

/** Output of a bank parser, before categorisation and storage. */
export interface ParsedTxn extends PayeeInfo {
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

/** Bump when parsers start extracting new fields; older Gmail transactions are re-read on the next sync. */
export const DETAIL_VERSION = 2;

/**
 * Bump whenever bank templates are added or improved. Transactions that only the
 * low-confidence generic reader understood are re-read once per bump.
 */
export const PARSER_BUILD = 4;

export interface Transaction extends PayeeInfo {
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
  /** Person / merchant / own account, decided by classification or by the user. */
  payeeType?: PayeeType;
  /** Email subject line (truncated), to help recognise the transaction. */
  subject?: string;
  /** Which parser generation produced the payee details (see DETAIL_VERSION). */
  detailVersion?: number;
  /** Template set used when this was parsed (see PARSER_BUILD). */
  parserBuild?: number;
  /** When the user last changed this transaction by hand (category, note, exclude, duplicate decision). */
  editedAt?: string;
  createdAt: string;
}

export interface MerchantRule {
  id: string;
  /**
   * Case-insensitive substring or /regex/ matched against the merchant name,
   * the payee name as written, and the payee's UPI ID.
   */
  pattern: string;
  /** Category to apply; omitted when the rule only renames a payee. */
  category?: Category;
  kind?: TxnKind;
  /** Friendly name to show instead of the bank's text, e.g. "Rahul (driver)". */
  label?: string;
  /** Mark the payee as a person, merchant or your own account. */
  payeeType?: PayeeType;
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
  /**
   * Last-4 digits of credit cards whose bill payments should count as spending
   * (for cards you don't get purchase alerts for — otherwise spending is double-counted).
   */
  billSpendCards?: string[];
  syncMonths: number;
  /** When ownIdentifiers / billSpendCards / syncMonths last changed (for cross-device merge). */
  settingsAt?: string;
  /** Back up preferences to the app's hidden folder in Google Drive (default on). */
  prefsSync?: boolean;
  prefsSyncedAt?: string;
  lastSyncAt?: string;
  /** Latest email date seen during sync (ISO), used for incremental sync. */
  syncedThrough?: string;
  syncedFrom?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  clientId: '',
  ownIdentifiers: [],
  billSpendCards: [],
  syncMonths: 12,
};
