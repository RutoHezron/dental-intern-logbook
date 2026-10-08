import { displayMonth, getProcedureType, hasErrors, reflectionsCsv, validateReflection, type Reflection, type ReflectionTag } from '@logbook/core';
import { Download, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Empty, PageHeader, ToneNote, useToast } from '../components/ui';
import { deleteReflection, newId, saveReflection } from '../data/repo';
import { downloadText, fmtDate } from '../lib/format';
import { useInternship } from '../state/AppData';

export const TAGS: { value: ReflectionTag; label: string; mark: string }[] = [
  { value: 'important', label: 'Important case', mark: '⭐' },
  { value: 'learning', label: 'Learning case', mark: '📚' },
  { value: 'challenging', label: 'Challenging case', mark: '⚠️' },
  { value: 'revision', label: 'Revision', mark: '🧠' },
  { value: 'milestone', label: 'Milestone', mark: '🏆' },
];

const PROMPTS: { key: keyof Reflection; label: string; hint: string }[] = [
  { key: 'interesting', label: 'What was interesting today?', hint: 'The case or moment worth remembering' },
  { key: 'learned', label: 'What did I learn?', hint: 'One concrete lesson' },
  { key: 'challenged', label: 'What challenged me?', hint: 'Technique, decision, communication…' },
  { key: 'doDifferently', label: 'What would I do differently?', hint: '' },
  { key: 'revise', label: 'What should I revise?', hint: 'Topics to read up on' },
  { key: 'needExposure', label: 'What do I need more exposure to?', hint: 'Helps the gap analysis and your supervisor discussions' },
];

export function DiaryPage() {
  const { ix, ds } = useInternship();
  const [tag, setTag] = useState<ReflectionTag | ''>('');
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    return ds.reflections
      .filter((r) => !r.deletedAt)
      .filter((r) => !tag || r.tags.includes(tag))
      .filter((r) => !query || [r.title, r.interesting, r.learned, r.challenged, r.doDifferently, r.revise, r.needExposure].join(' ').toLowerCase().includes(query))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [ds.reflections, tag, q]);
  const byMonth = new Map<string, Reflection[]>();
  for (const r of list) byMonth.set(displayMonth(r.date), [...(byMonth.get(displayMonth(r.date)) ?? []), r]);

  return (
    <div>
      <PageHeader
        title="Reflection diary"
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => downloadText('reflection-diary.csv', reflectionsCsv(ix))}>
              <Download size={16} aria-hidden="true" /> CSV
            </button>
            <Link to="/diary/new" className="btn btn-primary">
              <Plus size={16} aria-hidden="true" /> New reflection
            </Link>
          </>
        }
      >
        What you learned, not just what you did. Private unless you choose to share an entry.
      </PageHeader>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-60 flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true" />
          <input className="field !pl-9" placeholder="Search reflections" aria-label="Search reflections" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by tag">
          {TAGS.map((t) => (
            <button key={t.value} type="button" aria-pressed={tag === t.value} className="chip !min-h-9" onClick={() => setTag(tag === t.value ? '' : t.value)}>
              <span aria-hidden="true">{t.mark}</span> {t.label}
            </button>
          ))}
        </div>
      </div>
      {list.length === 0 ? (
        <Empty title={tag || q ? 'No reflections match' : 'Your diary is empty'} action={<Link to="/diary/new" className="btn btn-primary">Write the first one</Link>}>
          A few lines after a memorable case is enough. These entries feed your weekly reports and final portfolio.
        </Empty>
      ) : (
        <div className="space-y-6">
          {[...byMonth.entries()].map(([month, items]) => (
            <section key={month}>
              <h2 className="eyebrow mb-2">{month}</h2>
              <ul className="grid gap-3 md:grid-cols-2">
                {items.map((r) => (
                  <li key={r.id}>
                    <Link to={`/diary/${r.id}`} className="card block h-full p-4 hover:border-line-strong">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-sans text-[15px] font-semibold">{r.title || 'Untitled reflection'}</h3>
                        <span className="shrink-0 text-xs text-ink-3">{fmtDate(r.date)}</span>
                      </div>
                      <p className="mt-1 line-clamp-3 text-sm text-ink-2">{r.learned || r.interesting || r.challenged || r.revise}</p>
                      {r.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-ink-2">
                          {r.tags.map((t) => {
                            const m = TAGS.find((x) => x.value === t)!;
                            return (
                              <span key={t} className="rounded-full bg-surface-2 px-2 py-0.5">
                                <span aria-hidden="true">{m.mark}</span> {m.label}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export function DiaryEditorPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { ix, ds, today } = useInternship();
  const navigate = useNavigate();
  const toast = useToast();
  const existing = id ? ds.reflections.find((r) => r.id === id) : undefined;
  const encounterId = existing?.encounterId ?? params.get('encounter') ?? undefined;
  const encounter = encounterId ? ix.encounters.find((e) => e.id === encounterId) : undefined;
  const [r, setR] = useState<Reflection>(
    () =>
      existing ?? {
        id: newId(),
        internshipId: ds.internship.id,
        date: encounter?.date ?? today,
        encounterId,
        title: '',
        tags: [],
        sharedWithSupervisor: false,
        createdAt: '',
        updatedAt: '',
      },
  );
  const [error, setError] = useState<string | null>(null);
  const issues = validateReflection(r, today);

  const save = async () => {
    if (hasErrors(issues)) {
      setError(issues.find((i) => i.level === 'error')!.message);
      return;
    }
    await saveReflection(r);
    toast('Reflection saved');
    navigate('/diary');
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader eyebrow={existing ? 'Edit reflection' : 'New reflection'} title="Reflection" />
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {encounter && (
          <p className="text-sm text-ink-2">
            About the visit on {fmtDate(encounter.date)}: {encounter.procedures.map((p) => getProcedureType(p.procedureTypeId)?.shortName).join(', ')}
          </p>
        )}
        <div className="card space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
            <div>
              <label className="label" htmlFor="rtitle">Title</label>
              <input id="rtitle" className="field" placeholder="e.g. Curved canal on a lower molar" value={r.title} onChange={(e) => setR({ ...r, title: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="rdate">Date</label>
              <input id="rdate" type="date" className="field" max={today} value={r.date} onChange={(e) => setR({ ...r, date: e.target.value })} />
            </div>
          </div>
          {PROMPTS.map((p) => (
            <div key={p.key}>
              <label className="label" htmlFor={`p-${p.key}`}>{p.label}</label>
              <textarea
                id={`p-${p.key}`}
                className="field min-h-16"
                placeholder={p.hint}
                value={(r[p.key] as string | undefined) ?? ''}
                onChange={(e) => setR({ ...r, [p.key]: e.target.value || undefined })}
              />
            </div>
          ))}
          <fieldset>
            <legend className="label">Mark as</legend>
            <div className="flex flex-wrap gap-1.5">
              {TAGS.map((t) => {
                const on = r.tags.includes(t.value);
                return (
                  <button
                    key={t.value}
                    type="button"
                    aria-pressed={on}
                    className="chip"
                    onClick={() => setR({ ...r, tags: on ? r.tags.filter((x) => x !== t.value) : [...r.tags, t.value] })}
                  >
                    <span aria-hidden="true">{t.mark}</span> {t.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={r.sharedWithSupervisor} onChange={(e) => setR({ ...r, sharedWithSupervisor: e.target.checked })} />
            Share this reflection with my supervisor
          </label>
        </div>
        {issues
          .filter((i) => i.level === 'warning')
          .map((i, k) => (
            <ToneNote key={k} tone="warning">
              {i.message}
            </ToneNote>
          ))}
        {error && <ToneNote tone="critical">{error}</ToneNote>}
        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary flex-1">
            Save reflection
          </button>
          {existing && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={async () => {
                if (!window.confirm('Delete this reflection?')) return;
                await deleteReflection(existing.id);
                toast('Reflection deleted');
                navigate('/diary');
              }}
            >
              <Trash2 size={16} aria-hidden="true" /> Delete
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
