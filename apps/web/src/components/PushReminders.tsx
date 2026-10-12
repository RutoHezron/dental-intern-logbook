import { Bell, BellOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { currentSubscription, disablePush, enablePush, pushSupported } from '../push/push';
import { supabaseRpc } from '../sync/supabase';
import { useSync } from '../sync/SyncProvider';
import { ToneNote, useToast } from './ui';

/**
 * Opt in to one daily reminder on this device. Content is counts and a link
 * only ("2 entries returned…"), so nothing clinical shows on a locked screen.
 */
export function PushReminders({ audience = 'intern' }: { audience?: 'intern' | 'supervisor' }) {
  const sync = useSync();
  const toast = useToast();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const available = pushSupported() && sync.configured && Boolean(sync.email);

  useEffect(() => {
    if (!available) return;
    currentSubscription()
      .then((s) => setOn(Boolean(s)))
      .catch(() => setOn(false));
  }, [available]);

  if (!available) return null;

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      if (on) {
        await disablePush(supabaseRpc);
        setOn(false);
        toast('Daily reminders turned off on this device');
      } else {
        await enablePush(supabaseRpc);
        setOn(true);
        toast('Daily reminders turned on');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change reminders.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-56 flex-1 text-sm text-ink-2">
          {audience === 'supervisor'
            ? 'Get one notification a day on this device when entries are waiting for your verification.'
            : 'One notification a day on this device when something needs you: returned entries, entries waiting over a week, or a few quiet days. It shows counts only — never patient details.'}
        </p>
        <button type="button" className="btn btn-secondary" disabled={busy || on === null} aria-pressed={Boolean(on)} onClick={toggle}>
          {on ? <BellOff size={16} aria-hidden="true" /> : <Bell size={16} aria-hidden="true" />}
          {busy ? 'Please wait…' : on ? 'Turn off daily reminders' : 'Turn on daily reminders'}
        </button>
      </div>
      {error && (
        <div className="mt-3">
          <ToneNote tone="critical">{error}</ToneNote>
        </div>
      )}
    </div>
  );
}
