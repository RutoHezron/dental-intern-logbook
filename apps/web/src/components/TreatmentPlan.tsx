import {
  CATEGORY_LABELS,
  getProcedureType,
  isOpen,
  ITEM_STATUS_LABELS,
  itemLabel,
  orderedOpenItems,
  patientBrief,
  PLAN_PHASES,
  planProgress,
  PROCEDURE_TYPES,
  stageText,
  type PlanItem,
  type ProcedureCategory,
  type TreatmentPlan,
} from '@logbook/core';
import { AlertTriangle, CalendarClock, ClipboardCheck, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { newId, RepoError, saveTreatmentPlan } from '../data/repo';
import { fmtDate } from '../lib/format';
import { useInternship } from '../state/AppData';
import { ToothChart } from './ToothChart';
import { ProgressBar, ToneNote, useToast } from './ui';

/** The "before you start" summary for a returning patient (blueprint §11.1). */
export function PatientBriefCard({ patientId, compact = false }: { patientId: string; compact?: boolean }) {
  const { ix, ds, today } = useInternship();
  const brief = patientBrief(ix, patientId, ds.treatmentPlans ?? [], today);
  if (!brief) return null;
  const nothing = !brief.lastVisit && !brief.inProgress.length && !brief.next.length;
  if (compact && nothing) return null;
  return (
    <section aria-label="Next-visit brief" className="rounded-[12px] border border-line bg-surface-2 p-3 text-sm">
      <div className="eyebrow mb-1.5">Before you start</div>
      <div className="font-medium">{brief.headline}</div>
      {brief.alerts.length > 0 && (
        <p className="mt-1 flex items-start gap-1.5" style={{ color: 'var(--warning-ink)' }}>
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          Re-confirm with the patient today: {brief.alerts.join(', ')}.
        </p>
      )}
      {brief.lastVisit && (
        <p className="mt-1 text-ink-2">
          Last visit {fmtDate(brief.lastVisit.date)}: {brief.lastVisit.summary}
          {brief.lastVisit.findings ? ` · ${brief.lastVisit.findings}` : ''}
        </p>
      )}
      {brief.inProgress.map((i) => (
        <p key={i.label} className="mt-1">
          <strong>{i.label}</strong> — {i.detail}
        </p>
      ))}
      {brief.next.length > 0 && (
        <p className="mt-1 text-ink-2">
          Planned next:{' '}
          {brief.next.map((n, k) => (
            <span key={n.label}>
              {k > 0 && ', '}
              {n.label}
              {n.dueOn && <span style={n.overdue ? { color: 'var(--critical-ink)' } : undefined}> (due {fmtDate(n.dueOn)}{n.overdue ? ', overdue' : ''})</span>}
            </span>
          ))}
        </p>
      )}
      {brief.followUp.map((f) => (
        <p key={f} className="mt-1 text-ink-2">
          {f}
        </p>
      ))}
      {nothing && <p className="mt-1 text-ink-2">No previous visits or plan recorded.</p>}
    </section>
  );
}

const CATEGORY_ORDER: ProcedureCategory[] = ['diagnosis', 'periodontal', 'restorative', 'endodontic', 'oral_surgery', 'prosthodontic', 'paediatric', 'preventive', 'orthodontic', 'emergency', 'general'];

/**
 * Adds a planned treatment. Deliberately shows no logbook codes or targets:
 * the plan follows clinical need (blueprint, "the ethical line").
 */
function AddItem({ onAdd }: { onAdd: (i: PlanItem) => void }) {
  const [procedureTypeId, setProcedure] = useState('');
  const [sites, setSites] = useState<string[]>([]);
  const [phase, setPhase] = useState<PlanItem['phase']>('definitive');
  const [dueOn, setDue] = useState('');
  const [otherName, setOther] = useState('');
  const type = procedureTypeId ? getProcedureType(procedureTypeId) : undefined;
  const canAdd = type && (type.siteKind !== 'tooth' || sites.length > 0) && (type.id !== 'other' || otherName.trim());
  return (
    <div className="space-y-3 rounded-[12px] border border-line p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="pi-proc">Treatment</label>
          <select id="pi-proc" className="field" value={procedureTypeId} onChange={(e) => (setProcedure(e.target.value), setSites([]))}>
            <option value="">Choose…</option>
            {CATEGORY_ORDER.map((c) => (
              <optgroup key={c} label={CATEGORY_LABELS[c]}>
                {PROCEDURE_TYPES.filter((t) => t.category === c).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="pi-phase">Phase</label>
          <select id="pi-phase" className="field" value={phase} onChange={(e) => setPhase(e.target.value as PlanItem['phase'])}>
            {PLAN_PHASES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {type?.id === 'other' && (
        <div>
          <label className="label" htmlFor="pi-other">Treatment name</label>
          <input id="pi-other" className="field" value={otherName} onChange={(e) => setOther(e.target.value)} />
        </div>
      )}
      {type?.siteKind === 'tooth' && <ToothChart selected={sites} onChange={setSites} />}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="pi-due">Due (optional)</label>
          <input id="pi-due" type="date" className="field" value={dueOn} onChange={(e) => setDue(e.target.value)} />
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!canAdd}
          onClick={() => {
            onAdd({ id: newId(), phase, procedureTypeId, sites, status: 'planned', dueOn: dueOn || undefined, otherName: type?.id === 'other' ? otherName.trim() : undefined });
            setProcedure('');
            setSites([]);
            setDue('');
            setOther('');
          }}
        >
          <Plus size={16} aria-hidden="true" /> Add to plan
        </button>
      </div>
      <p className="text-xs text-ink-3">Review intervals are never set for you — choose them clinically.</p>
    </div>
  );
}

export function TreatmentPlanCard({ patientId }: { patientId: string }) {
  const { ds, today } = useInternship();
  const toast = useToast();
  const existing = (ds.treatmentPlans ?? []).filter((p) => p.patientId === patientId).sort((a, b) => b.createdOn.localeCompare(a.createdOn));
  const active = existing.find((p) => p.status === 'active');
  const [draft, setDraft] = useState<TreatmentPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const plan = draft ?? active ?? null;
  const editing = Boolean(draft);

  const start = () =>
    setDraft(
      active
        ? { ...active, items: active.items.map((i) => ({ ...i })) }
        : { id: newId(), internshipId: ds.internship.id, patientId, createdOn: today, status: 'active', items: [], createdAt: '', updatedAt: '' },
    );
  const save = async (p: TreatmentPlan, message: string) => {
    setError(null);
    try {
      await saveTreatmentPlan(p);
      setDraft(null);
      toast(message);
    } catch (err) {
      setError(err instanceof RepoError ? err.message : 'Could not save the plan.');
    }
  };
  const setItem = (id: string, patch: Partial<PlanItem>) => draft && setDraft({ ...draft, items: draft.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });

  if (!plan) {
    return (
      <section className="card p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[16px] font-semibold">Treatment plan</h2>
          <button type="button" className="btn btn-secondary !min-h-9" onClick={start}>
            <ClipboardCheck size={16} aria-hidden="true" /> Create plan
          </button>
        </div>
        <p className="mt-1 text-sm text-ink-2">Plan multi-visit care so the next visit and any handover start from the right place.</p>
        {existing.length > 0 && <p className="mt-2 text-xs text-ink-3">{existing.length} previous plan(s) closed.</p>}
      </section>
    );
  }

  const progress = planProgress(plan);
  const ordered = [...plan.items].sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || PLAN_PHASES.findIndex((p) => p.id === a.phase) - PLAN_PHASES.findIndex((p) => p.id === b.phase));
  const next = orderedOpenItems(plan)[0];

  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[16px] font-semibold">Treatment plan</h2>
          <p className="text-xs text-ink-3">
            Agreed {fmtDate(plan.createdOn)} · {progress.done} of {progress.total} done
          </p>
        </div>
        {!editing ? (
          <button type="button" className="btn btn-secondary !min-h-9" onClick={start}>
            Edit plan
          </button>
        ) : (
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary !min-h-9" onClick={() => save(draft!, 'Plan saved')}>
              Save plan
            </button>
            <button type="button" className="btn btn-ghost !min-h-9" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        )}
      </div>
      <ProgressBar verified={progress.done} pending={0} min={Math.max(progress.total, 1)} color="var(--l3)" />
      {plan.handedOverOn && !editing && (
        <p className="text-xs text-ink-2">
          Handed over {plan.handoverTo ? `to ${plan.handoverTo} ` : ''}on {fmtDate(plan.handedOverOn)}
          {plan.handoverNote ? `: “${plan.handoverNote}”` : ''}
        </p>
      )}
      {next && !editing && (
        <p className="flex items-center gap-1.5 text-sm">
          <CalendarClock size={15} aria-hidden="true" /> Next: <strong>{itemLabel(next)}</strong>
          {next.dueOn && <span className="text-ink-2">due {fmtDate(next.dueOn)}</span>}
        </p>
      )}
      <ul className="divide-y divide-line">
        {ordered.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className={isOpen(i) ? 'font-medium' : 'text-ink-3 line-through decoration-1'}>{itemLabel(i)}</span>
              <span className="block text-xs text-ink-3">
                {PLAN_PHASES.find((p) => p.id === i.phase)?.label}
                {stageText(i) ? ` · ${stageText(i)}` : ''}
                {i.dueOn && isOpen(i) ? ` · due ${fmtDate(i.dueOn)}` : ''}
                {i.completedOn ? ` · completed ${fmtDate(i.completedOn)}` : ''}
              </span>
            </span>
            {editing ? (
              <>
                <select aria-label={`Status of ${itemLabel(i)}`} className="field !min-h-9 !w-auto !py-1 text-sm" value={i.status} onChange={(e) => setItem(i.id, { status: e.target.value as PlanItem['status'] })}>
                  {(Object.keys(ITEM_STATUS_LABELS) as PlanItem['status'][]).map((s) => (
                    <option key={s} value={s}>
                      {ITEM_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
                <button type="button" aria-label={`Remove ${itemLabel(i)}`} className="btn btn-ghost !min-h-9 !px-2" onClick={() => setDraft({ ...draft!, items: draft!.items.filter((x) => x.id !== i.id) })}>
                  <X size={15} />
                </button>
              </>
            ) : (
              <span className="text-xs font-medium text-ink-2">{ITEM_STATUS_LABELS[i.status]}</span>
            )}
          </li>
        ))}
        {plan.items.length === 0 && <li className="py-2 text-sm text-ink-2">No treatments planned yet.</li>}
      </ul>
      {editing && (
        <>
          <AddItem onAdd={(item) => setDraft({ ...draft!, items: [...draft!.items, item] })} />
          <div>
            <label className="label" htmlFor="plan-consent">Consent (optional)</label>
            <input
              id="plan-consent"
              className="field"
              placeholder="e.g. Plan explained; verbal consent documented in hospital file"
              value={draft!.consentNote ?? ''}
              onChange={(e) => setDraft({ ...draft!, consentNote: e.target.value || undefined })}
            />
          </div>
        </>
      )}
      {!editing && progress.open === 0 && plan.items.length > 0 && (
        <ToneNote tone="good">
          All planned treatment is done.{' '}
          <button type="button" className="font-semibold underline underline-offset-2" onClick={() => save({ ...plan, status: 'completed' }, 'Plan closed')}>
            Close the plan
          </button>
        </ToneNote>
      )}
      {!editing && progress.open > 0 && (
        <button type="button" className="text-xs text-ink-3 underline underline-offset-2" onClick={() => window.confirm('Close this plan with treatment still open?') && save({ ...plan, status: 'abandoned' }, 'Plan closed')}>
          Close plan without finishing
        </button>
      )}
      {error && <ToneNote tone="critical">{error}</ToneNote>}
    </section>
  );
}
