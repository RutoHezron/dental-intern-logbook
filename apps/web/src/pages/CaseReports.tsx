import {
  CASE_REPORT_SECTIONS,
  CASE_REPORTS_PER_ROTATION,
  ddmmyyyy,
  draftCaseReportFromVisits,
  getProcedureType,
  rotationEnd,
  rotationForDate,
  validateCaseReport,
  type CaseReport,
} from '@logbook/core';
import { CheckCircle2, ChevronRight, CircleDashed, Clock, CornerUpLeft, FilePlus2, Printer, Send, Trash2, Wand2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { PageHeader, ProgressBar, Segmented, ToneNote, useToast } from '../components/ui';
import { deleteCaseReport, newId, RepoError, saveCaseReport } from '../data/repo';
import { fmtDate, ROTATION_VAR, rotationName } from '../lib/format';
import { analyticsDate, useInternship } from '../state/AppData';

const STATUS = {
  draft: { label: 'Draft', Icon: CircleDashed, color: 'var(--ink-3)' },
  submitted: { label: 'Awaiting verification', Icon: Clock, color: 'var(--warning-ink)' },
  returned: { label: 'Returned — needs changes', Icon: CornerUpLeft, color: 'var(--critical-ink)' },
  verified: { label: 'Verified', Icon: CheckCircle2, color: 'var(--good-ink)' },
} as const;

export function CaseReportsPage() {
  const { ix, ds, today } = useInternship();
  const asOf = analyticsDate(today, ix);
  const reports = ds.caseReports ?? [];
  const rotations = [...ds.rotations].sort((a, b) => a.startsOn.localeCompare(b.startsOn)).filter((r) => r.startsOn <= asOf);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="Case reports"
        actions={
          <Link to="/case-reports/new" className="btn btn-primary">
            <FilePlus2 size={16} aria-hidden="true" /> New case report
          </Link>
        }
      >
        The logbook expects {CASE_REPORTS_PER_ROTATION} case reports per rotation. Start one from a patient&rsquo;s visits and the facts are drafted for you; you
        write the discussion. Verified reports fill the printed &ldquo;Log of Case Reports&rdquo;.
      </PageHeader>
      {[...rotations].reverse().map((r) => {
        const list = reports.filter((x) => x.rotationId === r.id).sort((a, b) => b.date.localeCompare(a.date));
        const verified = list.filter((x) => x.status === 'verified').length;
        const pending = list.filter((x) => x.status === 'submitted').length;
        return (
          <section key={r.id} className="card overflow-hidden">
            <header className="border-b border-line px-4 py-3" style={{ boxShadow: `inset 4px 0 0 ${ROTATION_VAR[r.rotation]}` }}>
              <div className="flex items-center gap-2">
                <h2 className="flex-1 text-[17px] font-semibold">{rotationName(ix, r.rotation)}</h2>
                <span className="tabular text-sm">
                  <strong>{verified}</strong>
                  <span className="text-ink-3">/{CASE_REPORTS_PER_ROTATION} verified</span>
                </span>
              </div>
              <div className="mt-2">
                <ProgressBar verified={verified} pending={pending} min={CASE_REPORTS_PER_ROTATION} color={ROTATION_VAR[r.rotation]} />
              </div>
            </header>
            {list.length === 0 ? (
              <p className="px-4 py-4 text-sm text-ink-2">No case reports yet for this rotation.</p>
            ) : (
              <ul className="divide-y divide-line">
                {list.map((c) => {
                  const s = STATUS[c.status];
                  return (
                    <li key={c.id}>
                      <Link to={`/case-reports/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                        <s.Icon size={18} className="shrink-0" style={{ color: s.color }} aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{c.title || 'Untitled case'}</span>
                          <span className="block text-xs text-ink-3">
                            {fmtDate(c.date)} · {s.label}
                          </span>
                        </span>
                        <ChevronRight size={16} className="text-ink-3" aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ===========================================================================
// Editor
// ===========================================================================

export function CaseReportEditorPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { ix, ds, today, state } = useInternship();
  const existing = id ? (ds.caseReports ?? []).find((r) => r.id === id) : undefined;
  if (id && !existing) return <PageHeader title="Case report not found" />;
  const fromVisit = params.get('encounter');
  const initial: CaseReport =
    existing ??
    (() => {
      const base: CaseReport = {
        id: newId(),
        internshipId: ds.internship.id,
        rotationId: rotationForDate(ds.rotations, today)?.id ?? null,
        date: today,
        title: '',
        patientId: null,
        encounterIds: [],
        sections: {},
        status: 'draft',
        supervisorId: state.preferences.defaultSupervisorId ?? null,
        createdAt: '',
        updatedAt: '',
      };
      if (!fromVisit) return base;
      const enc = ix.encounters.find((e) => e.id === fromVisit);
      const sameCase = enc?.patientId ? ix.encounters.filter((e) => e.patientId === enc.patientId).map((e) => e.id) : [fromVisit];
      const draft = draftCaseReportFromVisits(ix, sameCase);
      return { ...base, ...draft, supervisorId: enc?.supervisorId ?? base.supervisorId };
    })();
  return <Editor key={initial.id} initial={initial} />;
}

function Editor({ initial }: { initial: CaseReport }) {
  const { ix, ds, today } = useInternship();
  const toast = useToast();
  const navigate = useNavigate();
  const [r, setR] = useState<CaseReport>(initial);
  const [view, setView] = useState<'edit' | 'print'>(initial.status === 'verified' ? 'print' : 'edit');
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const locked = initial.status === 'verified';
  const issues = validateCaseReport(r, today, false);
  const rotation = ds.rotations.find((x) => x.id === r.rotationId);
  const latest = ix.latest.get(r.id);

  const save = async (submit: boolean) => {
    setError(null);
    try {
      const saved = await saveCaseReport(r, today, submit);
      setR(saved);
      toast(submit ? 'Sent to your supervisor for verification' : 'Case report saved');
      if (submit) navigate('/case-reports');
    } catch (err) {
      setError(err instanceof RepoError ? err.message : 'Could not save.');
    }
  };

  const fillFromVisits = () => {
    const draft = draftCaseReportFromVisits(ix, r.encounterIds);
    // Only fill what is empty: never overwrite the intern's own words.
    const sections = { ...r.sections };
    for (const [k, v] of Object.entries(draft.sections)) if (!sections[k]?.trim() && v) sections[k] = v;
    setR({ ...r, title: r.title || draft.title, sections, patientId: r.patientId ?? draft.patientId });
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print">
        <PageHeader
          eyebrow={rotation ? rotationName(ix, rotation.rotation) : 'Case report'}
          title={r.title || 'New case report'}
          actions={
            <>
              <Segmented
                label="View"
                value={view}
                onChange={setView}
                options={[
                  { value: 'edit', label: locked ? 'Details' : 'Edit' },
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
        />
        {r.status === 'returned' && latest?.comment && (
          <div className="mb-4">
            <ToneNote tone="critical">Returned by your supervisor: &ldquo;{latest.comment}&rdquo; Make the changes and send it again.</ToneNote>
          </div>
        )}
        {locked && (
          <div className="mb-4">
            <ToneNote tone="good">Verified on {fmtDate((latest?.signedAt ?? '').slice(0, 10) || r.updatedAt.slice(0, 10))} · reference {latest?.hash.slice(0, 8)}. Verified reports cannot be changed.</ToneNote>
          </div>
        )}
      </div>

      {view === 'print' ? (
        <div className="paper-sheet">
          <PaperCaseReport r={r} />
        </div>
      ) : (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save(false);
          }}
        >
          <fieldset disabled={locked} className="space-y-5">
            <div className="card grid gap-3 p-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label" htmlFor="cr-title">Case description (printed in the logbook)</label>
                <input id="cr-title" className="field" placeholder="e.g. Pericoronitis of 38 managed with surgical extraction" value={r.title} onChange={(e) => setR({ ...r, title: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="cr-date">Date</label>
                <input id="cr-date" type="date" className="field" max={today} value={r.date} onChange={(e) => setR({ ...r, date: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="cr-rot">Rotation</label>
                <select id="cr-rot" className="field" value={r.rotationId ?? ''} onChange={(e) => setR({ ...r, rotationId: e.target.value || null })}>
                  <option value="">—</option>
                  {ds.rotations.map((x) => (
                    <option key={x.id} value={x.id}>
                      {rotationName(ix, x.rotation)} ({fmtDate(x.startsOn)} – {fmtDate(rotationEnd(x))})
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="cr-sup">Supervisor who will verify</label>
                <select id="cr-sup" className="field" value={r.supervisorId ?? ''} onChange={(e) => setR({ ...r, supervisorId: e.target.value || null })}>
                  <option value="">Choose…</option>
                  {ds.supervisors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.rotation ? ` · ${s.rotation}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <LinkedVisits r={r} setR={setR} picking={picking} setPicking={setPicking} onDraft={fillFromVisits} />

            <div className="card space-y-4 p-4">
              {CASE_REPORT_SECTIONS.map((s) => (
                <div key={s.id}>
                  <label className="label" htmlFor={`cs-${s.id}`}>
                    {s.label}
                    {s.required && <span className="font-normal text-ink-3"> · needed to send</span>}
                  </label>
                  <textarea
                    id={`cs-${s.id}`}
                    className={`field ${s.id === 'disc' || s.id === 'mx' ? 'min-h-32' : 'min-h-20'}`}
                    placeholder={s.hint}
                    value={r.sections[s.id] ?? ''}
                    onChange={(e) => setR({ ...r, sections: { ...r.sections, [s.id]: e.target.value } })}
                  />
                </div>
              ))}
            </div>
          </fieldset>

          {issues
            .filter((i) => i.level === 'warning')
            .map((i, k) => (
              <ToneNote key={k} tone="warning">
                {i.message}
              </ToneNote>
            ))}
          {error && <ToneNote tone="critical">{error}</ToneNote>}
          {!locked && (
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn btn-secondary flex-1">
                Save draft
              </button>
              <button type="button" className="btn btn-primary flex-1" onClick={() => save(true)}>
                <Send size={16} aria-hidden="true" /> {r.status === 'returned' ? 'Send back for verification' : 'Send for verification'}
              </button>
              {initial.createdAt && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={async () => {
                    if (!window.confirm('Delete this case report?')) return;
                    await deleteCaseReport(r.id);
                    toast('Case report deleted');
                    navigate('/case-reports');
                  }}
                >
                  <Trash2 size={16} aria-hidden="true" /> Delete
                </button>
              )}
            </div>
          )}
          <p className="text-xs text-ink-3">Never include names, phone numbers or ID numbers. Refer to the patient by age and sex only.</p>
        </form>
      )}
    </div>
  );
}

function LinkedVisits({
  r,
  setR,
  picking,
  setPicking,
  onDraft,
}: {
  r: CaseReport;
  setR: (r: CaseReport) => void;
  picking: boolean;
  setPicking: (v: boolean) => void;
  onDraft: () => void;
}) {
  const { ix } = useInternship();
  const [q, setQ] = useState('');
  const linked = ix.encounters.filter((e) => r.encounterIds.includes(e.id)).sort((a, b) => a.date.localeCompare(b.date));
  const candidates = useMemo(() => {
    const query = q.trim().toUpperCase();
    return [...ix.encounters]
      .reverse()
      .filter((e) => !r.encounterIds.includes(e.id))
      .filter((e) => !query || (e.patientId && ix.patients.get(e.patientId)?.ref.includes(query)))
      .slice(0, 12);
  }, [ix, r.encounterIds, q]);
  const summary = (e: (typeof ix.encounters)[number]) =>
    `${fmtDate(e.date)} · ${e.patientId ? ix.patients.get(e.patientId)?.ref : '—'} · ${e.procedures.map((p) => getProcedureType(p.procedureTypeId)?.shortName).join(', ')}`;
  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[16px] font-semibold">Visits this case is about</h2>
        <div className="flex gap-2">
          <button type="button" className="btn btn-ghost !min-h-9" onClick={() => setPicking(!picking)}>
            {picking ? 'Done' : 'Add visits'}
          </button>
          {linked.length > 0 && (
            <button type="button" className="btn btn-secondary !min-h-9" onClick={onDraft}>
              <Wand2 size={15} aria-hidden="true" /> Draft from linked visits
            </button>
          )}
        </div>
      </div>
      {linked.length === 0 ? (
        <p className="text-sm text-ink-2">Link the patient&rsquo;s visits to draft the facts automatically. The hospital number is not copied into the report.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {linked.map((e) => (
            <li key={e.id} className="chip !min-h-8 text-xs" aria-pressed="true">
              {summary(e)}
              <button type="button" aria-label="Unlink visit" onClick={() => setR({ ...r, encounterIds: r.encounterIds.filter((x) => x !== e.id) })}>
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {picking && (
        <div className="rounded-[10px] border border-line p-2">
          <input className="field" placeholder="Filter by patient no." aria-label="Filter visits by patient number" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="mt-2 max-h-64 overflow-auto">
            {candidates.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className="w-full rounded-[8px] px-2 py-2 text-left text-sm hover:bg-surface-2"
                  onClick={() => setR({ ...r, encounterIds: [...r.encounterIds, e.id], patientId: r.patientId ?? e.patientId })}
                >
                  {summary(e)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PaperCaseReport({ r }: { r: CaseReport }) {
  const { ix, ds } = useInternship();
  const rotation = ds.rotations.find((x) => x.id === r.rotationId);
  const latest = ix.latest.get(r.id);
  return (
    <article className="text-[10pt]">
      <h1 className="paper-h2">Case report{rotation ? ` — ${rotationName(ix, rotation.rotation)}` : ''}</h1>
      <p className="mb-1">
        <strong>{r.title}</strong>
      </p>
      <p className="mb-4 text-[9pt]">
        {ds.internship.internName} · {ddmmyyyy(r.date)}
        {r.status === 'verified' && latest ? ` · verified, ref. ${latest.hash.slice(0, 8)}` : ''}
      </p>
      {CASE_REPORT_SECTIONS.filter((s) => r.sections[s.id]?.trim()).map((s) => (
        <section key={s.id} className="mb-3 break-inside-avoid">
          <h2 className="mb-0.5 text-[10pt] font-bold">{s.label}</h2>
          <p className="whitespace-pre-wrap text-[9.5pt]">{r.sections[s.id]}</p>
        </section>
      ))}
      <div className="mt-6 grid grid-cols-3 gap-4 text-[9.5pt]">
        {['Supervisor name', 'Signature', 'Date'].map((t) => (
          <div key={t} className="flex items-baseline gap-2">
            <span className="shrink-0">{t}</span>
            <span className="flex-1 border-b border-dotted border-black">&nbsp;</span>
          </div>
        ))}
      </div>
    </article>
  );
}

