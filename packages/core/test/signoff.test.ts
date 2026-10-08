import { describe, expect, it } from 'vitest';
import { checkPin, hashPin, indexDataset, isValidPin, reviewChecks, toWire, verificationQueue } from '../src';
import { addEncounter, addPatient, emptyDataset, proc } from './fixtures';

describe('supervisor PIN', () => {
  it('rejects guessable PINs', () => {
    expect(isValidPin('1111')).toBe(false);
    expect(isValidPin('1234')).toBe(false);
    expect(isValidPin('98765')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('4071')).toBe(true);
  });

  it('stores only a salted hash and checks the PIN against it', async () => {
    const stored = await hashPin('4071');
    expect(stored.pinHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain('4071');
    expect(await checkPin('4071', stored)).toBe(true);
    expect(await checkPin('4072', stored)).toBe(false);
    expect(await checkPin('4071', {})).toBe(false);
    // Same PIN, different salt, different hash.
    expect((await hashPin('4071')).pinHash).not.toBe(stored.pinHash);
  });

  it('never sends PIN material over the wire', async () => {
    const wire = toWire({ id: 's1', name: 'Dr Sup', ...(await hashPin('4071')), pinSetAt: 'x' });
    expect(Object.keys(wire).sort()).toEqual(['id', 'name']);
  });
});

describe('review checks and queue', () => {
  it('lists submitted entries for a supervisor, oldest first', () => {
    const ds = emptyDataset();
    addEncounter(ds, '2025-10-21', [proc('extraction', 3, ['36'])]);
    addEncounter(ds, '2025-10-20', [proc('extraction', 3, ['46'])]);
    const q = verificationQueue(indexDataset(ds), 'sup-1');
    expect(q.map((e) => e.performedOn)).toEqual(['2025-10-20', '2025-10-21']);
    expect(verificationQueue(indexDataset(ds), 'someone-else')).toHaveLength(0);
  });

  it('flags late entries, duplicates and a first jump to a high level', () => {
    const ds = emptyDataset();
    const p = addPatient(ds);
    const e1 = addEncounter(ds, '2025-10-20', [proc('extraction', 5, ['36'])], { patient: p });
    addEncounter(ds, '2025-10-20', [proc('extraction', 5, ['36'])], { patient: p });
    const entry = ds.entries.find((x) => x.encounterId === e1.id)!;
    entry.createdAt = '2025-10-30T10:00:00Z';
    const kinds = reviewChecks(indexDataset(ds), entry).map((c) => c.message);
    expect(kinds.join(' ')).toMatch(/Logged 10 days after/);
    expect(kinds.join(' ')).toMatch(/same code, patient, site and date/);
    expect(kinds.join(' ')).toMatch(/First OMF 2 entry at level 5/);
  });

  it('flags a paediatric code without a birth year', () => {
    const ds = emptyDataset();
    const child = addPatient(ds, { birthYear: 2016 });
    addEncounter(ds, '2026-01-05', [proc('pulpotomy', 3, ['84'])], { patient: child });
    const entry = ds.entries[0]!;
    ds.patients[0]!.birthYear = undefined;
    expect(reviewChecks(indexDataset(ds), entry).map((c) => c.kind)).toContain('paed_age_unknown');
  });
});
