import { cohortMember, displayDate, KMPDC_DENTAL_3, rotationEnd, todayISO, type CohortMember } from '@logbook/core';
import { AlertTriangle, RefreshCw, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader, ProgressBar, RotationDot, ToneNote, useToast } from '../components/ui';
import { acceptCoordinatorInvite, loadCohort } from '../coordinate/api';
import { fmtDate } from '../lib/format';
import { supabaseRpc } from '../sync/supabase';
import { useSync } from '../sync/SyncProvider';
import { AcceptCode, Frame, useGate } from './Supervise';

/**
 * Coordinator cohort view: the interns who chose to share their progress.
 * Counts of entries per code, forms held and case reports — never patients,
 * entries or visits. Counts show recorded exposure, not competence.
 */
export function CohortPage() {
  const gate = useGate();
  return (
    <Frame role="Coordinator">
      <PageHeader title="Your cohort">
        Progress of interns who share their logbook with you: verified entries toward the KMPDC minimums, assessment forms and case reports. Counts show recorded exposure, not
        competence.
      </PageHeader>
      {gate ?? <Cohort />}
    </Frame>
  );
}

function Cohort() {
  const sync = useSync();
  const toast = useToast();
  const [members, setMembers] = useState<CohortMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const asOf = todayISO();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const shares = await loadCohort(supabaseRpc);
      setMembers(shares.map((s) => cohortMember(s, KMPDC_DENTAL_3, asOf)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your cohort.');
    } finally {
      setLoading(false);
    }
  }, [asOf]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const needsAttention = useMemo(() => (members ?? []).filter((m) => m.flags.length > 0).length, [members]);

  if (error) return <ToneNote tone="critical">{error}</ToneNote>;
  if (!members) return <p className="text-ink-2">Loading your cohort…</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
        <Users size={16} aria-hidden="true" />
        <span className="flex-1">
          {members.length} intern{members.length === 1 ? '' : 's'} sharing with {sync.email}
          {needsAttention ? ` · ${needsAttention} with items for attention` : ''}
        </span>
        <button type="button" className="btn btn-ghost" disabled={loading} onClick={refresh}>
          <RefreshCw size={16} aria-hidden="true" /> Refresh
        </button>
      </div>

      {members.length === 0 && (
        <ToneNote tone="neutral">No interns share their progress with you yet. Interns create a sharing code in their logbook under Settings; enter it below.</ToneNote>
      )}

      <ul className="space-y-3">
        {members.map((m) => (
          <MemberCard key={m.share.ownerId} m={m} />
        ))}
      </ul>

      <details className="card p-4">
        <summary className="cursor-pointer text-sm font-medium">Add an intern with a sharing code</summary>
        <div className="mt-3">
          <AcceptCode
            accept={async (code) => ({ ...(await acceptCoordinatorInvite(supabaseRpc, code)), supervisorName: '' })}
            onAccepted={(r) => {
              toast(`${r.internName ?? 'The intern'} now shares their progress with you`);
              refresh();
            }}
          />
        </div>
      </details>
    </div>
  );
}

function MemberCard({ m }: { m: CohortMember }) {
  const s = m.share;
  const pct = Math.round(m.overall.pct * 100);
  return (
    <li className="card p-4" aria-label={`Progress of ${s.internName}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold">{s.internName}</h2>
        <span className="text-sm text-ink-2">{[s.licenceNo, s.facilityName ?? s.institution].filter(Boolean).join(' · ')}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
        <span>
          {displayDate(s.periodFrom)} – {displayDate(s.periodTo)}
        </span>
        {m.current ? (
          <span className="flex items-center gap-1.5">
            <RotationDot code={m.current.rotation} /> Now in {m.current.rotation} until {fmtDate(rotationEnd(m.current))}
          </span>
        ) : (
          <span>Not in a rotation today</span>
        )}
        {m.lastEntryOn && <span>Last entry {fmtDate(m.lastEntryOn)}</span>}
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-baseline justify-between text-sm">
          <span>
            <strong className="tabular">{m.overall.verifiedTowardMinimum}</strong> of {m.overall.minimumTotal} minimum entries verified
          </span>
          <span className="tabular font-semibold">{pct}%</span>
        </div>
        <ProgressBar verified={m.overall.verifiedTowardMinimum} pending={m.pending} min={m.overall.minimumTotal} />
        <div className="mt-1 text-xs text-ink-2">
          {m.overall.met} of {m.overall.codes} codes met · {m.pending} awaiting verification{m.returned ? ` · ${m.returned} returned` : ''}
        </div>
      </div>

      {m.flags.length > 0 && (
        <ul className="mt-3 space-y-1" aria-label="For attention">
          {m.flags.map((f) => (
            <li key={f} className="flex items-start gap-1.5 text-sm" style={{ color: 'var(--warning-ink)' }}>
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> {f}
            </li>
          ))}
        </ul>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium">By rotation</summary>
        <ul className="mt-2 divide-y divide-line">
          {m.rotations.map((r) => (
            <li key={r.rotation.id} className="py-2 text-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="flex items-center gap-1.5 font-semibold">
                  <RotationDot code={r.rotation.rotation} /> {r.rotation.rotation}
                </span>
                <span className="text-ink-2">
                  {fmtDate(r.rotation.startsOn)} – {fmtDate(rotationEnd(r.rotation))}
                </span>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-ink-2 sm:grid-cols-4">
                <span>
                  Verified <strong className="tabular text-ink">{r.summary.verifiedTowardMinimum}</strong>/{r.summary.minimumTotal}
                </span>
                <span>
                  Codes met <strong className="tabular text-ink">{r.summary.met}</strong>/{r.summary.codes}
                </span>
                <span>
                  Forms held <strong className="tabular text-ink">{r.formsHeld}</strong>/{r.formsDue} due
                </span>
                <span>
                  Case reports <strong className="tabular text-ink">{r.caseReportsVerified}</strong>/{r.caseReportsExpected}
                </span>
              </div>
              {r.attention.length > 0 && (
                <div className="mt-1 text-xs" style={{ color: 'var(--warning-ink)' }}>
                  Below pace or minimum: {r.attention.slice(0, 6).map((a) => `${a.code} ${a.verified}/${a.min}`).join(', ')}
                  {r.attention.length > 6 ? ` and ${r.attention.length - 6} more` : ''}
                </div>
              )}
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}
