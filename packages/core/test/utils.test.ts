import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  ageOnDate,
  csvCell,
  daysBetween,
  endOfMonth,
  isPrimaryTooth,
  isValidDate,
  isValidFdi,
  seededRandom,
  sha256,
  stableStringify,
  toCsv,
  toothClass,
  uuidv7,
  weekday,
} from '../src';

describe('dates', () => {
  it('does calendar arithmetic without time-zone drift', () => {
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2025-10-13', '2026-10-11')).toBe(363);
    expect(weekday('2025-10-13')).toBe(0); // Monday
    expect(weekday('2025-10-19')).toBe(6); // Sunday
  });

  it('clamps month addition to the last day of the month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2025-10-13', 12)).toBe('2026-10-13');
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
  });

  it('validates ISO dates strictly', () => {
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('13/10/2025')).toBe(false);
  });

  it('computes age from birth year', () => {
    expect(ageOnDate(2010, '2026-03-01')).toBe(16);
  });
});

describe('FDI notation', () => {
  it('accepts permanent and primary teeth and rejects others', () => {
    expect(isValidFdi('36')).toBe(true);
    expect(isValidFdi('85')).toBe(true);
    expect(isValidFdi('19')).toBe(false);
    expect(isValidFdi('56')).toBe(false);
    expect(isValidFdi('3')).toBe(false);
    expect(isPrimaryTooth('74')).toBe(true);
  });

  it('classifies anterior and posterior teeth', () => {
    expect(toothClass('11')).toBe('anterior');
    expect(toothClass('43')).toBe('anterior');
    expect(toothClass('14')).toBe('posterior');
    expect(toothClass('36')).toBe('posterior');
    expect(toothClass('99')).toBeNull();
  });
});

describe('hashing', () => {
  it('matches SHA-256 test vectors', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });

  it('hashes UTF-8 text and long input like Node crypto', () => {
    for (const s of ['é ✓ 🦷 Mwangi', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'y'.repeat(10_000)]) {
      expect(sha256(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
    }
  });

  it('serialises objects stably regardless of key order', () => {
    expect(stableStringify({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(stableStringify({ a: [2, { c: 4, d: 3 }], b: 1 }));
    expect(stableStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe('ids', () => {
  it('produces RFC-shaped, time-ordered UUIDv7s', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });

  it('is deterministic with a seeded generator', () => {
    expect(uuidv7(1, seededRandom(42))).toBe(uuidv7(1, seededRandom(42)));
  });
});

describe('CSV', () => {
  it('quotes delimiters and neutralises spreadsheet formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell(null)).toBe('');
    expect(toCsv(['x', 'y'], [[1, 'two']])).toBe('x,y\r\n1,two');
  });
});
