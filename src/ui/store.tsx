import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { db } from '../lib/db';
import { reapplyRules } from '../lib/categorize';
import { schedulePrefsSync } from '../lib/prefsSync';
import { setLocalTemplates, type CustomTemplate } from '../lib/parsers/taught';
import { setIgnoreRules, subjectKey, type IgnoreRule } from '../lib/parsers/ignore';
import { dropIgnoredUnparsed } from '../lib/prefsSync';
import { uid } from './format';
import { DEFAULT_SETTINGS, type BankId, type MerchantRule, type Settings, type Transaction, type UnparsedEmail } from '../lib/types';

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
  ignoreRules: IgnoreRule[];
  /** Ignore every email from this bank with this kind of subject. Returns how many not-understood emails were cleared. */
  ignoreLike(bank: BankId, subject: string): Promise<number>;
  stopIgnoring(id: string): Promise<void>;
  templates: CustomTemplate[];
  addTemplate(t: CustomTemplate): Promise<void>;
  deleteTemplate(id: string): Promise<void>;
  toast(msg: string): void;
  toastMsg: string | null;
  /** A long-running job shown at the top of the screen (e.g. re-reading emails). */
  task: { label: string; done: number; total: number } | null;
  setTask(t: { label: string; done: number; total: number } | null): void;
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
  const [templates, setTemplates] = useState<CustomTemplate[]>([]);
  const [task, setTask] = useState<Store['task']>(null);
  const [ignoreRules, setIgnoreRulesState] = useState<IgnoreRule[]>([]);

  const reload = useCallback(async () => {
    try {
      const [t, r, s, u, tpl] = await Promise.all([db.allTransactions(), db.allRules(), db.settings(), db.allUnparsed(), db.templates()]);
      setLocalTemplates(tpl);
      setTemplates(tpl);
      const ign = await db.ignoreRules();
      setIgnoreRules(ign);
      setIgnoreRulesState(ign);
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

  const addTemplate = useCallback(
    async (t: CustomTemplate) => {
      const list = [...(await db.templates()).filter((x) => x.id !== t.id), t];
      await db.saveTemplates(list);
      setTemplates(list);
      await db.saveSettings({ ...(await db.settings()), pendingReread: true });
      schedulePrefsSync(() => void reload());
    },
    [reload],
  );

  const deleteTemplate = useCallback(
    async (id: string) => {
      await db.deleteTemplate(id);
      setTemplates(await db.templates());
      schedulePrefsSync(() => void reload());
    },
    [reload],
  );

  const ignoreLike = useCallback(
    async (bank: BankId, subject: string) => {
      const key = subjectKey(subject);
      const list = await db.ignoreRules();
      if (!list.some((r) => r.bank === bank && r.subject === key)) list.push({ id: uid(), bank, subject: key, example: subject.slice(0, 200), createdAt: new Date().toISOString() });
      await db.saveIgnoreRules(list);
      const n = await dropIgnoredUnparsed();
      await reload();
      schedulePrefsSync(() => void reload());
      return n;
    },
    [reload],
  );

  const stopIgnoring = useCallback(
    async (id: string) => {
      await db.deleteIgnoreRule(id);
      await db.saveSettings({ ...(await db.settings()), pendingReread: true });
      await reload();
      schedulePrefsSync(() => void reload());
    },
    [reload],
  );

  const dismissUnparsed = useCallback(async (id: string) => {
    await db.deleteUnparsed(id);
    setUnparsed((u) => u.filter((x) => x.id !== id));
  }, []);

  const value = useMemo<Store>(
    () => ({ ready, error, txns, rules, settings, unparsed, reload, updateTxns, saveSettings, addRule, deleteRule, dismissUnparsed, setBillSpendCards, templates, addTemplate, deleteTemplate, ignoreRules, ignoreLike, stopIgnoring, toast, toastMsg, task, setTask }),
    [ready, error, txns, rules, settings, unparsed, reload, updateTxns, saveSettings, addRule, deleteRule, dismissUnparsed, setBillSpendCards, templates, addTemplate, deleteTemplate, ignoreRules, ignoreLike, stopIgnoring, toast, toastMsg, task],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
