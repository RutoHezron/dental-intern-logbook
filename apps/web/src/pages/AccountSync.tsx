import { CloudCheck, LogOut, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { EmailSignIn } from '../components/EmailSignIn';
import { PushReminders } from '../components/PushReminders';
import { Section, ToneNote, useToast } from '../components/ui';
import { useInternship } from '../state/AppData';
import { useSync } from '../sync/SyncProvider';

/** Sign in with an emailed one-time code; no passwords. */
export function AccountSync() {
  const sync = useSync();
  const { state } = useInternship();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!sync.configured) {
    return (
      <Section title="Account & sync">
        <p className="text-sm text-ink-2">
          This copy of the app is not connected to a sync server, so your logbook lives only on this device. Export a backup regularly (below).
        </p>
      </Section>
    );
  }

  if (state.demo) {
    return (
      <Section title="Account & sync">
        <ToneNote tone="neutral">The demo internship never syncs. Start your own logbook to sign in and back it up to your account.</ToneNote>
      </Section>
    );
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (sync.email) {
    return (
      <Section title="Account & sync">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <div className="flex items-center gap-2 font-medium">
              <CloudCheck size={16} className="text-good-ink" aria-hidden="true" /> Signed in as {sync.email}
            </div>
            <div className="mt-0.5 text-ink-2">
              {sync.lastSyncAt ? `Last synced ${new Date(sync.lastSyncAt).toLocaleString()}` : 'Not synced yet'}
              {sync.pending > 0 && ` · ${sync.pending} change${sync.pending === 1 ? '' : 's'} waiting`}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary" disabled={busy || sync.state === 'syncing'} onClick={() => run(sync.syncNow)}>
              <RefreshCw size={16} aria-hidden="true" /> Sync now
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                run(async () => {
                  await sync.signOut();
                  toast('Signed out. Records stay on this device.');
                })
              }
            >
              <LogOut size={16} aria-hidden="true" /> Sign out
            </button>
          </div>
        </div>
        <div className="mt-4 border-t border-line pt-4">
          <PushReminders />
        </div>
        {sync.errors > 0 && (
          <div className="mt-3">
            <ToneNote tone="critical">
              {sync.errors} change{sync.errors === 1 ? ' was' : 's were'} not accepted by the server{sync.lastError ? `: ${sync.lastError}` : '.'} They remain saved on this
              device.
            </ToneNote>
          </div>
        )}
        {error && (
          <div className="mt-3">
            <ToneNote tone="critical">{error}</ToneNote>
          </div>
        )}
      </Section>
    );
  }

  return (
    <Section title="Account & sync">
      <p className="mb-3 text-sm text-ink-2">Sign in to back up your logbook and use it on more than one device. We email you a 6-digit code — no password.</p>
      <EmailSignIn onSignedIn={() => toast('Signed in · syncing your logbook')} />
    </Section>
  );
}
