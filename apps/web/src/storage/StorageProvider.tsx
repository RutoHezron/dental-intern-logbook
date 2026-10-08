import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAppData } from '../state/AppData';
import { autoBackupIfDue, backupNow, getBackupState } from './backup';
import { getStorageStatus, initDeviceStorage, type StorageStatus } from './device';

/**
 * Sets up on-phone storage at launch and keeps the automatic backup going:
 * when the app opens and whenever it is put in the background.
 */

type BackupState = Awaited<ReturnType<typeof getBackupState>>;

interface StorageApi {
  status: StorageStatus | null;
  backup: BackupState | null;
  refresh: () => Promise<void>;
  backupNow: () => Promise<BackupState['location']>;
}

const Ctx = createContext<StorageApi | null>(null);

export function StorageProvider({ children }: { children: ReactNode }) {
  const { state } = useAppData();
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [backup, setBackup] = useState<BackupState | null>(null);
  const demo = Boolean(state?.demo);
  const hasInternship = Boolean(state?.dataset);

  useEffect(() => {
    initDeviceStorage()
      .then(setStatus)
      .catch(() => getStorageStatus().then(setStatus));
    getBackupState().then(setBackup);
  }, []);

  const runAuto = useCallback(async () => {
    setBackup(await autoBackupIfDue({ demo, hasInternship }));
  }, [demo, hasInternship]);

  useEffect(() => {
    if (!hasInternship) return;
    runAuto();
    const onHide = () => {
      if (document.visibilityState === 'hidden') runAuto();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [hasInternship, runAuto]);

  const refresh = useCallback(async () => {
    setStatus(await getStorageStatus());
    setBackup(await getBackupState());
  }, []);

  const doBackup = useCallback(async () => {
    const where = await backupNow();
    await refresh();
    return where;
  }, [refresh]);

  return <Ctx.Provider value={{ status, backup, refresh, backupNow: doBackup }}>{children}</Ctx.Provider>;
}

export function useDeviceStorage(): StorageApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDeviceStorage must be used inside StorageProvider');
  return v;
}
