import { Capacitor } from '@capacitor/core';
import { db, getMeta, setMeta } from '../data/db';

/**
 * The logbook lives on the phone. On first launch the app opens its on-device
 * database and asks the system to keep it permanently, so it is not cleared
 * to free up space. In the native app the database sits in the app's private
 * storage, which the system never evicts; in a browser we request persistent
 * storage, which installed web apps are normally granted.
 */

export type Platform = 'android' | 'ios' | 'web';

export interface StorageStatus {
  platform: Platform;
  /** True when the system has promised not to evict the data; null when unknown. */
  persistent: boolean | null;
  usageBytes: number | null;
  quotaBytes: number | null;
  initialisedAt: string | null;
  /** Plain-language description of where the data lives. */
  location: string;
}

const INIT_KEY = 'storageInitialisedAt';

export const platform: Platform = Capacitor.getPlatform() as Platform;
export const isNative = Capacitor.isNativePlatform();

async function requestPersistence(): Promise<boolean | null> {
  if (isNative) return true; // App-private storage is not evicted by the system.
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return null;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

/** Open the on-device database and secure it. Safe to call on every launch. */
export async function initDeviceStorage(): Promise<StorageStatus> {
  await db.open();
  const persistent = await requestPersistence();
  let initialisedAt = await getMeta<string | null>(INIT_KEY, null);
  if (!initialisedAt) {
    initialisedAt = new Date().toISOString();
    await setMeta(INIT_KEY, initialisedAt);
  }
  return { ...(await estimate()), persistent, initialisedAt, platform, location: describeLocation() };
}

export async function getStorageStatus(): Promise<StorageStatus> {
  let persistent: boolean | null = isNative ? true : null;
  if (!isNative && typeof navigator !== 'undefined' && navigator.storage?.persisted) {
    try {
      persistent = await navigator.storage.persisted();
    } catch {
      persistent = null;
    }
  }
  return {
    ...(await estimate()),
    persistent,
    initialisedAt: await getMeta<string | null>(INIT_KEY, null),
    platform,
    location: describeLocation(),
  };
}

async function estimate(): Promise<Pick<StorageStatus, 'usageBytes' | 'quotaBytes'>> {
  try {
    const e = await navigator.storage?.estimate?.();
    return { usageBytes: e?.usage ?? null, quotaBytes: e?.quota ?? null };
  } catch {
    return { usageBytes: null, quotaBytes: null };
  }
}

function describeLocation(): string {
  if (platform === 'android') return 'In the app’s private storage on this phone';
  if (platform === 'ios') return 'In the app’s private storage on this iPhone';
  return 'In this browser’s storage on this device';
}

export function formatBytes(n: number | null): string {
  if (n === null) return 'unknown';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}
