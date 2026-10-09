import {
  completionReadiness,
  completionRemarkId,
  ddmmyyyy,
  END_OF_INTERNSHIP_SECTIONS,
  FORMS_VERSION,
  INTERNSHIP_OUTCOME_LABELS,
  KIND_LABELS,
  assessmentStatus,
  rotationEnd,
  validateAssessment,
  type Assessment,
  type InternshipFormKind,
} from '@logbook/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, ChevronRight, CircleDashed, Clock, Printer, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { PageHeader, Segmented, ToneNote, useToast } from '../components/ui';
import { db } from '../data/db';
import { newId, RepoError, saveAssessment } from '../data/repo';
import { fmtDate, rotationName } from '../lib/format';
import { analyticsDate, useInternship } from '../state/AppData';

const KINDS: InternshipFormKind[] = ['end_of_internship', 'completion_verification'];

/** End-of-internship paperwork and a readiness checklist (shown on the forms list). */
export function CompletionPanel() {
  const { ix, ds, today } = useInternship();
  const asOf = analyticsDate(today, ix);
  const assessments = useLiveQuery(() => db.assessments.toArray(), []) ?? [];
  const readiness = completionReadiness(ix, assessments, asOf);
  const ready = readiness.filter((r) => r.ok).length;
  const [open, setOpen] = useState(false);
  return (
    <section className="card overflow-hidden">
      <h2 className="flex items-center gap-2 border-b border-line px-4 py-3 text-[17px] font-semibold">
        End of internship
        <span className="ml-auto text-xs font-normal text-ink-3">ends {fmtDate(ds.internship.periodTo)}</span>
      </h2>
      <ul className="divide-y divide-line">
        {KINDS.map((kind) => {
          const a = assessments.find((x) => x.kind === kind && !x.deletedAt);
          const status = assessmentStatus(a, '');
          return (
            <li key={kind}>
              <Link to={`/forms/internship/${kind}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                {status === 'complete' ? (
                  <CheckCircle2 size={18} className="shrink-0 text-good-ink" aria-label="Complete" />
                ) : status === 'in_progress' ? (
                  <Clock size={18} className="shrink-0 text-warning-ink" aria-label="In progress" />
                ) : (
                  <CircleDashed size={18} className="shrink-0 text-ink-3" aria-label="Not started" />
                )}
                <span className="flex-1">
                  <span className="block text-sm font-medium">
                    {kind === 'end_of_internship' ? '5.8' : '5.9'} {KIND_LABELS[kind]}
                  </span>
                  <span className="block text-xs text-ink-3">{status === 'complete' ? 'Complete' : status === 'in_progress' ? 'In progress' : 'Not started'}</span>
                </span>
                <ChevronRight size={16} className="text-ink-3" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-line px-4 py-3">
        <button type="button" className="flex w-full items-center justify-between text-sm font-semibold" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span>Ready for KMPDC?</span>
          <span className="tabular text-xs font-normal text-ink-2">
            {ready} of {readiness.length} checks done
          </span>
        </button>
        {open && (
          <ul className="mt-3 space-y-2">
            {readiness.map((r) => (
              <li key={r.id} className="flex items-start gap-2 text-sm">
                {r.ok ? (
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-good-ink" aria-label="Done" />
                ) : (
                  <XCircle size={16} className="mt-0.5 shrink-0 text-critical-ink" aria-label="Not yet" />
                )}
                <span>
                  {r.label}
                  {r.detail && <span className="block text-xs text-ink-2">{r.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function InternshipFormEditorPage() {
  const { kind: kindParam = '' } = useParams();
  const kind = kindParam as InternshipFormKind;
  const existing = useLiveQuery(async () => (await db.assessments.filter((a) => a.kind === kind && !a.deletedAt).first()) ?? null, [kind]);
  if (!KINDS.includes(kind)) return <PageHeader title="Form not found" />;
  if (existing === undefined) return <div className="py-10 text-sm text-ink-3">Loading…</div>;
  return <Editor key={existing?.id ?? 'new'} kind={kind} existing={existing} />;
}

function Editor({ kind, existing }: { kind: InternshipFormKind; existing: Assessment | null }) {
  const { ix, ds, state } = useInternship();
  const toast = useToast();
  const navigate = useNavigate();
  const rotations = [...ds.rotations].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const [a, setA] = useState<Assessment>(
    () =>
      existing ?? {
        id: newId(),
        internshipId: ds.internship.id,
        rotationId: null,
        kind,
        sequence: 1,
        formVersion: FORMS_VERSION,
        // 5.9 starts with an empty remark per rotation so completeness can be judged.
        responses: kind === 'completion_verification' ? Object.fromEntries(rotations.map((r) => [completionRemarkId(r.rotation), ''])) : {},
        grades: {},
        gradeRemarks: {},
        createdAt: '',
        updatedAt: '',
      },
  );
  const [view, setView] = useState<'fill' | 'print'>('fill');
  const [error, setError] = useState<string | null>(null);
  const issues = validateAssessment(a, '');
  const set = (id: string, text: string) => setA({ ...a, responses: { ...a.responses, [id]: text } });
  const centre = state.facility?.name ?? ds.internship.institution ?? '';

  const save = async () => {
    setError(null);
    try {
      await saveAssessment(a, '');
      toast('Form saved');
    } catch (err) {
      setError(err instanceof RepoError ? err.message : 'Could not save the form.');
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print">
        <PageHeader
          eyebrow={kind === 'end_of_internship' ? 'KMPDC 5.8' : 'KMPDC 5.9'}
          title={KIND_LABELS[kind]}
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
          {ds.internship.internName} · internship {fmtDate(ds.internship.periodFrom)} – {fmtDate(ds.internship.periodTo)}
        </PageHeader>
      </div>

      {view === 'print' ? (
        <div className="paper-sheet">
          {kind === 'end_of_internship' ? <PaperEndOfInternship a={a} centre={centre} /> : <PaperCompletion a={a} centre={centre} />}
        </div>
      ) : (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {kind === 'end_of_internship' ? (
            <>
              {END_OF_INTERNSHIP_SECTIONS.map((s) => (
                <section key={s.id} className="card space-y-2 p-4">
                  <h2 className="text-[16px] font-semibold">{s.title}</h2>
                  <label className="label" htmlFor={`r-${s.items[0]!.id}`}>{s.items[0]!.label}</label>
                  <textarea id={`r-${s.items[0]!.id}`} className="field min-h-24" value={a.responses[s.items[0]!.id] ?? ''} onChange={(e) => set(s.items[0]!.id, e.target.value)} />
                </section>
              ))}
              <section className="card space-y-3 p-4">
                <h2 className="text-[16px] font-semibold">Medical Superintendent / Medical Director — select one</h2>
                <div role="radiogroup" aria-label="Outcome" className="space-y-2">
                  {(Object.keys(INTERNSHIP_OUTCOME_LABELS) as (keyof typeof INTERNSHIP_OUTCOME_LABELS)[]).map((o) => (
                    <label key={o} className="flex items-start gap-2 text-sm">
                      <input type="radio" name="outcome" className="mt-1 h-4 w-4 accent-[var(--accent)]" checked={a.outcome === o} onChange={() => setA({ ...a, outcome: o })} />
                      {INTERNSHIP_OUTCOME_LABELS[o]}
                    </label>
                  ))}
                </div>
                {a.outcome === 'extend' && (
                  <div>
                    <label className="label" htmlFor="extendBy">Extension period</label>
                    <input id="extendBy" className="field" placeholder="e.g. 8 weeks" value={a.extendBy ?? ''} onChange={(e) => setA({ ...a, extendBy: e.target.value || undefined })} />
                  </div>
                )}
              </section>
            </>
          ) : (
            <section className="card space-y-4 p-4">
              <h2 className="text-[16px] font-semibold">Dental Internship Coordinator&rsquo;s remarks per rotation</h2>
              <p className="text-sm text-ink-2">Rotation dates are taken from your calendar, including any extensions.</p>
              {rotations.map((r) => {
                const id = completionRemarkId(r.rotation);
                return (
                  <div key={r.id}>
                    <label className="label" htmlFor={`v-${id}`}>
                      {rotationName(ix, r.rotation)} · {fmtDate(r.startsOn)} – {fmtDate(rotationEnd(r))}
                    </label>
                    <input id={`v-${id}`} className="field" placeholder="e.g. Completed satisfactorily" value={a.responses[id] ?? ''} onChange={(e) => set(id, e.target.value)} />
                  </div>
                );
              })}
            </section>
          )}
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
          <p className="text-xs text-ink-3">Names, signatures, qualifications, KMPDC registration numbers and stamps go on the printed form.</p>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paper versions
// ---------------------------------------------------------------------------

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="shrink-0">{label}</span>
      <span className="flex-1 border-b border-dotted border-black pb-0.5 font-medium">{value || ' '}</span>
    </div>
  );
}

function Lines({ items }: { items: string[] }) {
  return (
    <div className="mt-2 grid grid-cols-3 gap-x-4 gap-y-2 text-[9.5pt]">
      {items.map((t) => (
        <Field key={t} label={t} />
      ))}
    </div>
  );
}

function PaperEndOfInternship({ a, centre }: { a: Assessment; centre: string }) {
  const { ds } = useInternship();
  return (
    <article className="text-[10pt]">
      <h1 className="paper-h1">5.8. END OF DENTAL INTERNSHIP TRAINING EVALUATION</h1>
      <div className="mb-5 space-y-2">
        <Field label="Full name of intern" value={ds.internship.internName} />
        <Field label="National ID/ passport no." />
        <Field label="Internship Training Centre" value={centre} />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Internship period from" value={ddmmyyyy(ds.internship.periodFrom)} />
          <Field label="to" value={ddmmyyyy(ds.internship.periodTo)} />
        </div>
      </div>
      <h2 className="mb-1.5 text-[10pt] font-bold uppercase">Assessment and recommendation by Dental Internship Coordinator</h2>
      <div className="min-h-[30mm] whitespace-pre-wrap border border-black p-2 text-[9.5pt]">{a.responses.e1}</div>
      <Lines items={['Name', 'Qualification', 'KMPDC reg. no.', 'Signature', 'Date', 'Stamp']} />
      <h2 className="mb-1.5 mt-6 text-[10pt] font-bold uppercase">Assessment and recommendation by Medical Superintendent / Medical Director</h2>
      {a.responses.e2 && <div className="mb-2 whitespace-pre-wrap border border-black p-2 text-[9.5pt]">{a.responses.e2}</div>}
      <p className="mb-1 text-[9.5pt]">SELECT ONE:</p>
      <ul className="space-y-1.5 text-[9.5pt]">
        {(Object.keys(INTERNSHIP_OUTCOME_LABELS) as (keyof typeof INTERNSHIP_OUTCOME_LABELS)[]).map((o) => (
          <li key={o}>
            {a.outcome === o ? '☒' : '☐'} {INTERNSHIP_OUTCOME_LABELS[o]}
            {o === 'extend' && ` ${a.outcome === 'extend' ? a.extendBy ?? '' : '. . . . . . . . .'} to fulfil the requirements.`}
          </li>
        ))}
      </ul>
      <Lines items={['Name', 'Qualification', 'KMPDC reg. no.', 'Signature', 'Date', 'Stamp']} />
    </article>
  );
}

function PaperCompletion({ a, centre }: { a: Assessment; centre: string }) {
  const { ix, ds } = useInternship();
  const rotations = [...ds.rotations].sort((x, y) => x.startsOn.localeCompare(y.startsOn));
  return (
    <article className="text-[10pt]">
      <h1 className="paper-h1">5.9. VERIFICATION OF COMPLETION OF DENTAL INTERNSHIP TRAINING</h1>
      <p className="mb-3 text-[9pt]">Internship queries: internship@kmpdc.go.ke</p>
      <h2 className="paper-h2">COMPLETION OF DENTAL INTERNSHIP TRAINING</h2>
      <div className="mb-4 space-y-2">
        <Field label="Full name of intern" value={ds.internship.internName} />
        <div className="grid grid-cols-2 gap-4">
          <Field label="National ID no." />
          <Field label="e-mail address" value={ds.internship.email} />
        </div>
        <Field label="Internship training centre" value={centre} />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Internship period from" value={ddmmyyyy(ds.internship.periodFrom)} />
          <Field label="to" value={ddmmyyyy(ds.internship.periodTo)} />
        </div>
      </div>
      <p className="mb-2 text-[9.5pt]">
        This is to verify that the above-named person has successfully completed the prescribed Dental Internship Training programme at this institution with the
        internship rotations as follows:
      </p>
      <table className="paper-table">
        <thead>
          <tr>
            <th>Rotation</th>
            <th className="w-[17%]">
              Start date
              <br />
              <span className="font-normal">DD/MM/YYYY</span>
            </th>
            <th className="w-[17%]">
              End date
              <br />
              <span className="font-normal">DD/MM/YYYY</span>
            </th>
            <th className="w-[34%]">Dental Internship Coordinator&rsquo;s remarks</th>
          </tr>
        </thead>
        <tbody>
          {rotations.map((r, i) => (
            <tr key={r.id}>
              <td>
                {i + 1}. {rotationName(ix, r.rotation)}
              </td>
              <td className="text-center tabular-nums">{ddmmyyyy(r.startsOn)}</td>
              <td className="text-center tabular-nums">{ddmmyyyy(rotationEnd(r))}</td>
              <td className="text-[9pt]">{a.responses[completionRemarkId(r.rotation)]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-[9.5pt]">As verified by the Medical Superintendent/ Medical Director:</p>
      <Lines items={['Name', 'KMPDC reg. no.', 'Signature', 'Date', 'Hospital stamp']} />
      <div className="mt-8 border-t border-dashed border-black pt-2 text-[9.5pt]">
        <p className="text-center font-bold">FOR OFFICIAL USE</p>
        <p className="mt-2">Verified by the Professional Assessment Department</p>
        <Lines items={['Name', 'Signature', 'Date']} />
        <p className="mt-2">Assistant Director, Professional Assessment · KENYA MEDICAL PRACTITIONERS AND DENTISTS COUNCIL</p>
      </div>
    </article>
  );
}
