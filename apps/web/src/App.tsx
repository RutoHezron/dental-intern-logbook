import { lazy, Suspense, useState, type ComponentType } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, type RouteObject } from 'react-router';
import { Shell } from './components/Shell';
import { ToastProvider } from './components/ui';
import { QuickEntryPage } from './pages/QuickEntry';
import { TodayPage } from './pages/Today';
import { AppDataProvider, useAppData } from './state/AppData';
import { ThemeSync } from './state/theme';

// Today and Quick Entry load with the app shell; everything else loads on first visit.
const named = <K extends string>(load: () => Promise<Record<K, ComponentType<object>>>, key: K) =>
  lazy(() => load().then((m) => ({ default: m[key] })));
const LogbookPage = named(() => import('./pages/Logbook'), 'LogbookPage');
const CodeDetailPage = named(() => import('./pages/CodeDetail'), 'CodeDetailPage');
const PatientPage = named(() => import('./pages/Patient'), 'PatientPage');
const CompetenciesPage = named(() => import('./pages/Competencies'), 'CompetenciesPage');
const DiaryPage = named(() => import('./pages/Diary'), 'DiaryPage');
const DiaryEditorPage = named(() => import('./pages/Diary'), 'DiaryEditorPage');
const ReportsPage = named(() => import('./pages/Reports'), 'ReportsPage');
const ReportViewPage = named(() => import('./pages/Reports'), 'ReportViewPage');
const PortfolioPage = named(() => import('./pages/Portfolio'), 'PortfolioPage');
const RotationsPage = named(() => import('./pages/Rotations'), 'RotationsPage');
const SettingsPage = named(() => import('./pages/Settings'), 'SettingsPage');
const MorePage = named(() => import('./pages/More'), 'MorePage');
const OnboardingPage = named(() => import('./pages/Onboarding'), 'OnboardingPage');

/** Screens inside the shell need an internship; first run goes to onboarding. */
function RequireInternship() {
  const { loaded, ix } = useAppData();
  if (!loaded) return <div className="p-8 text-ink-2">Opening your logbook…</div>;
  if (!ix) return <Navigate to="/welcome" replace />;
  return <Outlet />;
}

const routes: RouteObject[] = [
  { path: '/welcome', element: <OnboardingPage /> },
  {
    element: <RequireInternship />,
    children: [
      {
        element: <Shell />,
        children: [
          { index: true, element: <TodayPage /> },
          { path: 'log', element: <QuickEntryPage /> },
          { path: 'log/visit/:id', element: <QuickEntryPage mode="visit" /> },
          { path: 'log/activity/:id', element: <QuickEntryPage mode="activity" /> },
          { path: 'logbook', element: <LogbookPage /> },
          { path: 'logbook/code/:code', element: <CodeDetailPage /> },
          { path: 'patients/:id', element: <PatientPage /> },
          { path: 'competencies', element: <CompetenciesPage /> },
          { path: 'diary', element: <DiaryPage /> },
          { path: 'diary/new', element: <DiaryEditorPage /> },
          { path: 'diary/:id', element: <DiaryEditorPage /> },
          { path: 'reports', element: <ReportsPage /> },
          { path: 'reports/view', element: <ReportViewPage /> },
          { path: 'portfolio', element: <PortfolioPage /> },
          { path: 'rotations', element: <RotationsPage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: 'more', element: <MorePage /> },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
];

export function App() {
  // Created on mount so it reads the current URL (matters for tests and deep links).
  const [router] = useState(() => createBrowserRouter(routes));
  return (
    <AppDataProvider>
      <ThemeSync />
      <ToastProvider>
        <Suspense fallback={<div className="p-8 text-ink-2">Loading…</div>}>
          <RouterProvider router={router} />
        </Suspense>
      </ToastProvider>
    </AppDataProvider>
  );
}
