import {
  computeStats,
  daysBetween,
  displayDate,
  generateInsights,
  getActivityType,
  getProcedureType,
  internshipWeek,
  QUESTION_LABELS,
  requirementProgress,
  rotationEnd,
  summarizeProgress,
  weekIndexOn,
} from '@logbook/core';
import { ArrowRight, Check, Plus, Sparkles } from 'lucide-react';
import { lazy, Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { LevelLadder, PageHeader, ProgressBar, RotationDot, Section, StatusBadge, ToneNote } from '../components/ui';
import { computeReminders } from '../lib/reminders';
import { isNative } from '../storage/device';
import { useDeviceStorage } from '../storage/StorageProvider';
import { plural, ROTATION_VAR, rotationName } from '../lib/format';
import { analyticsDate, useInternship } from '../state/AppData';

// The charting library is large; load it after the rest of the dashboard.
const ActivityChart = lazy(() => import('../components/charts').then((m) => ({ default: m.ActivityChart })));

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function Stat({ label, value, delta, hint }: { label: string; value: number | string; delta?: string; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium text-ink-2">{label}</div>
      <div className="mt-1 font-display text-[28px] font-semibold leading-none">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {(delta || hint) && (
        <div className="mt-1.5 text-xs text-ink-3">
          {delta && <span className="font-semibold text-good-ink">{delta}</span>} {hint}
        </div>
      )}
    </div>
  );
}

export function TodayPage() {
  const { ix, ds, today, currentRotation, state } = useInternship();
  const storage = useDeviceStorage();
  const asOf = analyticsDate(today, ix);
  const [showAllInsights, setShowAllInsights] = useState(false);

  const data = useMemo(() => {
    const total = computeStats(ix, ds.internship.periodFrom, asOf);
    const week = internshipWeek(ds.internship, weekIndexOn(ds.internship, asOf));
    const thisWeek = computeStats(ix, week.from, asOf);
    const progress = requirementProgress(ix, asOf);
    const summary = summarizeProgress(progress);
    const STATUS_ORDER = ['behind', 'at_risk', 'on_track', 'upcoming', 'not_met', 'met'];
    // Unmet codes first, so the list shows what still needs attention.
    const rotationCodes = currentRotation
      ? progress
          .filter((p) => p.requirement.rotation === currentRotation.rotation)
          .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.pct - b.pct)
      : [];
    const insights = generateInsights(ix, { asOf });
    const reminders = computeReminders(ix, today, new Date(), { lastAt: storage.backup?.lastAt ?? null, automatic: isNative && (storage.backup?.enabled ?? true), demo: Boolean(state.demo) });
    const rotationsDone = ds.rotations.filter((r) => rotationEnd(r) < asOf).length;
    const todays = [
      ...ix.encounters.filter((e) => e.date === today).map((e) => ({ kind: 'visit' as const, id: e.id, time: e.time ?? '', e })),
      ...ix.activities.filter((a) => a.date === today).map((a) => ({ kind: 'activity' as const, id: a.id, time: '', a })),
    ];
    return { total, thisWeek, week, summary, rotationCodes, insights, reminders, rotationsDone, todays };
  }, [ix, ds, asOf, today, currentRotation, storage.backup, state.demo]);

  const patients = new Map(ds.patients.map((p) => [p.id, p]));
  const firstName = ds.internship.internName.replace(/^Dr\.?\s+/i, '').split(' ')[0];
  const favourites = state.preferences.favourites.map((id) => getProcedureType(id)).filter((t): t is NonNullable<typeof t> => Boolean(t));

  const rotationWeek = currentRotation ? Math.floor(daysBetween(currentRotation.startsOn, asOf) / 7) + 1 : null;
  const rotationWeeks = currentRotation ? Math.ceil((daysBetween(currentRotation.startsOn, rotationEnd(currentRotation)) + 1) / 7) : null;

  const insightList = showAllInsights ? data.insights : data.insights.slice(0, 4);

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={displayDate(today)} title={`${greeting()}, ${firstName}`}>
        {currentRotation ? (
          <span>
            Week {rotationWeek} of {rotationWeeks} in <strong className="text-ink">{rotationName(ix, currentRotation.rotation)}</strong>
          </span>
        ) : today < ds.internship.periodFrom ? (
          <span>Your internship starts on {displayDate(ds.internship.periodFrom)}.</span>
        ) : (
          <span>No rotation is scheduled for today.</span>
        )}
      </PageHeader>

      {/* Quick log: one tap starts an entry with the procedure already chosen */}
      <section aria-label="Quick log" className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[17px] font-semibold">Log a patient</h2>
          <Link to="/log?mode=activity" className="text-sm font-medium text-ink-2 underline-offset-2 hover:underline">
            Log an activity
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          {favourites.map((t) => (
            <Link key={t.id} to={`/log?procedure=${t.id}`} className="chip">
              {t.shortName}
            </Link>
          ))}
          <Link to="/log" className="chip !border-accent !bg-accent !text-accent-ink">
            <Plus size={16} aria-hidden="true" /> Other
          </Link>
        </div>
      </section>

      {/* Headline numbers: cumulative, with this week's change */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Patients seen" value={data.total.patientsSeen} delta={data.thisWeek.patientsSeen ? `+${data.thisWeek.patientsSeen}` : undefined} hint="this week" />
        <Stat label="Procedures" value={data.total.procedures.total} delta={data.thisWeek.procedures.total ? `+${data.thisWeek.procedures.total}` : undefined} hint="this week" />
        <Stat label="Performed by you" value={data.total.procedures.performed} hint={`L3–5 · ${data.total.procedures.independent} independent`} />
        <Stat label="Codes met" value={`${data.summary.met}/${data.summary.codes}`} hint="default counting rules" />
        <Stat label="Entries verified" value={data.total.entries.verified} hint={`${data.total.entries.pending} awaiting`} />
        <Stat label="Rotations completed" value={`${data.rotationsDone}/${ds.rotations.length}`} />
      </div>

      {data.reminders.length > 0 && (
        <section aria-label="Reminders" className="space-y-2">
          {data.reminders.slice(0, 4).map((r) => (
            <ToneNote key={r.id} tone={r.tone}>
              <span>{r.text}</span>
              {r.to && (
                <Link to={r.to} className="ml-2 font-semibold underline underline-offset-2">
                  {r.action ?? 'Open'}
                </Link>
              )}
            </ToneNote>
          ))}
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <Section title="Clinical activity" aside={<span>{plural(data.total.procedures.total, 'procedure')} to date</span>}>
          <Suspense fallback={<div className="h-[290px]" aria-hidden="true" />}>
            <ActivityChart ix={ix} asOf={asOf} />
          </Suspense>
        </Section>

        <Section
          title={currentRotation ? `${currentRotation.rotation} logbook codes` : 'Logbook codes'}
          aside={
            <Link to={`/logbook?view=codes${currentRotation ? `&rotation=${currentRotation.rotation}` : ''}`} className="inline-flex items-center gap-1 font-medium">
              All <ArrowRight size={14} aria-hidden="true" />
            </Link>
          }
        >
          {data.rotationCodes.length ? (
            <ul className="space-y-3">
              {data.rotationCodes.slice(0, 8).map((p) => (
                <li key={p.requirement.code}>
                  <Link to={`/logbook/code/${encodeURIComponent(p.requirement.code)}`} className="block">
                    <div className="mb-1 flex items-center gap-2 text-sm">
                      <span className="code w-20 shrink-0">{p.requirement.code.replace('COMM ', '')}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-2">{p.requirement.description}</span>
                      <LevelLadder level={p.highestVerifiedLevel} size={14} />
                      <span className="tabular w-14 text-right font-medium">
                        {p.verified}/{p.requirement.minCount}
                      </span>
                    </div>
                    <ProgressBar verified={p.verified} pending={p.pending} min={p.requirement.minCount} color={ROTATION_VAR[p.requirement.rotation]} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2">Codes for the current rotation appear here.</p>
          )}
          <p className="mt-3 text-xs text-ink-3">Solid = verified; hatched = awaiting verification. Counts show recorded exposure, not competence.</p>
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section
          title="Insights"
          aside={
            <span className="inline-flex items-center gap-1">
              <Sparkles size={14} aria-hidden="true" /> From your recorded data
            </span>
          }
        >
          <ul className="space-y-3">
            {insightList.map((i) => (
              <li key={i.id} className="border-l-2 pl-3" style={{ borderColor: i.tone === 'positive' ? 'var(--good)' : i.tone === 'attention' ? 'var(--serious)' : 'var(--line-strong)' }}>
                <div className="eyebrow mb-0.5">
                  {QUESTION_LABELS[i.question]} · {i.basis === 'recorded' ? 'recorded data' : 'interpretation'}
                </div>
                <p className="text-sm">{i.text}</p>
                <details className="mt-0.5 text-xs text-ink-3">
                  <summary className="cursor-pointer">Based on</summary>
                  {i.evidence}
                </details>
              </li>
            ))}
          </ul>
          {data.insights.length > 4 && (
            <button type="button" className="mt-3 text-sm font-medium underline underline-offset-2" onClick={() => setShowAllInsights(!showAllInsights)}>
              {showAllInsights ? 'Show fewer' : `Show all ${data.insights.length}`}
            </button>
          )}
        </Section>

        <Section title="Exposure overview" aside={<Link to="/competencies">Competencies</Link>}>
          <p className="mb-2 text-xs text-ink-3">Quantity is an exposure indicator, not proof of competence.</p>
          <RotationGaps />
        </Section>
      </div>

      <Section title="Today" aside={<Link to="/logbook">Logbook</Link>}>
        {data.todays.length === 0 ? (
          <p className="text-sm text-ink-2">Nothing logged today yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.todays.map((t) =>
              t.kind === 'visit' ? (
                <li key={t.id}>
                  <Link to={`/log/visit/${t.id}`} className="flex items-center gap-3 py-2.5 text-sm">
                    <span className="code w-12 text-ink-3">{t.e.time}</span>
                    <span className="code">{t.e.patientId ? patients.get(t.e.patientId)?.ref : '—'}</span>
                    <span className="min-w-0 flex-1 truncate text-ink-2">
                      {t.e.procedures.map((p) => `${getProcedureType(p.procedureTypeId)?.shortName}${p.sites.length ? ' ' + p.sites.join(',') : ''}`).join(' · ')}
                    </span>
                  </Link>
                </li>
              ) : (
                <li key={t.id}>
                  <Link to={`/log/activity/${t.id}`} className="flex items-center gap-3 py-2.5 text-sm">
                    <span className="code w-12 text-ink-3">—</span>
                    <span className="min-w-0 flex-1 truncate">{t.a.title ?? getActivityType(t.a.activityTypeId)?.name}</span>
                  </Link>
                </li>
              ),
            )}
          </ul>
        )}
      </Section>
    </div>
  );
}

/** Per-rotation ✓ / ⚠ overview (brief §13 "Exposure gaps"). */
function RotationGaps() {
  const { ix, today } = useInternship();
  const asOf = analyticsDate(today, ix);
  const progress = useMemo(() => requirementProgress(ix, asOf), [ix, asOf]);
  return (
    <ul className="mt-1 divide-y divide-line">
      {ix.ds.rotations.map((r) => {
        const list = progress.filter((p) => p.requirement.rotation === r.rotation);
        const s = summarizeProgress(list);
        const started = r.startsOn <= asOf;
        const weak = list.filter((p) => ['not_met', 'behind', 'at_risk'].includes(p.status));
        const strong = started && weak.length === 0 && s.met / Math.max(1, s.codes) >= 0.6;
        return (
          <li key={r.id} className="flex items-start gap-3 py-2.5 text-sm">
            <RotationDot code={r.rotation} size={10} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{rotationName(ix, r.rotation)}</span>
                {!started ? (
                  <StatusBadge status="upcoming" />
                ) : strong ? (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-good-ink">
                    <Check size={12} strokeWidth={3} aria-hidden="true" /> Strong exposure
                  </span>
                ) : (
                  <span className="tabular text-xs text-ink-2">
                    {s.met}/{s.codes} met
                  </span>
                )}
              </div>
              {started && weak.length > 0 && (
                <div className="mt-0.5 text-xs text-ink-2">
                  Limited recorded exposure: {weak.slice(0, 4).map((p) => p.requirement.code).join(', ')}
                  {weak.length > 4 ? ` +${weak.length - 4}` : ''}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
