import { buildPortfolio, CATEGORY_LABELS, displayDate } from '@logbook/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { Printer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CumulativeChart, RankedBars } from '../components/charts';
import { LevelLadder, PageHeader, ProgressBar, RotationDot, Section, StatusBadge, useToast } from '../components/ui';
import { getMeta, META, setMeta } from '../data/db';
import { fmtDate, fmtPct, plural, ROTATION_VAR, rotationName } from '../lib/format';
import { analyticsDate, useInternship } from '../state/AppData';
import { TAGS } from './Diary';

export function PortfolioPage() {
  const { ix, ds, state, today } = useInternship();
  const toast = useToast();
  const asOf = analyticsDate(today, ix);
  const pf = useMemo(() => buildPortfolio(ix, asOf), [ix, asOf]);
  const saved = useLiveQuery(() => getMeta<string | null>(META.finalReflection, null), []);
  const [text, setText] = useState('');
  useEffect(() => {
    if (saved !== undefined) setText(saved ?? '');
  }, [saved]);
  const t = pf.totals;
  const complete = asOf >= ds.internship.periodTo;

  return (
    <article className="space-y-5">
      <PageHeader
        eyebrow={complete ? 'Final portfolio' : `Portfolio in progress · to ${displayDate(asOf)}`}
        title="Dental internship clinical portfolio"
        actions={
          <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
            <Printer size={16} aria-hidden="true" /> Print / PDF
          </button>
        }
      >
        Built from your records. It grows with every entry, so it is never assembled by hand.
      </PageHeader>

      {/* 1. Overview */}
      <Section title="Internship overview">
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          {[
            ['Intern', ds.internship.internName],
            ['Training centre', state.facility?.name ?? ds.internship.institution ?? '—'],
            ['Internship period', `${fmtDate(ds.internship.periodFrom)} – ${fmtDate(ds.internship.periodTo)}`],
            ['Licence no.', ds.internship.licenceNo ?? '—'],
            ['Logbook framework', `${ds.requirementSet.issuer} ${ds.requirementSet.title}, ${ds.requirementSet.edition}`],
            ['Rotations', `${pf.rotations.filter((r) => r.status === 'completed').length} of ${pf.rotations.length} completed`],
          ].map(([k, v]) => (
            <div key={k} className="flex gap-3">
              <dt className="w-36 shrink-0 text-ink-3">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {/* 2. Clinical activity summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Patients', t.patientsSeen],
          ['Procedures', t.procedures.total],
          ['Performed (L3–5)', t.procedures.performed],
          ['Independent (L5)', t.procedures.independent],
          ['Emergencies', t.emergencies],
          ['Referrals', t.referrals],
          ['Radiographs', t.radiographs],
          ['Theatre / ward sessions', t.theatre],
          ['Outreach & community', t.outreach],
          ['Academic activities', t.academic],
          ['Logbook entries verified', t.entries.verified],
          ['Codes met (default rules)', `${pf.progressSummary.met}/${pf.progressSummary.codes}`],
        ].map(([k, v]) => (
          <div key={k as string} className="card p-3">
            <div className="text-xs text-ink-2">{k}</div>
            <div className="tabular font-display text-2xl font-semibold">{typeof v === 'number' ? v.toLocaleString() : v}</div>
          </div>
        ))}
      </div>

      {/* 3. Progress timeline — the internship journey */}
      <Section title="Internship progression" aside="Month by month">
        <CumulativeChart ix={ix} asOf={asOf} />
        <ol className="mt-5 space-y-0">
          {pf.timeline.map((s, i) => (
            <li key={s.period.index} className="grid grid-cols-[3.25rem_1rem_1fr] gap-x-3">
              <div className="pt-0.5 text-right">
                <div className="code text-sm font-semibold">M{s.period.index}</div>
                <div className="text-[11px] text-ink-3">{s.period.from.slice(0, 7)}</div>
              </div>
              <div className="flex flex-col items-center">
                <span className="mt-1.5 h-3 w-3 shrink-0 rounded-full" style={{ background: ROTATION_VAR[s.rotations.at(-1) ?? ''] ?? 'var(--ink-3)' }} aria-hidden="true" />
                {i < pf.timeline.length - 1 && <span className="w-px flex-1 bg-line-strong" aria-hidden="true" />}
              </div>
              <div className="pb-5">
                <div className="font-semibold">
                  {s.headline}
                  {s.partial && <span className="ml-2 text-xs font-normal text-ink-3">(in progress)</span>}
                </div>
                <div className="tabular mt-0.5 text-sm text-ink-2">
                  {plural(s.stats.procedures.total, 'procedure')} · {fmtPct(s.performedShare)} performed by you · {s.cumulativeProcedures.toLocaleString()} to date
                </div>
                {(s.levelUps.length > 0 || s.milestones.length > 0) && (
                  <ul className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                    {s.milestones.map((m) => (
                      <li key={m.id} className="rounded-full bg-accent-soft px-2 py-0.5">
                        🏆 {m.title}
                      </li>
                    ))}
                    {s.levelUps.length > 0 && (
                      <li className="rounded-full bg-surface-2 px-2 py-0.5 text-ink-2">
                        {s.levelUps.length} code{s.levelUps.length === 1 ? '' : 's'} reached a new verified level
                      </li>
                    )}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ol>
        <p className="text-xs text-ink-3">Headlines describe the recorded numbers for each month; they are not assessments.</p>
      </Section>

      {/* 4. Procedure portfolio */}
      <Section title="Procedure portfolio" aside={plural(pf.procedures.length, 'procedure type')}>
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-3">
                <th className="px-4 py-2 font-medium sm:px-0">Procedure</th>
                <th className="px-2 py-2 font-medium">Area</th>
                {['L1', 'L2', 'L3', 'L4', 'L5'].map((l) => (
                  <th key={l} className="px-2 py-2 text-right font-medium">
                    {l}
                  </th>
                ))}
                <th className="px-4 py-2 text-right font-medium sm:px-0">Total</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {pf.procedures.map((x) => (
                <tr key={x.type.id} className="border-t border-line">
                  <td className="px-4 py-1.5 sm:px-0">{x.type.name}</td>
                  <td className="px-2 py-1.5 text-ink-2">{CATEGORY_LABELS[x.type.category]}</td>
                  {([1, 2, 3, 4, 5] as const).map((l) => (
                    <td key={l} className={`px-2 py-1.5 text-right ${x.levels[l] ? '' : 'text-ink-3'}`}>
                      {x.levels[l] || '·'}
                    </td>
                  ))}
                  <td className="px-4 py-1.5 text-right font-semibold sm:px-0">{x.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* 5–6. Competency development and rotation performance */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Rotation performance">
          <RankedBars rows={pf.rotations.map((r) => ({ label: rotationName(ix, r.rotation.rotation), value: r.stats.procedures.total, color: ROTATION_VAR[r.rotation.rotation] }))} />
          <ul className="mt-4 divide-y divide-line text-sm">
            {pf.rotations.map((r) => (
              <li key={r.rotation.id} className="flex items-center gap-3 py-2">
                <RotationDot code={r.rotation.rotation} />
                <span className="flex-1">{rotationName(ix, r.rotation.rotation)}</span>
                <span className="tabular text-ink-2">
                  {r.summary.met}/{r.summary.codes} codes met
                </span>
                <span className="w-24 text-right text-xs text-ink-3">{r.status.replace('_', ' ')}</span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Competency development">
          <ul className="space-y-2.5">
            {pf.progress
              .filter((p) => p.requirement.minCount >= 5 && !p.requirement.code.startsWith('COMM'))
              .map((p) => (
                <li key={p.requirement.code} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2 text-sm">
                  <span className="code">{p.requirement.code}</span>
                  <ProgressBar verified={p.verified} pending={p.pending} min={p.requirement.minCount} color={ROTATION_VAR[p.requirement.rotation]} />
                  <span className="flex items-center gap-2">
                    <span className="tabular w-14 text-right">
                      {p.verified}/{p.requirement.minCount}
                    </span>
                    <LevelLadder level={p.highestVerifiedLevel} size={12} />
                  </span>
                </li>
              ))}
          </ul>
        </Section>
      </div>

      {/* 7–8. Strengths and areas requiring development */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Areas of strength">
          {pf.strengths.length ? (
            <ul className="space-y-1.5 text-sm">
              {pf.strengths.map((p) => (
                <li key={p.requirement.code}>
                  <span className="code mr-2">{p.requirement.code}</span>
                  {p.requirement.description} — {p.verified} verified (minimum {p.requirement.minCount})
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2">Appears once codes reach their minimum.</p>
          )}
        </Section>
        <Section title="Areas requiring further development">
          {pf.development.length ? (
            <ul className="space-y-1.5 text-sm">
              {pf.development.map((p) => (
                <li key={p.requirement.code} className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={p.status} />
                  <span className="code">{p.requirement.code}</span>
                  <span className="text-ink-2">
                    {p.verified} of {p.requirement.minCount} — exposure appears limited based on recorded activities
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2">No gaps in recorded exposure.</p>
          )}
          {pf.uncoded.some((u) => u.total < 3) && (
            <p className="mt-3 text-xs text-ink-3">
              Little recorded exposure to: {pf.uncoded.filter((u) => u.total < 3).map((u) => u.competency.description.toLowerCase()).join('; ')}.
            </p>
          )}
        </Section>
      </div>

      {/* 6. Learning journey */}
      <Section title="Clinical learning journey" aside={plural(ds.reflections.filter((r) => !r.deletedAt).length, 'reflection')}>
        <div className="grid gap-5 md:grid-cols-3">
          {(
            [
              ['milestone', pf.highlights.milestones],
              ['important', pf.highlights.important],
              ['challenging', pf.highlights.challenging],
            ] as const
          ).map(([tag, items]) => {
            const m = TAGS.find((x) => x.value === tag)!;
            return (
              <div key={tag}>
                <h3 className="mb-2 text-sm font-semibold">
                  <span aria-hidden="true">{m.mark}</span> {m.label}s ({items.length})
                </h3>
                <ul className="space-y-2 text-sm">
                  {items.slice(0, 5).map((r) => (
                    <li key={r.id}>
                      <div className="font-medium">{r.title}</div>
                      <div className="text-xs text-ink-3">{fmtDate(r.date)}</div>
                      {r.learned && <div className="text-ink-2">{r.learned}</div>}
                    </li>
                  ))}
                  {items.length === 0 && <li className="text-ink-3">None tagged yet.</li>}
                </ul>
              </div>
            );
          })}
        </div>
      </Section>

      {/* 10. Final reflection: draft from records, edited by the intern */}
      <Section title="Final reflection">
        <div className="no-print mb-4 rounded-[12px] border border-line bg-surface-2 p-4">
          <div className="eyebrow mb-2">Draft from your records — every sentence cites the data it uses</div>
          <ul className="space-y-2 text-sm">
            {pf.draftReflection.map((s, i) => (
              <li key={i}>
                {s.text}
                <div className="text-xs text-ink-3">Based on: {s.evidence}</div>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-secondary mt-3" onClick={() => setText(pf.draftReflection.map((s) => s.text).join(' '))}>
            Use draft as a starting point
          </button>
        </div>
        <label className="label" htmlFor="finalReflection">Your reflection</label>
        <textarea
          id="finalReflection"
          className="field min-h-48"
          placeholder="Write in your own words. Nothing here is submitted automatically."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="no-print mt-2 flex justify-end">
          <button
            type="button"
            className="btn btn-primary"
            onClick={async () => {
              await setMeta(META.finalReflection, text);
              toast('Reflection saved');
            }}
          >
            Save reflection
          </button>
        </div>
      </Section>

      <p className="text-xs text-ink-3">{pf.disclaimer}</p>
    </article>
  );
}
