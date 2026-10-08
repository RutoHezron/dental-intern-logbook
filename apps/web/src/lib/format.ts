import { displayDate, displayShortDate, type DatasetIndex, type ProgressStatus, type RotationCode } from '@logbook/core';

export const ROTATION_VAR: Record<string, string> = {
  OMF: 'var(--rot-omf)',
  PAED: 'var(--rot-paed)',
  PER: 'var(--rot-per)',
  CONS: 'var(--rot-cons)',
  COMM: 'var(--rot-comm)',
};

export const ROTATION_ORDER = ['OMF', 'PAED', 'PER', 'CONS', 'COMM'];

export function rotationName(ix: DatasetIndex, code: RotationCode | null | undefined): string {
  if (!code) return 'No rotation';
  return ix.ds.requirementSet.rotations.find((r) => r.code === code)?.name ?? code;
}

/** Short rotation names for tight spaces. */
export const ROTATION_SHORT: Record<string, string> = {
  OMF: 'Oral surgery',
  PAED: 'Paediatrics & ortho',
  PER: 'Periodontology',
  CONS: 'Conservative & prosth.',
  COMM: 'Community',
};

export const LEVEL_NAMES: Record<number, string> = {
  0: 'No exposure',
  1: 'Observed',
  2: 'Assisted',
  3: 'Direct supervision',
  4: 'Indirect supervision',
  5: 'Independent',
};

export const STATUS_META: Record<ProgressStatus, { label: string; tone: 'good' | 'warning' | 'serious' | 'critical' | 'neutral' }> = {
  met: { label: 'Met', tone: 'good' },
  on_track: { label: 'On track', tone: 'neutral' },
  at_risk: { label: 'At risk', tone: 'warning' },
  behind: { label: 'Behind', tone: 'serious' },
  not_met: { label: 'Not met', tone: 'critical' },
  upcoming: { label: 'Upcoming', tone: 'neutral' },
  no_rotation: { label: 'No rotation', tone: 'neutral' },
};

export const fmtDate = displayDate;
export const fmtShort = displayShortDate;

export function fmtPct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export function fmtChange(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '±0';
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function downloadText(filename: string, text: string, type = 'text/csv') {
  // BOM so spreadsheet apps read UTF-8 correctly.
  const blob = new Blob([type === 'text/csv' ? '﻿' + text : text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
