import { addDays, displayDate, KMPDC_DENTAL_3, startOfIsoWeek, todayISO, weekday, type RotationCode } from '@logbook/core';
import { ArrowDown, ArrowUp, CheckCircle2, ShieldCheck, Smartphone } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router';
import { syncConfigured } from '../sync/supabase';
import { LevelLadder, ToneNote } from '../components/ui';
import { loadDemo, RepoError, setupInternship } from '../data/repo';
import { ROTATION_VAR } from '../lib/format';
import { useAppData } from '../state/AppData';
import { isNative } from '../storage/device';
import { useDeviceStorage } from '../storage/StorageProvider';

const DEMO_END = '2026-10-11';

export function OnboardingPage() {
  const { loaded, ix } = useAppData();
  const [busy, setBusy] = useState<'demo' | 'setup' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = todayISO();
  const [form, setForm] = useState({
    internName: '',
    email: '',
    licenceNo: '',
    facilityName: '',
    county: '',
    periodFrom: weekday(today) === 0 ? today : addDays(startOfIsoWeek(today), 7),
  });
  const [order, setOrder] = useState<RotationCode[]>(KMPDC_DENTAL_3.rotations.map((r) => r.code));

  const startDemo = async () => {
    setBusy('demo');
    // The redirect below happens once the live data shows the new internship.
    await loadDemo(today < DEMO_END ? today : DEMO_END);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy('setup');
    try {
      await setupInternship({ ...form, rotationOrder: order, supervisors: [] });
    } catch (err) {
      setError(err instanceof RepoError ? err.message : 'Could not create the internship. Try again.');
      setBusy(null);
    }
  };

  const move = (i: number, dir: -1 | 1) => {
    const next = [...order];
    const j = i + dir;
    [next[i], next[j]] = [next[j]!, next[i]!];
    setOrder(next);
  };

  // Navigate only when the app's live data includes the internship; navigating
  // straight after the write races the live query and bounces back here.
  if (loaded && ix) return <Navigate to="/" replace />;

  let cursor = form.periodFrom;

  return (
    <div className="min-h-dvh bg-paper">
      <div className="mx-auto grid max-w-[1100px] gap-10 px-5 py-10 lg:grid-cols-[1.1fr_1fr] lg:py-16">
        <section>
          <div className="flex items-center gap-2.5">
            <img src="/icon.svg" alt="" width={36} height={36} />
            <span className="eyebrow">Dental internship logbook</span>
          </div>
          <h1 className="mt-6 text-[40px] font-semibold leading-[1.05] sm:text-[52px]">
            Log the patient.
            <br />
            The logbook writes itself.
          </h1>
          <p className="mt-5 max-w-xl text-[17px] text-ink-2">
            Record each visit in under a minute: patient number, teeth, procedure, your level, supervisor. Codes, counts, weekly and monthly
            reports and your final portfolio build up from those entries — nothing is typed twice.
          </p>

          <ol className="mt-8 space-y-3" aria-label="Competency levels">
            {(['Observed', 'Assisted', 'Under direct supervision', 'Under indirect supervision', 'Independently'] as const).map((t, i) => (
              <li key={t} className="flex items-center gap-3 text-sm">
                <LevelLadder level={(i + 1) as 1 | 2 | 3 | 4 | 5} size={20} />
                <span className="code w-6 text-ink-3">L{i + 1}</span>
                <span>{t}</span>
              </li>
            ))}
          </ol>

          <StorageReady />

          <div className="mt-8 flex items-start gap-3 rounded-[14px] border border-line bg-surface p-4 text-sm text-ink-2">
            <ShieldCheck size={20} className="mt-0.5 shrink-0 text-ink" aria-hidden="true" />
            <p>
              <strong className="text-ink">No patient names, phone numbers or IDs.</strong> Only the hospital number the paper logbook already asks
              for, plus birth year and sex where the rules need them. Records stay on this device until you connect an account.
            </p>
          </div>
        </section>

        <section className="space-y-5">
          <div className="card p-5">
            <h2 className="text-xl font-semibold">Explore the demo internship</h2>
            <p className="mt-1 text-sm text-ink-2">
              Twelve months of fictional records for Dr Alex Mwangi across all five rotations — about 1,000 visits — so you can see the dashboard,
              reports and portfolio filled in.
            </p>
            <button type="button" className="btn btn-secondary mt-4 w-full" onClick={startDemo} disabled={busy !== null}>
              {busy === 'demo' ? 'Building the demo…' : 'Open the demo'}
            </button>
          </div>

          <form className="card space-y-4 p-5" onSubmit={submit} noValidate>
            <div>
              <h2 className="text-xl font-semibold">Set up my internship</h2>
              <p className="mt-1 text-sm text-ink-2">Entered once; reused on every report and form.</p>
            </div>
            <div>
              <label className="label" htmlFor="internName">Full name</label>
              <input id="internName" className="field" autoComplete="name" required value={form.internName} onChange={(e) => setForm({ ...form, internName: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="facility">Internship training centre</label>
              <input id="facility" className="field" required value={form.facilityName} onChange={(e) => setForm({ ...form, facilityName: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="county">County</label>
                <input id="county" className="field" value={form.county} onChange={(e) => setForm({ ...form, county: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="licence">Internship licence no.</label>
                <input id="licence" className="field" value={form.licenceNo} onChange={(e) => setForm({ ...form, licenceNo: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="start">Internship start date</label>
              <input id="start" type="date" className="field" required value={form.periodFrom} onChange={(e) => setForm({ ...form, periodFrom: e.target.value })} />
            </div>
            <fieldset>
              <legend className="label">Rotation order</legend>
              <ol className="space-y-1.5">
                {order.map((code, i) => {
                  const def = KMPDC_DENTAL_3.rotations.find((r) => r.code === code)!;
                  const from = cursor;
                  cursor = addDays(cursor, def.weeks * 7);
                  return (
                    <li key={code} className="flex items-center gap-2 rounded-[10px] border border-line px-3 py-2 text-sm">
                      <span className="h-6 w-1 rounded-full" style={{ background: ROTATION_VAR[code] }} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{def.name}</span>
                        <span className="block text-xs text-ink-3">
                          {def.weeks} weeks · from {displayDate(from)}
                        </span>
                      </span>
                      <button type="button" className="btn btn-ghost !min-h-9 !px-2" aria-label={`Move ${def.name} earlier`} disabled={i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp size={16} />
                      </button>
                      <button type="button" className="btn btn-ghost !min-h-9 !px-2" aria-label={`Move ${def.name} later`} disabled={i === order.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDown size={16} />
                      </button>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-2 text-xs text-ink-3">You can adjust dates, extensions and supervisors later under Rotations.</p>
            </fieldset>
            {error && <ToneNote tone="critical">{error}</ToneNote>}
            <button type="submit" className="btn btn-primary w-full" disabled={busy !== null}>
              {busy === 'setup' ? 'Creating…' : 'Create my logbook'}
            </button>
          </form>
          {syncConfigured && (
            <p className="text-center text-sm text-ink-2">
              Supervising interns?{' '}
              <Link to="/supervise" className="font-medium text-ink underline underline-offset-2">
                Review entries submitted to you
              </Link>
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

/** First-run confirmation that the logbook's storage is set up on this phone. */
function StorageReady() {
  const { status } = useDeviceStorage();
  const device = isNative ? 'phone' : 'device';
  return (
    <div className="mt-8 flex items-start gap-3 rounded-[14px] border border-line bg-surface p-4 text-sm" role="status" aria-live="polite">
      {status ? (
        <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-good-ink" aria-hidden="true" />
      ) : (
        <Smartphone size={20} className="mt-0.5 shrink-0 text-ink-3" aria-hidden="true" />
      )}
      <div>
        <p className="font-medium">{status ? `Storage is ready on this ${device}` : `Setting up storage on this ${device}…`}</p>
        <p className="mt-0.5 text-ink-2">
          Your logbook is saved {isNative ? 'in the app’s own storage on this phone' : 'on this device'} and works without signal or an account.
          {status?.persistent === true && ` It is kept permanently — the ${isNative ? 'phone' : 'browser'} will not clear it to free space.`}
          {status?.persistent === false && ' Add the app to your Home screen so the browser keeps it permanently.'}
        </p>
      </div>
    </div>
  );
}
