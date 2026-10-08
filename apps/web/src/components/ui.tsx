import type { Level, ProgressStatus } from '@logbook/core';
import { AlertTriangle, Check, CircleDashed, Clock, OctagonAlert, TrendingDown } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { LEVEL_NAMES, ROTATION_VAR, STATUS_META } from '../lib/format';

// ---------------------------------------------------------------------------
// Level ladder — the app's signature: five steps, observe → independent.
// ---------------------------------------------------------------------------

const STEP_HEIGHTS = [0.36, 0.52, 0.68, 0.84, 1];

/** Compact glyph showing a level reached (0 = no exposure). */
export function LevelLadder({ level, size = 18, label = true }: { level: Level | 0; size?: number; label?: boolean }) {
  const w = size * 1.2;
  const bar = w / 5 - 1.5;
  return (
    <span className="inline-flex items-center gap-1.5" title={`Level ${level}: ${LEVEL_NAMES[level]}`}>
      <svg width={w} height={size} viewBox={`0 0 ${w} ${size}`} aria-hidden="true">
        {STEP_HEIGHTS.map((h, i) => (
          <rect
            key={i}
            x={i * (bar + 1.5)}
            y={size - size * h}
            width={bar}
            height={size * h}
            rx={1.5}
            fill={i < level ? `var(--l${i + 1})` : 'var(--l0)'}
          />
        ))}
      </svg>
      {label && <span className="sr-only">{`Level ${level}: ${LEVEL_NAMES[level]}`}</span>}
    </span>
  );
}

/** The chair-side level picker: a staircase of five large targets. Never pre-selected. */
export function LevelPicker({
  value,
  onChange,
  expected,
  name = 'level',
}: {
  value: Level | null;
  onChange: (l: Level) => void;
  expected?: Level;
  name?: string;
}) {
  return (
    <div role="radiogroup" aria-label="Your participation level" className="grid grid-cols-5 items-end gap-1.5">
      {([1, 2, 3, 4, 5] as Level[]).map((l, i) => {
        const selected = value === l;
        return (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`Level ${l}: ${LEVEL_NAMES[l]}`}
            name={name}
            onClick={() => onChange(l)}
            className="group relative flex flex-col items-center justify-end rounded-[10px] border px-1 pb-1.5 pt-2 text-center transition-colors"
            style={{
              minHeight: 54 + i * 10,
              borderColor: selected ? `var(--l${l})` : 'var(--line-strong)',
              background: selected ? `var(--l${l})` : 'var(--surface)',
              color: selected ? '#fff' : 'var(--ink)',
            }}
          >
            <span className="code text-lg leading-none">{l}</span>
            <span className="mt-1 text-[11px] font-medium leading-tight" style={{ color: selected ? '#fff' : 'var(--ink-2)' }}>
              {['Observed', 'Assisted', 'Direct sup.', 'Indirect sup.', 'Independent'][i]}
            </span>
            {expected === l && (
              <span
                className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full px-1.5 text-[10px] font-semibold"
                style={{ background: 'var(--surface)', color: 'var(--ink-2)', border: '1px solid var(--line-strong)' }}
              >
                expected
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status (always icon + label, never colour alone)
// ---------------------------------------------------------------------------

const TONE_STYLE = {
  good: { color: 'var(--good-ink)', bg: 'color-mix(in srgb, var(--good) 12%, transparent)', Icon: Check },
  warning: { color: 'var(--warning-ink)', bg: 'color-mix(in srgb, var(--warning) 18%, transparent)', Icon: AlertTriangle },
  serious: { color: 'var(--serious-ink)', bg: 'color-mix(in srgb, var(--serious) 16%, transparent)', Icon: TrendingDown },
  critical: { color: 'var(--critical-ink)', bg: 'color-mix(in srgb, var(--critical) 12%, transparent)', Icon: OctagonAlert },
  neutral: { color: 'var(--ink-2)', bg: 'var(--surface-2)', Icon: CircleDashed },
} as const;

export function StatusBadge({ status }: { status: ProgressStatus }) {
  const meta = STATUS_META[status];
  const tone = status === 'on_track' ? { ...TONE_STYLE.neutral, Icon: Clock } : TONE_STYLE[meta.tone];
  const Icon = tone.Icon;
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap" style={{ color: tone.color, background: tone.bg }}>
      <Icon size={12} strokeWidth={2.5} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

export function ToneNote({ tone, children }: { tone: keyof typeof TONE_STYLE; children: ReactNode }) {
  const t = TONE_STYLE[tone];
  const Icon = t.Icon;
  return (
    <div className="flex items-start gap-2 rounded-[10px] px-3 py-2 text-sm" style={{ background: t.bg, color: tone === 'neutral' ? 'var(--ink-2)' : 'var(--ink)' }}>
      <Icon size={16} className="mt-0.5 shrink-0" style={{ color: t.color }} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress toward a minimum: verified (solid) + pending (hatched)
// ---------------------------------------------------------------------------

export function ProgressBar({ verified, pending, min, color = 'var(--ink)' }: { verified: number; pending: number; min: number; color?: string }) {
  const max = Math.max(min, 1);
  const v = Math.min(verified, max) / max;
  const p = Math.min(pending, Math.max(0, max - verified)) / max;
  return (
    <div
      className="relative h-2 w-full overflow-hidden rounded-full"
      style={{ background: 'var(--l0)' }}
      role="img"
      aria-label={`${verified} verified and ${pending} pending of ${min}`}
    >
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${v * 100}%`, background: color }} />
      <div
        className="absolute inset-y-0 rounded-r-full"
        style={{
          left: `calc(${v * 100}% + ${v > 0 ? 2 : 0}px)`,
          width: `${p * 100}%`,
          background: `repeating-linear-gradient(135deg, ${color} 0 2px, transparent 2px 5px)`,
          opacity: 0.55,
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

export function RotationDot({ code, size = 8 }: { code: string | null | undefined; size?: number }) {
  return <span aria-hidden="true" className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: code ? ROTATION_VAR[code] ?? 'var(--ink-3)' : 'var(--ink-3)' }} />;
}

export function PageHeader({ title, eyebrow, actions, children }: { title: string; eyebrow?: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h1 className="text-[26px] font-semibold sm:text-[30px]">{title}</h1>
        {children && <div className="mt-1 text-sm text-ink-2">{children}</div>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Section({ title, aside, children, className = '' }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card min-w-0 p-4 sm:p-5 ${className}`}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-semibold">{title}</h2>
        {aside && <div className="text-sm text-ink-2">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed border-line-strong px-6 py-10 text-center">
      <div className="font-display text-lg font-semibold">{title}</div>
      {children && <div className="max-w-md text-sm text-ink-2">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[10px] border border-line-strong bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className="min-h-9 rounded-[8px] px-3 text-sm font-medium transition-colors"
          style={value === o.value ? { background: 'var(--ink)', color: 'var(--paper)' } : { color: 'var(--ink-2)' }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

interface Toast {
  id: number;
  text: string;
  tone: 'good' | 'critical' | 'neutral';
}

const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'good') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="no-print pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex max-w-md items-center gap-2 rounded-[12px] px-4 py-3 text-sm font-medium shadow-card"
            style={{ background: 'var(--ink)', color: 'var(--paper)' }}
          >
            {t.tone === 'good' && <Check size={16} style={{ color: 'var(--good)' }} aria-hidden="true" />}
            {t.tone === 'critical' && <OctagonAlert size={16} style={{ color: 'var(--critical)' }} aria-hidden="true" />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
