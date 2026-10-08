import { indexDataset, rotationForDate, todayISO, type DatasetIndex, type ISODate, type Rotation } from '@logbook/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadState, type LoadedState } from '../data/repo';

/**
 * App-wide data: the whole internship is small enough (a few thousand rows)
 * to hold in memory, so every screen derives what it needs from one indexed
 * dataset that updates live whenever the on-device store changes.
 */

export interface AppData {
  loaded: boolean;
  state: LoadedState | null;
  ix: DatasetIndex | null;
  today: ISODate;
  currentRotation: Rotation | null;
  online: boolean;
}

const Ctx = createContext<AppData | null>(null);

function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const state = useLiveQuery(loadState, []);
  const online = useOnline();
  const today = todayISO();
  const ix = useMemo(() => (state?.dataset ? indexDataset(state.dataset) : null), [state]);
  const value = useMemo<AppData>(
    () => ({
      loaded: state !== undefined,
      state: state ?? null,
      ix,
      today,
      currentRotation: ix ? rotationForDate(ix.ds.rotations, today) : null,
      online,
    }),
    [state, ix, today, online],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppData(): AppData {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppData must be used inside AppDataProvider');
  return v;
}

/** For screens that only render once an internship exists (guarded by the router). */
export function useInternship() {
  const d = useAppData();
  if (!d.ix || !d.state) throw new Error('No internship loaded');
  return { ...d, ix: d.ix, state: d.state, ds: d.ix.ds };
}

/** The analytics date: today, but never past the end of the internship. */
export function analyticsDate(today: ISODate, ix: DatasetIndex): ISODate {
  return today > ix.ds.internship.periodTo ? ix.ds.internship.periodTo : today;
}
