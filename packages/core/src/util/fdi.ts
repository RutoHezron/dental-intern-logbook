/**
 * FDI two-digit tooth notation.
 * Permanent: quadrants 1–4, teeth 1–8. Primary: quadrants 5–8, teeth 1–5.
 * Anterior = incisors and canines (positions 1–3); posterior = premolars and molars.
 */

export type ToothClass = 'anterior' | 'posterior';

export function isValidFdi(tooth: string): boolean {
  if (!/^\d{2}$/.test(tooth)) return false;
  const q = Number(tooth[0]);
  const t = Number(tooth[1]);
  if (q >= 1 && q <= 4) return t >= 1 && t <= 8;
  if (q >= 5 && q <= 8) return t >= 1 && t <= 5;
  return false;
}

export function isPrimaryTooth(tooth: string): boolean {
  return isValidFdi(tooth) && Number(tooth[0]) >= 5;
}

export function toothClass(tooth: string): ToothClass | null {
  if (!isValidFdi(tooth)) return null;
  return Number(tooth[1]) <= 3 ? 'anterior' : 'posterior';
}

/** Chart layout as seen facing the patient: upper right, upper left, lower right, lower left. */
export const PERMANENT_TEETH: string[][] = [
  ['18', '17', '16', '15', '14', '13', '12', '11'],
  ['21', '22', '23', '24', '25', '26', '27', '28'],
  ['48', '47', '46', '45', '44', '43', '42', '41'],
  ['31', '32', '33', '34', '35', '36', '37', '38'],
];

export const PRIMARY_TEETH: string[][] = [
  ['55', '54', '53', '52', '51'],
  ['61', '62', '63', '64', '65'],
  ['85', '84', '83', '82', '81'],
  ['71', '72', '73', '74', '75'],
];
