import { describe, expect, it } from 'vitest';
import { ACTIVITY_TYPES, KMPDC_DENTAL_3, PROCEDURE_TYPES } from '../src';

const clinical = KMPDC_DENTAL_3.requirements.filter((r) => r.rotation !== 'COMM');
const community = KMPDC_DENTAL_3.requirements.filter((r) => r.rotation === 'COMM');

describe('KMPDC 3rd edition requirement set', () => {
  it('has the 42 clinical procedure codes with 762 minimum entries (blueprint §1.7)', () => {
    expect(clinical).toHaveLength(42);
    expect(clinical.reduce((s, r) => s + r.minCount, 0)).toBe(762);
  });

  it('has 752 printed rows: CONS 07 has a target but no rows (G3)', () => {
    expect(clinical.reduce((s, r) => s + r.printedRows, 0)).toBe(752);
    expect(KMPDC_DENTAL_3.requirements.find((r) => r.code === 'CONS 07')?.printedRows).toBe(0);
  });

  it('has codes per rotation as in 5.3.3–5.6.3', () => {
    const count = (rot: string) => clinical.filter((r) => r.rotation === rot).length;
    expect([count('OMF'), count('PAED'), count('PER'), count('CONS')]).toEqual([19, 10, 6, 7]);
  });

  it('has 16 community activities, 64 case follow-up steps and 8 weekly reports (5.7)', () => {
    expect(community.filter((r) => r.code.startsWith('COMM A'))).toHaveLength(16);
    expect(community.filter((r) => r.code.startsWith('COMM C-')).reduce((s, r) => s + r.minCount, 0)).toBe(64);
    expect(community.find((r) => r.code === 'COMM W')?.minCount).toBe(8);
    expect(community.every((r) => r.expectedLevel === 4)).toBe(true);
  });

  it('spans 52 weeks over five rotations (2.1.3)', () => {
    expect(KMPDC_DENTAL_3.rotations.reduce((s, r) => s + r.weeks, 0)).toBe(52);
  });

  it('keeps expected levels for assisting-only codes', () => {
    const level = (code: string) => KMPDC_DENTAL_3.requirements.find((r) => r.code === code)?.expectedLevel;
    expect(level('PER 05')).toBe(2);
    expect(level('PER 06')).toBe(2);
    expect(level('CONS 05')).toBe(2);
    expect(level('OMF 19')).toBe(1);
  });

  it('has unique codes', () => {
    const codes = KMPDC_DENTAL_3.requirements.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('procedure and activity catalogue', () => {
  const codes = new Set(KMPDC_DENTAL_3.requirements.map((r) => r.code));
  const uncoded = new Set(KMPDC_DENTAL_3.uncoded.map((u) => u.code));

  it('only maps to codes that exist in the requirement set', () => {
    for (const t of PROCEDURE_TYPES) for (const m of t.mappings) expect(codes, `${t.id} → ${m.requirementCode}`).toContain(m.requirementCode);
    for (const t of ACTIVITY_TYPES) for (const m of t.mappings) expect(codes, `${t.id} → ${m.requirementCode}`).toContain(m.requirementCode);
  });

  it('links every unmapped clinical procedure to an uncoded competency, except "other"', () => {
    for (const t of PROCEDURE_TYPES.filter((x) => x.mappings.length === 0 && x.id !== 'other')) {
      expect(uncoded, t.id).toContain(t.uncoded);
    }
  });

  it('covers every clinical code with at least one procedure or activity mapping', () => {
    const mapped = new Set([...PROCEDURE_TYPES, ...ACTIVITY_TYPES].flatMap((t) => t.mappings.map((m) => m.requirementCode)));
    for (const r of clinical) expect(mapped, r.code).toContain(r.code);
  });

  it('puts paediatric mappings before adult ones so age decides the code (R7)', () => {
    for (const t of PROCEDURE_TYPES) {
      const paedIndex = t.mappings.findIndex((m) => m.when.maxAgeExclusive !== undefined);
      const otherIndex = t.mappings.findIndex((m) => m.when.maxAgeExclusive === undefined);
      if (paedIndex >= 0 && otherIndex >= 0) expect(paedIndex, t.id).toBeLessThan(otherIndex);
    }
  });
});
