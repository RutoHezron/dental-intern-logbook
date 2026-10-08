import { indexDataset } from '@logbook/core';
import { generateDemoDataset } from '@logbook/core/synthetic';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, getMeta } from '../data/db';
import { clearAll } from '../data/repo';
import { computeReminders } from '../lib/reminders';
import { getBackupState, setAutoBackup } from './backup';
import { formatBytes, getStorageStatus, initDeviceStorage, isNative, platform } from './device';

describe('on-device storage', () => {
  beforeEach(async () => {
    await clearAll();
    vi.restoreAllMocks();
  });

  it('runs as the web platform in tests', () => {
    expect(platform).toBe('web');
    expect(isNative).toBe(false);
  });

  it('opens the database, records when storage was set up, and asks to keep it permanently', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { persist, persisted: vi.fn().mockResolvedValue(false), estimate: vi.fn().mockResolvedValue({ usage: 2048, quota: 10_000_000 }) },
    });
    const status = await initDeviceStorage();
    expect(db.isOpen()).toBe(true);
    expect(persist).toHaveBeenCalledOnce();
    expect(status).toMatchObject({ platform: 'web', persistent: true, usageBytes: 2048, quotaBytes: 10_000_000 });
    expect(status.initialisedAt).toBeTruthy();

    // The setup date is kept across launches.
    const first = await getMeta('storageInitialisedAt', null);
    await initDeviceStorage();
    expect(await getMeta('storageInitialisedAt', null)).toBe(first);
  });

  it('reports when the browser has not granted permanent storage', async () => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { persisted: vi.fn().mockResolvedValue(false), estimate: vi.fn().mockResolvedValue({}) },
    });
    expect((await getStorageStatus()).persistent).toBe(false);
  });

  it('defaults to automatic backups and remembers the choice', async () => {
    expect((await getBackupState()).enabled).toBe(true);
    await setAutoBackup(false);
    expect((await getBackupState()).enabled).toBe(false);
  });

  it('formats sizes for people', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(5_767_168)).toBe('5.5 MB');
    expect(formatBytes(null)).toBe('unknown');
  });
});

describe('backup reminder', () => {
  const ix = indexDataset(generateDemoDataset({ asOf: '2026-03-01' }));
  const at = new Date('2026-03-01T12:00:00');
  const ids = (b: Parameters<typeof computeReminders>[3]) => computeReminders(ix, '2026-03-01', at, b).map((r) => r.id);

  it('reminds browser users who have never backed up or not for a week', () => {
    expect(ids({ lastAt: null, automatic: false, demo: false })).toContain('backup');
    expect(ids({ lastAt: '2026-02-20T09:00:00Z', automatic: false, demo: false })).toContain('backup');
    expect(ids({ lastAt: '2026-02-27T09:00:00Z', automatic: false, demo: false })).not.toContain('backup');
  });

  it('stays quiet when the phone backs up automatically, and for demo data', () => {
    expect(ids({ lastAt: null, automatic: true, demo: false })).not.toContain('backup');
    expect(ids({ lastAt: null, automatic: false, demo: true })).not.toContain('backup');
  });
});
