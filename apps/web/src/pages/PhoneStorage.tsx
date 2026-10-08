import { HardDrive, RotateCcw, Save, ShieldCheck, Smartphone } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Section, ToneNote, useToast } from '../components/ui';
import { importBackup, RepoError } from '../data/repo';
import { BACKUP_FOLDER, daysSince, listPhoneBackups, readPhoneBackup, setAutoBackup } from '../storage/backup';
import { formatBytes, isNative } from '../storage/device';
import { useDeviceStorage } from '../storage/StorageProvider';

/** Where the logbook lives on this phone, and its backups. */
export function PhoneStorage() {
  const { status, backup, refresh, backupNow } = useDeviceStorage();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phoneFiles, setPhoneFiles] = useState<{ name: string; directory: 'documents' | 'app' }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    refresh();
    if (isNative) listPhoneBackups().then(setPhoneFiles);
  }, [refresh]);

  const restore = async (json: string) => {
    if (!window.confirm('Restoring replaces everything on this phone with the backup. Continue?')) return;
    try {
      await importBackup(json);
      toast('Backup restored');
    } catch (err) {
      toast(err instanceof RepoError ? err.message : 'Could not restore this backup', 'critical');
    }
  };

  const age = daysSince(backup?.lastAt ?? null);
  const where =
    backup?.location === 'documents'
      ? `Documents/${BACKUP_FOLDER} on this phone`
      : backup?.location === 'app'
        ? 'the app’s private storage'
        : backup?.location === 'share'
          ? 'the place you chose in the share sheet'
          : backup?.location === 'download'
            ? 'your downloads'
            : null;

  return (
    <Section title={isNative ? 'Phone storage' : 'Storage on this device'}>
      <div className="flex items-start gap-3 text-sm">
        <Smartphone size={20} className="mt-0.5 shrink-0 text-ink" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium">Your logbook is stored on this {isNative ? 'phone' : 'device'}.</p>
          <p className="text-ink-2">
            {status?.location ?? 'Checking…'}. It works with no signal and needs no account.
            {status?.usageBytes !== null && status?.usageBytes !== undefined && <> Using {formatBytes(status.usageBytes)}.</>}
          </p>
          {status?.initialisedAt && <p className="text-xs text-ink-3">Storage set up on {new Date(status.initialisedAt).toLocaleDateString()}.</p>}
        </div>
      </div>

      <div className="mt-3">
        {status?.persistent === true ? (
          <ToneNote tone="good">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck size={14} aria-hidden="true" /> Kept permanently — the {isNative ? 'phone' : 'browser'} will not clear it to free up space.
            </span>
          </ToneNote>
        ) : status?.persistent === false ? (
          <ToneNote tone="warning">
            This browser may clear the logbook if the phone runs low on space. Install the app (browser menu → <em>Add to Home screen</em>) and back up
            regularly.
          </ToneNote>
        ) : null}
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <h3 className="mb-1 text-sm font-semibold">Backups</h3>
        <p className="text-sm text-ink-2">
          {backup?.lastAt
            ? `Last backup ${age === 0 ? 'today' : age === 1 ? 'yesterday' : `${age} days ago`}${where ? `, saved to ${where}` : ''}.`
            : 'No backup yet.'}
          {isNative && ` A copy is saved automatically to Documents/${BACKUP_FOLDER} once a day when something has changed (the last 7 days are kept). It stays on the phone even if the app is removed.`}
          {!isNative && ' Save a copy to your phone’s files or cloud drive at least once a week.'}
        </p>
        {backup?.lastError && (
          <div className="mt-2">
            <ToneNote tone="critical">{backup.lastError}</ToneNote>
          </div>
        )}
        {isNative && (
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5 accent-[var(--accent)]"
              checked={backup?.enabled ?? true}
              onChange={async (e) => {
                await setAutoBackup(e.target.checked);
                await refresh();
              }}
            />
            Back up automatically every day
          </label>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const loc = await backupNow();
                if (loc) toast(loc === 'documents' ? `Saved to Documents/${BACKUP_FOLDER}` : 'Backup saved');
                if (isNative) setPhoneFiles(await listPhoneBackups());
              } catch (err) {
                toast(err instanceof Error ? err.message : 'Backup failed', 'critical');
              } finally {
                setBusy(false);
              }
            }}
          >
            <Save size={16} aria-hidden="true" /> {isNative ? 'Back up now' : 'Save backup to phone'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            <RotateCcw size={16} aria-hidden="true" /> Restore from a file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) await restore(await file.text());
              e.target.value = '';
            }}
          />
        </div>
        {isNative && phoneFiles.length > 0 && (
          <div className="mt-4">
            <h4 className="mb-1 text-xs font-semibold text-ink-2">Backups on this phone</h4>
            <ul className="divide-y divide-line text-sm">
              {phoneFiles.map((f) => (
                <li key={f.directory + f.name} className="flex items-center justify-between gap-2 py-2">
                  <span className="inline-flex items-center gap-2">
                    <HardDrive size={14} className="text-ink-3" aria-hidden="true" />
                    <span className="code text-xs">{f.name}</span>
                  </span>
                  <button type="button" className="text-sm font-medium underline underline-offset-2" onClick={async () => restore(await readPhoneBackup(f.name, f.directory))}>
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Section>
  );
}
