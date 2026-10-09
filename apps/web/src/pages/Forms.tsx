import {
  assessmentSchedule,
  assessmentStatus,
  criteriaFor,
  ddmmyyyy,
  displayDate,
  formSectionNumber,
  FORMS_VERSION,
  GRADE_DESCRIPTIONS,
  KIND_LABELS,
  MID_ROTATION_SECTIONS,
  MONTHLY_SECTIONS,
  OUTCOME_LABELS,
  OVERALL_SECTIONS,
  progressSnapshot,
  progressSummaryText,
  rotationEnd,
  validateAssessment,
  type Assessment,
  type AssessmentKind,
  type FormSection,
  type Grade,
  type Rotation,
} from '@logbook/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, ChevronRight, CircleDashed, Clock, Printer, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { PageHeader, RotationDot, Segmented, ToneNote, useToast } from '../components/ui';
import { db } from '../data/db';
import { newId, RepoError, saveAssessment } from '../data/repo';
import { fmtDate, rotationName } from '../lib/format';
import { analyticsDate, useInternship } from '../state/AppData';
import { CompletionPanel } from './InternshipForms';

const SECTIONS_FOR: Partial<Record<AssessmentKind, FormSection[]>> = {
  monthly: MONTHLY_SECTIONS,
  mid_rotation: MID_ROTATION_SECTIONS,
  overall_rotation: OVERALL_SECTIONS,
};

const formTitle = (kind: AssessmentKind, sequence: number) => (kind === 'monthly' ? `${KIND_LABELS.monthly} — month ${sequence === 1 ? 'one' : 'two'}` : KIND_LABELS[kind]);

// ===========================================================================
// List
// ===========================================================================

export function FormsPage() {
  const { ix, ds, today } = useInternship();
  const asOf = analyticsDate(today, ix);
  const assessments = useLiveQuery(() => db.assessments.toArray(), []) ?? [];
  const find = (r: Rotation, kind: AssessmentKind, seq: number) => assessments.find((a) => a.rotationId === r.id && a.kind === kind && a.sequence === seq && !a.deletedAt);
  // Once the last rotation has started, the completion paperwork moves to the top.
  const nearEnd = [...ds.rotations].sort((x, y) => x.startsOn.localeCompare(y.startsOn)).at(-1)!.startsOn <= asOf;
  const ordered = [...ds.rotations].sort((a, b) => {
    const cur = (r: Rotation) => (r.startsOn <= asOf && rotationEnd(r) >= asOf ? 0 : r.startsOn > asOf ? 1 : 2);
    return cur(a) - cur(b) || a.startsOn.localeCompare(b.startsOn);
  });

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Assessment forms">
        The KMPDC monthly, mid-rotation, end-of-rotation and overall forms, with your details and logbook progress filled in. Complete them at the meeting, then
        print for signatures and stamps.
      </PageHeader>
      {nearEnd && <CompletionPanel />}
      {ordered.map((r) => (
        <section key={r.id} className="card overflow-hidden">
          <h2 className="flex items-center gap-2 border-b border-line px-4 py-3 text-[17px] font-semibold">
            <RotationDot code={r.rotation} size={10} /> {rotationName(ix, r.rotation)}
            <span className="ml-auto text-xs font-normal text-ink-3">
              {fmtDate(r.startsOn)} – {fmtDate(rotationEnd(r))}
            </span>
          </h2>
          <ul className="divide-y divide-line">
            {assessmentSchedule(r).map((f) => {
              const a = find(r, f.kind, f.sequence);
              const status = assessmentStatus(a, r.rotation);
              const overdue = status !== 'complete' && f.due < asOf;
              return (
                <li key={`${f.kind}-${f.sequence}`}>
                  <Link to={`/forms/${r.id}/${f.kind}/${f.sequence}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                    {status === 'complete' ? (
                      <CheckCircle2 size={18} className="shrink-0 text-good-ink" aria-label="Complete" />
                    ) : status === 'in_progress' ? (
                      <Clock size={18} className="shrink-0 text-warning-ink" aria-label="In progress" />
                    ) : (
                      <CircleDashed size={18} className="shrink-0 text-ink-3" aria-label="Not started" />
                    )}
                    <span className="flex-1">
                      <span className="block text-sm font-medium">{formTitle(f.kind, f.sequence)}</span>
                      <span className={`block text-xs ${overdue ? 'text-critical-ink' : 'text-ink-3'}`}>
                        {status === 'complete' ? 'Complete' : status === 'in_progress' ? 'In progress' : 'Not started'} · due {fmtDate(f.due)}
                        {overdue ? ' · overdue' : ''}
                      </span>
                    </span>
                    <ChevronRight size={16} className="text-ink-3" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {!nearEnd && <CompletionPanel />}
    </div>
  );
}

// ===========================================================================
// Editor
// ===========================================================================

export function FormEditorPage() {
  const { rotationId = '', kind: kindParam = 'monthly', sequence: seqParam = '1' } = useParams();
  const kind = kindParam as AssessmentKind;
  const sequence = Number(seqParam) || 1;
  const { ix, ds, state, today } = useInternship();
  const rotation = ds.rotations.find((r) => r.id === rotationId);
  const existing = useLiveQuery(
    // null = no saved form yet; undefined = still loading.
    async () => (await db.assessments.where('rotationId').equals(rotationId).filter((a) => a.kind === kind && a.sequence === sequence && !a.deletedAt).first()) ?? null,
    [rotationId, kind, sequence],
  );
  if (!rotation) return <PageHeader title="Form not found" />;
  // Wait for the first read so the editor starts from what is saved.
  if (existing === undefined) return <div className="py-10 text-sm text-ink-3">Loading…</div>;
  return <Editor key={existing?.id ?? 'new'} rotation={rotation} kind={kind} sequence={sequence} existing={existing ?? null} centre={state.facility?.name ?? ds.internship.institution ?? ''} asOf={analyticsDate(today, ix)} />;
}

function blank(rotation: Rotation, kind: AssessmentKind, sequence: number, internshipId: string): Assessment {
  return {
    id: newId(),
    internshipId,
    rotationId: rotation.id,
    kind,
    sequence,
    formVersion: FORMS_VERSION,
    responses: {},
    grades: {},
    gradeRemarks: {},
    createdAt: '',
    updatedAt: '',
  };
}

function Editor({ rotation, kind, sequence, existing, centre, asOf }: { rotation: Rotation; kind: AssessmentKind; sequence: number; existing: Assessment | null; centre: string; asOf: string }) {
  const { ix, ds } = useInternship();
  const toast = useToast();
  const navigate = useNavigate();
  const [a, setA] = useState<Assessment>(() => existing ?? blank(rotation, kind, sequence, ds.internship.id));
  const [view, setView] = useState<'fill' | 'print'>('fill');
  const [error, setError] = useState<string | null>(null);
  const issues = validateAssessment(a, rotation.rotation);
  const sections = SECTIONS_FOR[kind];
  const snapshotDate = a.heldOn && a.heldOn <= asOf ? a.heldOn : asOf;
  const set = (id: string, text: string) => setA({ ...a, responses: { ...a.responses, [id]: text } });

  const save = async () => {
    setError(null);
    try {
      const withEvidence = kind === 'overall_rotation' ? a : { ...a, progressSnapshot: progressSnapshot(ix, rotation, snapshotDate) };
      await saveAssessment(withEvidence, rotation.rotation);
      setA(withEvidence);
      toast('Form saved');
    } catch (err) {
      setError(err instanceof RepoError ? err.message : 'Could not save the form.');
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print">
        <PageHeader
          eyebrow={`${rotationName(ix, rotation.rotation)} · ${formSectionNumber(ds.requirementSet.rotations.find((r) => r.code === rotation.rotation)?.section ?? '', kind, rotation.rotation)}`}
          title={formTitle(kind, sequence)}
          actions={
            <>
              <Segmented
                label="View"
                value={view}
                onChange={setView}
                options={[
                  { value: 'fill', label: 'Fill in' },
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
          {ds.internship.internName} · {fmtDate(rotation.startsOn)} – {fmtDate(rotationEnd(rotation))}
        </PageHeader>
      </div>

      {view === 'print' ? (
        <div className="paper-sheet">
          <PaperForm a={a} rotation={rotation} centre={centre} />
        </div>
      ) : (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {kind === 'monthly' && (
            <div className="card grid grid-cols-2 gap-3 p-4">
              <div>
                <label className="label" htmlFor="heldOn">Meeting date</label>
                <input id="heldOn" type="date" className="field" value={a.heldOn ?? ''} onChange={(e) => setA({ ...a, heldOn: e.target.value || undefined })} />
              </div>
              <div>
                <label className="label" htmlFor="heldAt">Time</label>
                <input id="heldAt" type="time" className="field" value={a.heldAt ?? ''} onChange={(e) => setA({ ...a, heldAt: e.target.value || undefined })} />
              </div>
            </div>
          )}

          {sections?.map((s) => (
            <section key={s.id} className="card space-y-3 p-4">
              <h2 className="text-[16px] font-semibold">{s.title}</h2>
              {s.items.map((item) => (
                <div key={item.id}>
                  <div className="flex items-end justify-between gap-2">
                    <label className="label" htmlFor={`r-${item.id}`}>
                      {s.items.length > 1 ? `${item.id.slice(1)}. ` : ''}
                      {item.label}
                    </label>
                    {item.id === 'b2' && (
                      <button type="button" className="mb-1.5 inline-flex items-center gap-1 text-xs font-semibold underline underline-offset-2" onClick={() => set('b2', progressSummaryText(ix, rotation, snapshotDate))}>
                        <Wand2 size={13} aria-hidden="true" /> Fill from logbook
                      </button>
                    )}
                  </div>
                  <textarea id={`r-${item.id}`} className="field min-h-20" value={a.responses[item.id] ?? ''} onChange={(e) => set(item.id, e.target.value)} />
                </div>
              ))}
            </section>
          ))}

          {kind === 'end_of_rotation' && <GradesEditor a={a} setA={setA} rotation={rotation} />}

          {kind === 'overall_rotation' && (
            <section className="card space-y-3 p-4">
              <h2 className="text-[16px] font-semibold">Assessment by Medical Superintendent / Medical Director</h2>
              <div role="radiogroup" aria-label="Outcome" className="space-y-2">
                {(Object.keys(OUTCOME_LABELS) as (keyof typeof OUTCOME_LABELS)[]).map((o) => (
                  <label key={o} className="flex items-start gap-2 text-sm">
                    <input type="radio" name="outcome" className="mt-1 h-4 w-4 accent-[var(--accent)]" checked={a.outcome === o} onChange={() => setA({ ...a, outcome: o })} />
                    {OUTCOME_LABELS[o]}
                  </label>
                ))}
              </div>
              {a.outcome === 'extend' && (
                <div>
                  <label className="label" htmlFor="extendBy">Extension period</label>
                  <input id="extendBy" className="field" placeholder="e.g. 4 weeks" value={a.extendBy ?? ''} onChange={(e) => setA({ ...a, extendBy: e.target.value || undefined })} />
                  <p className="mt-1 text-xs text-ink-3">Record the extension under Rotations so the calendar and all forms update.</p>
                </div>
              )}
            </section>
          )}

          {kind !== 'overall_rotation' && <SnapshotPanel rotation={rotation} asOf={snapshotDate} />}

          {issues
            .filter((i) => i.level !== 'info')
            .map((i, k) => (
              <ToneNote key={k} tone={i.level === 'error' ? 'critical' : 'warning'}>
                {i.message}
              </ToneNote>
            ))}
          {error && <ToneNote tone="critical">{error}</ToneNote>}
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary flex-1">
              Save form
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => navigate('/forms')}>
              Back to forms
            </button>
          </div>
          <p className="text-xs text-ink-3">Signatures, names and stamps go on the printed form until KMPDC accepts digital sign-off.</p>
        </form>
      )}
    </div>
  );
}

function GradeButtons({ value, onChange, label }: { value: Grade | undefined; onChange: (g: Grade) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1">
      {([3, 2, 1, 0] as Grade[]).map((g) => (
        <button key={g} type="button" role="radio" aria-checked={value === g} title={GRADE_DESCRIPTIONS[g]} aria-label={`${g}: ${GRADE_DESCRIPTIONS[g]}`} className="chip code !min-h-10 !min-w-10 justify-center !px-0" onClick={() => onChange(g)}>
          {g}
        </button>
      ))}
    </div>
  );
}

function GradesEditor({ a, setA, rotation }: { a: Assessment; setA: (a: Assessment) => void; rotation: Rotation }) {
  const groups = criteriaFor(rotation.rotation);
  return (
    <section className="card space-y-4 p-4">
      <div>
        <h2 className="text-[16px] font-semibold">Grades</h2>
        <ul className="mt-2 grid gap-1 text-xs text-ink-2 sm:grid-cols-2">
          {([3, 2, 1, 0] as Grade[]).map((g) => (
            <li key={g}>
              <strong className="code text-ink">{g}</strong> {GRADE_DESCRIPTIONS[g]}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-ink-3">A grade of 0 or 1 requires reasons and recommendations in the interest of the intern and the public.</p>
      </div>
      {groups.map((g) => (
        <div key={g.title}>
          <h3 className="mb-2 text-sm font-semibold">{g.title}</h3>
          <ul className="space-y-3">
            {g.criteria.map((c) => {
              const grade = a.grades[c.id];
              const needs = grade === 0 || grade === 1;
              return (
                <li key={c.id} className="rounded-[10px] border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm">{c.label}</span>
                    <GradeButtons label={c.label} value={grade} onChange={(v) => setA({ ...a, grades: { ...a.grades, [c.id]: v } })} />
                  </div>
                  {(needs || a.gradeRemarks[c.id]) && (
                    <input
                      className="field mt-2"
                      aria-label={`Remarks: ${c.label}`}
                      placeholder={needs ? 'Reasons and recommendations (required)' : 'Remarks'}
                      value={a.gradeRemarks[c.id] ?? ''}
                      onChange={(e) => setA({ ...a, gradeRemarks: { ...a.gradeRemarks, [c.id]: e.target.value } })}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <span className="text-sm font-semibold">Overall grade</span>
        <GradeButtons label="Overall grade" value={a.overallGrade} onChange={(v) => setA({ ...a, overallGrade: v })} />
      </div>
      <div>
        <label className="label" htmlFor="recommendation">Internship Supervisor&rsquo;s recommendation</label>
        <textarea id="recommendation" className="field min-h-20" value={a.recommendation ?? ''} onChange={(e) => setA({ ...a, recommendation: e.target.value || undefined })} />
      </div>
    </section>
  );
}

function SnapshotPanel({ rotation, asOf }: { rotation: Rotation; asOf: string }) {
  const { ix } = useInternship();
  const snap = progressSnapshot(ix, rotation, asOf);
  return (
    <details className="card p-4">
      <summary className="cursor-pointer text-sm font-semibold">Logbook progress attached as evidence ({displayDate(asOf)})</summary>
      <table className="mt-3 w-full text-sm">
        <tbody className="tabular">
          {snap.codes.map((c) => (
            <tr key={c.code} className="border-t border-line">
              <td className="code py-1">{c.code}</td>
              <td className="py-1 text-right">
                {c.verified}/{c.min}
              </td>
              <td className="py-1 pl-3 text-xs text-ink-2">{c.status.replace('_', ' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

// ===========================================================================
// Paper form
// ===========================================================================

function SignLine({ label, withQualification = false }: { label: string; withQualification?: boolean }) {
  const cell = (t: string) => (
    <div className="flex items-baseline gap-2">
      <span className="shrink-0">{t}</span>
      <span className="flex-1 border-b border-dotted border-black">&nbsp;</span>
    </div>
  );
  return (
    <div className="mt-2 grid grid-cols-3 gap-4 text-[9.5pt]">
      {cell(`${label} name`)}
      {withQualification ? cell('Qualification') : cell('Signature')}
      {cell('Date')}
      {withQualification && cell('KMPDC reg. no.')}
      {withQualification && cell('Signature')}
      {withQualification && cell('Stamp')}
    </div>
  );
}

function PaperForm({ a, rotation, centre }: { a: Assessment; rotation: Rotation; centre: string }) {
  const { ix, ds } = useInternship();
  const sectionNo = formSectionNumber(ds.requirementSet.rotations.find((r) => r.code === rotation.rotation)?.section ?? '', a.kind, rotation.rotation);
  const name = rotationName(ix, rotation.rotation);
  const title =
    a.kind === 'monthly'
      ? `Monthly Assessment in the ${name} rotation`
      : a.kind === 'mid_rotation'
        ? `Mid-Rotation Assessment in the ${name} rotation`
        : a.kind === 'end_of_rotation'
          ? `End-of-Rotation Evaluation in ${name}`
          : `Overall assessment in the ${name} rotation`;
  const Field = ({ label, value }: { label: string; value?: string }) => (
    <div className="flex items-baseline gap-2">
      <span className="shrink-0">{label}</span>
      <span className="flex-1 border-b border-dotted border-black pb-0.5 font-medium">{value || ' '}</span>
    </div>
  );
  const Box = ({ text }: { text?: string }) => <div className="min-h-[18mm] whitespace-pre-wrap border border-black p-2 text-[9.5pt]">{text}</div>;
  return (
    <article className="text-[10pt]">
      <h1 className="paper-h2">
        {sectionNo}. {title}
      </h1>
      <div className="mb-4 space-y-2">
        <Field label="Full name of intern" value={ds.internship.internName} />
        <div className="grid grid-cols-2 gap-4">
          <Field label="National ID/ passport no." />
          <Field label="Internship Training Centre" value={centre} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Rotation period from" value={ddmmyyyy(rotation.startsOn)} />
          <Field label="to" value={ddmmyyyy(rotationEnd(rotation))} />
        </div>
        {a.kind === 'monthly' && (
          <div className="grid grid-cols-2 gap-4">
            <Field label={`MONTH ${a.sequence === 1 ? 'ONE' : 'TWO'}: Date`} value={a.heldOn ? ddmmyyyy(a.heldOn) : ''} />
            <Field label="Time" value={a.heldAt} />
          </div>
        )}
      </div>

      {SECTIONS_FOR[a.kind]?.map((s) => (
        <section key={s.id} className="mb-4 break-inside-avoid">
          <h2 className="mb-1.5 text-[10pt] font-bold uppercase">{s.title}</h2>
          {s.items.length > 1 ? (
            <table className="paper-table">
              <tbody>
                {s.items.map((item, i) => (
                  <tr key={item.id}>
                    <td className="w-[38%] align-top text-[9pt]">
                      {['i', 'ii', 'iii', 'iv', 'v'][i]}. {item.label}
                    </td>
                    <td className="whitespace-pre-wrap align-top text-[9.5pt]">{a.responses[item.id]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Box text={a.responses[s.items[0]!.id]} />
          )}
          <SignLine label={s.id === 'intern' ? 'Intern' : s.id === 'supervisor' ? 'Supervisor' : 'Coordinator'} withQualification={a.kind === 'overall_rotation'} />
        </section>
      ))}

      {a.kind === 'end_of_rotation' && (
        <>
          <table className="paper-table paper-small mb-3">
            <thead>
              <tr>
                <th className="w-[10%]">GRADE</th>
                <th>DESCRIPTION</th>
              </tr>
            </thead>
            <tbody>
              {([3, 2, 1, 0] as Grade[]).map((g) => (
                <tr key={g}>
                  <td className="text-center">{g}</td>
                  <td>{GRADE_DESCRIPTIONS[g]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="paper-table">
            <thead>
              <tr>
                <th>CRITERIA</th>
                <th className="w-[10%]">GRADE</th>
                <th className="w-[40%]">REMARKS</th>
              </tr>
            </thead>
            <tbody>
              {criteriaFor(rotation.rotation).flatMap((g) => [
                <tr key={g.title}>
                  <td colSpan={3} className="font-bold uppercase">
                    {g.title}
                  </td>
                </tr>,
                ...g.criteria.map((c, i) => (
                  <tr key={c.id}>
                    <td className="text-[9pt]">
                      {String.fromCharCode(97 + i)}. {c.label}
                    </td>
                    <td className="text-center font-semibold">{a.grades[c.id] ?? ''}</td>
                    <td className="text-[9pt]">{a.gradeRemarks[c.id]}</td>
                  </tr>
                )),
              ])}
              <tr>
                <td className="font-bold">OVERALL GRADE</td>
                <td className="text-center font-semibold">{a.overallGrade ?? ''}</td>
                <td />
              </tr>
            </tbody>
          </table>
          <h2 className="mb-1.5 mt-3 text-[10pt] font-bold uppercase">Internship Supervisor&rsquo;s recommendation</h2>
          <Box text={a.recommendation} />
          <SignLine label="Supervisor" />
        </>
      )}

      {a.kind === 'overall_rotation' && (
        <section className="mb-4 break-inside-avoid">
          <h2 className="mb-1.5 text-[10pt] font-bold uppercase">Assessment by Medical Superintendent / Medical Director</h2>
          <p className="mb-1 text-[9.5pt]">SELECT ONE:</p>
          <ul className="space-y-1 text-[9.5pt]">
            {(Object.keys(OUTCOME_LABELS) as (keyof typeof OUTCOME_LABELS)[]).map((o) => (
              <li key={o}>
                {a.outcome === o ? '☒' : '☐'} {OUTCOME_LABELS[o]}
                {o === 'extend' && ` ${a.outcome === 'extend' ? a.extendBy ?? '' : '. . . . . . . . .'}`}
              </li>
            ))}
          </ul>
          <SignLine label="Med. Sup." withQualification />
        </section>
      )}

      {a.progressSnapshot && a.kind !== 'overall_rotation' && (
        <section className="mt-4 break-inside-avoid">
          <h2 className="mb-1 text-[9pt] font-bold">Attachment: logbook progress on {ddmmyyyy(a.progressSnapshot.asOf)} (verified / minimum)</h2>
          <p className="text-[8.5pt]">{a.progressSnapshot.codes.map((c) => `${c.code} ${c.verified}/${c.min}`).join(' · ')}</p>
        </section>
      )}
    </article>
  );
}
