import { getProcedureType } from '@logbook/core';
import { Lock } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { LevelLadder, PageHeader, RotationDot } from '../components/ui';
import { fmtDate } from '../lib/format';
import { useInternship } from '../state/AppData';
import { EntryChip } from './Logbook';

/**
 * Case timeline: the intern's own visits for one pseudonymous patient number.
 * A view over existing records — it adds no patient data.
 */
export function PatientPage() {
  const { id = '' } = useParams();
  const { ix } = useInternship();
  const patient = ix.patients.get(id);
  if (!patient) return <PageHeader title="Patient not found" />;
  const visits = ix.encounters.filter((e) => e.patientId === id).sort((a, b) => a.date.localeCompare(b.date));
  const openStages = new Map<string, { name: string; stage: number; stages: number; tooth: string }>();
  for (const v of visits) {
    for (const p of v.procedures) {
      const t = getProcedureType(p.procedureTypeId);
      if (!t || t.stages <= 1) continue;
      const key = `${t.id}|${p.sites.join(',')}`;
      if ((p.stage ?? 1) >= t.stages) openStages.delete(key);
      else openStages.set(key, { name: t.shortName, stage: p.stage ?? 1, stages: t.stages, tooth: p.sites.join(',') });
    }
  }
  const entries = ix.entries;
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader eyebrow="Case timeline" title={patient.ref}>
        {[patient.birthYear && `Born ${patient.birthYear}`, patient.sex, patient.systemicCondition && 'Systemic condition recorded'].filter(Boolean).join(' · ') || 'No demographic details recorded'}
      </PageHeader>
      <p className="flex items-start gap-2 text-xs text-ink-3">
        <Lock size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        Pseudonymous: identified by hospital number only, visible to you alone. The hospital file remains the clinical record.
      </p>
      {openStages.size > 0 && (
        <div className="card p-4">
          <h2 className="mb-2 text-[15px] font-semibold">Open treatment</h2>
          <ul className="space-y-1 text-sm">
            {[...openStages.values()].map((o) => (
              <li key={o.name + o.tooth}>
                {o.name} <span className="code">{o.tooth}</span> — stage {o.stage} of {o.stages} done
              </li>
            ))}
          </ul>
        </div>
      )}
      <ol className="relative space-y-4 border-l border-line-strong pl-5">
        {visits.map((v) => (
          <li key={v.id} className="relative">
            <span className="absolute -left-[26px] top-1.5 h-3 w-3 rounded-full border-2 border-paper" style={{ background: 'var(--ink)' }} aria-hidden="true" />
            <Link to={`/log/visit/${v.id}`} className="card block p-4 hover:border-line-strong">
              <div className="flex items-center gap-2 text-sm text-ink-2">
                <RotationDot code={ix.rotationCode(v.rotationId)} />
                {fmtDate(v.date)} · {v.visitType}
              </div>
              {v.findings.length > 0 && <div className="mt-1 text-sm">{v.findings.map((f) => f.term + (f.site ? ` (${f.site})` : '')).join(' · ')}</div>}
              <ul className="mt-2 space-y-1 text-sm">
                {v.procedures.map((p) => (
                  <li key={p.id} className="flex items-center gap-2">
                    <LevelLadder level={p.level} size={12} />
                    {p.otherName ?? getProcedureType(p.procedureTypeId)?.name}
                    {p.stage ? ` · stage ${p.stage}` : ''}
                    {p.sites.length > 0 && <span className="code text-ink-3">{p.sites.join(' ')}</span>}
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-1">
                {entries.filter((e) => e.encounterId === v.id).map((e) => (
                  <EntryChip key={e.id} entry={e} />
                ))}
              </div>
              {(v.referredTo || v.followUpNeeded) && (
                <div className="mt-2 text-xs text-ink-2">
                  {v.referredTo && `Referred to ${v.referredTo}. `}
                  {v.followUpNeeded && 'Follow-up needed.'}
                </div>
              )}
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
