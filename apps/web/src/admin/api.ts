import { fromWire, type ID } from '@logbook/core';
import type { Rpc } from '../supervise/api';

/**
 * Administrator route: register supervisors and link them to interns. The
 * server refuses every call from an account that is not an administrator.
 */

export interface InternSupervisorRecord {
  id: ID;
  name: string;
  role?: string;
  rotation?: string;
  /** The registered supervisor this record is linked to (empty values arrive as undefined). */
  accountId?: ID;
  linked: boolean;
  linkedAt?: string;
  linkedEmail?: string;
}

export interface AdminIntern {
  ownerId: ID;
  email?: string;
  internName: string;
  licenceNo?: string;
  institution?: string;
  periodFrom: string;
  periodTo: string;
  supervisors: InternSupervisorRecord[];
}

export interface SupervisorAccount {
  id: ID;
  email: string;
  name: string;
  role?: string;
  kmpdcRegNo?: string;
  createdAt: string;
  /** Has signed in to the app at least once. */
  signedIn: boolean;
  interns: number;
}

export interface AdminOverview {
  interns: AdminIntern[];
  supervisors: SupervisorAccount[];
  admins: { email: string; addedAt: string }[];
}

export async function isAdmin(rpc: Rpc): Promise<boolean> {
  return (await rpc('is_admin', {})) === true;
}

export async function loadOverview(rpc: Rpc): Promise<AdminOverview> {
  return fromWire<AdminOverview>((await rpc('admin_overview', {})) as Record<string, unknown>);
}

export async function registerSupervisor(rpc: Rpc, s: { email: string; name: string; role?: string; kmpdcRegNo?: string }): Promise<{ id: ID }> {
  return fromWire(
    await (rpc('admin_register_supervisor', { p_email: s.email, p_name: s.name, p_role: s.role || null, p_reg_no: s.kmpdcRegNo || null }) as Promise<Record<string, unknown>>),
  );
}

export async function removeSupervisor(rpc: Rpc, accountId: ID): Promise<void> {
  await rpc('admin_remove_supervisor', { p_account: accountId });
}

/** `supervisorId`: one of the intern's existing supervisor records; omit to add a new one to their logbook. */
export async function linkSupervisor(rpc: Rpc, accountId: ID, internId: ID, supervisorId?: ID | null): Promise<{ supervisorId: ID; linked: boolean }> {
  return fromWire(await (rpc('admin_link_supervisor', { p_account: accountId, p_intern: internId, p_supervisor: supervisorId ?? null }) as Promise<Record<string, unknown>>));
}

export async function unlinkSupervisorRecord(rpc: Rpc, supervisorId: ID): Promise<void> {
  await rpc('admin_unlink_supervisor', { p_supervisor: supervisorId });
}

export async function addAdmin(rpc: Rpc, email: string): Promise<void> {
  await rpc('admin_add_admin', { p_email: email });
}

export async function removeAdmin(rpc: Rpc, email: string): Promise<void> {
  await rpc('admin_remove_admin', { p_email: email });
}

/** The intern's record that most likely is this person: same name, ignoring titles, case and punctuation. */
export function suggestRecord(intern: AdminIntern, account: SupervisorAccount): InternSupervisorRecord | undefined {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\b(dr|prof|mr|mrs|ms|miss)\b\.?/g, '')
      .replace(/[^a-z]/g, '');
  const target = norm(account.name);
  return intern.supervisors.find((s) => !s.accountId && norm(s.name) === target);
}
