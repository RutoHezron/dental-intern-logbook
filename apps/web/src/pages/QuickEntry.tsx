import {
  ACTIVITY_TYPES,
  applyEncounterToPlan,
  COMMUNITY_CASE_TYPES,
  COMMUNITY_ITEMS,
  deriveActivity,
  deriveEncounter,
  FOLLOW_UP_STEPS,
  getActivityType,
  getProcedureType,
  hasErrors,
  INVESTIGATION_KINDS,
  KMPDC_DENTAL_3,
  PROCEDURE_TYPES,
  rotationCodeFor,
  rotationForDate,
  validateActivity,
  validateEncounter,
  type Activity,
  type Derivation,
  type Encounter,
  type EncounterProcedure,
  type Finding,
  type Issue,
  type Level,
  type Patient,
  type ProcedureType,
  type Setting,
  type VisitType,
} from '@logbook/core';
import { ChevronDown, Info, Repeat, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ToothChart } from '../components/ToothChart';
import { PatientBriefCard } from '../components/TreatmentPlan';
import { LevelPicker, PageHeader, RotationDot, Segmented, ToneNote, useToast } from '../components/ui';
import { deleteActivity, deleteEncounter, newId, normaliseRef, RepoError, saveActivity, saveEncounter, savePreferences, saveSupervisor } from '../data/repo';
import { rotationName } from '../lib/format';
import { useInternship } from '../state/AppData';

const VISIT_TYPES: { value: VisitType; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'review', label: 'Review' },
  { value: 'continuing', label: 'Continuing' },
  { value: 'emergency', label: 'Emergency' },
];

const SETTINGS: { value: Setting; label: string }[] = [
  { value: 'opd', label: 'Clinic / OPD' },
  { value: 'ward', label: 'Ward' },
  { value: 'theatre', label: 'Theatre' },
  { value: 'emergency', label: 'Casualty' },
  { value: 'outreach', label: 'Outreach' },
];

const COMMON_DIAGNOSES = [
  'Dental caries',
  'Irreversible pulpitis',
  'Reversible pulpitis',
  'Pulp necrosis',
  'Chronic apical periodontitis',
  'Acute apical abscess',
  'Chronic gingivitis',
  'Periodontitis',
  'Pericoronitis',
  'Impacted third molar',
  'Retained root',
  'Dental fluorosis',
  'Partially dentate',
  'Edentulous',
];

const nowTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function QuickEntryPage({ mode }: { mode?: 'visit' | 'activity' }) {
  const { id } = useParams();
  const [params] = useSearchParams();
  const initial: 'visit' | 'activity' = mode ?? (params.get('mode') === 'activity' ? 'activity' : 'visit');
  const [tab, setTab] = useState<'visit' | 'activity'>(initial);
  const editing = Boolean(id);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow={editing ? 'Edit entry' : 'New entry'} title={tab === 'visit' ? 'Log a patient visit' : 'Log an activity'}>
        {!editing && 'Required: the essentials only. Everything else is optional and can be added later.'}
      </PageHeader>
      {!editing && (
        <div className="mb-5">
          <Segmented
            label="Entry type"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'visit', label: 'Patient visit' },
              { value: 'activity', label: 'Activity (no patient)' },
            ]}
          />
        </div>
      )}
      {tab === 'visit' ? <VisitForm key={id ?? 'new-visit'} id={id} /> : <ActivityForm key={id ?? 'new-activity'} id={id} />}
    </div>
  );
}

// ===========================================================================
// Shared bits
// ===========================================================================

function RotationLine({ date, rotationId, overridden, onOverride }: { date: string; rotationId: string | null; overridden: boolean; onOverride: (id: string | null) => void }) {
  const { ix, ds } = useInternship();
  const [open, setOpen] = useState(false);
  const auto = rotationForDate(ds.rotations, date);
  const current = overridden ? ds.rotations.find((r) => r.id === rotationId) ?? null : auto;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <RotationDot code={current?.rotation} />
      <span className="text-ink-2">
        {current ? rotationName(ix, current.rotation) : 'No rotation covers this date'}
        {!overridden && current && <span className="text-ink-3"> · from the date</span>}
        {overridden && <span className="text-ink-3"> · set manually</span>}
      </span>
      <button type="button" className="text-sm font-medium underline underline-offset-2" onClick={() => setOpen(!open)}>
        Change
      </button>
      {open && (
        <select
          aria-label="Rotation"
          className="field !min-h-9 !w-auto !py-1"
          value={overridden ? rotationId ?? '' : 'auto'}
          onChange={(e) => {
            onOverride(e.target.value === 'auto' ? null : e.target.value);
            setOpen(false);
          }}
        >
          <option value="auto">Automatic (from date)</option>
          {ds.rotations.map((r) => (
            <option key={r.id} value={r.id}>
              {rotationName(ix, r.rotation)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function SupervisorSelect({ value, onChange }: { value: string | null | undefined; onChange: (id: string) => void }) {
  const { ds, currentRotation } = useInternship();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const sorted = [...ds.supervisors].sort((a, b) => Number(b.rotation === currentRotation?.rotation) - Number(a.rotation === currentRotation?.rotation) || a.name.localeCompare(b.name));
  const add = async () => {
    const id = newId();
    await saveSupervisor({ id, name, rotation: currentRotation?.rotation });
    onChange(id);
    setAdding(false);
    setName('');
  };
  return (
    <div>
      <label className="label" htmlFor="supervisor">Supervisor</label>
      {adding ? (
        <div className="flex gap-2">
          <input id="supervisor" className="field" placeholder="e.g. Dr J. Otieno" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <button type="button" className="btn btn-secondary" disabled={!name.trim()} onClick={add}>
            Add
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)} aria-label="Cancel">
            <X size={16} />
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <select id="supervisor" className="field" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
            <option value="">Choose…</option>
            {sorted.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.rotation ? ` · ${s.rotation}` : ''}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-secondary shrink-0" onClick={() => setAdding(true)}>
            New
          </button>
        </div>
      )}
    </div>
  );
}

/** What the save will create: codes and rules, plus reasons for anything not counted. */
function ReviewStrip({ derivation, issues, planChanges = [] }: { derivation: Derivation | null; issues: Issue[]; planChanges?: string[] }) {
  return (
    <section aria-label="What this entry will log" aria-live="polite" className="rounded-[14px] border border-line bg-surface-2 p-4">
      <div className="eyebrow mb-2">Will be logged</div>
      {derivation && derivation.notes.length > 0 ? (
        <ul className="space-y-1.5 text-sm">
          {derivation.notes.map((n, i) => (
            <li key={i} className="flex items-start gap-2">
              {n.requirementCode && !/already counted/.test(n.message) ? (
                <span className="code mt-px shrink-0 rounded-[6px] bg-ink px-1.5 text-[12px] text-paper">{n.requirementCode}</span>
              ) : (
                <span className="code mt-px shrink-0 rounded-[6px] border border-line-strong px-1.5 text-[12px] text-ink-3">{n.uncoded ?? '—'}</span>
              )}
              <span className="text-ink-2">{n.message}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-3">Add a procedure to see which logbook codes it will count toward.</p>
      )}
      {planChanges.length > 0 && (
        <div className="mt-3">
          <div className="eyebrow mb-1">Treatment plan</div>
          <ul className="space-y-1 text-sm text-ink-2">
            {planChanges.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {issues.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {issues.map((i, k) => (
            <li key={k}>
              <ToneNote tone={i.level === 'error' ? 'critical' : i.level === 'warning' ? 'warning' : 'neutral'}>{i.message}</ToneNote>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LockedNote({ count }: { count: number }) {
  if (!count) return null;
  return (
    <ToneNote tone="neutral">
      {count} logbook entr{count === 1 ? 'y from this record is' : 'ies from this record are'} verified. Changes that alter a verified entry are blocked — ask your supervisor to
      return it, or add a new entry.
    </ToneNote>
  );
}

// ===========================================================================
// Patient visit
// ===========================================================================

interface PatientForm {
  ref: string;
  birthYear: string;
  sex: Patient['sex'] | '';
  systemicCondition: boolean;
}

function ProcedurePicker({ onPick, rotation }: { onPick: (t: ProcedureType) => void; rotation: string | null }) {
  const { state } = useInternship();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const fav = state.preferences.favourites.map((id) => getProcedureType(id)).filter(Boolean) as ProcedureType[];
  const typical = PROCEDURE_TYPES.filter((t) => rotation && t.typicalRotations.includes(rotation) && !fav.includes(t));
  const query = q.trim().toLowerCase();
  const results = query
    ? PROCEDURE_TYPES.filter((t) => [t.name, t.shortName, ...(t.keywords ?? [])].some((s) => s.toLowerCase().includes(query)))
    : [];
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {[...fav, ...typical.slice(0, 8)].map((t) => (
          <button key={t.id} type="button" className="chip" onClick={() => onPick(t)}>
            {t.shortName}
          </button>
        ))}
        <button type="button" className="chip" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Search size={15} aria-hidden="true" /> All procedures
        </button>
      </div>
      {open && (
        <div className="mt-3 rounded-[12px] border border-line bg-surface p-3">
          <input className="field" placeholder="Search: RCT, scaling, I&D, denture…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Search procedures" />
          <ul className="mt-2 max-h-72 overflow-auto">
            {(query ? results : PROCEDURE_TYPES).map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-[8px] px-2 py-2 text-left text-sm hover:bg-surface-2"
                  onClick={() => {
                    onPick(t);
                    setOpen(false);
                    setQ('');
                  }}
                >
                  <span>{t.name}</span>
                  <span className="code text-[11px] text-ink-3">{t.mappings.map((m) => m.requirementCode).join(' / ') || t.uncoded || 'exposure'}</span>
                </button>
              </li>
            ))}
            {query && results.length === 0 && <li className="px-2 py-2 text-sm text-ink-3">No match. Use "Other procedure" and name it.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function ProcedureCard({
  proc,
  rotation,
  onChange,
  onRemove,
  patientAge,
}: {
  proc: EncounterProcedure;
  rotation: string | null;
  onChange: (p: EncounterProcedure) => void;
  onRemove: () => void;
  patientAge: number | null;
}) {
  const type = getProcedureType(proc.procedureTypeId)!;
  const mapping = type.mappings.find((m) => !m.when.rotation || m.when.rotation === rotation);
  const expected = mapping ? KMPDC_DENTAL_3.requirements.find((r) => r.code === mapping.requirementCode)?.expectedLevel : undefined;
  return (
    <div className="card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{type.name}</div>
          {type.uncoded && <div className="text-xs text-ink-3">No KMPDC code — tracked as exposure ({type.uncoded})</div>}
        </div>
        <button type="button" className="btn btn-ghost !min-h-9 !px-2" onClick={onRemove} aria-label={`Remove ${type.name}`}>
          <Trash2 size={16} />
        </button>
      </div>
      <div className="space-y-4">
        {type.id === 'other' && (
          <div>
            <label className="label" htmlFor={`other-${proc.id}`}>Procedure name</label>
            <input id={`other-${proc.id}`} className="field" value={proc.otherName ?? ''} onChange={(e) => onChange({ ...proc, otherName: e.target.value })} />
          </div>
        )}
        {type.siteKind === 'tooth' && (
          <ToothChart selected={proc.sites} onChange={(sites) => onChange({ ...proc, sites })} defaultDentition={patientAge !== null && patientAge < 12 ? 'primary' : 'permanent'} />
        )}
        {type.siteKind === 'region' && (
          <div>
            <label className="label" htmlFor={`site-${proc.id}`}>Site / region (optional)</label>
            <input
              id={`site-${proc.id}`}
              className="field"
              placeholder="e.g. Lower right sextant, buccal mucosa"
              value={proc.sites.join(', ')}
              onChange={(e) => onChange({ ...proc, sites: e.target.value ? [e.target.value] : [] })}
            />
          </div>
        )}
        {type.stages > 1 && (
          <div>
            <span className="label">Stage</span>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Stage">
              {type.stageNames!.map((s, i) => (
                <button key={s} type="button" role="radio" aria-checked={(proc.stage ?? 1) === i + 1} className="chip" onClick={() => onChange({ ...proc, stage: i + 1 })}>
                  {i + 1}. {s}
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          <span className="label">Your level</span>
          <LevelPicker value={proc.level ?? null} onChange={(level) => onChange({ ...proc, level })} expected={expected} name={`level-${proc.id}`} />
        </div>
      </div>
    </div>
  );
}

function VisitForm({ id }: { id?: string }) {
  const { ix, ds, state, today } = useInternship();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const existing = id ? ix.encounters.find((e) => e.id === id) : undefined;
  const existingPatient = existing?.patientId ? ix.patients.get(existing.patientId) : undefined;

  const blankProc = (procedureTypeId: string): EncounterProcedure =>
    ({ id: newId(), procedureTypeId, sites: [], level: undefined as unknown as Level, stage: getProcedureType(procedureTypeId)!.stages > 1 ? 1 : undefined });

  const [enc, setEnc] = useState<Encounter>(
    () =>
      existing ?? {
        id: newId(),
        internshipId: ds.internship.id,
        rotationId: rotationForDate(ds.rotations, today)?.id ?? null,
        date: today,
        time: nowTime(),
        patientId: null,
        visitType: 'new',
        setting: 'opd',
        supervisorId: state.preferences.defaultSupervisorId ?? null,
        findings: [],
        investigations: [],
        procedures: params.get('procedure') && getProcedureType(params.get('procedure')!) ? [blankProc(params.get('procedure')!)] : [],
        createdAt: '',
        updatedAt: '',
      },
  );
  const [patient, setPatient] = useState<PatientForm>({
    ref: existingPatient?.ref ?? params.get('patient') ?? '',
    birthYear: existingPatient?.birthYear ? String(existingPatient.birthYear) : '',
    sex: existingPatient?.sex ?? '',
    systemicCondition: existingPatient?.systemicCondition ?? false,
  });
  const [details, setDetails] = useState(Boolean(existing && (existing.findings.length || existing.investigations.length || existing.notes || existing.referredTo)));
  const [diagText, setDiagText] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const firstProcRef = useRef<HTMLDivElement>(null);

  const ref = normaliseRef(patient.ref);
  const knownPatient = useMemo(() => (ref ? ds.patients.find((p) => p.ref === ref) : undefined), [ref, ds.patients]);
  const recentRefs = useMemo(() => {
    const seen = new Set<string>();
    const out: Patient[] = [];
    for (const e of [...ix.encounters].reverse()) {
      if (!e.patientId || seen.has(e.patientId)) continue;
      seen.add(e.patientId);
      const p = ix.patients.get(e.patientId);
      if (p) out.push(p);
      if (out.length >= 6) break;
    }
    return out;
  }, [ix]);

  const rotation = enc.rotationOverridden ? enc.rotationId : rotationForDate(ds.rotations, enc.date)?.id ?? null;
  const rotationCode = rotationCodeFor(ds.rotations, rotation);
  const birthYear = patient.birthYear ? Number(patient.birthYear) : knownPatient?.birthYear;
  const patientAge = birthYear ? Number(enc.date.slice(0, 4)) - birthYear : null;
  const previewPatient: Patient | null = ref
    ? { id: knownPatient?.id ?? 'new', ref, birthYear, sex: (patient.sex || knownPatient?.sex) as Patient['sex'], systemicCondition: patient.systemicCondition || knownPatient?.systemicCondition, createdAt: '' }
    : null;
  const draft: Encounter = { ...enc, rotationId: rotation, patientId: previewPatient?.id ?? null };

  const derivation = useMemo(
    () => deriveEncounter({ ...draft, procedures: draft.procedures.filter((p) => p.level) }, { set: ds.requirementSet, rules: ds.rules, rotation: rotationCode, patient: previewPatient }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(draft), JSON.stringify(previewPatient), rotationCode, ds.rules],
  );
  const issues = useMemo(
    () =>
      validateEncounter(draft, {
        today,
        loggedOn: today,
        internship: ds.internship,
        rotations: ds.rotations,
        rotation: rotationCode,
        patient: previewPatient,
        rules: ds.rules,
        others: ix.encounters,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(draft), JSON.stringify(previewPatient), today],
  );
  const verifiedCount = existing ? ix.entries.filter((e) => e.encounterId === existing.id && (e.status === 'verified' || e.status === 'locked')).length : 0;
  const planPreview = useMemo(() => {
    if (!knownPatient) return [];
    const withLevels = { ...draft, procedures: draft.procedures.filter((p) => p.level) };
    return (ds.treatmentPlans ?? []).filter((p) => p.patientId === knownPatient.id).flatMap((p) => applyEncounterToPlan(p, withLevels).changes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(draft), knownPatient?.id, ds.treatmentPlans]);

  useEffect(() => {
    if (params.get('procedure')) firstProcRef.current?.scrollIntoView({ block: 'nearest' });
  }, [params]);

  const setProc = (i: number, p: EncounterProcedure) => setEnc({ ...enc, procedures: enc.procedures.map((x, k) => (k === i ? p : x)) });
  const addFinding = (term: string) => {
    if (!term.trim() || enc.findings.some((f) => f.term === term)) return;
    setEnc({ ...enc, findings: [...enc.findings, { term: term.trim(), isDiagnosis: true, certainty: 'confirmed' }] });
  };

  const save = async (repeat: boolean) => {
    setSaveError(null);
    if (hasErrors(issues)) {
      setSaveError('Fix the items marked in red before saving.');
      return;
    }
    setBusy(true);
    try {
      const res = await saveEncounter(draft, ref ? { ref, birthYear, sex: (patient.sex || undefined) as Patient['sex'], systemicCondition: patient.systemicCondition || undefined } : null);
      if (enc.supervisorId && enc.supervisorId !== state.preferences.defaultSupervisorId) {
        await savePreferences({ ...state.preferences, defaultSupervisorId: enc.supervisorId });
      }
      const parts = [res.created ? `${res.created} logbook entr${res.created === 1 ? 'y' : 'ies'} sent for verification` : null, res.planChanges.length ? 'treatment plan updated' : null].filter(Boolean);
      toast(parts.length ? `Saved · ${parts.join(' · ')}` : 'Saved');
      if (repeat) {
        // Next patient: keep date, setting, supervisor and procedure types; clear patient, teeth and levels.
        setEnc({
          ...enc,
          id: newId(),
          time: nowTime(),
          patientId: null,
          findings: [],
          investigations: [],
          notes: undefined,
          referredTo: undefined,
          procedures: enc.procedures.map((p) => blankProc(p.procedureTypeId)),
        });
        setPatient({ ref: '', birthYear: '', sex: '', systemicCondition: false });
        window.scrollTo({ top: 0 });
      } else {
        if (existing) navigate(-1);
        else navigate('/');
      }
    } catch (err) {
      setSaveError(err instanceof RepoError ? err.message : 'Could not save. Your entry is still on screen — try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing || !window.confirm('Delete this visit and withdraw its logbook entries?')) return;
    try {
      await deleteEncounter(existing.id);
      toast('Visit deleted');
      navigate('/logbook');
    } catch (err) {
      setSaveError(err instanceof RepoError ? err.message : 'Could not delete.');
    }
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save(false);
      }}
      noValidate
    >
      <LockedNote count={verifiedCount} />

      <div className="card space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="date">Date</label>
            <input id="date" type="date" className="field" value={enc.date} max={today} onChange={(e) => setEnc({ ...enc, date: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="time">Time</label>
            <input id="time" type="time" className="field" value={enc.time ?? ''} onChange={(e) => setEnc({ ...enc, time: e.target.value })} />
          </div>
        </div>
        <RotationLine
          date={enc.date}
          rotationId={enc.rotationId}
          overridden={Boolean(enc.rotationOverridden)}
          onOverride={(rid) => setEnc({ ...enc, rotationId: rid, rotationOverridden: rid !== null })}
        />

        <div>
          <label className="label" htmlFor="patientRef">Patient no. <span className="font-normal text-ink-3">(hospital / OP number — no names)</span></label>
          <input
            id="patientRef"
            className="field code uppercase"
            autoComplete="off"
            inputMode="text"
            placeholder="OP-26-04417"
            value={patient.ref}
            onChange={(e) => setPatient({ ...patient, ref: e.target.value })}
          />
          {!patient.ref && recentRefs.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Recent patients">
              {recentRefs.map((p) => (
                <button key={p.id} type="button" className="chip code !min-h-8 !px-2.5 !text-[12px]" onClick={() => setPatient({ ...patient, ref: p.ref })}>
                  {p.ref}
                </button>
              ))}
            </div>
          )}
          {knownPatient && !existing && (
            <div className="mt-2">
              <PatientBriefCard patientId={knownPatient.id} compact />
            </div>
          )}
          {knownPatient ? (
            <p className="mt-1.5 text-xs text-ink-2">
              Returning patient
              {knownPatient.birthYear ? ` · born ${knownPatient.birthYear}` : ''}
              {knownPatient.sex ? ` · ${knownPatient.sex}` : ''}
              {knownPatient.systemicCondition ? ' · systemic condition recorded' : ''} ·{' '}
              <Link to={`/patients/${knownPatient.id}`} className="underline underline-offset-2">
                case timeline and plan
              </Link>
            </p>
          ) : (
            ref && (
              <div className="mt-3 grid grid-cols-[1fr_auto] gap-3 sm:grid-cols-[8rem_auto_1fr]">
                <div>
                  <label className="label" htmlFor="birthYear">Birth year</label>
                  <input
                    id="birthYear"
                    className="field tabular"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="2014"
                    value={patient.birthYear}
                    onChange={(e) => setPatient({ ...patient, birthYear: e.target.value.replace(/\D/g, '') })}
                  />
                </div>
                <div>
                  <span className="label">Sex</span>
                  <div className="flex gap-1.5" role="radiogroup" aria-label="Sex">
                    {(['F', 'M'] as const).map((s) => (
                      <button key={s} type="button" role="radio" aria-checked={patient.sex === s} className="chip !min-w-11 justify-center" onClick={() => setPatient({ ...patient, sex: patient.sex === s ? '' : s })}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="col-span-2 flex items-center gap-2 text-sm sm:col-span-1 sm:mt-6">
                  <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={patient.systemicCondition} onChange={(e) => setPatient({ ...patient, systemicCondition: e.target.checked })} />
                  Has a systemic condition (e.g. diabetes)
                </label>
              </div>
            )
          )}
        </div>

        <div>
          <span className="label">Visit</span>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Visit type">
            {VISIT_TYPES.map((v) => (
              <button key={v.value} type="button" role="radio" aria-checked={enc.visitType === v.value} className="chip" onClick={() => setEnc({ ...enc, visitType: v.value })}>
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div ref={firstProcRef} className="space-y-3">
        <h2 className="text-[17px] font-semibold">Procedures</h2>
        {enc.procedures.map((p, i) => (
          <ProcedureCard
            key={p.id}
            proc={p}
            rotation={rotationCode}
            patientAge={patientAge}
            onChange={(np) => setProc(i, np)}
            onRemove={() => setEnc({ ...enc, procedures: enc.procedures.filter((_, k) => k !== i) })}
          />
        ))}
        <div className="card p-4">
          <div className="mb-2 text-sm font-medium text-ink-2">{enc.procedures.length ? 'Add another procedure' : 'What did you do?'}</div>
          <ProcedurePicker rotation={rotationCode} onPick={(t) => setEnc({ ...enc, procedures: [...enc.procedures, blankProc(t.id)] })} />
        </div>
      </div>

      <div className="card space-y-4 p-4">
        <SupervisorSelect value={enc.supervisorId} onChange={(sid) => setEnc({ ...enc, supervisorId: sid || null })} />

        <button type="button" className="flex w-full items-center justify-between text-sm font-semibold" aria-expanded={details} onClick={() => setDetails(!details)}>
          <span>Diagnosis, investigations, referral and notes</span>
          <ChevronDown size={18} className={`transition-transform ${details ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        {details && (
          <div className="space-y-4 border-t border-line pt-4">
            <div>
              <span className="label">Diagnosis</span>
              {enc.findings.length > 0 && (
                <ul className="mb-2 flex flex-wrap gap-1.5">
                  {enc.findings.map((f: Finding) => (
                    <li key={f.term} className="chip !min-h-8" aria-pressed="true">
                      {f.term}
                      <button type="button" aria-label={`Remove ${f.term}`} onClick={() => setEnc({ ...enc, findings: enc.findings.filter((x) => x !== f) })}>
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <input
                  className="field"
                  list="diagnoses"
                  placeholder="Type or choose a diagnosis"
                  aria-label="Add diagnosis"
                  value={diagText}
                  onChange={(e) => setDiagText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addFinding(diagText);
                      setDiagText('');
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    addFinding(diagText);
                    setDiagText('');
                  }}
                >
                  Add
                </button>
                <datalist id="diagnoses">
                  {COMMON_DIAGNOSES.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </div>
              <p className="mt-1 text-xs text-ink-3">Never inferred from the procedure. OMF 1 counts only when a diagnosis is recorded.</p>
            </div>
            <div>
              <span className="label">Investigations</span>
              <div className="flex flex-wrap gap-1.5">
                {INVESTIGATION_KINDS.map((k) => {
                  const on = enc.investigations.some((i) => i.kind === k);
                  return (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={on}
                      className="chip !min-h-9"
                      onClick={() => setEnc({ ...enc, investigations: on ? enc.investigations.filter((i) => i.kind !== k) : [...enc.investigations, { kind: k }] })}
                    >
                      {k}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <span className="label">Setting</span>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Setting">
                {SETTINGS.map((s) => (
                  <button key={s.value} type="button" role="radio" aria-checked={enc.setting === s.value} className="chip !min-h-9" onClick={() => setEnc({ ...enc, setting: s.value })}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="referral">Referred to</label>
                <input id="referral" className="field" placeholder="e.g. Physician, ENT" value={enc.referredTo ?? ''} onChange={(e) => setEnc({ ...enc, referredTo: e.target.value || undefined })} />
              </div>
              <label className="flex items-center gap-2 text-sm sm:mt-6">
                <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={Boolean(enc.followUpNeeded)} onChange={(e) => setEnc({ ...enc, followUpNeeded: e.target.checked })} />
                Follow-up needed
              </label>
            </div>
            <div>
              <label className="label" htmlFor="notes">Notes</label>
              <textarea id="notes" className="field min-h-20" placeholder="Clinical notes — no patient names or contacts" value={enc.notes ?? ''} onChange={(e) => setEnc({ ...enc, notes: e.target.value || undefined })} />
            </div>
          </div>
        )}
      </div>

      <ReviewStrip derivation={derivation} issues={issues} planChanges={planPreview} />
      {saveError && <ToneNote tone="critical">{saveError}</ToneNote>}

      <div className="sticky bottom-20 z-10 -mx-4 flex flex-wrap gap-2 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:mx-0 lg:rounded-[14px] lg:border">
        <button type="submit" className="btn btn-primary flex-1" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {!existing && (
          <button type="button" className="btn btn-secondary flex-1" disabled={busy} onClick={() => save(true)}>
            <Repeat size={16} aria-hidden="true" /> Save & next
          </button>
        )}
        {existing && (
          <button type="button" className="btn btn-ghost" onClick={remove} disabled={busy}>
            <Trash2 size={16} aria-hidden="true" /> Delete
          </button>
        )}
      </div>
      {existing && (
        <p className="flex items-center gap-1.5 text-xs text-ink-3">
          <Info size={14} aria-hidden="true" />
          <Link to={`/diary/new?encounter=${existing.id}`} className="underline underline-offset-2">
            Write a reflection about this case
          </Link>
          <span aria-hidden="true">·</span>
          <Link to={`/case-reports/new?encounter=${existing.id}`} className="underline underline-offset-2">
            Write a case report
          </Link>
        </p>
      )}
    </form>
  );
}

// ===========================================================================
// Activity (no patient)
// ===========================================================================

function ActivityForm({ id }: { id?: string }) {
  const { ix, ds, state, today } = useInternship();
  const navigate = useNavigate();
  const toast = useToast();
  const existing = id ? ix.activities.find((a) => a.id === id) : undefined;
  const [act, setAct] = useState<Activity>(
    () =>
      existing ?? {
        id: newId(),
        internshipId: ds.internship.id,
        rotationId: rotationForDate(ds.rotations, today)?.id ?? null,
        date: today,
        activityTypeId: '',
        level: undefined as unknown as Level,
        supervisorId: state.preferences.defaultSupervisorId ?? null,
        createdAt: '',
        updatedAt: '',
      },
  );
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const rotation = act.rotationOverridden ? act.rotationId : rotationForDate(ds.rotations, act.date)?.id ?? null;
  const rotationCode = rotationCodeFor(ds.rotations, rotation);
  const type = getActivityType(act.activityTypeId);
  const draft = { ...act, rotationId: rotation };
  const derivation = useMemo(
    () => (type && act.level ? deriveActivity(draft, { set: ds.requirementSet, rules: ds.rules, rotation: rotationCode }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(draft), rotationCode],
  );
  const issues = useMemo(
    () =>
      type
        ? validateActivity(draft, { today, loggedOn: today, internship: ds.internship, rotations: ds.rotations, rotation: rotationCode, rules: ds.rules, others: ix.activities })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(draft), today],
  );
  const verifiedCount = existing ? ix.entries.filter((e) => e.activityId === existing.id && (e.status === 'verified' || e.status === 'locked')).length : 0;
  const sortedTypes = [...ACTIVITY_TYPES].sort((a, b) => Number(rotationCode ? b.typicalRotations.includes(rotationCode) : 0) - Number(rotationCode ? a.typicalRotations.includes(rotationCode) : 0));

  const save = async () => {
    setSaveError(null);
    if (!type) return setSaveError('Choose the kind of activity.');
    if (!act.level) return setSaveError('Choose your level.');
    if (hasErrors(issues)) return setSaveError('Fix the items marked in red before saving.');
    setBusy(true);
    try {
      const res = await saveActivity(draft);
      toast(res.created ? 'Saved · logbook entry sent for verification' : 'Saved');
      if (existing) navigate(-1);
        else navigate('/');
    } catch (err) {
      setSaveError(err instanceof RepoError ? err.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      noValidate
    >
      <LockedNote count={verifiedCount} />
      <div className="card space-y-4 p-4">
        <div>
          <label className="label" htmlFor="adate">Date</label>
          <input id="adate" type="date" className="field" value={act.date} max={today} onChange={(e) => setAct({ ...act, date: e.target.value })} />
        </div>
        <RotationLine date={act.date} rotationId={act.rotationId} overridden={Boolean(act.rotationOverridden)} onOverride={(rid) => setAct({ ...act, rotationId: rid, rotationOverridden: rid !== null })} />
        <div>
          <span className="label">Activity</span>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Activity type">
            {sortedTypes.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={act.activityTypeId === t.id}
                className="chip !h-auto !py-2 text-left"
                onClick={() => setAct({ ...act, activityTypeId: t.id, level: t.fixedLevel ?? act.level })}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
        {type?.needs === 'community_item' && (
          <div>
            <label className="label" htmlFor="item">Which community activity (5.7.4)</label>
            <select id="item" className="field" value={act.communityItem ?? ''} onChange={(e) => setAct({ ...act, communityItem: Number(e.target.value) || undefined })}>
              <option value="">Choose…</option>
              {COMMUNITY_ITEMS.map((t, i) => (
                <option key={i} value={i + 1}>
                  {i + 1}. {t}
                </option>
              ))}
            </select>
          </div>
        )}
        {type?.needs === 'community_case' && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="ctype">Case type</label>
              <select id="ctype" className="field" value={act.caseType ?? ''} onChange={(e) => setAct({ ...act, caseType: e.target.value || undefined, caseSlot: undefined })}>
                <option value="">Choose…</option>
                {COMMUNITY_CASE_TYPES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="cslot">Case no.</label>
              <select id="cslot" className="field" value={act.caseSlot ?? ''} onChange={(e) => setAct({ ...act, caseSlot: Number(e.target.value) || undefined })}>
                <option value="">Choose…</option>
                {Array.from({ length: COMMUNITY_CASE_TYPES.find((c) => c.id === act.caseType)?.cases ?? 0 }, (_, i) => (
                  <option key={i} value={i + 1}>
                    Case {i + 1}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="cstep">Step</label>
              <select id="cstep" className="field" value={act.followUpStep ?? ''} onChange={(e) => setAct({ ...act, followUpStep: (e.target.value || undefined) as Activity['followUpStep'] })}>
                <option value="">Choose…</option>
                {FOLLOW_UP_STEPS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-ink-3 sm:col-span-3">Case type and number only — never a patient identity (the paper logbook has no patient column here).</p>
          </div>
        )}
        {type?.needs === 'weekly_report' && (
          <div>
            <label className="label" htmlFor="wr">Weekly report no.</label>
            <select id="wr" className="field" value={act.weeklyReportNo ?? ''} onChange={(e) => setAct({ ...act, weeklyReportNo: Number(e.target.value) || undefined })}>
              <option value="">Choose…</option>
              {Array.from({ length: 8 }, (_, i) => (
                <option key={i} value={i + 1}>
                  Week {i + 1}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label" htmlFor="title">Title (optional)</label>
          <input id="title" className="field" placeholder="e.g. Grand round: failed RCT" value={act.title ?? ''} onChange={(e) => setAct({ ...act, title: e.target.value || undefined })} />
        </div>
        <div>
          <span className="label">Your level</span>
          <LevelPicker value={act.level ?? null} onChange={(level) => setAct({ ...act, level })} expected={type?.fixedLevel ?? (rotationCode === 'COMM' ? 4 : undefined)} />
        </div>
        <SupervisorSelect value={act.supervisorId} onChange={(sid) => setAct({ ...act, supervisorId: sid || null })} />
        <div>
          <label className="label" htmlFor="anotes">Notes</label>
          <textarea id="anotes" className="field min-h-20" value={act.notes ?? ''} onChange={(e) => setAct({ ...act, notes: e.target.value || undefined })} />
        </div>
      </div>
      <ReviewStrip derivation={derivation} issues={issues} />
      {saveError && <ToneNote tone="critical">{saveError}</ToneNote>}
      <div className="sticky bottom-20 z-10 -mx-4 flex gap-2 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:mx-0 lg:rounded-[14px] lg:border">
        <button type="submit" className="btn btn-primary flex-1" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {existing && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={async () => {
              if (!window.confirm('Delete this activity?')) return;
              try {
                await deleteActivity(existing.id);
                toast('Activity deleted');
                navigate('/logbook');
              } catch (err) {
                setSaveError(err instanceof RepoError ? err.message : 'Could not delete.');
              }
            }}
          >
            <Trash2 size={16} aria-hidden="true" /> Delete
          </button>
        )}
      </div>
    </form>
  );
}

