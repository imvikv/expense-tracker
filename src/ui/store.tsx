import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { db } from '../lib/db';
import { reapplyRules } from '../lib/categorize';
import { schedulePrefsSync } from '../lib/prefsSync';
import { DEFAULT_SETTINGS, type MerchantRule, type Settings, type Transaction, type UnparsedEmail } from '../lib/types';

export interface Store {
  ready: boolean;
  error: string | null;
  txns: Transaction[];
  rules: MerchantRule[];
  settings: Settings;
  unparsed: UnparsedEmail[];
  reload(): Promise<void>;
  updateTxns(t: Transaction[]): Promise<void>;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  /** Add a rule and apply it to past transactions. Returns how many changed. */
  addRule(rule: MerchantRule): Promise<number>;
  deleteRule(id: string): Promise<void>;
  dismissUnparsed(id: string): Promise<void>;
  /** Choose which cards' bill payments count as spending, and re-classify stored bills. */
  setBillSpendCards(cards: string[]): Promise<number>;
  toast(msg: string): void;
  toastMsg: string | null;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [rules, setRules] = useState<MerchantRule[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [unparsed, setUnparsed] = useState<UnparsedEmail[]>([]);
  const [toastMsg, setToast] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [t, r, s, u] = await Promise.all([db.allTransactions(), db.allRules(), db.settings(), db.allUnparsed()]);
      t.sort((a, b) => b.date.localeCompare(a.date));
      setTxns(t);
      setRules(r);
      const envId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '';
      setSettings({ ...s, clientId: s.clientId || envId });
      setUnparsed(u.sort((a, b) => b.date.localeCompare(a.date)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const toast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((m) => (m === msg ? null : m)), 3200);
  }, []);

  const updateTxns = useCallback(
    async (changed: Transaction[]) => {
      await db.putTransactions(changed);
      const byId = new Map(changed.map((t) => [t.id, t]));
      setTxns((prev) => prev.map((t) => byId.get(t.id) ?? t));
      if (changed.some((t) => t.editedAt)) schedulePrefsSync(() => void reload());
    },
    [reload],
  );

  const saveSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const syncable = 'ownIdentifiers' in patch || 'billSpendCards' in patch || 'syncMonths' in patch;
      if (syncable) patch = { ...patch, settingsAt: new Date().toISOString() };
      const next = { ...(await db.settings()), ...patch };
      await db.saveSettings(next);
      setSettings((cur) => ({ ...cur, ...patch }));
      if (syncable) schedulePrefsSync(() => void reload());
    },
    [reload],
  );

  const addRule = useCallback(
    async (rule: MerchantRule) => {
      await db.putRule(rule);
      const all = [...(await db.allRules())];
      setRules(all);
      const changed = reapplyRules(await db.allTransactions(), all, settings);
      await updateTxns(changed);
      schedulePrefsSync(() => void reload());
      return changed.length;
    },
    [settings, updateTxns, reload],
  );

  const deleteRule = useCallback(
    async (id: string) => {
      await db.deleteRule(id);
      const all = await db.allRules();
      setRules(all);
      const changed = reapplyRules(await db.allTransactions(), all, settings);
      await updateTxns(changed);
      schedulePrefsSync(() => void reload());
    },
    [settings, updateTxns, reload],
  );

  const setBillSpendCards = useCallback(
    async (cards: string[]) => {
      const next = { ...(await db.settings()), billSpendCards: cards, settingsAt: new Date().toISOString() };
      await db.saveSettings(next);
      setSettings((cur) => ({ ...cur, billSpendCards: cards, settingsAt: next.settingsAt }));
      const changed = reapplyRules(await db.allTransactions(), await db.allRules(), next);
      await updateTxns(changed);
      schedulePrefsSync(() => void reload());
      return changed.length;
    },
    [updateTxns, reload],
  );

  const dismissUnparsed = useCallback(async (id: string) => {
    await db.deleteUnparsed(id);
    setUnparsed((u) => u.filter((x) => x.id !== id));
  }, []);

  const value = useMemo<Store>(
    () => ({ ready, error, txns, rules, settings, unparsed, reload, updateTxns, saveSettings, addRule, deleteRule, dismissUnparsed, setBillSpendCards, toast, toastMsg }),
    [ready, error, txns, rules, settings, unparsed, reload, updateTxns, saveSettings, addRule, deleteRule, dismissUnparsed, setBillSpendCards, toast, toastMsg],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
