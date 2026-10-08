import { PERMANENT_TEETH, PRIMARY_TEETH } from '@logbook/core';
import { useState, type ReactNode } from 'react';
import { Segmented } from './ui';

function Quadrant({ label, teeth, render }: { label: string; teeth: string[]; render: (t: string) => ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <span className="w-7 shrink-0 whitespace-pre-line text-[10px] leading-tight text-ink-3 sm:hidden">{label.replace(' ', '\n')}</span>
      <div className="flex min-w-0 flex-1 gap-1">{teeth.map(render)}</div>
    </div>
  );
}

function Tooth({ t, on, onToggle }: { t: string; on: boolean; onToggle: (t: string) => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={`Tooth ${t}`}
      onClick={() => onToggle(t)}
      className="code flex h-11 min-w-0 flex-1 items-center justify-center rounded-[8px] border text-[13px] transition-colors"
      style={{
        borderColor: on ? 'var(--accent)' : 'var(--line)',
        background: on ? 'var(--accent)' : 'var(--surface)',
        color: on ? 'var(--accent-ink)' : 'var(--ink)',
      }}
    >
      {t}
    </button>
  );
}

/**
 * FDI tooth chart, laid out as seen facing the patient. Tapping is the only
 * way to enter a tooth, which avoids wrong-site errors from typed numbers
 * (blueprint §"Where automation introduces clinical risk").
 */
export function ToothChart({
  selected,
  onChange,
  defaultDentition = 'permanent',
  multiple = true,
}: {
  selected: string[];
  onChange: (teeth: string[]) => void;
  defaultDentition?: 'permanent' | 'primary';
  multiple?: boolean;
}) {
  const [dentition, setDentition] = useState<'permanent' | 'primary'>(
    selected.some((t) => Number(t[0]) >= 5) ? 'primary' : defaultDentition,
  );
  const rows = dentition === 'permanent' ? PERMANENT_TEETH : PRIMARY_TEETH;
  const toggle = (t: string) => {
    if (!multiple) return onChange(selected[0] === t ? [] : [t]);
    onChange(selected.includes(t) ? selected.filter((x) => x !== t) : [...selected, t]);
  };
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <Segmented
          label="Dentition"
          value={dentition}
          onChange={setDentition}
          options={[
            { value: 'permanent', label: 'Permanent' },
            { value: 'primary', label: 'Primary' },
          ]}
        />
        {selected.length > 0 && (
          <button type="button" className="text-sm font-medium text-ink-2 underline-offset-2 hover:underline" onClick={() => onChange([])}>
            Clear {selected.length}
          </button>
        )}
      </div>
      <div className="rounded-[12px] border border-line bg-surface-2 p-1.5" role="group" aria-label={`${dentition} teeth`}>
        {[0, 2].map((rowStart) => (
          // Quadrants sit side by side on wider screens and stack on phones so every tooth stays ≥40px wide.
          <div
            key={rowStart}
            className={`flex flex-col gap-1 sm:flex-row sm:gap-1.5 ${rowStart === 0 ? 'border-b border-dashed border-line-strong pb-1.5' : 'pt-1.5'}`}
          >
            <Quadrant label={rowStart === 0 ? 'Upper right' : 'Lower right'} teeth={rows[rowStart]!} render={(t) => <Tooth key={t} t={t} on={selected.includes(t)} onToggle={toggle} />} />
            <div className="hidden w-px self-stretch bg-line-strong sm:block" aria-hidden="true" />
            <Quadrant label={rowStart === 0 ? 'Upper left' : 'Lower left'} teeth={rows[rowStart + 1]!} render={(t) => <Tooth key={t} t={t} on={selected.includes(t)} onToggle={toggle} />} />
          </div>
        ))}
      </div>
      <div className="mt-1 hidden justify-between text-[11px] text-ink-3 sm:flex">
        <span>Patient's right</span>
        <span>Patient's left</span>
      </div>
    </div>
  );
}
