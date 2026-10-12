import { getActivityType, getProcedureType } from '@logbook/core';
import { Check, LogOut, PenLine, RefreshCw, ShieldCheck, UserCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { EmailSignIn } from '../components/EmailSignIn';
import { PushReminders } from '../components/PushReminders';
import { PageHeader, Segmented, ToneNote, useToast } from '../components/ui';
import { fmtDate } from '../lib/format';
import { useAppData } from '../state/AppData';
import {
  acceptInvite,
  formatInviteCode,
  loadActivity,
  loadQueue,
  signDecisions,
  type ActivityEntry,
  type Decision,
  type InternActivity,
  type QueueEntry,
  type SupervisionLink,
  type SupervisorQueue,
} from '../supervise/api';
import { acceptCoordinatorInvite } from '../coordinate/api';
import { supabaseRpc } from '../sync/supabase';
import { useSync } from '../sync/SyncProvider';
import { CaseReportReview, EntryReview, type Draft } from './SignOff';

/**
 * Supervisor review on the supervisor's own phone or computer (V1). Online:
 * the supervisor signs in, sees what interns submitted to them, and signs it.
 * Nothing is stored on this device except the sign-in.
 */

export function Frame({ children, role = 'Supervisor' }: { children: ReactNode; role?: string }) {
  const sync = useSync();
  return (
    <div className="min-h-dvh bg-paper">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <span className="eyebrow flex-1">Dental internship logbook · {role}</span>
          {sync.email && (
            <button type="button" className="btn btn-ghost text-sm" onClick={() => sync.signOut()}>
              <LogOut size={16} aria-hidden="true" /> Sign out
            </button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}

/**
 * Supervisor sign-in must never happen on a phone that holds an intern's
 * logbook: the logbook would start syncing into the supervisor's account.
 */
export function useGate(): ReactNode | null {
  const sync = useSync();
  const { loaded, ix, state } = useAppData();
  if (!sync.configured) {
    return <ToneNote tone="neutral">This copy of the app is not connected to a server. Supervisors can still sign on the intern's phone with a PIN (Supervisor sign-off).</ToneNote>;
  }
  if (!loaded) return <p className="text-ink-2">Opening…</p>;
  if (ix && !state?.demo) {
    return (
      <ToneNote tone="warning">
        This device holds {ix.ds.internship.internName}'s logbook, so supervisor and coordinator sign-in is not available on it. Review from your own phone or computer, or sign here with your PIN
        using{' '}
        <Link to="/sign-off" className="font-medium underline underline-offset-2">
          Supervisor sign-off
        </Link>
        .
      </ToneNote>
    );
  }
  if (!sync.email) {
    return (
      <div className="card p-5">
        <h2 className="mb-1 text-lg font-semibold">Sign in to continue</h2>
        <p className="mb-4 text-sm text-ink-2">Use your work email address. We send you a 6-digit code — no password.</p>
        <EmailSignIn />
      </div>
    );
  }
  return null;
}

export function SupervisePage() {
  const gate = useGate();
  return (
    <Frame>
      <PageHeader title="Your interns">Requests waiting for your sign-off and the activity of each intern you supervise. Verify, adjust the level you observed, or return with a comment.</PageHeader>
      {gate ?? <Queue />}
    </Frame>
  );
}

function Queue() {
  const sync = useSync();
  const toast = useToast();
  const [queue, setQueue] = useState<SupervisorQueue | null>(null);
  const [activity, setActivity] = useState<InternActivity[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<'requests' | 'activity'>('requests');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [q, a] = await Promise.all([loadQueue(supabaseRpc), loadActivity(supabaseRpc)]);
      setQueue(q);
      setActivity(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your queue.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (error) {
    return (
      <ToneNote tone="critical">
        {error}{' '}
        <button type="button" className="font-medium underline underline-offset-2" onClick={refresh}>
          Try again
        </button>
      </ToneNote>
    );
  }
  if (!queue) return <p className="text-ink-2">Loading your queue…</p>;

  const waiting = (l: SupervisionLink) =>
    queue.entries.filter((e) => e.supervisorId === l.supervisorId).length + queue.caseReports.filter((r) => r.supervisorId === l.supervisorId).length;
  const link = queue.links.find((l) => l.supervisorId === selected) ?? queue.links[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
        <UserCheck size={16} aria-hidden="true" />
        <span className="flex-1">Signed in as {sync.email}</span>
        <button type="button" className="btn btn-ghost" disabled={loading} onClick={refresh}>
          <RefreshCw size={16} aria-hidden="true" /> Refresh
        </button>
      </div>
      {queue.links.length > 0 && <PushReminders audience="supervisor" />}
      {!link ? (
        <div className="card p-5">
          <h2 className="mb-1 text-lg font-semibold">No interns linked yet</h2>
          <p className="mb-4 text-sm text-ink-2">
            Your training centre's administrator links you to your interns using this email address. An intern can also invite you from their logbook (Rotations &amp; supervisors);
            enter the code they show you.
          </p>
          <AcceptCode onAccepted={refresh} />
        </div>
      ) : (
        <>
          {queue.links.length > 1 && (
            <ul className="grid gap-2 sm:grid-cols-2" aria-label="Your interns">
              {queue.links.map((l) => {
                const a = activity.find((x) => x.supervisorId === l.supervisorId);
                const n = waiting(l);
                const current = l.supervisorId === link.supervisorId;
                return (
                  <li key={l.supervisorId}>
                    <button
                      type="button"
                      aria-pressed={current}
                      onClick={() => setSelected(l.supervisorId)}
                      className="card w-full p-3 text-left transition-colors"
                      style={current ? { borderColor: 'var(--ink)' } : undefined}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="flex-1 font-semibold">{l.internName ?? 'Intern'}</span>
                        {n > 0 && (
                          <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: 'var(--warning)', color: 'var(--warning-ink)' }}>
                            {n} to verify
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-ink-2">
                        {a?.summary.lastOn ? `Last entry ${fmtDate(a.summary.lastOn)} · ${a.summary.last7Days} in the last 7 days` : 'Nothing submitted to you yet'}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <Segmented
            label={`View for ${link.internName ?? 'intern'}`}
            value={tab}
            onChange={setTab}
            options={[
              { value: 'requests', label: `Requests (${waiting(link)})` },
              { value: 'activity', label: 'Activity' },
            ]}
          />

          {tab === 'requests' ? (
            <InternQueue
              key={link.supervisorId}
              link={link}
              queue={queue}
              onSigned={(n) => {
                toast(`${n} decision${n === 1 ? '' : 's'} signed for ${link.internName ?? 'your intern'}`);
                refresh();
              }}
            />
          ) : (
            <InternActivityView link={link} activity={activity.find((a) => a.supervisorId === link.supervisorId)} />
          )}

          <details className="card p-4">
            <summary className="cursor-pointer text-sm font-medium">Add another intern with an invite code</summary>
            <div className="mt-3">
              <AcceptCode onAccepted={refresh} />
            </div>
          </details>
        </>
      )}
    </div>
  );
}

const ENTRY_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  submitted: { label: 'Waiting for you', color: 'var(--warning-ink)', bg: 'var(--warning)' },
  returned: { label: 'Returned', color: 'var(--critical-ink)', bg: 'var(--critical)' },
  verified: { label: 'Verified', color: 'var(--good-ink)', bg: 'var(--good)' },
  locked: { label: 'Verified', color: 'var(--good-ink)', bg: 'var(--good)' },
};

function StatusPill({ status }: { status: string }) {
  const s = ENTRY_STATUS[status] ?? { label: status, color: 'var(--ink-2)', bg: 'var(--surface-2)' };
  return (
    <span className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap" style={{ color: s.color, background: s.bg }}>
      {s.label}
    </span>
  );
}

/** Everything the intern submitted to this supervisor, newest first: what is waiting, what was returned, what was verified. */
function InternActivityView({ link, activity }: { link: SupervisionLink; activity: InternActivity | undefined }) {
  const name = link.internName ?? 'This intern';
  if (!activity || activity.summary.total + activity.caseReports.length === 0) {
    return <ToneNote tone="neutral">{name} has not submitted anything to you yet.</ToneNote>;
  }
  const s = activity.summary;
  const byDate = new Map<string, ActivityEntry[]>();
  for (const e of activity.entries) byDate.set(e.performedOn, [...(byDate.get(e.performedOn) ?? []), e]);
  const tiles: [string, number][] = [
    ['Waiting for you', s.submitted],
    ['Returned to intern', s.returned],
    ['Verified', s.verified],
    ['Last 7 days', s.last7Days],
  ];
  return (
    <section aria-label={`Activity of ${name}`} className="space-y-5">
      <div>
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-xl font-semibold">{name}</h2>
          {s.lastOn && <span className="text-sm text-ink-2">Last entry {fmtDate(s.lastOn)}</span>}
        </div>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {tiles.map(([label, value]) => (
            <div key={label} className="card p-3">
              <dt className="text-xs text-ink-2">{label}</dt>
              <dd className="tabular text-2xl font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {activity.caseReports.length > 0 && (
        <div>
          <h3 className="eyebrow mb-2">Case reports</h3>
          <ul className="card divide-y divide-line">
            {activity.caseReports.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-24 shrink-0 text-ink-2">{fmtDate(r.date)}</span>
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
                <StatusPill status={r.status} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {[...byDate.entries()].map(([date, list]) => (
        <div key={date}>
          <h3 className="eyebrow mb-2">{fmtDate(date)}</h3>
          <ul className="card divide-y divide-line">
            {list.map((e) => (
              <li key={e.id} className="px-3 py-2 text-sm">
                <div className="flex items-start gap-3">
                  <span className="code w-16 shrink-0 font-semibold">{e.requirementCode}</span>
                  <span className="min-w-0 flex-1">
                    {summaryOf(e) || 'Logbook entry'} <span className="text-ink-2">· L{e.levelClaimed} claimed</span>
                  </span>
                  <StatusPill status={e.status} />
                </div>
                {e.decision && (
                  <div className="mt-1 text-xs text-ink-2 sm:pl-19">
                    {e.decision.decision === 'verified' ? 'Verified' : 'Returned'} {fmtDate(e.decision.signedAt.slice(0, 10))}
                    {e.decision.levelObserved ? ` at L${e.decision.levelObserved}` : ''}
                    {e.decision.comment ? ` — “${e.decision.comment}”` : ''}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {s.total > activity.entries.length && <p className="text-xs text-ink-3">Showing the latest {activity.entries.length} of {s.total} entries.</p>}
    </section>
  );
}

function summaryOf(e: QueueEntry): string {
  if (e.activity) return e.activity.title ?? getActivityType(e.activity.activityTypeId)?.name ?? 'Activity';
  const p = e.visit?.procedures.find((x) => (x as { id?: string }).id === e.encounterProcedureId);
  const name = p ? getProcedureType(p.procedureTypeId)?.name ?? p.otherName : undefined;
  const dx = e.visit?.diagnoses.join(', ');
  return [e.rotation, name, p?.stage ? `stage ${p.stage}` : null, dx ? `Dx: ${dx}` : null].filter(Boolean).join(' · ');
}

function InternQueue({ link, queue, onSigned }: { link: SupervisionLink; queue: SupervisorQueue; onSigned: (n: number) => void }) {
  const entries = useMemo(() => queue.entries.filter((e) => e.supervisorId === link.supervisorId), [queue, link]);
  const reports = useMemo(() => queue.caseReports.filter((r) => r.supervisorId === link.supervisorId), [queue, link]);
  const reportIds = new Set(reports.map((r) => r.id));
  const [draft, setDraft] = useState<Draft>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = entries.length + reports.length;
  const decided = Object.keys(draft).length;

  const set = (id: string, v: Draft[string] | null) =>
    setDraft((d) => {
      const n = { ...d };
      if (v) n[id] = v;
      else delete n[id];
      return n;
    });

  const byDate = new Map<string, QueueEntry[]>();
  for (const e of entries) byDate.set(e.performedOn, [...(byDate.get(e.performedOn) ?? []), e]);

  const sign = async () => {
    const decisions: Decision[] = Object.entries(draft).map(([id, d]) =>
      reportIds.has(id) ? { caseReportId: id, decision: d.decision, comment: d.comment } : { entryId: id, decision: d.decision, levelObserved: d.level, comment: d.comment },
    );
    if (decisions.some((d) => d.decision === 'returned' && !d.comment?.trim())) {
      setConfirming(false);
      return setError('Say what needs fixing for each returned item.');
    }
    setBusy(true);
    setError(null);
    try {
      const n = await signDecisions(supabaseRpc, link, queue, decisions);
      setDraft({});
      setConfirming(false);
      onSigned(n);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign. Nothing was saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={`Queue for ${link.internName ?? 'intern'}`}>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-xl font-semibold">{link.internName ?? 'Intern'}</h2>
        <span className="text-sm text-ink-2">
          {[link.licenceNo, link.institution].filter(Boolean).join(' · ')}
          {link.licenceNo || link.institution ? ' · ' : ''}you are listed as {link.supervisorName}
        </span>
      </div>
      {total === 0 ? (
        <ToneNote tone="good">Nothing from {link.internName ?? 'this intern'} is waiting for you.</ToneNote>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setDraft(Object.fromEntries([...reports, ...entries].map((e) => [e.id, draft[e.id] ?? { decision: 'verified' as const }])))}
            >
              <Check size={16} aria-hidden="true" /> Verify all remaining as claimed
            </button>
            {decided > 0 && (
              <button type="button" className="btn btn-ghost" onClick={() => setDraft({})}>
                Clear decisions
              </button>
            )}
          </div>
          <div className="space-y-5">
            {reports.length > 0 && (
              <div>
                <h3 className="eyebrow mb-2">Case reports</h3>
                <ul className="space-y-2">
                  {reports.map((r) => (
                    <CaseReportReview key={r.id} report={r} value={draft[r.id]} onChange={(v) => set(r.id, v)} />
                  ))}
                </ul>
              </div>
            )}
            {[...byDate.entries()].map(([date, list]) => (
              <div key={date}>
                <h3 className="eyebrow mb-2">{fmtDate(date)}</h3>
                <ul className="space-y-2">
                  {list.map((e) => (
                    <EntryReview key={e.id} entry={e} summary={summaryOf(e)} checks={[]} value={draft[e.id]} onChange={(v) => set(e.id, v)} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {error && (
            <div className="mt-3">
              <ToneNote tone="critical">{error}</ToneNote>
            </div>
          )}
          <div className="sticky bottom-0 z-10 -mx-4 mt-5 flex flex-wrap items-center gap-3 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-[14px] sm:border">
            {confirming ? (
              <>
                <span className="flex-1 text-sm">
                  <ShieldCheck size={16} className="mr-1 inline text-good-ink" aria-hidden="true" />
                  Sign {decided} decision{decided === 1 ? '' : 's'} as {link.supervisorName}? Each becomes a permanent, tamper-evident record.
                </span>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={sign}>
                  {busy ? 'Signing…' : 'Confirm and sign'}
                </button>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setConfirming(false)}>
                  Back
                </button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm text-ink-2">
                  {decided} of {total} decided
                </span>
                <button type="button" className="btn btn-primary" disabled={decided === 0} onClick={() => setConfirming(true)}>
                  <PenLine size={16} aria-hidden="true" /> Sign {decided}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}

type Accepted = { supervisorName: string; internName: string | null };

export function AcceptCode({
  initial = '',
  accept = (code: string) => acceptInvite(supabaseRpc, code),
  onAccepted,
}: {
  initial?: string;
  accept?: (code: string) => Promise<Accepted>;
  onAccepted: (r: Accepted) => void;
}) {
  const [code, setCode] = useState(formatInviteCode(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onAccepted(await accept(code));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept the invite.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <label className="label" htmlFor="invite-code">Invite code</label>
          <input
            id="invite-code"
            className="field code tracking-[0.2em] uppercase"
            placeholder="XXXX-XXXX-XXXX"
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(formatInviteCode(e.target.value))}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy || code.length < 14}>
          {busy ? 'Checking…' : 'Accept invite'}
        </button>
      </div>
      {error && (
        <div className="mt-3">
          <ToneNote tone="critical">{error}</ToneNote>
        </div>
      )}
    </form>
  );
}

/** Opened from the intern's invite link or QR code. */
export function JoinPage() {
  const gate = useGate();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  if (params.get('kind') === 'coordinator') {
    return (
      <Frame role="Coordinator">
        <PageHeader title="Accept an invite">An intern has chosen to share their logbook progress with you as their internship coordinator.</PageHeader>
        {gate ?? (
          <div className="card p-5">
            <AcceptCode
              initial={params.get('code') ?? ''}
              accept={async (code) => {
                const r = await acceptCoordinatorInvite(supabaseRpc, code);
                return { internName: r.internName, supervisorName: '' };
              }}
              onAccepted={(r) => {
                toast(`${r.internName ?? 'The intern'} now shares their progress with you`);
                navigate('/cohort', { replace: true });
              }}
            />
          </div>
        )}
      </Frame>
    );
  }
  return (
    <Frame>
      <PageHeader title="Accept an invite">An intern has asked you to verify their logbook entries from your own phone or computer.</PageHeader>
      {gate ?? (
        <div className="card p-5">
          <AcceptCode
            initial={params.get('code') ?? ''}
            onAccepted={(r) => {
              toast(`You now verify ${r.internName ?? 'this intern'}'s entries as ${r.supervisorName}`);
              navigate('/supervise', { replace: true });
            }}
          />
        </div>
      )}
    </Frame>
  );
}
