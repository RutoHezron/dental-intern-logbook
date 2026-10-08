import { CalendarRange, ChevronRight, FileBarChart2, GraduationCap, PenLine, Printer, Settings, Trophy } from 'lucide-react';
import { Link } from 'react-router';
import { PageHeader } from '../components/ui';
import { SyncStatus } from '../components/Shell';

const LINKS = [
  { to: '/sign-off', label: 'Supervisor sign-off', sub: 'Your supervisor verifies entries on this phone', Icon: PenLine },
  { to: '/print', label: 'Print logbook pages', sub: 'KMPDC layout, filled from verified entries', Icon: Printer },
  { to: '/competencies', label: 'Competencies', sub: 'Levels and counts per logbook code', Icon: GraduationCap },
  { to: '/reports', label: 'Reports', sub: 'Weekly, monthly, rotation, internship', Icon: FileBarChart2 },
  { to: '/portfolio', label: 'Portfolio', sub: 'Your internship, assembled from your records', Icon: Trophy },
  { to: '/rotations', label: 'Rotations & supervisors', sub: 'Dates, extensions, objectives', Icon: CalendarRange },
  { to: '/settings', label: 'Settings', sub: 'Profile, favourites, counting rules, backup', Icon: Settings },
];

export function MorePage() {
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="More">
        <SyncStatus />
      </PageHeader>
      <ul className="card divide-y divide-line">
        {LINKS.map(({ to, label, sub, Icon }) => (
          <li key={to}>
            <Link to={to} className="flex items-center gap-3 px-4 py-3.5">
              <Icon size={20} className="text-ink-2" aria-hidden="true" />
              <span className="flex-1">
                <span className="block font-medium">{label}</span>
                <span className="block text-xs text-ink-3">{sub}</span>
              </span>
              <ChevronRight size={18} className="text-ink-3" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
