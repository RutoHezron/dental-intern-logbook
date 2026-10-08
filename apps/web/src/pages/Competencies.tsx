import { CATEGORY_LABELS, LEVEL_LONG, procedureExposure, progressCsv, requirementProgress, uncodedExposure, type Level } from '@logbook/core';
import { Download, Info } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { LevelLadder, PageHeader, Section, Segmented, StatusBadge } from '../components/ui';
import { downloadText, fmtDate, LEVEL_NAMES, ROTATION_ORDER, ROTATION_VAR, rotationName } from '../lib/format';
import { analyticsDate, useInternship } from '../state/AppData';

const LEVELS: Level[] = [1, 2, 3, 4, 5];
const COLS = ['Obs.', 'Assist', 'Direct', 'Indirect', 'Indep.'];

export function CompetenciesPage() {
  const { ix, today } = useInternship();
  const asOf = analyticsDate(today, ix);
  const [view, setView] = useState<'codes' | 'procedures'>('codes');
  const [rotation, setRotation] = useState('');
  const progress = useMemo(() => requirementProgress(ix, asOf), [ix, asOf]);
  const exposure = useMemo(() => procedureExposure(ix, asOf).filter((x) => x.total > 0).sort((a, b) => b.total - a.total), [ix, asOf]);
  const uncoded = useMemo(() => uncodedExposure(ix, asOf), [ix, asOf]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Competencies"
        actions={
          <button type="button" className="btn btn-secondary" onClick={() => downloadText('competency-progress.csv', progressCsv(progress))}>
            <Download size={16} aria-hidden="true" /> CSV
          </button>
        }
      >
        How often you have done each logbook competency, and at which level.
      </PageHeader>

      <div className="card flex items-start gap-3 p-4 text-sm text-ink-2">
        <Info size={18} className="mt-0.5 shrink-0 text-ink" aria-hidden="true" />
        <div>
          <p>
            <strong className="text-ink">Quantity is an exposure indicator, not proof of competence.</strong> Levels follow KMPDC 5.2.2; the supervisor's observed level
            replaces your claim once an entry is verified. Competence is assessed by your supervisors.
          </p>
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {LEVELS.map((l) => (
              <li key={l} className="flex items-start gap-2">
                <LevelLadder level={l} size={14} />
                <span>
                  <strong className="text-ink">L{l}</strong> {LEVEL_LONG[l]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: 'codes', label: 'Logbook codes' },
            { value: 'procedures', label: 'All procedures' },
          ]}
        />
        {view === 'codes' && (
          <select aria-label="Rotation" className="field !min-h-10 !w-auto" value={rotation} onChange={(e) => setRotation(e.target.value)}>
            <option value="">All rotations</option>
            {ROTATION_ORDER.map((c) => (
              <option key={c} value={c}>
                {rotationName(ix, c)}
              </option>
            ))}
          </select>
        )}
      </div>

      {view === 'codes' ? (
        <>
          {(rotation ? [rotation] : ROTATION_ORDER).map((code) => {
            const list = progress.filter((p) => p.requirement.rotation === code);
            return (
              <section key={code} className="card overflow-hidden">
                <h2 className="border-b border-line px-4 py-3 text-[17px] font-semibold" style={{ boxShadow: `inset 4px 0 0 ${ROTATION_VAR[code]}` }}>
                  {rotationName(ix, code)}
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="text-left text-xs text-ink-3">
                        <th className="px-4 py-2 font-medium">Competency</th>
                        {COLS.map((c, i) => (
                          <th key={c} className="px-2 py-2 text-right font-medium" title={LEVEL_NAMES[i + 1]}>
                            {c}
                          </th>
                        ))}
                        <th className="px-2 py-2 text-right font-medium">Verified / min</th>
                        <th className="px-2 py-2 font-medium">Reached</th>
                        <th className="px-4 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="tabular">
                      {list.map((p) => (
                        <tr key={p.requirement.code} className="border-t border-line">
                          <td className="px-4 py-2">
                            <Link to={`/logbook/code/${encodeURIComponent(p.requirement.code)}`} className="hover:underline">
                              <span className="code mr-2">{p.requirement.code}</span>
                              <span className="text-ink-2">{p.requirement.description}</span>
                            </Link>
                          </td>
                          {LEVELS.map((l) => (
                            <td key={l} className={`px-2 py-2 text-right ${p.levels[l] ? '' : 'text-ink-3'} ${l === p.requirement.expectedLevel ? 'font-semibold' : ''}`}>
                              {p.levels[l] || '·'}
                            </td>
                          ))}
                          <td className="px-2 py-2 text-right">
                            {p.verified}/{p.requirement.minCount}
                          </td>
                          <td className="px-2 py-2">
                            <LevelLadder level={p.highestVerifiedLevel} size={14} />
                          </td>
                          <td className="px-4 py-2">
                            <StatusBadge status={p.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
          <p className="text-xs text-ink-3">Bold column = level the logbook expects for that code. Level counts include entries awaiting verification.</p>

          <Section title="Expected but not coded in the logbook">
            <p className="mb-3 text-sm text-ink-2">
              KMPDC expects these (4.2, 4.4.2, 4.6.2) but the logbook has no code for them. They are tracked as exposure so they are not overlooked.
            </p>
            <ul className="divide-y divide-line">
              {uncoded.map((u) => (
                <li key={u.competency.code} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <span className="code w-16 text-ink-3">{u.competency.code}</span>
                  <span className="min-w-0 flex-1">{u.competency.description}</span>
                  <span className="tabular w-24 text-right">{u.total ? `${u.total} recorded` : <span className="text-ink-3">none yet</span>}</span>
                </li>
              ))}
            </ul>
          </Section>
        </>
      ) : (
        <section className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-3">
                  <th className="px-4 py-2 font-medium">Procedure</th>
                  <th className="px-2 py-2 font-medium">Area</th>
                  {COLS.map((c) => (
                    <th key={c} className="px-2 py-2 text-right font-medium">
                      {c}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right font-medium">Total</th>
                  <th className="px-4 py-2 font-medium">First / last</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {exposure.map((x) => (
                  <tr key={x.type.id} className="border-t border-line">
                    <td className="px-4 py-2">{x.type.name}</td>
                    <td className="px-2 py-2 text-ink-2">{CATEGORY_LABELS[x.type.category]}</td>
                    {LEVELS.map((l) => (
                      <td key={l} className={`px-2 py-2 text-right ${x.levels[l] ? '' : 'text-ink-3'}`}>
                        {x.levels[l] || '·'}
                      </td>
                    ))}
                    <td className="px-2 py-2 text-right font-semibold">{x.total}</td>
                    <td className="px-4 py-2 text-xs text-ink-2">
                      {x.firstOn && fmtDate(x.firstOn)} – {x.lastOn && fmtDate(x.lastOn)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-4 py-2 text-xs text-ink-3">
            All recorded procedures across every rotation, including those that do not count toward a logbook code.
          </p>
        </section>
      )}
    </div>
  );
}
