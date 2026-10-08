import { PROCEDURE_TYPES, RULE_DESCRIPTIONS, todayISO, type CountingRules } from '@logbook/core';
import { Download, ShieldCheck, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { PageHeader, Section, Segmented, ToneNote, useToast } from '../components/ui';
import type { Preferences } from '../data/db';
import { clearAll, exportBackup, importBackup, loadDemo, RepoError, saveFacility, saveInternship, savePreferences, saveRules } from '../data/repo';
import { downloadText } from '../lib/format';
import { AccountSync } from './AccountSync';
import { useInternship } from '../state/AppData';

export function SettingsPage() {
  const { ds, state } = useInternship();
  const toast = useToast();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState({
    internName: ds.internship.internName,
    email: ds.internship.email ?? '',
    licenceNo: ds.internship.licenceNo ?? '',
    facility: state.facility?.name ?? ds.internship.institution ?? '',
  });
  const prefs = state.preferences;
  const setPrefs = (p: Partial<Preferences>) => savePreferences({ ...prefs, ...p });
  const rules = ds.rules;
  const setRules = async (patch: Partial<CountingRules>) => {
    await saveRules({ ...rules, ...patch });
    toast('Counting rules updated · all counts recalculated');
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Settings" />

      <div id="sync">
        <AccountSync />
      </div>

      <Section title="Profile">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await saveInternship({ ...ds.internship, internName: profile.internName.trim() || ds.internship.internName, email: profile.email || undefined, licenceNo: profile.licenceNo || undefined, institution: profile.facility });
            if (state.facility) await saveFacility({ ...state.facility, name: profile.facility });
            toast('Profile saved');
          }}
        >
          <div>
            <label className="label" htmlFor="pname">Full name</label>
            <input id="pname" className="field" value={profile.internName} onChange={(e) => setProfile({ ...profile, internName: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="pemail">Email</label>
            <input id="pemail" type="email" className="field" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="plic">Internship licence no.</label>
            <input id="plic" className="field" value={profile.licenceNo} onChange={(e) => setProfile({ ...profile, licenceNo: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="pfac">Training centre</label>
            <input id="pfac" className="field" value={profile.facility} onChange={(e) => setProfile({ ...profile, facility: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className="btn btn-primary">
              Save profile
            </button>
          </div>
        </form>
      </Section>

      <Section title="Appearance">
        <Segmented
          label="Theme"
          value={prefs.theme}
          onChange={(theme) => setPrefs({ theme })}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </Section>

      <Section title="Favourite procedures" aside="Shown first in Quick Entry">
        <div className="flex flex-wrap gap-1.5">
          {PROCEDURE_TYPES.filter((t) => t.id !== 'other').map((t) => {
            const on = prefs.favourites.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={on}
                className="chip !min-h-9"
                onClick={() => setPrefs({ favourites: on ? prefs.favourites.filter((x) => x !== t.id) : [...prefs.favourites, t.id] })}
              >
                {t.shortName}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Counting rules">
        <p className="mb-3 text-sm text-ink-2">
          The KMPDC logbook does not define how entries are counted. These defaults apply until your training centre confirms them; reports say which rules were
          used.
        </p>
        <ul className="space-y-3 text-sm">
          <RuleToggle id="R1" checked={rules.rotationScope} onChange={(v) => setRules({ rotationScope: v })} />
          <RuleToggle id="R4" checked={rules.finalStageOnly} onChange={(v) => setRules({ finalStageOnly: v })} />
          <li className="flex items-start gap-3">
            <input
              type="checkbox"
              id="rule-per02"
              className="mt-0.5 h-5 w-5 accent-[var(--accent)]"
              checked={rules.preferSystemicCode}
              onChange={(e) => setRules({ preferSystemicCode: e.target.checked })}
            />
            <label htmlFor="rule-per02">
              <strong>PER 02 first.</strong> <span className="text-ink-2">Count periodontal care for patients with a systemic condition under PER 02 rather than PER 03.</span>
            </label>
          </li>
          <li className="flex items-center gap-3">
            <label htmlFor="rule-late" className="flex-1">
              <strong>R8 late-entry flag</strong> <span className="text-ink-2">after this many days</span>
            </label>
            <input id="rule-late" type="number" min={0} max={30} className="field tabular !w-20" value={rules.lateEntryDays} onChange={(e) => setRules({ lateEntryDays: Math.max(0, Number(e.target.value) || 0) })} />
          </li>
          <li className="flex items-start gap-3 border-t border-line pt-3">
            <input type="checkbox" id="rule-confirmed" className="mt-0.5 h-5 w-5 accent-[var(--accent)]" checked={rules.confirmed} onChange={(e) => setRules({ confirmed: e.target.checked })} />
            <label htmlFor="rule-confirmed">
              <strong>My training centre has confirmed these rules.</strong> <span className="text-ink-2">Removes the "default rules" label from reports.</span>
            </label>
          </li>
        </ul>
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-medium">All default rules (R1–R10)</summary>
          <dl className="mt-2 space-y-1.5 text-ink-2">
            {Object.entries(RULE_DESCRIPTIONS).map(([k, v]) => (
              <div key={k} className="flex gap-3">
                <dt className="code w-8 shrink-0 text-ink">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </details>
      </Section>

      <Section title="Your data">
        <div className="mb-4 flex items-start gap-3 text-sm text-ink-2">
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-ink" aria-hidden="true" />
          <p>
            Everything is stored on this device. No patient names, phone numbers or ID numbers are collected. Export a backup regularly; when account sync arrives, your
            records will also be kept on the server.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={async () => downloadText(`logbook-backup-${todayISO()}.json`, await exportBackup(), 'application/json')}
          >
            <Download size={16} aria-hidden="true" /> Export full backup
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
            <Upload size={16} aria-hidden="true" /> Restore from backup
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (!window.confirm('Restoring replaces everything on this device with the backup. Continue?')) return;
              try {
                await importBackup(await file.text());
                toast('Backup restored');
              } catch (err) {
                toast(err instanceof RepoError ? err.message : 'Could not restore this file', 'critical');
              }
            }}
          />
        </div>
        <div className="mt-6 space-y-3 border-t border-line pt-4">
          {state.demo ? (
            <ToneNote tone="neutral">You are using the fictional demo internship. Start your own logbook to remove the demo data from this device.</ToneNote>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={async () => {
                if (!window.confirm('Replace everything on this device with the demo internship?')) return;
                const today = todayISO();
                await loadDemo(today < '2026-10-11' ? today : '2026-10-11');
                toast('Demo internship loaded');
                navigate('/');
              }}
            >
              Load demo internship
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ color: 'var(--critical-ink)' }}
              onClick={async () => {
                if (!window.confirm(state.demo ? 'Remove the demo data and set up your own logbook?' : 'Permanently delete all records on this device? Export a backup first.')) return;
                await clearAll();
                navigate('/welcome');
              }}
            >
              {state.demo ? 'Start my own logbook' : 'Delete all data on this device'}
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
}

function RuleToggle({ id, checked, onChange }: { id: 'R1' | 'R4'; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <li className="flex items-start gap-3">
      <input type="checkbox" id={`rule-${id}`} className="mt-0.5 h-5 w-5 accent-[var(--accent)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={`rule-${id}`}>
        <strong>{id}.</strong> <span className="text-ink-2">{RULE_DESCRIPTIONS[id]}</span>
      </label>
    </li>
  );
}
