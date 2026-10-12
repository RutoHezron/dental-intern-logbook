import { Link2, Link2Off, RefreshCw, Search, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  addAdmin,
  isAdmin,
  linkSupervisor,
  loadOverview,
  registerSupervisor,
  removeAdmin,
  removeSupervisor,
  suggestRecord,
  unlinkSupervisorRecord,
  type AdminIntern,
  type AdminOverview,
} from '../admin/api';
import { PageHeader, Segmented, ToneNote, useToast } from '../components/ui';
import { fmtDate } from '../lib/format';
import { supabaseRpc } from '../sync/supabase';
import { useSync } from '../sync/SyncProvider';
import { Frame, useGate } from './Supervise';

/**
 * Administrator route: register supervisors by email and link them to their
 * interns, without invite codes. The administrator sees names and links only;
 * a linked supervisor sees what the intern submitted to them.
 */
export function AdminPage() {
  const gate = useGate();
  return (
    <Frame role="Administrator">
      <PageHeader title="Supervisors & interns">
        Register supervisors and link them to their interns. A linked supervisor signs in with their email and sees each intern's activity and the entries waiting for their
        sign-off. Interns see who is linked and can disconnect a supervisor.
      </PageHeader>
      {gate ?? <Console />}
    </Frame>
  );
}

type Tab = 'interns' | 'supervisors' | 'admins';

function Console() {
  const sync = useSync();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>('interns');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ok = await isAdmin(supabaseRpc);
      setAllowed(ok);
      if (ok) setData(await loadOverview(supabaseRpc));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (error) {
    return (
      <ToneNote tone="critical">
        {error}{' '}
        <button type="button" className="font-medium underline underline-offset-2" onClick={refresh}>
          Try again
        </button>
      </ToneNote>
    );
  }
  if (allowed === false) {
    return <ToneNote tone="warning">{sync.email} is not an administrator. Ask an existing administrator to add this email address under Administrators.</ToneNote>;
  }
  if (!data) return <p className="text-ink-2">Loading…</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
        <ShieldCheck size={16} aria-hidden="true" />
        <span className="flex-1">Administrator · {sync.email}</span>
        <button type="button" className="btn btn-ghost" disabled={loading} onClick={refresh}>
          <RefreshCw size={16} aria-hidden="true" /> Refresh
        </button>
      </div>
      <Segmented
        label="Section"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'interns', label: `Interns (${data.interns.length})` },
          { value: 'supervisors', label: `Supervisors (${data.supervisors.length})` },
          { value: 'admins', label: 'Administrators' },
        ]}
      />
      {tab === 'interns' && <Interns data={data} onChange={refresh} onRegister={() => setTab('supervisors')} />}
      {tab === 'supervisors' && <Supervisors data={data} onChange={refresh} />}
      {tab === 'admins' && <Admins data={data} onChange={refresh} />}
    </div>
  );
}

/** Run a server call with a toast on success and on failure. */
function useAction(onDone: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      onDone();
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Something went wrong', 'critical');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

// ---------------------------------------------------------------------------
// Interns
// ---------------------------------------------------------------------------

function Interns({ data, onChange, onRegister }: { data: AdminOverview; onChange: () => void; onRegister: () => void }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return data.interns;
    return data.interns.filter((i) => [i.internName, i.email, i.licenceNo, i.institution].some((v) => v?.toLowerCase().includes(t)));
  }, [data, q]);

  if (data.interns.length === 0) {
    return <ToneNote tone="neutral">No interns on the server yet. An intern appears here once they sign in and sync their logbook (Settings → Account &amp; sync).</ToneNote>;
  }
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" aria-hidden="true" />
        <input className="field pl-9" placeholder="Search by name, email, licence or institution" aria-label="Search interns" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {data.supervisors.length === 0 && (
        <ToneNote tone="neutral">
          Register a supervisor first, then link them here.{' '}
          <button type="button" className="font-medium underline underline-offset-2" onClick={onRegister}>
            Register a supervisor
          </button>
        </ToneNote>
      )}
      <ul className="space-y-3">
        {list.map((i) => (
          <InternCard key={i.ownerId} intern={i} data={data} onChange={onChange} />
        ))}
      </ul>
      {list.length === 0 && <p className="text-sm text-ink-2">No intern matches “{q}”.</p>}
    </div>
  );
}

const NEW_RECORD = 'new';

function InternCard({ intern, data, onChange }: { intern: AdminIntern; data: AdminOverview; onChange: () => void }) {
  const { busy, run } = useAction(onChange);
  const linkedAccounts = new Set(intern.supervisors.map((s) => s.accountId).filter(Boolean));
  const available = data.supervisors.filter((a) => !linkedAccounts.has(a.id));
  const [accountId, setAccountId] = useState('');
  const account = available.find((a) => a.id === accountId);
  const unlinkedRecords = intern.supervisors.filter((s) => !s.accountId && !s.linked);
  const [record, setRecord] = useState(NEW_RECORD);

  const pickAccount = (id: string) => {
    setAccountId(id);
    const a = available.find((x) => x.id === id);
    setRecord((a && suggestRecord(intern, a)?.id) ?? NEW_RECORD);
  };

  const link = async (e: FormEvent) => {
    e.preventDefault();
    if (!account) return;
    const ok = await run(
      () => linkSupervisor(supabaseRpc, account.id, intern.ownerId, record === NEW_RECORD ? null : record),
      `${account.name} now supervises ${intern.internName}`,
    );
    if (ok) {
      setAccountId('');
      setRecord(NEW_RECORD);
    }
  };

  return (
    <li className="card p-4" aria-label={intern.internName}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold">{intern.internName}</h2>
        <span className="text-sm text-ink-2">{[intern.email, intern.licenceNo, intern.institution].filter(Boolean).join(' · ')}</span>
      </div>
      <div className="mt-0.5 text-sm text-ink-2">
        {fmtDate(intern.periodFrom)} – {fmtDate(intern.periodTo)}
      </div>

      <h3 className="eyebrow mt-4 mb-1">Supervisors in this logbook</h3>
      {intern.supervisors.length === 0 ? (
        <p className="text-sm text-ink-2">None yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {intern.supervisors.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{s.name}</span>
                {s.role && <span className="text-ink-2"> · {s.role}</span>}
              </span>
              {s.linked ? (
                <span className="flex items-center gap-1 text-xs text-good-ink">
                  <Link2 size={14} aria-hidden="true" /> Linked{s.linkedEmail ? ` to ${s.linkedEmail}` : ''}
                </span>
              ) : s.accountId ? (
                <span className="text-xs text-ink-2">Linked · waiting for first sign-in</span>
              ) : (
                <span className="text-xs text-ink-3">Not linked (PIN sign-off on the intern's phone only)</span>
              )}
              {(s.linked || s.accountId) && (
                <button
                  type="button"
                  className="btn btn-ghost px-2 py-1 text-xs"
                  disabled={busy}
                  aria-label={`Unlink ${s.name} from ${intern.internName}`}
                  onClick={() =>
                    window.confirm(`Unlink ${s.name}? They will no longer see ${intern.internName}'s activity or requests.`) &&
                    run(() => unlinkSupervisorRecord(supabaseRpc, s.id), `${s.name} unlinked from ${intern.internName}`)
                  }
                >
                  <Link2Off size={14} aria-hidden="true" /> Unlink
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {available.length > 0 && (
        <form onSubmit={link} className="mt-3 flex flex-wrap items-end gap-2 rounded-[12px] border border-line bg-surface-2 p-3">
          <div className="min-w-48 flex-1">
            <label className="label" htmlFor={`acc-${intern.ownerId}`}>
              Link a supervisor
            </label>
            <select id={`acc-${intern.ownerId}`} className="field" value={accountId} onChange={(e) => pickAccount(e.target.value)}>
              <option value="">Choose a registered supervisor…</option>
              {available.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.email})
                </option>
              ))}
            </select>
          </div>
          {account && (
            <div className="min-w-48 flex-1">
              <label className="label" htmlFor={`rec-${intern.ownerId}`}>
                As
              </label>
              <select id={`rec-${intern.ownerId}`} className="field" value={record} onChange={(e) => setRecord(e.target.value)}>
                <option value={NEW_RECORD}>A new supervisor in the intern's logbook</option>
                {unlinkedRecords.map((s) => (
                  <option key={s.id} value={s.id}>
                    Their existing record “{s.name}”
                  </option>
                ))}
              </select>
            </div>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy || !account}>
            <Link2 size={16} aria-hidden="true" /> Link
          </button>
          {account && record !== NEW_RECORD && (
            <p className="basis-full text-xs text-ink-2">Entries the intern has already submitted to this record will appear in {account.name}'s requests.</p>
          )}
        </form>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Supervisors
// ---------------------------------------------------------------------------

function Supervisors({ data, onChange }: { data: AdminOverview; onChange: () => void }) {
  const { busy, run } = useAction(onChange);
  const [form, setForm] = useState({ name: '', email: '', role: '', kmpdcRegNo: '' });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => registerSupervisor(supabaseRpc, form), `${form.name.trim()} registered`)) setForm({ name: '', email: '', role: '', kmpdcRegNo: '' });
  };

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="card space-y-3 p-4" aria-label="Register a supervisor">
        <h2 className="text-lg font-semibold">Register a supervisor</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="sup-name">Full name</label>
            <input id="sup-name" className="field" required placeholder="Dr Jane Wanjiku" value={form.name} onChange={set('name')} />
          </div>
          <div>
            <label className="label" htmlFor="sup-email">Email (they sign in with it)</label>
            <input id="sup-email" className="field" type="email" required autoComplete="off" value={form.email} onChange={set('email')} />
          </div>
          <div>
            <label className="label" htmlFor="sup-role">Role (optional)</label>
            <input id="sup-role" className="field" placeholder="Consultant, Oral surgery" value={form.role} onChange={set('role')} />
          </div>
          <div>
            <label className="label" htmlFor="sup-reg">KMPDC reg. no. (optional)</label>
            <input id="sup-reg" className="field" value={form.kmpdcRegNo} onChange={set('kmpdcRegNo')} />
          </div>
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          <UserPlus size={16} aria-hidden="true" /> Register
        </button>
      </form>

      {data.supervisors.length === 0 ? (
        <ToneNote tone="neutral">No supervisors registered yet.</ToneNote>
      ) : (
        <ul className="card divide-y divide-line">
          {data.supervisors.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{a.name}</span>
                <span className="text-ink-2"> · {a.email}</span>
                {a.role && <span className="text-ink-2"> · {a.role}</span>}
              </span>
              <span className="text-xs text-ink-2">
                {a.interns} intern{a.interns === 1 ? '' : 's'} · {a.signedIn ? 'has signed in' : 'not signed in yet'}
              </span>
              <button
                type="button"
                className="btn btn-ghost px-2 py-1 text-xs"
                disabled={busy}
                aria-label={`Remove ${a.name}`}
                onClick={() =>
                  window.confirm(`Remove ${a.name}? They are unlinked from every intern. Their past sign-offs stay in the logbooks.`) &&
                  run(() => removeSupervisor(supabaseRpc, a.id), `${a.name} removed`)
                }
              >
                <Trash2 size={14} aria-hidden="true" /> Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Administrators
// ---------------------------------------------------------------------------

function Admins({ data, onChange }: { data: AdminOverview; onChange: () => void }) {
  const sync = useSync();
  const { busy, run } = useAction(onChange);
  const [email, setEmail] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => addAdmin(supabaseRpc, email), `${email.trim()} is now an administrator`)) setEmail('');
  };
  return (
    <div className="space-y-4">
      <ul className="card divide-y divide-line">
        {data.admins.map((a) => (
          <li key={a.email} className="flex items-center gap-3 px-4 py-3 text-sm">
            <span className="flex-1">
              {a.email}
              {a.email === sync.email?.toLowerCase() && <span className="text-ink-2"> (you)</span>}
            </span>
            <button
              type="button"
              className="btn btn-ghost px-2 py-1 text-xs"
              disabled={busy || data.admins.length <= 1}
              aria-label={`Remove administrator ${a.email}`}
              onClick={() => window.confirm(`Remove ${a.email} as an administrator?`) && run(() => removeAdmin(supabaseRpc, a.email), `${a.email} removed`)}
            >
              <Trash2 size={14} aria-hidden="true" /> Remove
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="card flex flex-wrap items-end gap-2 p-4">
        <div className="min-w-48 flex-1">
          <label className="label" htmlFor="admin-email">Add an administrator</label>
          <input id="admin-email" className="field" type="email" required placeholder="name@hospital.org" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Add
        </button>
      </form>
    </div>
  );
}
