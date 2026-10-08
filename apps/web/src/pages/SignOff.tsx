import {
  getActivityType,
  getProcedureType,
  isValidPin,
  reviewChecks,
  verificationQueue,
  type Level,
  type LogbookEntry,
} from '@logbook/core';
import { AlertTriangle, ArrowLeft, Check, CornerUpLeft, KeyRound, PenLine, ShieldCheck, Smartphone } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { LevelLadder, LevelPicker, PageHeader, ToneNote, useToast } from '../components/ui';
import { RepoError, setSupervisorPin, signOff, type SignOffDecision } from '../data/repo';
import { fmtDate, LEVEL_NAMES } from '../lib/format';
import { useInternship } from '../state/AppData';

/**
 * Supervisor sign-off on the intern's phone. Works offline. The intern hands
 * the phone over; the supervisor reviews each pending entry (verify, verify at
 * a different level, or return with a comment) and signs with their own PIN.
 */

type Draft = Record<string, { decision: 'verified' | 'returned'; level?: Level; comment?: string }>;

export function SignOffPage() {
  const { ix, ds } = useInternship();
  const [supervisorId, setSupervisorId] = useState<string | null>(null);
  const pendingBySupervisor = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of verificationQueue(ix)) if (e.supervisorId) m.set(e.supervisorId, (m.get(e.supervisorId) ?? 0) + 1);
    return m;
  }, [ix]);
  const unassigned = verificationQueue(ix, null).length;

  if (supervisorId) return <Review supervisorId={supervisorId} onExit={() => setSupervisorId(null)} />;

  const supervisors = ds.supervisors.filter((s) => pendingBySupervisor.has(s.id)).sort((a, b) => (pendingBySupervisor.get(b.id) ?? 0) - (pendingBySupervisor.get(a.id) ?? 0));
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Supervisor sign-off">
        Your supervisor reviews and signs your entries on this phone with their own PIN — no signal or account needed.
      </PageHeader>
      {supervisors.length === 0 ? (
        <ToneNote tone="good">Nothing is waiting for verification.</ToneNote>
      ) : (
        <ul className="card divide-y divide-line">
          {supervisors.map((s) => (
            <li key={s.id}>
              <button type="button" className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-surface-2" onClick={() => setSupervisorId(s.id)}>
                <Smartphone size={20} className="shrink-0 text-ink-2" aria-hidden="true" />
                <span className="flex-1">
                  <span className="block font-semibold">Hand the phone to {s.name}</span>
                  <span className="block text-sm text-ink-2">
                    {pendingBySupervisor.get(s.id)} entr{pendingBySupervisor.get(s.id) === 1 ? 'y' : 'ies'} waiting
                    {s.pinHash ? '' : ' · first sign-off: they will set a PIN'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {unassigned > 0 && (
        <p className="mt-4 text-sm text-ink-2">
          {unassigned} entr{unassigned === 1 ? 'y has' : 'ies have'} no supervisor named. Open the visit and choose one so it can be signed.{' '}
          <Link to="/logbook?status=submitted" className="font-medium underline underline-offset-2">
            Show them
          </Link>
        </p>
      )}
    </div>
  );
}

function sourceSummary(ix: ReturnType<typeof useInternship>['ix'], e: LogbookEntry): string {
  if (e.activityId) {
    const a = ix.activities.find((x) => x.id === e.activityId);
    return a?.title ?? getActivityType(a?.activityTypeId ?? '')?.name ?? 'Activity';
  }
  const enc = ix.encounters.find((x) => x.id === e.encounterId);
  const p = enc?.procedures.find((x) => x.id === e.encounterProcedureId);
  const t = p ? getProcedureType(p.procedureTypeId) : undefined;
  const dx = enc?.findings.filter((f) => f.isDiagnosis).map((f) => f.term).join(', ');
  return [t?.name ?? p?.otherName, p?.stage ? `stage ${p.stage}` : null, dx ? `Dx: ${dx}` : null].filter(Boolean).join(' · ');
}

function Review({ supervisorId, onExit }: { supervisorId: string; onExit: () => void }) {
  const { ix, ds } = useInternship();
  const toast = useToast();
  const supervisor = ds.supervisors.find((s) => s.id === supervisorId)!;
  const queue = useMemo(() => verificationQueue(ix, supervisorId), [ix, supervisorId]);
  const [draft, setDraft] = useState<Draft>({});
  const [step, setStep] = useState<'review' | 'sign' | 'done'>('review');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ verified: number; returned: number } | null>(null);
  const needsPin = !supervisor.pinHash;

  const decided = Object.keys(draft).length;
  const set = (id: string, v: Draft[string] | null) =>
    setDraft((d) => {
      const n = { ...d };
      if (v) n[id] = v;
      else delete n[id];
      return n;
    });

  const byDate = new Map<string, LogbookEntry[]>();
  for (const e of queue) byDate.set(e.performedOn, [...(byDate.get(e.performedOn) ?? []), e]);

  const sign = async () => {
    setError(null);
    const decisions: SignOffDecision[] = Object.entries(draft).map(([entryId, d]) => ({ entryId, decision: d.decision, levelObserved: d.level, comment: d.comment }));
    if (decisions.some((d) => d.decision === 'returned' && !d.comment?.trim())) return setError('Say what needs fixing for each returned entry.');
    setBusy(true);
    try {
      if (needsPin) {
        if (!isValidPin(pin)) throw new RepoError('Choose 4–8 digits that are not all the same or in sequence.');
        if (pin !== pin2) throw new RepoError('The two PINs do not match.');
        await setSupervisorPin(supervisorId, pin);
      }
      setResult(await signOff(supervisorId, pin, decisions));
      setStep('done');
      setPin('');
      setPin2('');
    } catch (err) {
      setError(err instanceof RepoError ? err.message : 'Could not sign. Nothing was saved.');
    } finally {
      setBusy(false);
    }
  };

  if (step === 'done' && result) {
    return (
      <div className="mx-auto max-w-lg py-10 text-center">
        <ShieldCheck size={44} className="mx-auto text-good-ink" aria-hidden="true" />
        <h1 className="mt-4 text-[26px] font-semibold">Signed</h1>
        <p className="mt-2 text-ink-2">
          {result.verified} verified{result.returned ? `, ${result.returned} returned for correction` : ''}. Thank you, {supervisor.name}.
        </p>
        <p className="mt-6 font-medium">Please hand the phone back.</p>
        <button
          type="button"
          className="btn btn-primary mt-4"
          onClick={() => {
            toast(`${result.verified} entries verified by ${supervisor.name}`);
            onExit();
          }}
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <button type="button" className="btn btn-ghost -ml-3 mb-2" onClick={onExit}>
        <ArrowLeft size={16} aria-hidden="true" /> Back to intern
      </button>
      <PageHeader eyebrow={`Sign-off for ${ds.internship.internName}`} title={`${supervisor.name}, please review`}>
        {queue.length} entr{queue.length === 1 ? 'y' : 'ies'} awaiting your verification. Verify, adjust the level you observed, or return with a comment. Checks are prompts, not
        accusations.
      </PageHeader>

      {step === 'review' && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setDraft(Object.fromEntries(queue.map((e) => [e.id, draft[e.id] ?? { decision: 'verified' as const }])))}
            >
              <Check size={16} aria-hidden="true" /> Verify all remaining as claimed
            </button>
            {decided > 0 && (
              <button type="button" className="btn btn-ghost" onClick={() => setDraft({})}>
                Clear decisions
              </button>
            )}
          </div>
          <div className="space-y-5">
            {[...byDate.entries()].map(([date, entries]) => (
              <section key={date}>
                <h2 className="eyebrow mb-2">{fmtDate(date)}</h2>
                <ul className="space-y-2">
                  {entries.map((e) => (
                    <EntryReview key={e.id} entry={e} summary={sourceSummary(ix, e)} checks={reviewChecks(ix, e).map((c) => c.message)} value={draft[e.id]} onChange={(v) => set(e.id, v)} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <div className="sticky bottom-20 z-10 -mx-4 mt-5 flex items-center gap-3 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:mx-0 lg:rounded-[14px] lg:border">
            <span className="flex-1 text-sm text-ink-2">
              {decided} of {queue.length} decided
            </span>
            <button type="button" className="btn btn-primary" disabled={decided === 0} onClick={() => setStep('sign')}>
              <PenLine size={16} aria-hidden="true" /> Sign {decided}
            </button>
          </div>
        </>
      )}

      {step === 'sign' && (
        <form
          className="card mx-auto max-w-md space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            sign();
          }}
        >
          <div className="flex items-center gap-2">
            <KeyRound size={18} aria-hidden="true" />
            <h2 className="text-lg font-semibold">{needsPin ? 'Set your sign-off PIN' : 'Enter your PIN to sign'}</h2>
          </div>
          <p className="text-sm text-ink-2">
            {needsPin
              ? `This is your first sign-off on ${ds.internship.internName}'s phone. Choose a 4–8 digit PIN that only you know; you will use it every time you sign here.`
              : `Signing ${decided} decision${decided === 1 ? '' : 's'}. Each is stored as a permanent, tamper-evident record.`}
          </p>
          <div>
            <label className="label" htmlFor="pin">PIN</label>
            <input
              id="pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={8}
              className="field code tracking-[0.4em]"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              autoFocus
            />
          </div>
          {needsPin && (
            <div>
              <label className="label" htmlFor="pin2">Repeat PIN</label>
              <input
                id="pin2"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={8}
                className="field code tracking-[0.4em]"
                value={pin2}
                onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))}
              />
            </div>
          )}
          {error && <ToneNote tone="critical">{error}</ToneNote>}
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary flex-1" disabled={busy || pin.length < 4}>
              {busy ? 'Signing…' : `Sign ${decided}`}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setStep('review')}>
              Back
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function EntryReview({
  entry,
  summary,
  checks,
  value,
  onChange,
}: {
  entry: LogbookEntry;
  summary: string;
  checks: string[];
  value: Draft[string] | undefined;
  onChange: (v: Draft[string] | null) => void;
}) {
  const [adjusting, setAdjusting] = useState(false);
  const decision = value?.decision;
  return (
    <li className="card p-4" style={decision ? { borderColor: decision === 'verified' ? 'var(--good)' : 'var(--critical)' } : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="code font-semibold">{entry.requirementCode}</span>
            {entry.patientRef && <span className="code text-sm text-ink-2">{entry.patientRef}</span>}
            {entry.site && <span className="code text-sm text-ink-2">· {entry.site}</span>}
          </div>
          {summary && <div className="mt-0.5 text-sm text-ink-2">{summary}</div>}
        </div>
        <span className="flex items-center gap-2 text-sm">
          <LevelLadder level={value?.level ?? entry.levelClaimed} size={14} />
          {value?.level && value.level !== entry.levelClaimed ? (
            <span>
              L{entry.levelClaimed} → <strong>L{value.level}</strong>
            </span>
          ) : (
            <span>
              L{entry.levelClaimed} {LEVEL_NAMES[entry.levelClaimed]}
            </span>
          )}
        </span>
      </div>
      {checks.length > 0 && (
        <ul className="mt-2 space-y-1">
          {checks.map((c) => (
            <li key={c} className="flex items-start gap-1.5 text-xs" style={{ color: 'var(--warning-ink)' }}>
              <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" /> {c}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={`Decision for ${entry.requirementCode}`}>
        <button type="button" aria-pressed={decision === 'verified' && !value?.level} className="chip !min-h-10" onClick={() => onChange({ decision: 'verified' })}>
          <Check size={15} aria-hidden="true" /> Verify
        </button>
        <button type="button" aria-pressed={adjusting || Boolean(value?.level)} className="chip !min-h-10" onClick={() => setAdjusting(!adjusting)}>
          Different level
        </button>
        <button type="button" aria-pressed={decision === 'returned'} className="chip !min-h-10" onClick={() => onChange({ decision: 'returned', comment: value?.comment })}>
          <CornerUpLeft size={15} aria-hidden="true" /> Return
        </button>
        {decision && (
          <button type="button" className="text-sm text-ink-3 underline underline-offset-2" onClick={() => onChange(null)}>
            Undo
          </button>
        )}
      </div>
      {adjusting && (
        <div className="mt-3">
          <span className="label">Level you observed</span>
          <LevelPicker
            value={value?.level ?? null}
            name={`observed-${entry.id}`}
            onChange={(level) => {
              onChange({ decision: 'verified', level });
              setAdjusting(false);
            }}
          />
        </div>
      )}
      {decision === 'returned' && (
        <div className="mt-3">
          <label className="label" htmlFor={`c-${entry.id}`}>What needs fixing?</label>
          <input
            id={`c-${entry.id}`}
            className="field"
            placeholder="e.g. Please confirm the tooth number"
            value={value?.comment ?? ''}
            onChange={(e) => onChange({ decision: 'returned', comment: e.target.value })}
          />
        </div>
      )}
    </li>
  );
}
