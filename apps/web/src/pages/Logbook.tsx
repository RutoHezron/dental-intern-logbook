import {
  activitiesCsv,
  getActivityType,
  getProcedureType,
  logbookCsv,
  proceduresCsv,
  requirementProgress,
  summarizeProgress,
  type Activity,
  type Encounter,
  type EntryStatus,
  type LogbookEntry,
} from '@logbook/core';
import { Download, PenLine, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { LevelLadder, PageHeader, ProgressBar, RotationDot, Segmented, StatusBadge } from '../components/ui';
import { downloadText, fmtDate, ROTATION_ORDER, ROTATION_VAR, rotationName } from '../lib/format';
import { analyticsDate, useInternship } from '../state/AppData';

type Row = { kind: 'visit'; date: string; e: Encounter } | { kind: 'activity'; date: string; a: Activity };

const STATUS_LABEL: Record<EntryStatus, string> = {
  draft: 'Draft',
  submitted: 'Awaiting',
  returned: 'Returned',
  verified: 'Verified',
  locked: 'Locked',
  withdrawn: 'Withdrawn',
};

export function EntryChip({ entry }: { entry: LogbookEntry }) {
  const tone =
    entry.status === 'verified' || entry.status === 'locked'
      ? { bg: 'var(--ink)', fg: 'var(--paper)', b: 'var(--ink)' }
      : entry.status === 'returned'
        ? { bg: 'transparent', fg: 'var(--critical-ink)', b: 'var(--critical)' }
        : { bg: 'transparent', fg: 'var(--ink-2)', b: 'var(--line-strong)' };
  return (
    <span
      className="code relative inline-flex items-center gap-1 rounded-[6px] border px-1.5 text-[11px] leading-5"
      style={{ background: tone.bg, color: tone.fg, borderColor: tone.b, borderStyle: entry.status === 'submitted' ? 'dashed' : 'solid' }}
      title={`${entry.requirementCode} · ${STATUS_LABEL[entry.status]}`}
    >
      {entry.requirementCode}
      <span className="sr-only">{STATUS_LABEL[entry.status]}</span>
    </span>
  );
}

export function LogbookPage() {
  const { ix, ds, today } = useInternship();
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') as 'records' | 'codes') ?? 'records';
  const rotation = params.get('rotation') ?? '';
  const status = (params.get('status') as EntryStatus | '') ?? '';
  const [q, setQ] = useState(params.get('q') ?? '');
  const [level, setLevel] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState(60);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const sup = new Map(ds.supervisors.map((s) => [s.id, s.name]));
  const entriesByEnc = useMemo(() => {
    const m = new Map<string, LogbookEntry[]>();
    for (const e of ds.entries) {
      if (e.status === 'withdrawn') continue;
      const k = e.encounterId ?? e.activityId!;
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return m;
  }, [ds.entries]);

  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    const all: Row[] = [
      ...ix.encounters.map((e) => ({ kind: 'visit' as const, date: e.date, e })),
      ...ix.activities.map((a) => ({ kind: 'activity' as const, date: a.date, a })),
    ];
    return all
      .filter((r) => {
        const rec = r.kind === 'visit' ? r.e : r.a;
        if (rotation && ix.rotationCode(rec.rotationId) !== rotation) return false;
        if (from && r.date < from) return false;
        if (to && r.date > to) return false;
        const entries = entriesByEnc.get(rec.id) ?? [];
        if (status && !entries.some((x) => x.status === status)) return false;
        if (level) {
          const lv = Number(level);
          const levels = r.kind === 'visit' ? r.e.procedures.map((p) => p.level) : [r.a.level];
          if (!levels.includes(lv as 1)) return false;
        }
        if (query) {
          const text =
            r.kind === 'visit'
              ? [
                  r.e.patientId ? ix.patients.get(r.e.patientId)?.ref : '',
                  ...r.e.procedures.flatMap((p) => [getProcedureType(p.procedureTypeId)?.name, p.otherName, ...p.sites]),
                  ...r.e.findings.map((f) => f.term),
                  r.e.supervisorId ? sup.get(r.e.supervisorId) : '',
                  r.e.referredTo,
                  ...entries.map((x) => x.requirementCode),
                ]
              : [getActivityType(r.a.activityTypeId)?.name, r.a.title, r.a.supervisorId ? sup.get(r.a.supervisorId) : '', ...entries.map((x) => x.requirementCode)];
          if (!text.filter(Boolean).join(' ').toLowerCase().includes(query)) return false;
        }
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date) || (b.kind === 'visit' && a.kind === 'visit' ? (b.e.time ?? '').localeCompare(a.e.time ?? '') : 0));
  }, [ix, q, rotation, status, level, from, to, entriesByEnc, sup]);

  const exportRange = { from: from || undefined, to: to || undefined, rotationCode: rotation || undefined };

  return (
    <div>
      <PageHeader
        title="Logbook"
        actions={
          <>
            <Link to="/sign-off" className="btn btn-primary">
              <PenLine size={16} aria-hidden="true" /> Supervisor sign-off
            </Link>
            <button type="button" className="btn btn-secondary" onClick={() => downloadText(`logbook-entries${rotation ? '-' + rotation : ''}.csv`, logbookCsv(ix, exportRange))}>
              <Download size={16} aria-hidden="true" /> Logbook CSV
            </button>
            <details className="relative">
              <summary className="btn btn-ghost cursor-pointer list-none">More exports</summary>
              <div className="absolute right-0 z-20 mt-1 w-56 rounded-[12px] border border-line bg-surface p-1 shadow-card">
                <button type="button" className="w-full rounded-[8px] px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => downloadText('procedures.csv', proceduresCsv(ix, exportRange))}>
                  All procedures (CSV)
                </button>
                <button type="button" className="w-full rounded-[8px] px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => downloadText('activities.csv', activitiesCsv(ix, exportRange))}>
                  Activities (CSV)
                </button>
              </div>
            </details>
          </>
        }
      >
        Every visit and activity you recorded, and the logbook entries derived from them.
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          label="View"
          value={view}
          onChange={(v) => set('view', v === 'records' ? '' : v)}
          options={[
            { value: 'records', label: 'Records' },
            { value: 'codes', label: 'By code' },
          ]}
        />
        <select aria-label="Rotation" className="field !min-h-10 !w-auto" value={rotation} onChange={(e) => set('rotation', e.target.value)}>
          <option value="">All rotations</option>
          {ROTATION_ORDER.map((c) => (
            <option key={c} value={c}>
              {rotationName(ix, c)}
            </option>
          ))}
        </select>
      </div>

      {view === 'codes' ? (
        <CodesView rotation={rotation} asOf={analyticsDate(today, ix)} />
      ) : (
        <>
          <div className="card mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
            <div className="relative sm:col-span-2 lg:col-span-1">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true" />
              <input
                className="field !pl-9"
                placeholder="Search patient no., procedure, tooth, diagnosis, code, supervisor"
                aria-label="Search the logbook"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setLimit(60);
                }}
              />
            </div>
            <select aria-label="Status" className="field" value={status} onChange={(e) => set('status', e.target.value)}>
              <option value="">Any status</option>
              <option value="submitted">Awaiting verification</option>
              <option value="returned">Returned</option>
              <option value="verified">Verified</option>
            </select>
            <select aria-label="Level" className="field" value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="">Any level</option>
              {[1, 2, 3, 4, 5].map((l) => (
                <option key={l} value={l}>
                  Level {l}
                </option>
              ))}
            </select>
            <input type="date" aria-label="From date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" aria-label="To date" className="field" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>

          <div className="mb-2 text-sm text-ink-2">
            {rows.length.toLocaleString()} record{rows.length === 1 ? '' : 's'}
          </div>
          <ul className="card divide-y divide-line">
            {rows.slice(0, limit).map((r) => {
              const rec = r.kind === 'visit' ? r.e : r.a;
              const entries = entriesByEnc.get(rec.id) ?? [];
              const rot = ix.rotationCode(rec.rotationId);
              return (
                <li key={rec.id}>
                  <Link to={r.kind === 'visit' ? `/log/visit/${rec.id}` : `/log/activity/${rec.id}`} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-4 py-3 hover:bg-surface-2 sm:grid-cols-[7.5rem_1fr_auto]">
                    <div className="flex items-center gap-2 text-sm">
                      <RotationDot code={rot} />
                      <span className="tabular text-ink-2">{fmtDate(r.date)}</span>
                    </div>
                    <div className="min-w-0">
                      {r.kind === 'visit' ? (
                        <>
                          <div className="flex flex-wrap items-center gap-x-2 text-sm">
                            <span className="code">{r.e.patientId ? ix.patients.get(r.e.patientId)?.ref : 'No patient no.'}</span>
                            <span className="text-ink-3">· {r.e.visitType}</span>
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                            {r.e.procedures.map((p) => (
                              <span key={p.id} className="inline-flex items-center gap-1.5">
                                <LevelLadder level={p.level} size={12} />
                                {p.otherName ?? getProcedureType(p.procedureTypeId)?.shortName}
                                {p.stage ? <span className="text-ink-3">stage {p.stage}</span> : null}
                                {p.sites.length > 0 && <span className="code text-ink-3">{p.sites.join(' ')}</span>}
                              </span>
                            ))}
                          </div>
                          {r.e.findings.length > 0 && <div className="mt-0.5 truncate text-xs text-ink-3">{r.e.findings.map((f) => f.term).join(' · ')}</div>}
                        </>
                      ) : (
                        <div className="flex items-center gap-1.5 text-sm">
                          <LevelLadder level={r.a.level} size={12} />
                          {r.a.title ?? getActivityType(r.a.activityTypeId)?.name}
                        </div>
                      )}
                    </div>
                    <div className="col-span-2 flex flex-wrap gap-1 sm:col-span-1 sm:justify-end">
                      {entries.map((x) => (
                        <EntryChip key={x.id} entry={x} />
                      ))}
                    </div>
                  </Link>
                </li>
              );
            })}
            {rows.length === 0 && <li className="px-4 py-10 text-center text-sm text-ink-2">No records match these filters.</li>}
          </ul>
          {rows.length > limit && (
            <button type="button" className="btn btn-secondary mt-3 w-full" onClick={() => setLimit(limit + 100)}>
              Show more ({rows.length - limit} remaining)
            </button>
          )}
          <p className="mt-3 text-xs text-ink-3">
            Code chips: solid = verified, dashed = awaiting verification, red outline = returned.
          </p>
        </>
      )}
    </div>
  );
}

function CodesView({ rotation, asOf }: { rotation: string; asOf: string }) {
  const { ix, ds } = useInternship();
  const progress = useMemo(() => requirementProgress(ix, asOf), [ix, asOf]);
  const groups = (rotation ? [rotation] : ROTATION_ORDER).map((code) => ({ code, list: progress.filter((p) => p.requirement.rotation === code) }));
  return (
    <div className="space-y-5">
      {!ds.rules.confirmed && (
        <p className="text-sm text-ink-2">
          Counted with <strong>default rules</strong> until your training centre confirms how the logbook is counted (see Settings → Counting rules).
        </p>
      )}
      {groups.map(({ code, list }) => {
        const s = summarizeProgress(list);
        return (
          <section key={code} className="card overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3" style={{ boxShadow: `inset 4px 0 0 ${ROTATION_VAR[code]}` }}>
              <h2 className="text-[17px] font-semibold">{rotationName(ix, code)}</h2>
              <span className="tabular text-sm text-ink-2">
                {s.met}/{s.codes} codes met · {s.verifiedTowardMinimum}/{s.minimumTotal} entries toward minimums
              </span>
            </header>
            <ul className="divide-y divide-line">
              {list.map((p) => (
                <li key={p.requirement.code}>
                  <Link to={`/logbook/code/${encodeURIComponent(p.requirement.code)}`} className="grid grid-cols-[5.5rem_1fr] items-center gap-x-3 gap-y-1.5 px-4 py-3 hover:bg-surface-2 sm:grid-cols-[6rem_1fr_9rem_6rem_7rem]">
                    <span className="code text-sm">{p.requirement.code}</span>
                    <span className="min-w-0 text-sm text-ink-2">{p.requirement.description}</span>
                    <div className="col-span-2 sm:col-span-1">
                      <ProgressBar verified={p.verified} pending={p.pending} min={p.requirement.minCount} color={ROTATION_VAR[code]} />
                    </div>
                    <span className="tabular text-sm">
                      <strong>{p.verified}</strong>
                      <span className="text-ink-3">/{p.requirement.minCount}</span>
                      {p.pending > 0 && <span className="text-ink-3"> +{p.pending}</span>}
                    </span>
                    <span className="flex items-center gap-2 sm:justify-end">
                      <LevelLadder level={p.highestVerifiedLevel} size={14} />
                      <StatusBadge status={p.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
