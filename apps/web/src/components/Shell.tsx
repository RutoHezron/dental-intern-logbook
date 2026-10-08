import { daysBetween, rotationEnd } from '@logbook/core';
import {
  BookOpen,
  CalendarRange,
  CircleAlert,
  CloudCheck,
  CloudOff,
  CloudUpload,
  FileBarChart2,
  GraduationCap,
  HardDrive,
  Home,
  Menu,
  NotebookPen,
  Plus,
  RefreshCw,
  Settings,
  Trophy,
} from 'lucide-react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useSync } from '../sync/SyncProvider';
import { Suspense, useEffect } from 'react';
import { ROTATION_SHORT } from '../lib/format';
import { useInternship } from '../state/AppData';
import { RotationDot } from './ui';

const PRIMARY = [
  { to: '/', label: 'Today', Icon: Home, end: true },
  { to: '/logbook', label: 'Logbook', Icon: BookOpen },
  { to: '/diary', label: 'Diary', Icon: NotebookPen },
  { to: '/reports', label: 'Reports', Icon: FileBarChart2 },
];

const SECONDARY = [
  { to: '/competencies', label: 'Competencies', Icon: GraduationCap },
  { to: '/portfolio', label: 'Portfolio', Icon: Trophy },
  { to: '/rotations', label: 'Rotations', Icon: CalendarRange },
  { to: '/settings', label: 'Settings', Icon: Settings },
];

const SYNC_LOOK = {
  local: { Icon: HardDrive, color: 'var(--ink-3)', text: 'Saved on this device' },
  signed_out: { Icon: HardDrive, color: 'var(--ink-3)', text: 'Saved on this device · not signed in' },
  offline: { Icon: CloudOff, color: 'var(--warning-ink)', text: 'Offline · saved on device' },
  syncing: { Icon: RefreshCw, color: 'var(--ink-2)', text: 'Syncing…' },
  synced: { Icon: CloudCheck, color: 'var(--good-ink)', text: 'Synced' },
  pending: { Icon: CloudUpload, color: 'var(--warning-ink)', text: 'Pending sync' },
  error: { Icon: CircleAlert, color: 'var(--critical-ink)', text: 'Sync error' },
} as const;

/** 🟢 synced · 🟡 pending · 🔴 error — always with an icon and words, never colour alone. */
export function SyncStatus({ compact = false }: { compact?: boolean }) {
  const sync = useSync();
  const look = SYNC_LOOK[sync.state];
  const Icon = look.Icon;
  const detail =
    sync.state === 'local' || sync.state === 'signed_out'
      ? sync.pending
        ? `${sync.pending} change${sync.pending === 1 ? '' : 's'} will sync once you sign in.`
        : 'Everything is saved on this device.'
      : sync.state === 'error'
        ? `${sync.lastError ?? `${sync.errors} change(s) were not accepted.`} Your records are still saved on this device.`
        : sync.state === 'pending' || sync.state === 'offline'
          ? `${sync.pending} change${sync.pending === 1 ? '' : 's'} waiting to sync.`
          : sync.lastSyncAt
            ? `Last synced ${new Date(sync.lastSyncAt).toLocaleString()}.`
            : '';
  const label = sync.state === 'pending' ? `${look.text} (${sync.pending})` : look.text;
  return (
    <Link to="/settings#sync" className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: look.color }} title={detail} aria-label={`${label}. ${detail}`}>
      <Icon size={14} aria-hidden="true" className={sync.state === 'syncing' ? 'animate-spin' : undefined} />
      {!compact && <span>{label}</span>}
    </Link>
  );
}

function CurrentRotation() {
  const { currentRotation, today } = useInternship();
  if (!currentRotation) return <span className="text-xs text-ink-3">No rotation today</span>;
  const left = daysBetween(today, rotationEnd(currentRotation));
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-2">
      <RotationDot code={currentRotation.rotation} />
      <span className="code">{currentRotation.rotation}</span>
      <span className="text-ink-3">· {left === 0 ? 'last day' : `${left} days left`}</span>
    </span>
  );
}

function SideLink({ to, label, Icon, end }: { to: string; label: string; Icon: typeof Home; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex min-h-10 items-center gap-3 rounded-[10px] px-3 text-[14px] font-medium transition-colors ${
          isActive ? 'bg-white/10 text-white' : 'text-white/65 hover:bg-white/5 hover:text-white'
        }`
      }
    >
      <Icon size={18} aria-hidden="true" />
      {label}
    </NavLink>
  );
}

export function Shell() {
  const { ds, state, currentRotation } = useInternship();
  const location = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="min-h-dvh lg:pl-64">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:p-2">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 hidden w-64 flex-col bg-graphite px-4 py-5 text-white lg:flex">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <img src="/icon.svg" alt="" width={30} height={30} />
          <div>
            <div className="font-display text-[17px] font-semibold leading-tight">Intern Logbook</div>
            <div className="text-[11px] text-white/55">Dental · KMPDC 3rd ed.</div>
          </div>
        </div>
        <NavLink to="/log" className="btn btn-primary mb-5 w-full">
          <Plus size={18} aria-hidden="true" /> Log a patient or activity
        </NavLink>
        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {PRIMARY.map((l) => (
            <SideLink key={l.to} {...l} />
          ))}
          <div className="my-3 h-px bg-white/10" />
          {SECONDARY.map((l) => (
            <SideLink key={l.to} {...l} />
          ))}
        </nav>
        <div className="mt-auto space-y-2 rounded-[12px] bg-white/5 p-3 text-xs text-white/70">
          <div className="font-medium text-white">{ds.internship.internName}</div>
          {currentRotation && (
            <div className="flex items-center gap-1.5">
              <RotationDot code={currentRotation.rotation} /> {ROTATION_SHORT[currentRotation.rotation] ?? currentRotation.rotation}
            </div>
          )}
          {state.demo && <div className="text-white/55">Demo internship · fictional data</div>}
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="no-print sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-paper/90 px-4 py-2.5 backdrop-blur lg:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <img src="/icon.svg" alt="" width={24} height={24} />
          <CurrentRotation />
        </div>
        <SyncStatus />
      </header>

      {/* Desktop top strip */}
      <div className="no-print hidden items-center justify-between border-b border-line px-8 py-2.5 lg:flex">
        <CurrentRotation />
        <SyncStatus />
      </div>

      {state.demo && (
        <div className="no-print border-b border-line bg-accent-soft px-4 py-2 text-center text-[13px] text-ink lg:px-8">
          You are exploring a <strong>fictional demo internship</strong> (Dr Alex Mwangi). No real patient data.{' '}
          <NavLink to="/settings" className="font-semibold underline underline-offset-2">
            Start your own
          </NavLink>
        </div>
      )}

      <main id="main" className="mx-auto w-full max-w-[1180px] px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-12 lg:pt-7">
        <Suspense fallback={<div className="py-10 text-sm text-ink-3">Loading…</div>}>
          <Outlet />
        </Suspense>
      </main>

      {/* Mobile bottom navigation with the central log button */}
      <nav aria-label="Main" className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-5 items-end">
          {[PRIMARY[0]!, PRIMARY[1]!].map((l) => (
            <BottomLink key={l.to} {...l} />
          ))}
          <NavLink to="/log" aria-label="Log a patient or activity" className="-mt-5 flex flex-col items-center gap-0.5 pb-1.5">
            <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-accent text-accent-ink shadow-card">
              <Plus size={26} aria-hidden="true" />
            </span>
            <span className="text-[11px] font-medium text-ink-2">Log</span>
          </NavLink>
          <BottomLink {...PRIMARY[2]!} />
          <BottomLink to="/more" label="More" Icon={Menu} />
        </div>
      </nav>
    </div>
  );
}

function BottomLink({ to, label, Icon, end }: { to: string; label: string; Icon: typeof Home; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${isActive ? 'text-accent' : 'text-ink-3'}`}
    >
      <Icon size={22} aria-hidden="true" />
      {label}
    </NavLink>
  );
}
