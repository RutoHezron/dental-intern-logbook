import type { Supervisor } from '@logbook/core';
import qrcode from 'qrcode-generator';
import { Copy, Link2, Link2Off, QrCode, Share2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { createInvite, inviteLink, unlinkSupervisor } from '../supervise/api';
import { supabaseRpc } from '../sync/supabase';
import { useSync } from '../sync/SyncProvider';
import { appUrl, fmtDate } from '../lib/format';
import { ToneNote, useToast } from './ui';

/**
 * Invite a supervisor to verify from their own phone. The code is single use
 * and expires in seven days; show the QR code chairside or send the link.
 */
export function SupervisorInvite({ supervisor, demo }: { supervisor: Supervisor; demo: boolean }) {
  const sync = useSync();
  const toast = useToast();
  const [invite, setInvite] = useState<{ code: string; expiresAt: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!sync.configured || demo) return null;

  const create = async () => {
    setOpen(true);
    setBusy(true);
    setError(null);
    try {
      // The supervisor must be on the server before it can be linked.
      await sync.syncNow();
      setInvite(await createInvite(supabaseRpc, supervisor.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create an invite.');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await unlinkSupervisor(supabaseRpc, supervisor.id);
      await sync.syncNow();
      toast(`${supervisor.name} can no longer sign from their own account`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not disconnect', 'critical');
    } finally {
      setBusy(false);
    }
  };

  if (supervisor.userId) {
    return (
      <span className="flex items-center gap-2 text-xs text-ink-2">
        <Link2 size={14} className="text-good-ink" aria-hidden="true" /> Signs from own phone
        <button type="button" className="btn btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={disconnect} aria-label={`Disconnect ${supervisor.name}'s account`}>
          <Link2Off size={14} aria-hidden="true" /> Disconnect
        </button>
      </span>
    );
  }

  return (
    <>
      <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={create} aria-label={`Invite ${supervisor.name} to sign from their own phone`}>
        <QrCode size={14} aria-hidden="true" /> Invite
      </button>
      {open && (
        <div className="basis-full rounded-[12px] border border-line bg-surface-2 p-4">
          {!sync.email ? (
            <ToneNote tone="neutral">
              Sign in first so the invite can reach your logbook:{' '}
              <Link to="/settings" className="font-medium underline underline-offset-2">
                Settings → Account &amp; sync
              </Link>
              .
            </ToneNote>
          ) : busy ? (
            <p className="text-sm text-ink-2">Creating invite…</p>
          ) : error ? (
            <ToneNote tone="critical">{error}</ToneNote>
          ) : invite ? (
            <InviteCard code={invite.code} expiresAt={invite.expiresAt} link={inviteLink(appUrl(), invite.code)} qrLabel={`QR code for ${supervisor.name}'s invite`}>
              Ask <strong>{supervisor.name}</strong> to scan this with their phone camera, or to open the link and sign in. They can then verify what you submit to them from anywhere.
            </InviteCard>
          ) : null}
          <button type="button" className="btn btn-ghost mt-2 text-sm" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      )}
    </>
  );
}

/** A one-time code with its QR code and link, ready to show chairside or send. */
export function InviteCard({ code, expiresAt, link, qrLabel, children }: { code: string; expiresAt: string; link: string; qrLabel: string; children: ReactNode }) {
  const toast = useToast();
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;
  return (
    <div className="flex flex-wrap items-start gap-4">
      <QrSvg text={link} label={qrLabel} />
      <div className="min-w-56 flex-1 space-y-2 text-sm">
        <p>{children}</p>
        <div>
          <div className="label">Invite code</div>
          <div className="code text-2xl font-semibold tracking-[0.15em]" aria-label="Invite code">
            {code}
          </div>
        </div>
        <p className="text-ink-2">Single use · expires {fmtDate(expiresAt.slice(0, 10))}. Creating a new invite cancels this one.</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-secondary text-sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                toast('Invite link copied');
              } catch {
                toast('Copy the code instead', 'critical');
              }
            }}
          >
            <Copy size={14} aria-hidden="true" /> Copy link
          </button>
          {canShare && (
            <button type="button" className="btn btn-secondary text-sm" onClick={() => navigator.share({ title: 'Logbook invite', text: `Invite code ${code}`, url: link }).catch(() => {})}>
              <Share2 size={14} aria-hidden="true" /> Share
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** QR code as SVG: black on white in every theme, so phone cameras read it reliably. */
function QrSvg({ text, label }: { text: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
    return { size: n + 8, path: d };
  }, [text]);
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} width="168" height="168" shapeRendering="crispEdges" className="shrink-0 rounded-[8px]">
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
