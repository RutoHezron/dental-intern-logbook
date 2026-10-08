import {
  buildReport,
  CATEGORY_LABELS,
  customPeriod,
  dayPeriod,
  displayDate,
  HEADLINE_METRICS,
  internshipMonth,
  internshipMonths,
  internshipPeriod,
  internshipWeek,
  internshipWeeks,
  logbookCsv,
  monthIndexOn,
  proceduresCsv,
  QUESTION_LABELS,
  rotationPeriod,
  snapshotMatches,
  snapshotReport,
  weekIndexOn,
  type Period,
  type ProcedureCategory,
  type Report,
} from '@logbook/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, Download, FileCheck2, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { LevelMixBar, RankedBars } from '../components/charts';
import { PageHeader, ProgressBar, Section, Segmented, StatusBadge, ToneNote, useToast } from '../components/ui';
import { db } from '../data/db';
import { newId, saveSnapshot } from '../data/repo';
import { downloadText, fmtChange, fmtDate, plural, ROTATION_VAR, rotationName } from '../lib/format';
import { analyticsDate, useInternship } from '../state/AppData';
import { TAGS } from './Diary';

type Kind = 'week' | 'month' | 'rotation' | 'internship' | 'custom';

const SECTIONS = [
  { key: 'procedures', label: 'Procedures' },
  { key: 'competencies', label: 'Competencies' },
  { key: 'diary', label: 'Clinical diary' },
  { key: 'feedback', label: 'Supervisor feedback' },
  { key: 'charts', label: 'Charts' },
  { key: 'insights', label: 'Insights' },
] as const;
type SectionKey = (typeof SECTIONS)[number]['key'];

export function ReportsPage() {
  const { ix, ds, today } = useInternship();
  const navigate = useNavigate();
  const asOf = analyticsDate(today, ix);
  const [kind, setKind] = useState<Kind>('month');
  const weeks = useMemo(() => internshipWeeks(ds.internship, asOf).reverse(), [ds.internship, asOf]);
  const months = useMemo(() => internshipMonths(ds.internship, asOf).reverse(), [ds.internship, asOf]);
  const [week, setWeek] = useState(String(weeks[0]?.index ?? 1));
  const [month, setMonth] = useState(String(months[0]?.index ?? 1));
  const [rotationId, setRotationId] = useState(ds.rotations.find((r) => r.startsOn <= asOf)?.id ?? ds.rotations[0]?.id ?? '');
  const [from, setFrom] = useState(ds.internship.periodFrom);
  const [to, setTo] = useState(asOf);
  const [include, setInclude] = useState<Set<SectionKey>>(new Set(SECTIONS.map((s) => s.key)));
  const snapshots = useLiveQuery(() => db.snapshots.orderBy('from').reverse().toArray(), []) ?? [];

  const open = () => {
    const p = new URLSearchParams({ kind });
    if (kind === 'week') p.set('index', week);
    if (kind === 'month') p.set('index', month);
    if (kind === 'rotation') p.set('id', rotationId);
    if (kind === 'custom') {
      p.set('from', from);
      p.set('to', to);
    }
    const off = SECTIONS.filter((s) => !include.has(s.key)).map((s) => s.key);
    if (off.length) p.set('hide', off.join(','));
    navigate(`/reports/view?${p}`);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Reports">Every report is generated from your entries — weekly, monthly, by rotation, or the whole internship — with cumulative totals alongside.</PageHeader>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: `This week`, sub: internshipWeek(ds.internship, weekIndexOn(ds.internship, asOf)).sublabel, href: `/reports/view?kind=week&index=${weekIndexOn(ds.internship, asOf)}` },
          { label: `This month`, sub: internshipMonth(ds.internship, monthIndexOn(ds.internship, asOf)).sublabel, href: `/reports/view?kind=month&index=${monthIndexOn(ds.internship, asOf)}` },
          { label: 'Whole internship', sub: 'Cumulative to date', href: '/reports/view?kind=internship' },
        ].map((c) => (
          <Link key={c.label} to={c.href} className="card p-4 hover:border-line-strong">
            <div className="font-semibold">{c.label}</div>
            <div className="text-xs text-ink-2">{c.sub}</div>
          </Link>
        ))}
      </div>

      <section className="card space-y-4 p-4 sm:p-5">
        <h2 className="text-[17px] font-semibold">Generate a report</h2>
        <div>
          <span className="label">Type</span>
          <Segmented
            label="Report type"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'week', label: 'Weekly' },
              { value: 'month', label: 'Monthly' },
              { value: 'rotation', label: 'Rotation' },
              { value: 'internship', label: 'Internship' },
              { value: 'custom', label: 'Custom' },
            ]}
          />
        </div>
        {kind === 'week' && (
          <div>
            <label className="label" htmlFor="pweek">Week</label>
            <select id="pweek" className="field" value={week} onChange={(e) => setWeek(e.target.value)}>
              {weeks.map((w) => (
                <option key={w.index} value={w.index}>
                  {w.label} · {w.sublabel}
                </option>
              ))}
            </select>
          </div>
        )}
        {kind === 'month' && (
          <div>
            <label className="label" htmlFor="pmonth">Month</label>
            <select id="pmonth" className="field" value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => (
                <option key={m.index} value={m.index}>
                  {m.label} · {m.sublabel}
                </option>
              ))}
            </select>
          </div>
        )}
        {kind === 'rotation' && (
          <div>
            <label className="label" htmlFor="prot">Rotation</label>
            <select id="prot" className="field" value={rotationId} onChange={(e) => setRotationId(e.target.value)}>
              {ds.rotations.map((r) => (
                <option key={r.id} value={r.id}>
                  {rotationName(ix, r.rotation)} · {fmtDate(r.startsOn)}
                </option>
              ))}
            </select>
          </div>
        )}
        {kind === 'custom' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="pfrom">From</label>
              <input id="pfrom" type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="pto">To</label>
              <input id="pto" type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        )}
        <fieldset>
          <legend className="label">Include</legend>
          <div className="flex flex-wrap gap-1.5">
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={include.has(s.key)}
                className="chip !min-h-9"
                onClick={() => {
                  const next = new Set(include);
                  if (next.has(s.key)) next.delete(s.key);
                  else next.add(s.key);
                  setInclude(next);
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </fieldset>
        <button type="button" className="btn btn-primary w-full" onClick={open} disabled={kind === 'custom' && from > to}>
          Open report
        </button>
      </section>

      <Section title="Finalised reports" aside={plural(snapshots.length, 'report')}>
        {snapshots.length === 0 ? (
          <p className="text-sm text-ink-2">Finalise a report to keep a fixed, hash-sealed copy — for example before sharing it with your supervisor.</p>
        ) : (
          <ul className="divide-y divide-line">
            {snapshots.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span>{s.label}</span>
                <span className="code text-xs text-ink-3" title={s.sha256}>
                  {s.sha256.slice(0, 12)} · {fmtDate(s.finalisedAt.slice(0, 10))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

// ===========================================================================
// Report view
// ===========================================================================

function resolvePeriod(params: URLSearchParams, ix: ReturnType<typeof useInternship>['ix'], asOf: string): { period: Period; title: string } | null {
  const { internship, rotations, requirementSet } = ix.ds;
  const kind = params.get('kind') as Kind | 'day';
  const index = Number(params.get('index'));
  switch (kind) {
    case 'week':
      return index ? { period: internshipWeek(internship, index), title: 'Weekly clinical report' } : null;
    case 'month':
      return index ? { period: internshipMonth(internship, index), title: 'Monthly clinical report' } : null;
    case 'rotation': {
      const r = rotations.find((x) => x.id === params.get('id'));
      return r ? { period: rotationPeriod(r, requirementSet), title: 'Rotation report' } : null;
    }
    case 'internship':
      return { period: { ...internshipPeriod(internship), to: asOf < internship.periodTo ? asOf : internship.periodTo }, title: 'Cumulative internship report' };
    case 'custom': {
      const f = params.get('from');
      const t = params.get('to');
      return f && t ? { period: customPeriod(f, t), title: 'Clinical activity report' } : null;
    }
    case 'day':
      return { period: dayPeriod(params.get('date') ?? asOf), title: 'Daily summary' };
    default:
      return null;
  }
}

export function ReportViewPage() {
  const { ix, ds, state, today } = useInternship();
  const [params] = useSearchParams();
  const toast = useToast();
  const asOf = analyticsDate(today, ix);
  const resolved = resolvePeriod(params, ix, asOf);
  const hidden = new Set((params.get('hide') ?? '').split(',').filter(Boolean));
  const show = (k: SectionKey) => !hidden.has(k);
  const report = useMemo(() => (resolved ? buildReport(ix, resolved.period, asOf) : null), [ix, resolved?.period.from, resolved?.period.to, asOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const snapshots = useLiveQuery(() => (report ? db.snapshots.where('from').equals(report.period.from).toArray() : []), [report?.period.from]) ?? [];
  const snapshot = snapshots.find((s) => s.to === report?.period.to && s.kind === report?.kind);

  if (!resolved || !report) return <PageHeader title="Report not found" />;
  const r = report;
  const rotationsInPeriod = ds.rotations.filter((x) => x.startsOn <= r.through && x.endsOn >= r.period.from);

  const finalise = async () => {
    const snap = snapshotReport(r, newId(), new Date().toISOString());
    await saveSnapshot(snap);
    toast(`Finalised · seal ${snap.sha256.slice(0, 12)}`);
  };

  return (
    <article className="mx-auto max-w-4xl space-y-5">
      <header className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="eyebrow mb-1">{resolved.title}</div>
            <h1 className="text-[28px] font-semibold sm:text-[34px]">{r.period.label}</h1>
            <div className="mt-1 text-ink-2">{r.period.sublabel}</div>
          </div>
          <div className="no-print flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
              <Printer size={16} aria-hidden="true" /> Print / PDF
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => downloadText(`procedures-${r.period.from}-${r.through}.csv`, proceduresCsv(ix, { from: r.period.from, to: r.through }))}
            >
              <Download size={16} aria-hidden="true" /> Procedures CSV
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => downloadText(`logbook-${r.period.from}-${r.through}.csv`, logbookCsv(ix, { from: r.period.from, to: r.through }))}>
              <Download size={16} aria-hidden="true" /> Logbook CSV
            </button>
          </div>
        </div>
        <dl className="mt-5 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="text-ink-3">Intern</dt>
            <dd>{ds.internship.internName}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-3">Training centre</dt>
            <dd>{state.facility?.name ?? ds.internship.institution}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-3">Rotation{rotationsInPeriod.length > 1 ? 's' : ''}</dt>
            <dd>{rotationsInPeriod.map((x) => rotationName(ix, x.rotation)).join(', ') || '—'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-3">Generated</dt>
            <dd>{displayDate(today)}</dd>
          </div>
        </dl>
        {r.partial && (
          <div className="mt-4">
            <ToneNote tone="neutral">This period is still in progress — figures run to {fmtDate(r.through)}.</ToneNote>
          </div>
        )}
        {snapshot && (
          <div className="mt-4">
            <ToneNote tone={snapshotMatches(snapshot, r) ? 'good' : 'warning'}>
              {snapshotMatches(snapshot, r)
                ? `Finalised on ${fmtDate(snapshot.finalisedAt.slice(0, 10))} · seal ${snapshot.sha256.slice(0, 12)} · matches the current data.`
                : `Finalised on ${fmtDate(snapshot.finalisedAt.slice(0, 10))}, but the underlying records have changed since. Finalise again to seal the current version.`}
            </ToneNote>
          </div>
        )}
      </header>

      {/* The compounding table: this period, previous period, cumulative */}
      <Section title="Activity" aside={r.previous ? `vs ${r.previous.label}` : undefined}>
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-3">
                <th className="px-4 py-2 font-medium sm:px-0">Measure</th>
                <th className="px-2 py-2 text-right font-medium">This period</th>
                {r.previousStats && <th className="px-2 py-2 text-right font-medium">Previous</th>}
                {r.previousStats && <th className="px-2 py-2 text-right font-medium">Change</th>}
                <th className="px-4 py-2 text-right font-medium sm:px-0">Cumulative</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {[
                ...HEADLINE_METRICS,
                { key: 'new', label: 'New patients', get: (s: Report['stats']) => s.newPatients },
                { key: 'fu', label: 'Follow-up visits', get: (s: Report['stats']) => s.followUps },
                { key: 'theatre', label: 'Theatre / ward sessions', get: (s: Report['stats']) => s.theatre },
                { key: 'outreach', label: 'Outreach & community', get: (s: Report['stats']) => s.outreach },
                { key: 'academic', label: 'Academic activities', get: (s: Report['stats']) => s.academic },
              ].map((m) => {
                const cur = m.get(r.stats);
                const prev = r.previousStats ? m.get(r.previousStats) : null;
                return (
                  <tr key={m.key} className="border-t border-line">
                    <td className="px-4 py-2 sm:px-0">{m.label}</td>
                    <td className="px-2 py-2 text-right font-semibold">{cur}</td>
                    {prev !== null && <td className="px-2 py-2 text-right text-ink-2">{prev}</td>}
                    {prev !== null && (
                      <td className="px-2 py-2 text-right" style={{ color: cur > prev ? 'var(--good-ink)' : 'var(--ink-2)' }}>
                        {fmtChange(cur - prev)}
                      </td>
                    )}
                    <td className="px-4 py-2 text-right sm:px-0">{m.get(r.cumulative)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {show('charts') && r.stats.procedures.total > 0 && (
        <div className="grid gap-5 md:grid-cols-2">
          <Section title="Participation level">
            <LevelMixBar byLevel={r.stats.procedures.byLevel} />
          </Section>
          <Section title="Clinical exposure by area">
            <RankedBars
              rows={Object.entries(r.stats.byCategory)
                .map(([c, n]) => ({ label: CATEGORY_LABELS[c as ProcedureCategory], value: n ?? 0 }))
                .sort((a, b) => b.value - a.value)}
            />
          </Section>
        </div>
      )}

      {show('procedures') && (
        <Section title="Procedures" aside={plural(r.stats.procedures.total, 'procedure')}>
          {r.stats.byProcedure.length === 0 ? (
            <p className="text-sm text-ink-2">No procedures recorded in this period.</p>
          ) : (
            <div className="-mx-4 overflow-x-auto sm:mx-0">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-3">
                    <th className="px-4 py-2 font-medium sm:px-0">Procedure</th>
                    {['L1', 'L2', 'L3', 'L4', 'L5'].map((l) => (
                      <th key={l} className="px-2 py-2 text-right font-medium">
                        {l}
                      </th>
                    ))}
                    <th className="px-4 py-2 text-right font-medium sm:px-0">Total</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {r.stats.byProcedure.map((p) => (
                    <tr key={p.id} className="border-t border-line">
                      <td className="px-4 py-2 sm:px-0">{p.name}</td>
                      {([1, 2, 3, 4, 5] as const).map((l) => (
                        <td key={l} className={`px-2 py-2 text-right ${p.byLevel[l] ? '' : 'text-ink-3'}`}>
                          {p.byLevel[l] || '·'}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-right font-semibold sm:px-0">{p.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {r.stats.diagnoses.length > 0 && (
            <p className="mt-3 text-sm text-ink-2">
              <strong className="text-ink">Most frequent diagnoses:</strong> {r.stats.diagnoses.slice(0, 6).map((d) => `${d.term} (${d.count})`).join(', ')}
            </p>
          )}
        </Section>
      )}

      {show('competencies') && (
        <Section title="Competency progression" aside="Logbook codes">
          {r.codeGains.length === 0 ? (
            <p className="text-sm text-ink-2">No logbook entries in this period.</p>
          ) : (
            <ul className="divide-y divide-line">
              {r.codeGains.map((g) => (
                <li key={g.code} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3 py-2 text-sm">
                  <span className="code">{g.code}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-ink-2">{g.description}</span>
                    <ProgressBar verified={g.totalVerified} pending={0} min={g.minCount} color={ROTATION_VAR[g.rotation]} />
                  </span>
                  <span className="tabular text-right">
                    <strong className="text-good-ink">+{g.gained}</strong>
                    <span className="block text-xs text-ink-3">
                      {g.totalVerified}/{g.minCount} verified
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {r.gaps.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold">Areas requiring further exposure</h3>
              <ul className="space-y-1.5 text-sm">
                {r.gaps.slice(0, 8).map((p) => (
                  <li key={p.requirement.code} className="flex items-center gap-2">
                    <StatusBadge status={p.status} />
                    <span className="code">{p.requirement.code}</span>
                    <span className="text-ink-2">
                      {p.verified} of {p.requirement.minCount} — exposure appears limited based on recorded activities
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {r.strengths.length > 0 && (
            <p className="mt-4 text-sm text-ink-2">
              <strong className="text-ink">Minimum met:</strong> {r.strengths.map((p) => p.requirement.code).join(', ')}
            </p>
          )}
        </Section>
      )}

      {show('diary') && (
        <Section title="Learning" aside={plural(r.stats.reflections.count, 'reflection')}>
          {r.stats.reflections.count === 0 ? (
            <p className="text-sm text-ink-2">
              No diary entries in this period. <Link to="/diary/new" className="no-print underline">Add a reflection</Link>
            </p>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-1.5">
                {r.learning.themes.map((t) => {
                  const m = TAGS.find((x) => x.value === t.tag);
                  return (
                    <span key={t.tag} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs">
                      <span aria-hidden="true">{m?.mark}</span> {m?.label ?? t.tag} · {t.count}
                    </span>
                  );
                })}
              </div>
              {r.learning.highlights.length > 0 && <TextList title="Highlights" items={r.learning.highlights.map((h) => ({ date: h.date, text: h.title }))} />}
              <TextList title="What I learned" items={r.learning.learned} />
              <TextList title="Challenges" items={r.learning.challenges} />
              <TextList title="To revise" items={r.learning.toRevise} />
              <TextList title="Exposure I want more of" items={r.learning.exposureWanted} />
            </div>
          )}
        </Section>
      )}

      {show('feedback') && (
        <Section title="Supervisor feedback">
          <p className="tabular text-sm text-ink-2">
            {r.supervisorFeedback.verified} entries verified · {r.supervisorFeedback.returned} returned · {r.supervisorFeedback.levelAdjusted} with the level adjusted by the supervisor
          </p>
          {r.supervisorFeedback.comments.length > 0 && (
            <ul className="mt-3 space-y-2 text-sm">
              {r.supervisorFeedback.comments.slice(0, 12).map((c) => (
                <li key={c.verification.id} className="border-l-2 border-line-strong pl-3">
                  “{c.verification.comment}” <span className="text-xs text-ink-3">— {c.code}, {fmtDate(c.performedOn)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {show('insights') && r.insights.length > 0 && (
        <Section title="Insights" aside="Generated from recorded data">
          <ul className="space-y-3">
            {r.insights.slice(0, 8).map((i) => (
              <li key={i.id} className="text-sm">
                <div className="eyebrow">
                  {QUESTION_LABELS[i.question]} · {i.basis === 'recorded' ? 'recorded data' : 'interpretation'}
                </div>
                {i.text}
                <div className="text-xs text-ink-3">Based on: {i.evidence}</div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <footer className="space-y-3 pb-4 text-xs text-ink-3">
        <p>
          Generated from logbook records with {ds.rules.confirmed ? 'confirmed' : 'default'} counting rules. Procedure counts indicate recorded exposure and are not, on their own, proof of
          competence. Patient numbers are pseudonymous; no names or contacts are stored.
        </p>
        <div className="no-print flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-secondary" onClick={finalise}>
            <FileCheck2 size={16} aria-hidden="true" /> Finalise report
          </button>
          {snapshot && snapshotMatches(snapshot, r) && (
            <span className="inline-flex items-center gap-1 text-good-ink">
              <CheckCircle2 size={14} aria-hidden="true" /> Sealed
            </span>
          )}
        </div>
      </footer>
    </article>
  );
}

function TextList({ title, items }: { title: string; items: { date: string; text: string }[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className="mb-1 font-semibold">{title}</h3>
      <ul className="space-y-1 text-ink-2">
        {items.slice(0, 6).map((x, i) => (
          <li key={i}>
            <span className="tabular mr-2 text-xs text-ink-3">{fmtDate(x.date)}</span>
            {x.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
