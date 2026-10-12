import type { DocumentReference, Firestore } from 'firebase-admin/firestore';

/**
 * Everything a server function needs: the database, who is calling, and the
 * time (injected so tests can fix it). Functions are written against this so
 * they run the same in Cloud Functions and in the emulator tests.
 */
export interface Ctx {
  db: Firestore;
  uid: string | null;
  email?: string | null;
  now: Date;
}

export type Row = Record<string, unknown>;

/** Mirrors Postgres error classes so the app shows the same messages on either backend. */
export type ErrorCode = 'unauthenticated' | 'permission-denied' | 'invalid-argument' | 'not-found' | 'failed-precondition';

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function requireUser(ctx: Ctx, message = 'Sign in to sync'): string {
  if (!ctx.uid) throw new AppError('unauthenticated', message);
  return ctx.uid;
}

/** users/{uid}/{table}/{id}: every synced record lives under its owner. */
export const rowRef = (ctx: Ctx, owner: string, table: string, id: string): DocumentReference => ctx.db.doc(`users/${owner}/${table}/${id}`);
export const userRef = (ctx: Ctx, owner: string): DocumentReference => ctx.db.doc(`users/${owner}`);

export const iso = (d: Date) => d.toISOString();

/** ISO date (YYYY-MM-DD) n days from `day`. */
export function addDaysISO(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
