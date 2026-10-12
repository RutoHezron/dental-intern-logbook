import { beforeAll, describe, expect, it } from 'vitest';
import { cohortMember, indexDataset, requirementProgress, summarizeProgress, type CodeCounts, type Dataset, type SharedProgress } from '../src';
import { DEMO_DEFAULTS, generateDemoDataset } from '../src/synthetic';

/** What the server's coordinator_cohort() sends: counts only, as SQL would compute them. */
function shareOf(ds: Dataset): SharedProgress {
  const counts = new Map<string, CodeCounts>();
  for (const e of ds.entries) {
    if (e.status === 'withdrawn') continue;
    const c = counts.get(e.requirementCode) ?? { code: e.requirementCode, logged: 0, verified: 0, pending: 0, returned: 0, lastOn: null };
    c.logged++;
    if (e.status === 'verified' || e.status === 'locked') c.verified++;
    else c.pending++;
    if (e.status === 'returned') c.returned++;
    if (!c.lastOn || e.performedOn > c.lastOn) c.lastOn = e.performedOn;
    counts.set(e.requirementCode, c);
  }
  return {
    ownerId: 'intern-1',
    sharedAt: '2026-01-01T00:00:00.000Z',
    internName: ds.internship.internName,
    periodFrom: ds.internship.periodFrom,
    periodTo: ds.internship.periodTo,
    rotations: ds.rotations,
    counts: [...counts.values()],
    assessments: (ds.assessments ?? []).map((a) => ({ rotationId: a.rotationId, kind: a.kind, sequence: a.sequence, heldOn: a.heldOn ?? null, overallGrade: a.overallGrade ?? null, outcome: a.outcome ?? null })),
    caseReports: (ds.caseReports ?? []).map((c) => ({ rotationId: c.rotationId ?? null, status: c.status })),
  };
}

let ds: Dataset;
beforeAll(() => {
  ds = generateDemoDataset();
});

describe('coordinator cohort view', () => {
  it("shows the same progress as the intern's own dashboard, from counts alone", () => {
    const asOf = DEMO_DEFAULTS.asOf;
    const member = cohortMember(shareOf(ds), ds.requirementSet, asOf);
    const own = summarizeProgress(requirementProgress(indexDataset(ds), asOf));
    expect(member.overall).toEqual(own);
    expect(member.overall.codes).toBe(ds.requirementSet.requirements.length);
  });

  it('summarises each rotation: codes, forms held and case reports', () => {
    const asOf = DEMO_DEFAULTS.asOf;
    const m = cohortMember(shareOf(ds), ds.requirementSet, asOf);
    expect(m.rotations.map((r) => r.rotation.rotation)).toEqual([...ds.rotations].sort((a, b) => a.startsOn.localeCompare(b.startsOn)).map((r) => r.rotation));
    const omf = m.rotations.find((r) => r.rotation.rotation === 'OMF')!;
    expect(omf.formsHeld).toBeLessThanOrEqual(omf.formsDue);
    expect(omf.formsOverdue).toBe(omf.formsDue - omf.formsHeld);
    expect(omf.caseReportsExpected).toBe(10);
    expect(omf.caseReportsVerified).toBe((ds.caseReports ?? []).filter((c) => c.rotationId === omf.rotation.id && c.status === 'verified').length);
  });

  it('flags facts for attention, and nothing personal', () => {
    const share = shareOf(ds);
    const quiet = { ...share, counts: share.counts.map((c) => ({ ...c, lastOn: '2025-11-01' })) };
    const m = cohortMember(quiet, ds.requirementSet, '2026-03-02');
    expect(m.flags).toContain('No entries in the last 14 days');
    expect(JSON.stringify(m)).not.toMatch(/OP-\d|patientRef|birthYear/);
  });
});
