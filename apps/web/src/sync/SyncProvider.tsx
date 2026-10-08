import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { db, getMeta, META } from '../data/db';
import { useAppData } from '../state/AppData';
import { resetCursor, syncOnce } from './engine';
import { getSupabase, supabaseTransport, syncConfigured } from './supabase';

/**
 * Runs sync in the background: on start, when the device comes back online,
 * shortly after every local change, and once a minute. Demo data never syncs.
 */

export type SyncState = 'local' | 'signed_out' | 'offline' | 'syncing' | 'synced' | 'pending' | 'error';

export interface SyncApi {
  configured: boolean;
  email: string | null;
  state: SyncState;
  pending: number;
  errors: number;
  lastSyncAt: string | null;
  lastError: string | null;
  syncNow: () => Promise<void>;
  sendCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SyncApi | null>(null);

const INTERVAL_MS = 60_000;
const DEBOUNCE_MS = 1_500;

export function SyncProvider({ children }: { children: ReactNode }) {
  const { state, online } = useAppData();
  const demo = Boolean(state?.demo);
  const [email, setEmail] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const lastSyncAt = useLiveQuery(() => getMeta<string | null>(META.lastSyncAt, null), []) ?? null;
  const pending = useLiveQuery(() => db.outbox.where('status').equals('pending').count(), []) ?? 0;
  const errors = useLiveQuery(() => db.outbox.where('status').equals('error').count(), []) ?? 0;
  const inFlight = useRef<Promise<void> | null>(null);

  // Track the signed-in account.
  useEffect(() => {
    if (!syncConfigured) return;
    let unsub: (() => void) | undefined;
    getSupabase().then((sb) => {
      sb.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null));
      const { data } = sb.auth.onAuthStateChange((_e, session) => setEmail(session?.user.email ?? null));
      unsub = () => data.subscription.unsubscribe();
    });
    return () => unsub?.();
  }, []);

  const canSync = syncConfigured && Boolean(email) && online && !demo;

  const syncNow = useCallback(async () => {
    if (!canSync) return;
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      setRunning(true);
      try {
        await syncOnce(supabaseTransport);
        setLastError(null);
      } catch (err) {
        setLastError(err instanceof Error ? err.message : 'Sync failed');
      } finally {
        setRunning(false);
        inFlight.current = null;
      }
    })();
    inFlight.current = run;
    return run;
  }, [canSync]);

  // On sign-in / reconnect, and on a timer.
  useEffect(() => {
    if (!canSync) return;
    syncNow();
    const t = setInterval(syncNow, INTERVAL_MS);
    return () => clearInterval(t);
  }, [canSync, syncNow]);

  // Shortly after local changes.
  useEffect(() => {
    if (!canSync || pending === 0) return;
    const t = setTimeout(syncNow, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [canSync, pending, syncNow]);

  const api = useMemo<SyncApi>(() => {
    let s: SyncState;
    if (!syncConfigured || demo) s = 'local';
    else if (!email) s = 'signed_out';
    else if (!online) s = 'offline';
    else if (running) s = 'syncing';
    else if (errors || lastError) s = 'error';
    else if (pending) s = 'pending';
    else s = 'synced';
    return {
      configured: syncConfigured,
      email,
      state: s,
      pending,
      errors,
      lastSyncAt,
      lastError,
      syncNow,
      async sendCode(address: string) {
        const sb = await getSupabase();
        const { error } = await sb.auth.signInWithOtp({ email: address.trim(), options: { shouldCreateUser: true } });
        if (error) throw new Error(error.message);
      },
      async verifyCode(address: string, code: string) {
        const sb = await getSupabase();
        const { error } = await sb.auth.verifyOtp({ email: address.trim(), token: code.trim(), type: 'email' });
        if (error) throw new Error(error.message);
        // Pull everything this account already has (e.g. from another device).
        await resetCursor();
      },
      async signOut() {
        const sb = await getSupabase();
        await sb.auth.signOut();
      },
    };
  }, [demo, email, online, running, errors, lastError, pending, lastSyncAt, syncNow]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useSync(): SyncApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSync must be used inside SyncProvider');
  return v;
}
