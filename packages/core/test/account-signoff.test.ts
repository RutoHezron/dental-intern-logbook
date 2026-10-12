import { describe, expect, it } from 'vitest';
import { buildAccountSignatures, chainHead, chainKey, checkVerificationChain, createVerification, type LogbookEntry, type Verification } from '../src';
import { addEncounter, emptyDataset, proc } from './fixtures';

let n = 0;
const newId = () => `v-${String(++n).padStart(4, '0')}`;

function entries() {
  const ds = emptyDataset();
  addEncounter(ds, '2025-10-20', [proc('extraction', 3, ['46']), proc('extraction', 4, ['36'])]);
  return ds.entries;
}

describe('account sign-off (supervisor on their own device)', () => {
  it('chains each decision from the tip, with strictly increasing times', () => {
    const [a, b] = entries();
    const sigs = buildAccountSignatures('sup-1', null, [
      { kind: 'entry', entry: a!, decision: 'verified', levelObserved: 3 },
      { kind: 'entry', entry: b!, decision: 'returned', comment: '  Which tooth?  ' },
    ], new Date('2025-10-21T10:00:00Z'), newId);
    expect(sigs.map((s) => s.method)).toEqual(['account', 'account']);
    expect(sigs[0]!.prevHash).toBeNull();
    expect(sigs[1]!.prevHash).toBe(sigs[0]!.hash);
    expect(sigs[1]!.signedAt > sigs[0]!.signedAt).toBe(true);
    expect(sigs[1]).toMatchObject({ comment: 'Which tooth?', levelObserved: undefined });
    expect(checkVerificationChain(sigs, new Map(entries().map((e) => [e.id, e])))).toEqual([]);
  });

  it('never signs behind the tip, even with a slow clock', () => {
    const [a] = entries();
    const tip = { id: 'v-x', hash: 'f'.repeat(64), signedAt: '2025-10-21T12:00:00.000Z' };
    const [s] = buildAccountSignatures('sup-1', tip, [{ kind: 'entry', entry: a!, decision: 'verified' }], new Date('2025-10-21T11:00:00Z'), newId);
    expect(s!.signedAt).toBe('2025-10-21T12:00:00.001Z');
    expect(s!.prevHash).toBe(tip.hash);
    expect(s!.levelObserved).toBe(a!.levelClaimed);
  });

  it('a returned entry needs a comment', () => {
    const [a] = entries();
    expect(() => buildAccountSignatures('sup-1', null, [{ kind: 'entry', entry: a!, decision: 'returned', comment: ' ' }], new Date(), newId)).toThrow(/comment/);
  });

  it('keeps phone and account sign-offs on separate chains, each checked on its own', () => {
    const list = entries();
    const byId = new Map<string, LogbookEntry>(list.map((e) => [e.id, e]));
    // Phone chain: one PIN sign-off. Account chain: one from the supervisor's own device, signed in between.
    const pin = createVerification(list[0]!, { verifierId: 'sup-1', decision: 'verified', method: 'pin' }, null, '2025-10-21T09:00:00.000Z', 'v-pin');
    const [acct] = buildAccountSignatures('sup-1', null, [{ kind: 'entry', entry: list[1]!, decision: 'verified' }], new Date('2025-10-21T08:00:00Z'), newId);
    const all: Verification[] = [acct!, pin];
    expect(chainKey(pin)).toBe('device');
    expect(chainKey(acct!)).toBe('account:sup-1');
    expect(checkVerificationChain(all, byId)).toEqual([]);
    expect(chainHead(all, 'device')!.id).toBe('v-pin');
    expect(chainHead(all, 'account:sup-1')!.id).toBe(acct!.id);

    // A later phone sign-off links to the phone chain, not to the account record.
    const pin2 = createVerification(list[1]!, { verifierId: 'sup-1', decision: 'verified', method: 'pin' }, pin.hash, '2025-10-21T09:30:00.000Z', 'v-pin2');
    expect(checkVerificationChain([...all, pin2], byId)).toEqual([]);

    // Tampering with the entry still breaks the account record's hash.
    byId.set(list[1]!.id, { ...list[1]!, levelClaimed: 5 });
    expect(checkVerificationChain([acct!], byId)).toEqual([{ verificationId: acct!.id, problem: 'hash_mismatch' }]);
  });
});

describe('timestamps from the server', () => {
  it('come back in the form the device hashed', async () => {
    const { fromWire } = await import('../src');
    const v = fromWire<Verification>({ id: 'v1', signed_at: '2025-11-03T16:00:00.001+00:00', created_at: '2025-11-03 19:00:00+03', performed_on: '2025-11-03', comment: 'Seen at 10:00:00+00:00' });
    expect(v.signedAt).toBe('2025-11-03T16:00:00.001Z');
    expect((v as unknown as { createdAt: string }).createdAt).toBe('2025-11-03T16:00:00.000Z');
    expect((v as unknown as { performedOn: string }).performedOn).toBe('2025-11-03');
    expect(v.comment).toBe('Seen at 10:00:00+00:00');
  });
});
