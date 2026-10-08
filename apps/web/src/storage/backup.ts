import { todayISO, sha256 } from '@logbook/core';
import { getMeta, setMeta } from '../data/db';
import { exportBackup } from '../data/repo';
import { downloadText } from '../lib/format';
import { isNative } from './device';

/**
 * Backups on the phone itself.
 *
 * Native app: an automatic copy is written to Documents/DentalLogbook on the
 * phone (once a day, only when something changed), keeping the last seven
 * days. Files in Documents survive uninstalling the app, so a lost or
 * reinstalled app can be restored. If Documents is not writable, the copy
 * goes to the app's private storage instead.
 *
 * Browser: web pages cannot write files silently, so the intern saves a
 * backup through the phone's share sheet (to Files, Drive, etc.) or as a
 * download, and the app reminds them when one is due.
 */

export const BACKUP_FOLDER = 'DentalLogbook';
const KEEP_DAILY = 7;

interface BackupState {
  enabled: boolean;
  lastAt: string | null;
  lastHash: string | null;
  location: 'documents' | 'app' | 'download' | 'share' | null;
  lastError: string | null;
}

const KEY = 'phoneBackup';
const DEFAULT_STATE: BackupState = { enabled: true, lastAt: null, lastHash: null, location: null, lastError: null };

export async function getBackupState(): Promise<BackupState> {
  return { ...DEFAULT_STATE, ...(await getMeta<Partial<BackupState>>(KEY, {})) };
}

export async function setAutoBackup(enabled: boolean): Promise<void> {
  await setMeta(KEY, { ...(await getBackupState()), enabled });
}

async function writeNative(json: string, dated: boolean): Promise<'documents' | 'app'> {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
  const files = [`${BACKUP_FOLDER}/logbook-latest.json`, ...(dated ? [`${BACKUP_FOLDER}/logbook-${todayISO()}.json`] : [])];
  for (const directory of [Directory.Documents, Directory.Data]) {
    try {
      for (const path of files) {
        await Filesystem.writeFile({ path, data: json, directory, encoding: Encoding.UTF8, recursive: true });
      }
      await pruneOld(directory);
      return directory === Directory.Documents ? 'documents' : 'app';
    } catch {
      // Try the next location.
    }
  }
  throw new Error('Could not write the backup to this phone’s storage.');
}

async function pruneOld(directory: import('@capacitor/filesystem').Directory) {
  const { Filesystem } = await import('@capacitor/filesystem');
  const { files } = await Filesystem.readdir({ path: BACKUP_FOLDER, directory });
  const dated = files
    .map((f) => f.name)
    .filter((n) => /^logbook-\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .sort()
    .reverse();
  for (const name of dated.slice(KEEP_DAILY)) {
    await Filesystem.deleteFile({ path: `${BACKUP_FOLDER}/${name}`, directory });
  }
}

/** Automatic daily backup (native only). Skips demo data and unchanged data. */
export async function autoBackupIfDue(opts: { demo: boolean; hasInternship: boolean }): Promise<BackupState> {
  const state = await getBackupState();
  if (!isNative || !state.enabled || opts.demo || !opts.hasInternship) return state;
  if (state.lastAt && state.lastAt.slice(0, 10) === todayISO() && state.lastHash) return state;
  try {
    const json = await exportBackup();
    const hash = sha256(json);
    if (hash === state.lastHash) return state;
    const location = await writeNative(json, true);
    const next: BackupState = { ...state, lastAt: new Date().toISOString(), lastHash: hash, location, lastError: null };
    await setMeta(KEY, next);
    return next;
  } catch (err) {
    const next = { ...state, lastError: err instanceof Error ? err.message : 'Backup failed' };
    await setMeta(KEY, next);
    return next;
  }
}

/** Back up now, on request. Native: write to the phone; web: share sheet or download. */
export async function backupNow(): Promise<BackupState['location']> {
  const json = await exportBackup();
  const filename = `logbook-backup-${todayISO()}.json`;
  let location: BackupState['location'];
  if (isNative) {
    location = await writeNative(json, true);
  } else {
    const file = typeof File !== 'undefined' ? new File([json], filename, { type: 'application/json' }) : null;
    if (file && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Logbook backup' });
        location = 'share';
      } catch (err) {
        if ((err as Error).name === 'AbortError') return null;
        downloadText(filename, json, 'application/json');
        location = 'download';
      }
    } else {
      downloadText(filename, json, 'application/json');
      location = 'download';
    }
  }
  await setMeta(KEY, { ...(await getBackupState()), lastAt: new Date().toISOString(), lastHash: sha256(json), location, lastError: null });
  return location;
}

/** Native only: list backup files kept on the phone, newest first. */
export async function listPhoneBackups(): Promise<{ name: string; directory: 'documents' | 'app' }[]> {
  if (!isNative) return [];
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const out: { name: string; directory: 'documents' | 'app' }[] = [];
  for (const [directory, label] of [
    [Directory.Documents, 'documents'],
    [Directory.Data, 'app'],
  ] as const) {
    try {
      const { files } = await Filesystem.readdir({ path: BACKUP_FOLDER, directory });
      for (const f of files) if (f.name.endsWith('.json')) out.push({ name: f.name, directory: label });
    } catch {
      // Folder not created yet.
    }
  }
  return out.sort((a, b) => b.name.localeCompare(a.name));
}

/** Native only: read a backup file kept on the phone. */
export async function readPhoneBackup(name: string, where: 'documents' | 'app'): Promise<string> {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
  const res = await Filesystem.readFile({
    path: `${BACKUP_FOLDER}/${name}`,
    directory: where === 'documents' ? Directory.Documents : Directory.Data,
    encoding: Encoding.UTF8,
  });
  return typeof res.data === 'string' ? res.data : await (res.data as Blob).text();
}

/** Days since the last backup of any kind, or null if never. */
export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
}
