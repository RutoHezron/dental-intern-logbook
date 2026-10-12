import { Eye, EyeOff, QrCode } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { createCoordinatorInvite, myShares, revokeShare, type CoordinatorShare } from '../coordinate/api';
import { appUrl, fmtDate } from '../lib/format';
import { supabaseRpc } from '../sync/supabase';
import { useSync } from '../sync/SyncProvider';
import { InviteCard } from './SupervisorInvite';
import { Section, ToneNote, useToast } from './ui';

/**
 * Share progress with an internship coordinator (opt-in, revocable). The
 * coordinator sees counts and form status, never patients or entries.
 */
export function CoordinatorSharing({ demo }: { demo: boolean }) {
  const sync = useSync();
  const toast = useToast();
  const [shares, setShares] = useState<CoordinatorShare[] | null>(null);
  const [invite, setInvite] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const online = sync.configured && !demo && Boolean(sync.email);

  const refresh = useCallback(async () => {
    try {
      setShares(await myShares(supabaseRpc));
    } catch {
      setShares(null);
    }
  }, []);

  useEffect(() => {
    if (online) refresh();
  }, [online, refresh]);

  if (!sync.configured || demo) return null;

  return (
    <Section title="Share progress with your coordinator">
      <p className="mb-3 text-sm text-ink-2">
        Your internship coordinator can follow your progress: entries logged and verified per code, assessment forms held, case reports and returned entries. They never see patient
        numbers, teeth, visits, your diary or reports. You can stop sharing at any time.
      </p>
      {!sync.email ? (
        <ToneNote tone="neutral">Sign in above to share your progress.</ToneNote>
      ) : (
        <>
          {shares && shares.length > 0 && (
            <ul className="mb-3 divide-y divide-line">
              {shares.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <Eye size={16} className="text-ink-3" aria-hidden="true" />
                  <span className="flex-1">
                    {s.coordinatorEmail ?? 'A coordinator'} <span className="text-ink-3">· since {fmtDate(s.createdAt.slice(0, 10))}</span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost px-2 py-1 text-xs"
                    onClick={async () => {
                      await revokeShare(supabaseRpc, s.id);
                      toast(`${s.coordinatorEmail ?? 'The coordinator'} can no longer see your progress`);
                      refresh();
                    }}
                  >
                    <EyeOff size={14} aria-hidden="true" /> Stop sharing
                  </button>
                </li>
              ))}
            </ul>
          )}
          {invite ? (
            <InviteCard
              code={invite.code}
              expiresAt={invite.expiresAt}
              link={`${appUrl()}join?kind=coordinator&code=${encodeURIComponent(invite.code)}`}
              qrLabel="QR code for your coordinator"
            >
              Ask your coordinator to scan this, or send them the link. They sign in with their email and will see your progress from then on.
            </InviteCard>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await sync.syncNow();
                  setInvite(await createCoordinatorInvite(supabaseRpc));
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Could not create a sharing code.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <QrCode size={16} aria-hidden="true" /> {busy ? 'Creating…' : 'Create a sharing code'}
            </button>
          )}
          {error && (
            <div className="mt-3">
              <ToneNote tone="critical">{error}</ToneNote>
            </div>
          )}
        </>
      )}
    </Section>
  );
}
