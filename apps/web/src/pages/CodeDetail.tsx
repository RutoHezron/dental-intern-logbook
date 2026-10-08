import { levelMilestones, logbookCsv, requirementProgress, RULE_DESCRIPTIONS } from '@logbook/core';
import { Download } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { LevelMixBar } from '../components/charts';
import { LevelLadder, PageHeader, ProgressBar, Section, StatusBadge } from '../components/ui';
import { downloadText, fmtDate, LEVEL_NAMES, ROTATION_VAR, rotationName } from '../lib/format';
import { analyticsDate, useInternship } from '../state/AppData';
import { EntryChip } from './Logbook';

export function CodeDetailPage() {
  const { code = '' } = useParams();
  const { ix, ds, today } = useInternship();
  const asOf = analyticsDate(today, ix);
  const p = useMemo(() => requirementProgress(ix, asOf).find((x) => x.requirement.code === code), [ix, asOf, code]);
  const milestones = useMemo(() => levelMilestones(ix, asOf).filter((m) => m.code === code), [ix, asOf, code]);
  if (!p) return <PageHeader title="Code not found" />;
  const req = p.requirement;
  const entries = ix.entries.filter((e) => e.requirementCode === code).sort((a, b) => b.performedOn.localeCompare(a.performedOn));
  const sup = new Map(ds.supervisors.map((s) => [s.id, s.name]));
  const color = ROTATION_VAR[req.rotation];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={rotationName(ix, req.rotation)}
        title={req.code}
        actions={
          <button type="button" className="btn btn-secondary" onClick={() => downloadText(`${req.code.replace(/\s+/g, '-')}.csv`, logbookCsv(ix, { requirementCode: req.code }))}>
            <Download size={16} aria-hidden="true" /> CSV
          </button>
        }
      >
        {req.description}
      </PageHeader>

      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Section title="Progress" aside={<StatusBadge status={p.status} />}>
          <div className="mb-3 flex items-end gap-3">
            <span className="font-display text-[44px] font-semibold leading-none">{p.verified}</span>
            <span className="pb-1 text-ink-2">of {req.minCount} verified</span>
          </div>
          <ProgressBar verified={p.verified} pending={p.pending} min={req.minCount} color={color} />
          <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-ink-2">Logged</dt>
            <dd className="tabular text-right">{p.logged}</dd>
            <dt className="text-ink-2">Awaiting verification</dt>
            <dd className="tabular text-right">{p.pending}</dd>
            <dt className="text-ink-2">At expected level {req.expectedLevel}</dt>
            <dd className="tabular text-right">{p.atExpectedLevel}</dd>
            <dt className="text-ink-2">Remaining to minimum</dt>
            <dd className="tabular text-right">{p.remaining}</dd>
            {p.forecast !== null && (
              <>
                <dt className="text-ink-2">Pace forecast at rotation end</dt>
                <dd className="tabular text-right">≈ {p.forecast}</dd>
              </>
            )}
            <dt className="text-ink-2">Highest verified level</dt>
            <dd className="flex items-center justify-end gap-2">
              <LevelLadder level={p.highestVerifiedLevel} size={14} /> {LEVEL_NAMES[p.highestVerifiedLevel]}
            </dd>
          </dl>
          {req.notes && <p className="mt-3 text-xs text-ink-3">{req.notes}</p>}
          <p className="mt-2 text-xs text-ink-3">Counting: {RULE_DESCRIPTIONS.R2} Counts show recorded exposure, not competence.</p>
        </Section>

        <Section title="Levels">
          <LevelMixBar byLevel={p.levels} />
          <h3 className="mb-2 mt-5 text-sm font-semibold">Level journey</h3>
          {milestones.length ? (
            <ol className="space-y-1.5 text-sm">
              {milestones.map((m) => (
                <li key={m.level} className="flex items-center gap-3">
                  <LevelLadder level={m.level} size={14} />
                  <span className="flex-1">First verified at level {m.level} ({LEVEL_NAMES[m.level]?.toLowerCase()})</span>
                  <span className="tabular text-ink-2">{fmtDate(m.on)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-ink-2">No verified entries yet.</p>
          )}
        </Section>
      </div>

      <Section title="Entries" aside={`${entries.length}`}>
        {entries.length === 0 ? (
          <p className="text-sm text-ink-2">No entries for this code yet.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-3">
                  <th className="px-4 py-2 font-medium sm:px-2">Date</th>
                  <th className="px-2 py-2 font-medium">Patient no.</th>
                  <th className="px-2 py-2 font-medium">Site</th>
                  <th className="px-2 py-2 font-medium">Level</th>
                  <th className="px-2 py-2 font-medium">Supervisor</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Rule</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {entries.map((e) => {
                  const v = ix.latest.get(e.id);
                  const observed = v?.decision === 'verified' ? v.levelObserved : undefined;
                  return (
                    <tr key={e.id} className="border-t border-line align-top">
                      <td className="px-4 py-2 sm:px-2">
                        <Link className="underline-offset-2 hover:underline" to={e.encounterId ? `/log/visit/${e.encounterId}` : `/log/activity/${e.activityId}`}>
                          {fmtDate(e.performedOn)}
                        </Link>
                      </td>
                      <td className="code px-2 py-2">{e.patientRef ?? '—'}</td>
                      <td className="code px-2 py-2">{e.site ?? '—'}</td>
                      <td className="px-2 py-2">
                        {observed && observed !== e.levelClaimed ? (
                          <span title="Claimed → verified by supervisor">
                            L{e.levelClaimed} → <strong>L{observed}</strong>
                          </span>
                        ) : (
                          `L${e.levelClaimed}`
                        )}
                      </td>
                      <td className="px-2 py-2 text-ink-2">{e.supervisorId ? sup.get(e.supervisorId) : '—'}</td>
                      <td className="px-2 py-2">
                        <EntryChip entry={e} />
                        {v?.comment && <div className="mt-1 max-w-56 text-xs text-ink-2">“{v.comment}”</div>}
                      </td>
                      <td className="px-2 py-2 text-xs text-ink-3">{e.rule}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
