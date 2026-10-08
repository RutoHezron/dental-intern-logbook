import { computeStats, internshipMonths, internshipWeeks, type DatasetIndex, type ISODate } from '@logbook/core';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ROTATION_ORDER, ROTATION_SHORT, ROTATION_VAR } from '../lib/format';
import { Segmented } from './ui';

/**
 * Charts follow one system: recessive grid and axes, 2px surface gaps,
 * 4px rounded data ends, a legend whenever there are two or more series,
 * hover tooltips, and a table view for every chart.
 */

const axisProps = {
  tick: { fill: 'var(--ink-3)', fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: 'var(--axis)' },
} as const;

function TooltipBox({ active, payload, label, unit = 'procedures' }: { active?: boolean; payload?: { name?: string; value?: number; color?: string; payload?: Record<string, unknown> }[]; label?: string; unit?: string }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => (p.value ?? 0) > 0);
  const sub = payload[0]?.payload?.sublabel as string | undefined;
  return (
    <div className="rounded-[10px] border border-line bg-surface px-3 py-2 text-xs shadow-card">
      <div className="font-semibold text-ink">{label}</div>
      {sub && <div className="mb-1 text-ink-3">{sub}</div>}
      {rows.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-ink-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden="true" />
          <span>{ROTATION_SHORT[p.name ?? ''] ?? p.name}</span>
          <span className="tabular ml-auto pl-3 font-semibold text-ink">
            {p.value} {unit}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ codes }: { codes: string[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="Legend">
      {codes.map((c) => (
        <li key={c} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: ROTATION_VAR[c] }} aria-hidden="true" />
          {ROTATION_SHORT[c] ?? c}
        </li>
      ))}
    </ul>
  );
}

interface PeriodRow {
  label: string;
  sublabel: string;
  total: number;
  [rotation: string]: number | string;
}

export function useActivitySeries(ix: DatasetIndex, asOf: ISODate, grain: 'week' | 'month'): PeriodRow[] {
  return useMemo(() => {
    const periods = grain === 'week' ? internshipWeeks(ix.ds.internship, asOf) : internshipMonths(ix.ds.internship, asOf);
    return periods.map((p) => {
      const s = computeStats(ix, p.from, p.to < asOf ? p.to : asOf);
      const row: PeriodRow = { label: grain === 'week' ? `W${p.index}` : `M${p.index}`, sublabel: p.sublabel, total: s.procedures.total };
      for (const code of ROTATION_ORDER) row[code] = s.byRotation[code] ?? 0;
      return row;
    });
  }, [ix, asOf, grain]);
}

/** Procedures per week or month, coloured by rotation (one rotation per period, so bars rarely stack). */
export function ActivityChart({ ix, asOf, height = 220 }: { ix: DatasetIndex; asOf: ISODate; height?: number }) {
  const [grain, setGrain] = useState<'week' | 'month'>('month');
  const [table, setTable] = useState(false);
  const data = useActivitySeries(ix, asOf, grain);
  const present = ROTATION_ORDER.filter((c) => data.some((d) => (d[c] as number) > 0));
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label="Period"
          value={grain}
          onChange={setGrain}
          options={[
            { value: 'week', label: 'Weekly' },
            { value: 'month', label: 'Monthly' },
          ]}
        />
        <button type="button" className="text-xs font-medium text-ink-2 underline underline-offset-2" onClick={() => setTable(!table)}>
          {table ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {table ? (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-3">
                <th className="py-1 font-medium">Period</th>
                <th className="py-1 font-medium">Dates</th>
                <th className="py-1 text-right font-medium">Procedures</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {data.map((d) => (
                <tr key={d.label} className="border-t border-line">
                  <td className="py-1.5">{d.label}</td>
                  <td className="py-1.5 text-ink-2">{d.sublabel}</td>
                  <td className="py-1.5 text-right">{d.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div style={{ height }} role="img" aria-label={`Procedures per ${grain}, coloured by rotation`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 4, right: 4, left: -18, bottom: 0 }} barCategoryGap={grain === 'week' ? 2 : 8}>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="label" {...axisProps} interval={grain === 'week' ? 3 : 0} />
                <YAxis {...axisProps} axisLine={false} allowDecimals={false} />
                <Tooltip content={<TooltipBox />} cursor={{ fill: 'var(--surface-2)' }} />
                {present.map((code, i) => (
                  <Bar
                    key={code}
                    dataKey={code}
                    stackId="a"
                    fill={ROTATION_VAR[code]}
                    stroke="var(--surface)"
                    strokeWidth={grain === 'week' ? 0 : 2}
                    radius={i === present.length - 1 ? [4, 4, 0, 0] : 0}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2">
            <Legend codes={present} />
          </div>
        </>
      )}
    </div>
  );
}

/** Cumulative procedures through the internship — the compounding curve. */
export function CumulativeChart({ ix, asOf, height = 180 }: { ix: DatasetIndex; asOf: ISODate; height?: number }) {
  const data = useActivitySeries(ix, asOf, 'month');
  let run = 0;
  const rows = data.map((d) => ({ label: d.label, sublabel: d.sublabel, cumulative: (run += d.total) }));
  return (
    <div style={{ height }} role="img" aria-label="Cumulative procedures by internship month">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis {...axisProps} axisLine={false} allowDecimals={false} />
          <Tooltip
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className="rounded-[10px] border border-line bg-surface px-3 py-2 text-xs shadow-card">
                  <div className="font-semibold">{label}</div>
                  <div className="text-ink-3">{(payload[0]!.payload as { sublabel: string }).sublabel}</div>
                  <div className="tabular mt-0.5 font-semibold">{payload[0]!.value} procedures to date</div>
                </div>
              ) : null
            }
            cursor={{ stroke: 'var(--axis)' }}
          />
          <Line type="monotone" dataKey="cumulative" stroke="var(--ink)" strokeWidth={2} dot={{ r: 3, fill: 'var(--ink)', stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal bars for a ranked list (procedures by category, etc.). Single series: no legend needed. */
export function RankedBars({ rows, unit = '' }: { rows: { label: string; value: number; color?: string }[]; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate text-ink-2" title={r.label}>
            {r.label}
          </span>
          <span className="h-2 rounded-r-[4px]" style={{ width: `${(r.value / max) * 100}%`, minWidth: 2, background: r.color ?? 'var(--l3)' }} aria-hidden="true" />
          <span className="tabular w-10 text-right font-medium">
            {r.value}
            {unit}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Level mix as a single 100% bar (L1→L5), with a key. */
export function LevelMixBar({ byLevel }: { byLevel: Record<1 | 2 | 3 | 4 | 5, number> }) {
  const total = Object.values(byLevel).reduce((a, b) => a + b, 0);
  if (!total) return <div className="text-sm text-ink-3">No procedures recorded.</div>;
  const names = ['Observed', 'Assisted', 'Direct', 'Indirect', 'Independent'];
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-[4px]" role="img" aria-label={names.map((n, i) => `${n} ${byLevel[(i + 1) as 1]}`).join(', ')}>
        {([1, 2, 3, 4, 5] as const).map((l) =>
          byLevel[l] ? <span key={l} style={{ width: `${(byLevel[l] / total) * 100}%`, background: `var(--l${l})` }} title={`L${l} ${names[l - 1]}: ${byLevel[l]}`} /> : null,
        )}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2">
        {([1, 2, 3, 4, 5] as const).map((l) => (
          <li key={l} className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: `var(--l${l})` }} aria-hidden="true" />
            L{l} {names[l - 1]} <span className="tabular font-medium text-ink">{byLevel[l]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

