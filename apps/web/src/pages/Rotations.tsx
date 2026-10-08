import { addDays, checkRotationCalendar, computeStats, daysBetween, requirementProgress, rotationEnd, summarizeProgress, type Rotation } from '@logbook/core';
import { Plus, UserRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageHeader, ProgressBar, Section, ToneNote, useToast } from '../components/ui';
import { newId, RepoError, saveRotations, saveSupervisor } from '../data/repo';
import { fmtDate, ROTATION_VAR, rotationName } from '../lib/format';
import { analyticsDate, useInternship } from '../state/AppData';

export function RotationsPage() {
  const { ix, ds, today } = useInternship();
  const toast = useToast();
  const asOf = analyticsDate(today, ix);
  const [draft, setDraft] = useState<Rotation[]>(() => ds.rotations.map((r) => ({ ...r })));
  const [dirty, setDirty] = useState(false);
  const issues = checkRotationCalendar(draft, ds.internship.periodFrom);
  const progress = useMemo(() => requirementProgress(ix, asOf), [ix, asOf]);

  const update = (id: string, patch: Partial<Rotation>) => {
    setDraft(draft.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  const save = async () => {
    try {
      const { moved } = await saveRotations(ds.internship.id, draft);
      setDirty(false);
      toast(moved ? `Calendar saved · ${moved} record${moved === 1 ? '' : 's'} moved to the matching rotation` : 'Calendar saved');
    } catch (err) {
      toast(err instanceof RepoError ? err.message : 'Could not save the calendar', 'critical');
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Rotations"
        actions={
          dirty && (
            <button type="button" className="btn btn-primary" onClick={save}>
              Save calendar
            </button>
          )
        }
      >
        Entries are placed in a rotation by date. Change dates or record an extension here and entries move automatically (unless you set one manually).
      </PageHeader>

      {issues.map((i, k) => (
        <ToneNote key={k} tone="warning">
          {i.message}
        </ToneNote>
      ))}

      <ol className="space-y-4">
        {draft.map((r) => {
          const end = rotationEnd(r);
          const stats = computeStats(ix, r.startsOn, end < asOf ? end : asOf);
          const s = summarizeProgress(progress.filter((p) => p.requirement.rotation === r.rotation));
          const status = end < asOf ? 'Completed' : r.startsOn <= asOf ? `In progress · ${daysBetween(asOf, end)} days left` : 'Upcoming';
          return (
            <li key={r.id} className="card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3" style={{ boxShadow: `inset 4px 0 0 ${ROTATION_VAR[r.rotation]}` }}>
                <div>
                  <h2 className="text-[17px] font-semibold">{rotationName(ix, r.rotation)}</h2>
                  <div className="text-xs text-ink-2">
                    {fmtDate(r.startsOn)} – {fmtDate(end)} · {status}
                  </div>
                </div>
                <div className="tabular text-right text-sm text-ink-2">
                  {stats.procedures.total} procedures · {s.met}/{s.codes} codes met
                </div>
              </div>
              <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className="label" htmlFor={`s-${r.id}`}>Start</label>
                  <input id={`s-${r.id}`} type="date" className="field" value={r.startsOn} onChange={(e) => update(r.id, { startsOn: e.target.value })} />
                </div>
                <div>
                  <label className="label" htmlFor={`e-${r.id}`}>Planned end</label>
                  <input id={`e-${r.id}`} type="date" className="field" value={r.endsOn} onChange={(e) => update(r.id, { endsOn: e.target.value })} />
                </div>
                <div>
                  <label className="label" htmlFor={`x-${r.id}`}>Extension (days)</label>
                  <input
                    id={`x-${r.id}`}
                    type="number"
                    min={0}
                    className="field tabular"
                    value={r.extendedByDays}
                    onChange={(e) => update(r.id, { extendedByDays: Math.max(0, Number(e.target.value) || 0) })}
                  />
                  {r.extendedByDays > 0 && <p className="mt-1 text-xs text-ink-3">Ends {fmtDate(addDays(r.endsOn, r.extendedByDays))}</p>}
                </div>
                <div>
                  <label className="label" htmlFor={`sup-${r.id}`}>Supervisor</label>
                  <select id={`sup-${r.id}`} className="field" value={r.supervisorId ?? ''} onChange={(e) => update(r.id, { supervisorId: e.target.value || undefined })}>
                    <option value="">—</option>
                    {ds.supervisors.map((sp) => (
                      <option key={sp.id} value={sp.id}>
                        {sp.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2 lg:col-span-4">
                  <label className="label" htmlFor={`o-${r.id}`}>Objectives</label>
                  <textarea
                    id={`o-${r.id}`}
                    className="field min-h-16"
                    placeholder="Your personal objectives for this rotation"
                    value={r.objectives ?? ''}
                    onChange={(e) => update(r.id, { objectives: e.target.value || undefined })}
                  />
                </div>
              </div>
              <div className="border-t border-line px-4 py-3">
                <ProgressBar verified={s.verifiedTowardMinimum} pending={0} min={s.minimumTotal} color={ROTATION_VAR[r.rotation]} />
                <div className="tabular mt-1 text-xs text-ink-3">
                  {s.verifiedTowardMinimum} of {s.minimumTotal} minimum entries verified
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <Supervisors />
    </div>
  );
}

function Supervisors() {
  const { ix, ds } = useInternship();
  const toast = useToast();
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [rotation, setRotation] = useState('');
  return (
    <Section title="Supervisors">
      <ul className="mb-4 divide-y divide-line">
        {ds.supervisors.map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
            <UserRound size={16} className="text-ink-3" aria-hidden="true" />
            <span className="flex-1">
              {s.name}
              {s.role && <span className="text-ink-3"> · {s.role}</span>}
            </span>
            {s.rotation && <span className="code text-xs text-ink-2">{s.rotation}</span>}
          </li>
        ))}
        {ds.supervisors.length === 0 && <li className="py-2 text-sm text-ink-2">No supervisors yet.</li>}
      </ul>
      <form
        className="grid gap-2 sm:grid-cols-[1fr_1fr_10rem_auto]"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await saveSupervisor({ id: newId(), name, role: role || undefined, rotation: rotation || undefined });
            setName('');
            setRole('');
            toast('Supervisor added');
          } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not add', 'critical');
          }
        }}
      >
        <input className="field" aria-label="Supervisor name" placeholder="Name, e.g. Dr J. Otieno" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="field" aria-label="Role" placeholder="Role (optional)" value={role} onChange={(e) => setRole(e.target.value)} />
        <select className="field" aria-label="Rotation" value={rotation} onChange={(e) => setRotation(e.target.value)}>
          <option value="">Any rotation</option>
          {ds.rotations.map((r) => (
            <option key={r.id} value={r.rotation}>
              {rotationName(ix, r.rotation)}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-secondary" disabled={!name.trim()}>
          <Plus size={16} aria-hidden="true" /> Add
        </button>
      </form>
    </Section>
  );
}
