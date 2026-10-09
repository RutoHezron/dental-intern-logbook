import { ddmmyyyy, handoverList, itemLabel, rotationEnd, stageText, todayISO, type TreatmentPlan } from '@logbook/core';
import { Check, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Empty, PageHeader, Segmented, useToast } from '../components/ui';
import { saveTreatmentPlan } from '../data/repo';
import { fmtDate, rotationName } from '../lib/format';
import { analyticsDate, useInternship } from '../state/AppData';

/**
 * Rotation handover (intern duty 2.3 j): patients with unfinished treatment
 * whose last visit was in the rotation, with a note for the receiving intern.
 */
export function HandoverPage() {
  const { ix, ds, today, state } = useInternship();
  const toast = useToast();
  const asOf = analyticsDate(today, ix);
  const [params, setParams] = useSearchParams();
  const started = [...ds.rotations].sort((a, b) => a.startsOn.localeCompare(b.startsOn)).filter((r) => r.startsOn <= asOf);
  const rotationId = params.get('rotation') ?? started.at(-1)?.id ?? ds.rotations[0]!.id;
  const rotation = ds.rotations.find((r) => r.id === rotationId)!;
  const rows = useMemo(() => handoverList(ix, ds.treatmentPlans ?? [], rotation), [ix, ds.treatmentPlans, rotation]);
  const [view, setView] = useState<'list' | 'print'>('list');
  const [notes, setNotes] = useState<Record<string, { note: string; to: string }>>({});
  const value = (p: TreatmentPlan) => notes[p.id] ?? { note: p.handoverNote ?? '', to: p.handoverTo ?? '' };

  const save = async (p: TreatmentPlan) => {
    const v = value(p);
    await saveTreatmentPlan({ ...p, handoverNote: v.note.trim() || undefined, handoverTo: v.to.trim() || undefined, handedOverOn: todayISO() });
    toast('Handover saved');
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print">
        <PageHeader
          title="Rotation handover"
          actions={
            <>
              <Segmented
                label="View"
                value={view}
                onChange={setView}
                options={[
                  { value: 'list', label: 'Prepare' },
                  { value: 'print', label: 'Print view' },
                ]}
              />
              {view === 'print' && (
                <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
                  <Printer size={16} aria-hidden="true" /> Print
                </button>
              )}
            </>
          }
        >
          Patients whose treatment is unfinished when you leave a rotation, so the next intern can continue it.
        </PageHeader>
        <div className="mb-4">
          <label className="label" htmlFor="hrot">Rotation</label>
          <select id="hrot" className="field !w-auto" value={rotationId} onChange={(e) => setParams({ rotation: e.target.value }, { replace: true })}>
            {started.map((r) => (
              <option key={r.id} value={r.id}>
                {rotationName(ix, r.rotation)} (ends {fmtDate(rotationEnd(r))})
              </option>
            ))}
          </select>
        </div>
      </div>

      {rows.length === 0 ? (
        <Empty title="No unfinished treatment to hand over">Patients appear here when they have an active treatment plan with open items and were last seen in this rotation.</Empty>
      ) : view === 'list' ? (
        <ul className="space-y-3">
          {rows.map((r) => {
            const v = value(r.plan);
            return (
              <li key={r.plan.id} className="card space-y-3 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link to={`/patients/${r.plan.patientId}`} className="code font-semibold underline-offset-2 hover:underline">
                    {r.patient?.ref ?? '—'}
                  </Link>
                  <span className="text-xs text-ink-3">{r.lastVisit ? `last seen ${fmtDate(r.lastVisit)}` : 'not yet seen'}</span>
                </div>
                <ul className="space-y-0.5 text-sm">
                  {r.openItems.map((i) => (
                    <li key={i.id}>
                      {itemLabel(i)}
                      <span className="text-ink-2">{stageText(i) ? ` — ${stageText(i)}` : i.dueOn ? ` — due ${fmtDate(i.dueOn)}` : ''}</span>
                    </li>
                  ))}
                </ul>
                <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
                  <input
                    className="field"
                    aria-label={`Handover note for ${r.patient?.ref}`}
                    placeholder="Handover note, e.g. temporary dressing in place; obturate at next visit"
                    value={v.note}
                    onChange={(e) => setNotes({ ...notes, [r.plan.id]: { ...v, note: e.target.value } })}
                  />
                  <input
                    className="field"
                    aria-label={`Receiving intern for ${r.patient?.ref}`}
                    placeholder="Receiving intern"
                    value={v.to}
                    onChange={(e) => setNotes({ ...notes, [r.plan.id]: { ...v, to: e.target.value } })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-ink-3">{r.plan.handedOverOn ? `Handover saved ${fmtDate(r.plan.handedOverOn)}` : 'Not handed over yet'}</span>
                  <button type="button" className="btn btn-secondary !min-h-9" onClick={() => save(r.plan)}>
                    <Check size={15} aria-hidden="true" /> Save handover
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="paper-sheet">
          <h1 className="paper-h2">Rotation handover — {rotationName(ix, rotation.rotation)}</h1>
          <p className="mb-3 text-[9.5pt]">
            Handed over by {ds.internship.internName} · {state.facility?.name ?? ds.internship.institution} · rotation {ddmmyyyy(rotation.startsOn)} – {ddmmyyyy(rotationEnd(rotation))}
          </p>
          <table className="paper-table">
            <thead>
              <tr>
                <th className="w-[15%]">PATIENT NO.</th>
                <th>UNFINISHED TREATMENT</th>
                <th className="w-[13%]">LAST SEEN</th>
                <th className="w-[26%]">HANDOVER NOTE</th>
                <th className="w-[16%]">RECEIVED BY</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.plan.id}>
                  <td className="text-center">{r.patient?.ref}</td>
                  <td className="text-[9pt]">
                    {r.openItems.map((i) => (
                      <div key={i.id}>
                        {itemLabel(i)}
                        {stageText(i) ? ` (${stageText(i)!.split(';')[0]})` : ''}
                      </div>
                    ))}
                  </td>
                  <td className="text-center">{r.lastVisit ? ddmmyyyy(r.lastVisit) : ''}</td>
                  <td className="text-[9pt]">{value(r.plan).note}</td>
                  <td className="text-[9pt]">{value(r.plan).to}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4 text-[8.5pt]">Hospital numbers only; the hospital file remains the clinical record.</p>
        </div>
      )}
    </div>
  );
}
