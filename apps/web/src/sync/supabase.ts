import type { PullResult, PushChange, PushResult } from '@logbook/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SyncTransport } from './engine';

/**
 * Supabase connection, created only when the build is configured with a
 * project URL and public (anon) key. Without them the app runs local-only.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const syncConfigured = Boolean(url && anonKey);

let client: Promise<SupabaseClient> | null = null;

export function getSupabase(): Promise<SupabaseClient> {
  if (!syncConfigured) throw new Error('Sync is not configured for this build.');
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'logbook-auth', detectSessionInUrl: false },
    }),
  );
  return client;
}

export const supabaseTransport: SyncTransport = {
  async push(changes: PushChange[]): Promise<PushResult> {
    const sb = await getSupabase();
    const { data, error } = await sb.rpc('sync_push', { changes });
    if (error) throw new Error(error.message);
    return data as PushResult;
  },
  async pull(since: number): Promise<PullResult> {
    const sb = await getSupabase();
    const { data, error } = await sb.rpc('sync_pull', { since });
    if (error) throw new Error(error.message);
    return data as PullResult;
  },
};

/** Call a server function as the signed-in user. */
export async function supabaseRpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const sb = await getSupabase();
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}
