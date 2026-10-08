import { KMPDC_DENTAL_3 } from '../catalogue/kmpdc-dental-3rd-2024';
import { getProcedureType } from '../catalogue/procedures';
import { DEFAULT_COUNTING_RULES } from '../rules/counting';
import { deriveActivity, deriveEncounter, reconcileEntries } from '../rules/derive';
import { buildRotationCalendar, rotationEnd, rotationForDate, rotationProgress } from '../rules/rotations';
import { createVerification, statusAfter } from '../rules/verification';
import type {
  Activity,
  Assessment,
  Dataset,
  Encounter,
  EncounterProcedure,
  Finding,
  ID,
  ISODate,
  Investigation,
  Level,
  LogbookEntry,
  Patient,
  Reflection,
  Rotation,
  Setting,
  Supervisor,
  Verification,
  VisitType,
} from '../types';
import { addDays, daysBetween, eachDay, isWeekend, parseDate, weekday } from '../util/dates';
import { seededRandom, uuidv7 } from '../util/ids';
import { REFLECTION_TEMPLATES, MILESTONES } from './reflections';
import { criteriaFor, FORMS_VERSION } from '../catalogue/kmpdc-forms';
import { indexDataset } from '../analytics/dataset-index';
import { assessmentSchedule, progressSnapshot, progressSummaryText } from '../rules/assessments';

/**
 * Synthetic internship for demonstration and testing: "Dr Alex Mwangi".
 * Every person, facility and patient number is fictional. Deterministic for a
 * given seed so tests and screenshots are reproducible.
 */

export interface SyntheticOptions {
  seed?: number;
  /** Internship start (a Monday). */
  start?: ISODate;
  /** Data is generated up to and including this date. */
  asOf?: ISODate;
}

export const DEMO_DEFAULTS = { seed: 20251013, start: '2025-10-13', asOf: '2026-10-08' } as const;

const HOLIDAYS = new Set([
  '2025-10-20', '2025-12-12', '2025-12-25', '2025-12-26', '2026-01-01', '2026-04-03',
  '2026-04-06', '2026-05-01', '2026-06-01', '2026-10-10',
]);

const SUPERVISORS: Omit<Supervisor, 'id'>[] = [
  { name: 'Dr J. Otieno', role: 'Consultant Oral & Maxillofacial Surgeon', rotation: 'OMF', kmpdcRegNo: 'DEMO-0101' },
  { name: 'Dr R. Wanjiru', role: 'Dental Officer, OMFS', rotation: 'OMF', kmpdcRegNo: 'DEMO-0102' },
  { name: 'Dr M. Achieng', role: 'Paediatric Dentist', rotation: 'PAED', kmpdcRegNo: 'DEMO-0201' },
  { name: 'Dr K. Kiprono', role: 'Orthodontist', rotation: 'PAED', kmpdcRegNo: 'DEMO-0202' },
  { name: 'Dr L. Mutua', role: 'Periodontist', rotation: 'PER', kmpdcRegNo: 'DEMO-0301' },
  { name: 'Dr F. Chebet', role: 'Dental Officer, Periodontology', rotation: 'PER', kmpdcRegNo: 'DEMO-0302' },
  { name: 'Dr B. Njoroge', role: 'Restorative Dentist', rotation: 'CONS', kmpdcRegNo: 'DEMO-0401' },
  { name: 'Dr S. Odhiambo', role: 'Prosthodontist', rotation: 'CONS', kmpdcRegNo: 'DEMO-0402' },
  { name: 'Dr P. Wafula', role: 'County Oral Health Coordinator', rotation: 'COMM', kmpdcRegNo: 'DEMO-0501' },
  { name: 'Dr A. Nyambura', role: 'Dental Public Health Specialist', rotation: 'COMM', kmpdcRegNo: 'DEMO-0502' },
];

// --- Tooth pools ----------------------------------------------------------------
const ADULT_POSTERIOR = ['36', '46', '37', '47', '26', '16', '27', '17', '35', '45', '15', '25', '14', '24', '34', '44'];
const ADULT_ANTERIOR = ['11', '21', '12', '22', '13', '23', '31', '41', '32', '42', '33', '43'];
const THIRD_MOLARS = ['38', '48', '38', '48', '18', '28'];
const PRIMARY_MOLARS = ['74', '75', '84', '85', '54', '55', '64', '65'];
const PRIMARY_ANTERIOR = ['51', '61', '52', '62', '81', '71'];
const FIRST_MOLARS = ['16', '26', '36', '46'];

type ProcSpec = { type: string; sites?: string[]; stage?: number; level?: Level; otherName?: string };

interface EncSpec {
  visitType: VisitType;
  setting?: Setting;
  procs: ProcSpec[];
  findings?: Finding[];
  investigations?: Investigation[];
  referredTo?: string;
  followUpNeeded?: boolean;
  complaint?: string;
}

const dx = (term: string, site?: string, certainty: Finding['certainty'] = 'confirmed'): Finding => ({ term, site, isDiagnosis: true, certainty });

export function generateDemoDataset(options: SyntheticOptions = {}): Dataset {
  const seed = options.seed ?? DEMO_DEFAULTS.seed;
  const start = options.start ?? DEMO_DEFAULTS.start;
  const asOf = options.asOf ?? DEMO_DEFAULTS.asOf;
  const rng = seededRandom(seed);

  // ---------------------------------------------------------------- randomness
  const int = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
  const chance = (p: number) => rng() < p;
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!;
  const weighted = <T>(items: [T, number][]): T => {
    const total = items.reduce((s, [, w]) => s + w, 0);
    let x = rng() * total;
    for (const [v, w] of items) {
      x -= w;
      if (x <= 0) return v;
    }
    return items[items.length - 1]![0];
  };
  const poisson = (lambda: number) => {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rng();
    } while (p > L);
    return k - 1;
  };
  let idSeq = 0;
  const idOn = (date: ISODate) => uuidv7(parseDate(date) + 6 * 3_600_000 + (idSeq++ % 36_000) * 1000, rng);
  const stamp = (date: ISODate, hh: number, mm: number) =>
    `${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00.000+03:00`;

  // ---------------------------------------------------------------- structure
  const facilityId = 'facility-demo-ecrh';
  const set = KMPDC_DENTAL_3;
  const internshipId = 'internship-demo-alex';
  const rotations: Rotation[] = buildRotationCalendar(set, internshipId, start, ['OMF', 'PAED', 'PER', 'CONS', 'COMM'], () => idOn(start));
  const periodTo = addDays(start, 52 * 7 - 1);
  const supervisors: Supervisor[] = SUPERVISORS.map((s) => ({ ...s, id: idOn(start) }));
  const supsFor = (rot: string) => supervisors.filter((s) => s.rotation === rot);
  for (const r of rotations) {
    r.facilityId = facilityId;
    r.supervisorId = supsFor(r.rotation)[0]?.id;
    r.department = set.rotations.find((x) => x.code === r.rotation)?.name;
  }
  const internship: Dataset['internship'] = {
    id: internshipId,
    internName: 'Dr Alex Mwangi',
    email: 'alex.mwangi@example.org',
    licenceNo: 'DEMO-INT-2025-0147',
    facilityId,
    institution: 'Example County Referral Hospital (fictional)',
    requirementSetId: set.id,
    periodFrom: start,
    periodTo,
    declarationSignedAt: stamp(start, 8, 30),
  };

  // ---------------------------------------------------------------- patients
  const patients: Patient[] = [];
  const usedRefs = new Set<string>();
  const newPatient = (date: ISODate, kind: 'adult' | 'child' | 'teen-edge', inpatient = false): Patient => {
    const year = Number(date.slice(0, 4));
    let ref: string;
    do {
      ref = inpatient ? `IP-${date.slice(2, 4)}-${String(int(1000, 9999))}` : `OP-${date.slice(2, 4)}-${String(int(10000, 99999)).padStart(5, '0')}`;
    } while (usedRefs.has(ref));
    usedRefs.add(ref);
    const age = kind === 'child' ? int(3, 15) : kind === 'teen-edge' ? int(17, 18) : int(18, 76);
    const systemic = kind === 'adult' && chance(age > 45 ? 0.38 : 0.12);
    const alerts: string[] = [];
    if (systemic) alerts.push(pick(['Hypertension', 'Type 2 diabetes', 'HIV on ART', 'Cardiac disease', 'Asthma']));
    if (chance(0.05)) alerts.push('Penicillin allergy');
    const p: Patient = {
      id: idOn(date),
      ref,
      birthYear: year - age,
      sex: chance(0.53) ? 'F' : 'M',
      systemicCondition: systemic,
      alerts,
      createdAt: stamp(date, 8, 0),
    };
    patients.push(p);
    return p;
  };
  const recentByRotation = new Map<string, Patient[]>();
  const returningPatient = (rot: string): Patient | null => {
    const pool = recentByRotation.get(rot) ?? [];
    return pool.length ? pick(pool.slice(-40)) : null;
  };
  const remember = (rot: string, p: Patient) => {
    const pool = recentByRotation.get(rot) ?? [];
    pool.push(p);
    recentByRotation.set(rot, pool);
  };

  // ---------------------------------------------------------------- levels
  const internshipFraction = (date: ISODate) => Math.max(0, Math.min(1, daysBetween(start, date) / 364));
  const expectedFor = (typeId: string, rot: string): Level => {
    const t = getProcedureType(typeId);
    const m = t?.mappings.find((x) => !x.when.rotation || x.when.rotation === rot);
    const req = m ? set.requirements.find((r) => r.code === m.requirementCode) : undefined;
    return req?.expectedLevel ?? 3;
  };
  const levelFor = (expected: Level, rot: Rotation, date: ISODate): Level => {
    const p = rotationProgress(rot, date);
    const ip = internshipFraction(date);
    let mean: number;
    if (expected >= 5) mean = 2.0 + 3.4 * p + 0.5 * ip;
    else if (expected >= 3) mean = 1.4 + 2.2 * p + 0.3 * ip;
    else mean = 1.2 + 0.9 * p;
    let lvl = Math.round(mean + (rng() - 0.5) * 1.8);
    lvl = Math.max(1, Math.min(5, lvl));
    if (expected <= 2) lvl = Math.min(lvl, 2);
    else if (expected < 5) lvl = Math.min(lvl, expected + 1);
    return lvl as Level;
  };

  // ---------------------------------------------------------------- builders
  const encounters: Encounter[] = [];
  const activities: Activity[] = [];
  const lastSupervisor = new Map<string, ID>();

  const supervisorFor = (rot: string): ID | null => {
    const sups = supsFor(rot);
    if (!sups.length) return null;
    const prev = lastSupervisor.get(rot);
    const s = prev && chance(0.75) ? prev : pick(sups).id;
    lastSupervisor.set(rot, s);
    return s;
  };

  const addEncounter = (date: ISODate, rot: Rotation, patient: Patient | null, spec: EncSpec): Encounter => {
    const hh = int(8, 16);
    const mm = int(0, 59);
    const time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    // Most entries are logged the same day; a few are late (R8 flags).
    const lateBy = chance(0.06) ? int(4, 7) : 0;
    const createdAt = stamp(addDays(date, lateBy), lateBy ? int(18, 21) : Math.min(hh + 1, 20), int(0, 59));
    const procedures: EncounterProcedure[] = spec.procs.map((ps) => {
      const type = getProcedureType(ps.type)!;
      return {
        id: idOn(date),
        procedureTypeId: ps.type,
        sites: ps.sites ?? [],
        stage: type.stages > 1 ? ps.stage ?? 1 : undefined,
        level: ps.level ?? levelFor(expectedFor(ps.type, rot.rotation), rot, date),
        otherName: ps.otherName,
      };
    });
    const e: Encounter = {
      id: idOn(date),
      internshipId,
      rotationId: rot.id,
      date,
      time,
      patientId: patient?.id ?? null,
      visitType: spec.visitType,
      setting: spec.setting ?? 'opd',
      supervisorId: supervisorFor(rot.rotation),
      complaint: spec.complaint,
      findings: spec.findings ?? [],
      investigations: spec.investigations ?? [],
      procedures,
      referredTo: spec.referredTo,
      followUpNeeded: spec.followUpNeeded,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    };
    encounters.push(e);
    if (patient) remember(rot.rotation, patient);
    return e;
  };

  const addActivity = (date: ISODate, rot: Rotation, typeId: string, extra: Partial<Activity> = {}, level?: Level): Activity => {
    const expected: Level =
      typeId === 'postmortem' ? 1 : typeId === 'diagnostic_session' ? 3 : rot.rotation === 'COMM' ? 4 : typeId === 'cpd' ? 3 : 5;
    const lvl = level ?? (rot.rotation === 'COMM' ? (chance(0.85) ? 4 : 3) : expected === 1 ? 1 : levelFor(expected, rot, date));
    const createdAt = stamp(date, int(16, 20), int(0, 59));
    const a: Activity = {
      id: idOn(date),
      internshipId,
      rotationId: rot.id,
      date,
      activityTypeId: typeId,
      level: lvl,
      supervisorId: supervisorFor(rot.rotation),
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
      ...extra,
    };
    activities.push(a);
    return a;
  };

  const workingDays = (r: Rotation) =>
    eachDay(r.startsOn, rotationEnd(r) < asOf ? rotationEnd(r) : asOf).filter((d) => !isWeekend(d) && !HOLIDAYS.has(d));

  /** Spread `n` events over the rotation's working days, optionally biased to the second half. */
  const scheduleDays = (r: Rotation, n: number, bias: 'any' | 'late' = 'any'): ISODate[] => {
    const days = workingDays(r);
    if (!days.length) return [];
    const pool = bias === 'late' ? days.slice(Math.floor(days.length * 0.35)) : days;
    return Array.from({ length: n }, () => pick(pool)).sort();
  };

  // Leave days (fictional): five working days across the year.
  const leave = new Set<string>();
  for (const r of rotations.slice(0, 4)) leave.add(pick(workingDays(r).slice(10, -10)));
  leave.add(addDays(rotations[1]!.startsOn, 21));

  // ======================================================================== OMF
  const omf = rotations[0]!;
  {
    const ramp = (d: ISODate) => 0.55 + 0.45 * Math.min(1, rotationProgress(omf, d) * 2.5);
    for (const d of workingDays(omf)) {
      if (leave.has(d)) continue;
      const n = poisson(5.6 * ramp(d));
      for (let i = 0; i < n; i++) {
        const kind = weighted<'consult' | 'extraction' | 'review'>([['consult', 50], ['extraction', 35], ['review', 15]]);
        if (kind === 'review') {
          const p = returningPatient('OMF') ?? newPatient(d, 'adult');
          addEncounter(d, omf, p, {
            visitType: 'review',
            procs: [{ type: 'exam_plan' }],
            findings: chance(0.8) ? [dx(pick(['Healing extraction socket', 'Resolving facial swelling', 'Pericoronitis', 'Chronic periapical periodontitis']))] : [],
          });
          continue;
        }
        const p = newPatient(d, 'adult');
        const tooth = pick(ADULT_POSTERIOR);
        const diagnosis = pick([
          dx('Irreversible pulpitis', tooth),
          dx('Chronic apical periodontitis', tooth),
          dx('Grossly carious, unrestorable tooth', tooth),
          dx('Retained root', tooth),
          dx('Acute apical abscess', tooth),
          dx('Pericoronitis', pick(THIRD_MOLARS)),
          dx('Periodontally hopeless tooth', tooth),
        ]);
        const withDx = chance(0.92);
        const procs: ProcSpec[] = [{ type: 'exam_plan' }];
        if (kind === 'extraction' || chance(0.35)) {
          procs.push({ type: 'extraction', sites: chance(0.15) ? [tooth, pick(ADULT_POSTERIOR.filter((t) => t !== tooth))] : [tooth] });
        }
        addEncounter(d, omf, p, {
          visitType: chance(0.12) ? 'emergency' : 'new',
          procs,
          findings: withDx ? [diagnosis] : [],
          investigations: chance(0.3) ? [{ kind: chance(0.7) ? 'IOPA' : 'OPG', site: tooth }] : [],
          complaint: pick(['Toothache', 'Swelling', 'Pain on biting', 'Broken tooth', 'Loose tooth']),
          referredTo: chance(0.025) ? pick(['Physician (BP control)', 'ENT', 'Oncology clinic']) : undefined,
        });
      }
    }
    // Less common OMF procedures with fixed counts, so totals are realistic and stable.
    const omfScheduled: [number, 'any' | 'late', () => EncSpec, 'adult' | 'inpatient'][] = [
      [12, 'late', () => { const t = pick(THIRD_MOLARS); return { visitType: 'new', procs: [{ type: 'exam_plan' }, { type: 'surgical_extraction', sites: [t] }], findings: [dx('Impacted third molar', t)], investigations: [{ kind: 'OPG' }] }; }, 'adult'],
      [6, 'any', () => { const t = pick(ADULT_POSTERIOR); return { visitType: 'review', procs: [{ type: 'dry_socket', sites: [t] }], findings: [dx('Alveolar osteitis', t)] }; }, 'adult'],
      [12, 'any', () => ({ visitType: 'emergency', setting: 'emergency', procs: [{ type: 'suturing', sites: ['Lip / perioral'] }], findings: [dx('Oro-facial laceration')] }), 'adult'],
      [6, 'any', () => ({ visitType: 'review', setting: 'ward', procs: [{ type: 'dressing_change', sites: ['Surgical site'] }] }), 'inpatient'],
      [6, 'any', () => { const t = pick(ADULT_POSTERIOR); return { visitType: 'emergency', setting: 'emergency', procs: [{ type: 'bleeding_socket', sites: [t] }], findings: [dx('Post-extraction haemorrhage', t)] }; }, 'adult'],
      [7, 'any', () => ({ visitType: 'emergency', setting: 'emergency', procs: [{ type: 'exam_plan' }, { type: 'incision_drainage', sites: [pick(['Submandibular', 'Buccal space', 'Palatal'])] }], findings: [dx(pick(['Dentoalveolar abscess', 'Submandibular space infection', 'Buccal space abscess']))], investigations: [{ kind: 'FBC' }] }), 'adult'],
      [3, 'late', () => ({ visitType: 'new', setting: 'theatre', procs: [{ type: 'imf' }], findings: [dx('Mandibular fracture')], investigations: [{ kind: 'OPG' }] }), 'inpatient'],
      [11, 'any', () => ({ visitType: 'new', procs: [{ type: 'exam_plan' }, { type: 'biopsy', sites: [pick(['Buccal mucosa', 'Lateral tongue', 'Palate', 'Mandible'])] }], findings: [dx(pick(['Leukoplakia', 'Fibroepithelial polyp', 'Ulcer for investigation', 'Mucocele']), undefined, 'provisional')], investigations: [{ kind: 'Biopsy histology' }] }), 'adult'],
      [6, 'any', () => ({ visitType: 'emergency', setting: 'emergency', procs: [{ type: 'exam_plan' }, { type: 'closed_reduction' }], findings: [dx(pick(['Mandibular fracture', 'Dentoalveolar fracture']))], investigations: [{ kind: 'OPG' }] }), 'adult'],
      [4, 'any', () => ({ visitType: 'emergency', setting: 'emergency', procs: [{ type: 'tmj_reduction' }], findings: [dx('Anterior TMJ dislocation')] }), 'adult'],
      [5, 'late', () => ({ visitType: 'new', procs: [{ type: 'minor_oral_surgery', sites: [pick(['Upper anterior', 'Lower anterior', 'Upper ridge'])] }], findings: [dx(pick(['Periapical cyst', 'Irregular alveolar ridge']))] }), 'adult'],
      [1, 'late', () => ({ visitType: 'new', setting: 'theatre', procs: [{ type: 'cleft_repair', level: 2 }], findings: [dx('Unilateral cleft lip')] }), 'inpatient'],
      [2, 'late', () => ({ visitType: 'new', setting: 'theatre', procs: [{ type: 'open_reduction' }], findings: [dx('Displaced mandibular fracture')], investigations: [{ kind: 'OPG' }] }), 'inpatient'],
      [6, 'any', () => ({ visitType: 'continuing', setting: 'ward', procs: [{ type: 'venepuncture' }] }), 'inpatient'],
      [1, 'late', () => ({ visitType: 'emergency', setting: 'ward', procs: [{ type: 'resuscitation', level: 2 }] }), 'inpatient'],
    ];
    for (const [count, bias, spec, kind] of omfScheduled) {
      for (const d of scheduleDays(omf, count, bias)) {
        const s = spec();
        const p = kind === 'inpatient' ? newPatient(d, 'adult', true) : s.visitType === 'review' ? returningPatient('OMF') ?? newPatient(d, 'adult') : newPatient(d, 'adult');
        addEncounter(d, omf, p, s);
      }
    }
    for (const d of workingDays(omf)) {
      const wd = weekday(d);
      if (wd === 3) addActivity(d, omf, 'diagnostic_session', { title: pick(['Histopathology bench', 'Microbiology lab', 'Radiology reporting']) });
      if (wd === 1) addActivity(d, omf, 'ward_theatre', { title: pick(['Theatre list', 'Ward round', 'Theatre: major case']) });
      if (wd === 2) addActivity(d, omf, 'cpd', { title: pick(['Journal club', 'Departmental CME', 'Radiology interpretation session']) });
    }
    for (const d of scheduleDays(omf, 12)) addActivity(addDays(d, chance(0.4) ? (weekday(d) === 4 ? 1 : 0) : 0), omf, 'emergency_call', { title: 'Casualty call' });
    for (const d of scheduleDays(omf, 5, 'late')) addActivity(d, omf, 'postmortem', { title: 'Postmortem examination' }, 1);
    for (const d of scheduleDays(omf, 3, 'late')) addActivity(d, omf, 'case_presentation', { title: pick(['Case presentation: mandibular fracture', 'Case presentation: oral leukoplakia', 'Case presentation: fascial space infection']) });
  }

  // ======================================================================== PAED
  const paed = rotations[1]!;
  {
    const ramp = (d: ISODate) => 0.6 + 0.4 * Math.min(1, rotationProgress(paed, d) * 2.5);
    for (const d of workingDays(paed)) {
      if (leave.has(d)) continue;
      const n = poisson(4.9 * ramp(d));
      for (let i = 0; i < n; i++) {
        const isReturn = chance(0.3);
        const p = (isReturn ? returningPatient('PAED') : null) ?? newPatient(d, chance(0.03) ? 'teen-edge' : 'child');
        const kind = weighted<string>([
          ['prevent', 34], ['extraction', 18], ['restoration', 20], ['pulpotomy', 8], ['pulpectomy', 7], ['sdf', 6], ['ohe', 7],
        ]);
        const visitType: VisitType = isReturn ? 'continuing' : 'new';
        const base: ProcSpec[] = isReturn ? [] : [{ type: 'exam_plan' }];
        const t = pick(PRIMARY_MOLARS);
        switch (kind) {
          case 'prevent':
            addEncounter(d, paed, p, {
              visitType,
              procs: [...base, { type: 'behaviour_ohe' }, { type: 'fissure_sealant', sites: [pick(FIRST_MOLARS), pick(FIRST_MOLARS)].filter((x, j, a) => a.indexOf(x) === j) }, { type: 'fluoride' }],
              findings: [dx(pick(['Caries risk: high', 'Deep fissures, caries-free', 'Early enamel caries']))],
            });
            break;
          case 'extraction':
            addEncounter(d, paed, p, {
              visitType,
              procs: [...base, { type: 'extraction', sites: [chance(0.7) ? t : pick(PRIMARY_ANTERIOR)] }],
              findings: [dx(pick(['Over-retained primary tooth', 'Grossly carious primary molar', 'Dentoalveolar abscess']), t)],
              investigations: chance(0.25) ? [{ kind: 'IOPA', site: t }] : [],
            });
            break;
          case 'restoration':
            addEncounter(d, paed, p, {
              visitType,
              procs: [...base, { type: chance(0.55) ? 'gic' : 'composite', sites: chance(0.25) ? [t, pick(PRIMARY_MOLARS.filter((x) => x !== t))] : [t] }],
              findings: [dx('Dental caries', t)],
            });
            break;
          case 'pulpotomy':
            addEncounter(d, paed, p, { visitType, procs: [...base, { type: 'pulpotomy', sites: [t] }], findings: [dx('Reversible pulpitis, primary molar', t)], investigations: [{ kind: 'IOPA', site: t }] });
            break;
          case 'pulpectomy':
            addEncounter(d, paed, p, { visitType, procs: [...base, { type: 'pulpectomy', sites: [t] }], findings: [dx('Irreversible pulpitis, primary molar', t)], investigations: [{ kind: 'IOPA', site: t }] });
            break;
          case 'sdf':
            addEncounter(d, paed, p, { visitType, procs: [...base, { type: 'sdf' }, { type: 'behaviour_ohe' }], findings: [dx('Early childhood caries')] });
            break;
          default:
            addEncounter(d, paed, p, { visitType, procs: [...base, { type: 'behaviour_ohe' }], findings: [dx(pick(['Dental anxiety', 'High sugar diet']))] });
        }
      }
    }
    const paedScheduled: [number, 'any' | 'late', () => EncSpec][] = [
      [6, 'any', () => ({ visitType: 'new', procs: [{ type: 'fluorosis_mgmt', sites: ['Upper anteriors'] }], findings: [dx('Dental fluorosis')] })],
      [4, 'late', () => { const t = pick(PRIMARY_MOLARS); return { visitType: 'continuing', procs: [{ type: 'paed_crown', sites: [t] }], findings: [dx('Extensive caries, primary molar', t)] }; }],
      [5, 'any', () => ({ visitType: 'emergency', setting: 'emergency', procs: [{ type: 'dental_trauma', sites: ['Upper incisors'] }], findings: [dx(pick(['Enamel-dentine fracture 11', 'Luxation injury', 'Avulsed 21']))], investigations: [{ kind: 'IOPA' }] })],
      [1, 'late', () => ({ visitType: 'new', setting: 'theatre', procs: [{ type: 'ga_case', level: 3 }], findings: [dx('Severe early childhood caries')] })],
      [3, 'any', () => ({ visitType: 'new', procs: [{ type: 'ortho_assessment' }], findings: [dx(pick(['Class II div 1 malocclusion', 'Anterior crossbite']))], investigations: [{ kind: 'OPG' }] })],
      [1, 'late', () => ({ visitType: 'continuing', procs: [{ type: 'space_maintainer', sites: ['75'] }] })],
      [2, 'any', () => ({ visitType: 'new', procs: [{ type: 'mouthguard' }] })],
    ];
    for (const [count, bias, spec] of paedScheduled) {
      for (const d of scheduleDays(paed, count, bias)) addEncounter(d, paed, newPatient(d, 'child'), spec());
    }
    for (const d of workingDays(paed)) {
      if (weekday(d) === 2) addActivity(d, paed, 'cpd', { title: pick(['Paediatric CME', 'Orthodontic case conference', 'Journal club']) });
    }
    for (const d of scheduleDays(paed, 2, 'late')) addActivity(d, paed, 'case_presentation', { title: 'Case presentation: early childhood caries' });
    for (const d of scheduleDays(paed, 2)) addActivity(d, paed, 'ward_theatre', { title: 'Paediatric GA theatre list' });
  }

  // ======================================================================== PER
  const per = rotations[2]!;
  {
    const ramp = (d: ISODate) => 0.6 + 0.4 * Math.min(1, rotationProgress(per, d) * 2.5);
    for (const d of workingDays(per)) {
      if (leave.has(d)) continue;
      const n = poisson(3.7 * ramp(d));
      for (let i = 0; i < n; i++) {
        const isReturn = chance(0.35);
        const p = (isReturn ? returningPatient('PER') : null) ?? newPatient(d, 'adult');
        const kind = weighted<string>([['new', 45], ['maintenance', 25], ['rsd', 20], ['occlusal', 4], ['splint', 3]]);
        const diagnosis = dx(pick(['Chronic gingivitis', 'Stage II periodontitis', 'Stage III periodontitis', 'Drug-influenced gingival enlargement', 'Necrotising gingivitis']));
        if (kind === 'new' || !isReturn) {
          addEncounter(d, per, p, { visitType: 'new', procs: [{ type: 'exam_plan' }, { type: 'scaling_polishing' }], findings: [diagnosis], investigations: chance(0.2) ? [{ kind: 'OPG' }] : chance(0.1) ? [{ kind: 'Blood sugar' }] : [] });
        } else if (kind === 'maintenance') {
          addEncounter(d, per, p, { visitType: 'review', procs: [{ type: 'perio_maintenance' }, { type: 'scaling_polishing' }], findings: [diagnosis] });
        } else if (kind === 'rsd') {
          addEncounter(d, per, p, { visitType: 'continuing', procs: [{ type: 'root_planing' }], findings: [diagnosis] });
        } else if (kind === 'occlusal') {
          addEncounter(d, per, p, { visitType: 'continuing', procs: [{ type: 'occlusal_adjustment' }] });
        } else {
          addEncounter(d, per, p, { visitType: 'continuing', procs: [{ type: 'perio_splint', sites: ['Lower anteriors'] }], findings: [dx('Mobile lower incisors')] });
        }
      }
    }
    const perScheduled: [number, 'any' | 'late', () => EncSpec][] = [
      [5, 'late', () => ({ visitType: 'continuing', procs: [{ type: 'gingivectomy', sites: [pick(['Upper anterior gingiva', 'Lower labial frenum'])] }], findings: [dx(pick(['Gingival enlargement', 'High frenal attachment']))] })],
      [4, 'late', () => ({ visitType: 'continuing', procs: [{ type: 'perio_surgery', sites: ['Lower right sextant'], level: chance(0.5) ? 1 : 2 }], findings: [dx('Stage III periodontitis')] })],
      [2, 'late', () => ({ visitType: 'continuing', procs: [{ type: 'implant_team', level: 2 }] })],
      // Exposure outside the rotation's codes (R1): recorded, not counted.
      [3, 'any', () => { const t = pick(ADULT_POSTERIOR); return { visitType: 'new', procs: [{ type: 'extraction', sites: [t] }], findings: [dx('Periodontally hopeless tooth', t)] }; }],
    ];
    for (const [count, bias, spec] of perScheduled) {
      for (const d of scheduleDays(per, count, bias)) addEncounter(d, per, newPatient(d, 'adult'), spec());
    }
    for (const d of workingDays(per)) if (weekday(d) === 2) addActivity(d, per, 'cpd', { title: pick(['Periodontal case conference', 'Journal club', 'Departmental CME']) });
    for (const d of scheduleDays(per, 2, 'late')) addActivity(d, per, 'case_presentation', { title: 'Case presentation: periodontitis with diabetes' });
  }

  // ======================================================================== CONS
  const cons = rotations[3]!;
  {
    type Course = { patient: Patient; type: 'rct' | 'crown_bridge'; tooth: string; stage: number; due: ISODate };
    const courses: Course[] = [];
    const ramp = (d: ISODate) => 0.6 + 0.4 * Math.min(1, rotationProgress(cons, d) * 2.5);
    const consDays = workingDays(cons);
    const rctStartDays = new Set(scheduleDays(cons, 19, 'any').slice(0, 19));
    const crownStartDays = new Set(scheduleDays(cons, 5, 'late'));
    for (const d of consDays) {
      // Continue due multi-visit courses first (85% attend on time; others slip a week).
      for (const c of courses.filter((x) => x.due <= d && x.stage > 0)) {
        if (!chance(0.85)) {
          c.due = addDays(c.due, 7);
          continue;
        }
        const stages = c.type === 'rct' ? 3 : 2;
        addEncounter(d, cons, c.patient, {
          visitType: 'continuing',
          procs: [{ type: c.type, sites: [c.tooth], stage: c.stage }],
          investigations: c.type === 'rct' && c.stage === 3 ? [{ kind: 'IOPA', site: c.tooth }] : [],
        });
        c.stage = c.stage >= stages ? 0 : c.stage + 1;
        c.due = addDays(d, int(6, 12));
      }
      if (leave.has(d)) continue;
      if (rctStartDays.has(d)) {
        const p = newPatient(d, 'adult');
        const tooth = chance(0.6) ? pick(ADULT_POSTERIOR) : pick(ADULT_ANTERIOR);
        addEncounter(d, cons, p, {
          visitType: 'new',
          procs: [{ type: 'exam_plan' }, { type: 'rct', sites: [tooth], stage: 1 }],
          findings: [dx(pick(['Irreversible pulpitis', 'Pulp necrosis', 'Chronic apical periodontitis']), tooth)],
          investigations: [{ kind: 'IOPA', site: tooth }],
        });
        courses.push({ patient: p, type: 'rct', tooth, stage: 2, due: addDays(d, int(6, 12)) });
      }
      if (crownStartDays.has(d)) {
        const p = newPatient(d, 'adult');
        const tooth = pick([...ADULT_POSTERIOR.slice(0, 6), '11', '21']);
        addEncounter(d, cons, p, { visitType: 'continuing', procs: [{ type: 'crown_bridge', sites: [tooth], stage: 1 }], findings: [dx('Root-filled tooth requiring cuspal coverage', tooth)] });
        courses.push({ patient: p, type: 'crown_bridge', tooth, stage: 2, due: addDays(d, int(8, 14)) });
      }
      const n = poisson(4.4 * ramp(d));
      for (let i = 0; i < n; i++) {
        const p = (chance(0.3) ? returningPatient('CONS') : null) ?? newPatient(d, 'adult');
        const kind = weighted<string>([['post', 40], ['ant', 13], ['amalgam', 13], ['gic', 6], ['exam', 15], ['denture', 9], ['implant', 0.6]]);
        const post = pick(ADULT_POSTERIOR);
        const ant = pick(ADULT_ANTERIOR);
        switch (kind) {
          case 'post':
            addEncounter(d, cons, p, { visitType: 'continuing', procs: [{ type: 'composite', sites: chance(0.2) ? [post, pick(ADULT_POSTERIOR.filter((x) => x !== post))] : [post] }], findings: [dx('Dental caries', post)] });
            break;
          case 'ant':
            addEncounter(d, cons, p, { visitType: 'continuing', procs: [{ type: 'composite', sites: [ant] }], findings: [dx(pick(['Dental caries', 'Fractured incisal edge', 'Cervical abrasion']), ant)] });
            break;
          case 'amalgam':
            addEncounter(d, cons, p, { visitType: 'continuing', procs: [{ type: 'amalgam', sites: [post] }], findings: [dx('Dental caries', post)] });
            break;
          case 'gic':
            addEncounter(d, cons, p, { visitType: 'continuing', procs: [{ type: 'gic', sites: [chance(0.5) ? post : ant] }], findings: [dx('Cervical caries')] });
            break;
          case 'exam':
            addEncounter(d, cons, p, { visitType: 'new', procs: [{ type: 'exam_plan' }], findings: [dx(pick(['Multiple carious lesions', 'Partially dentate maxilla', 'Edentulous', 'Tooth wear']))], investigations: chance(0.4) ? [{ kind: 'Bitewing' }] : [] });
            break;
          case 'denture':
            addEncounter(d, cons, p, { visitType: 'continuing', procs: [{ type: weighted([['partial_denture', 5], ['complete_denture', 3], ['denture_repair', 2]]) }], findings: [dx(pick(['Partially dentate', 'Edentulous']))] });
            break;
          default:
            addEncounter(d, cons, p, { visitType: 'continuing', procs: [{ type: 'implant_team', level: 2 }] });
        }
      }
    }
    for (const d of workingDays(cons)) if (weekday(d) === 2) addActivity(d, cons, 'cpd', { title: pick(['Restorative CME', 'Journal club', 'Clinicopathological conference']) });
    for (const d of scheduleDays(cons, 7)) addActivity(d, cons, 'case_presentation', { title: pick(['Grand round: failed RCT', 'CPC: radiolucent lesion', 'Case presentation: tooth wear']) });
    for (const d of scheduleDays(cons, 1, 'late')) addEncounter(d, cons, newPatient(d, 'adult'), { visitType: 'continuing', procs: [{ type: 'implant_team', level: 2 }] });
  }

  // ======================================================================== COMM
  const comm = rotations[4]!;
  {
    const weekStart = (w: number) => addDays(comm.startsOn, (w - 1) * 7);
    // 5.7.4 activities: fixed plan over the 8 weeks; the last one falls after asOf.
    const itemPlan: [number, number, number][] = [
      [1, 1, 1], [2, 1, 3], [3, 2, 1], [4, 2, 3], [5, 3, 1], [6, 3, 2], [7, 3, 3], [8, 4, 1],
      [9, 4, 2], [10, 4, 3], [11, 5, 1], [12, 5, 3], [13, 6, 1], [14, 6, 3], [15, 7, 2], [16, 8, 4],
    ];
    const ITEM_TITLES: Record<number, string> = { 1: 'Primary school oral health talk', 2: 'Secondary school oral health talk', 6: 'Community outreach day' };
    for (const [item, week, day] of itemPlan) {
      const d = addDays(weekStart(week), day);
      if (d <= asOf) addActivity(d, comm, 'community_activity', { communityItem: item, title: ITEM_TITLES[item] });
    }
    // 5.7.5 case follow-ups: four steps per case, spaced over the rotation.
    const caseStarts: Record<string, number[]> = {
      diabetes: [1, 2], hypertension: [1, 3], cardiac: [2, 3], special_needs: [2, 4], hiv: [3, 4], tobacco: [1, 2, 3, 7], oral_cancer: [2, 6],
    };
    const steps = ['identification', 'genogram', 'home_visit', 'clinic_review'] as const;
    for (const [caseType, starts] of Object.entries(caseStarts)) {
      starts.forEach((week, slotIdx) => {
        let d = addDays(weekStart(week), int(0, 3));
        for (const step of steps) {
          if (d <= asOf) addActivity(d, comm, 'community_case_step', { caseType, caseSlot: slotIdx + 1, followUpStep: step });
          d = addDays(d, int(6, 10));
          while (isWeekend(d)) d = addDays(d, 1);
        }
      });
    }
    for (let w = 1; w <= 8; w++) {
      const d = addDays(weekStart(w), 4);
      if (d <= asOf) addActivity(d, comm, 'weekly_report', { weeklyReportNo: w, title: `Week ${w} community report` });
    }
    for (const d of scheduleDays(comm, 6)) {
      addEncounter(d, comm, newPatient(d, chance(0.5) ? 'child' : 'adult'), {
        visitType: 'new',
        setting: 'outreach',
        procs: [{ type: 'exam_plan' }],
        findings: [dx(pick(['Dental caries', 'Chronic gingivitis', 'Dental fluorosis']))],
        referredTo: chance(0.3) ? 'Dental clinic, Example County Referral Hospital' : undefined,
      });
    }
  }

  encounters.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''));
  activities.sort((a, b) => a.date.localeCompare(b.date));

  // ---------------------------------------------------------------- derive logbook entries
  const rules = DEFAULT_COUNTING_RULES;
  const patientById = new Map(patients.map((p) => [p.id, p]));
  const entries: LogbookEntry[] = [];
  for (const e of encounters) {
    const rot = rotationForDate(rotations, e.date);
    const patient = e.patientId ? patientById.get(e.patientId) ?? null : null;
    const d = deriveEncounter(e, { set, rules, rotation: rot?.rotation ?? null, patient });
    const rec = reconcileEntries(
      d.entries,
      [],
      { internshipId, rotationId: e.rotationId, performedOn: e.date, encounterId: e.id, patientRef: patient?.ref, supervisorId: e.supervisorId, status: 'submitted' },
      e.createdAt,
      () => idOn(e.date),
    );
    entries.push(...rec.create);
  }
  for (const a of activities) {
    const rot = rotationForDate(rotations, a.date);
    const d = deriveActivity(a, { set, rules, rotation: rot?.rotation ?? null });
    const rec = reconcileEntries(
      d.entries,
      [],
      { internshipId, rotationId: a.rotationId, performedOn: a.date, supervisorId: a.supervisorId, status: 'submitted' },
      a.createdAt,
      () => idOn(a.date),
    );
    entries.push(...rec.create);
  }

  // ---------------------------------------------------------------- supervisor verification
  type Decision = { entry: LogbookEntry; signedAt: string; decision: 'verified' | 'returned'; levelObserved?: Level; comment?: string; verifierId: ID };
  const decisions: Decision[] = [];
  const POSITIVE = ['Good technique and patient management.', 'Well done — confident handling.', 'Good case selection and documentation.', 'Sound clinical reasoning.'];
  const RETURN = ['Please confirm the tooth number against the chart.', 'Level seems high for this case — please review.', 'Date does not match the clinic list; please check.'];
  for (const entry of entries) {
    const age = daysBetween(entry.performedOn, asOf);
    if (age < 2 || !entry.supervisorId) continue; // too recent: still pending
    const r = rng();
    // Older entries are almost all signed; recent weeks have a realistic backlog.
    if (r < (age > 21 ? 0 : 0.12)) continue; // pending
    const delay = weighted([[0, 50], [1, 30], [2, 12], [4, 6], [9, 2]]);
    const signDate = addDays(entry.performedOn, Math.min(delay, age));
    const signedAt = stamp(signDate, int(15, 19), int(0, 59));
    if (r < (age > 30 ? 0.045 : 0.1)) {
      decisions.push({ entry, signedAt, decision: 'returned', comment: pick(RETURN), verifierId: entry.supervisorId });
      // Older returns were corrected and resubmitted, then verified; recent ones are still open.
      const fixedOn = addDays(signDate, int(2, 6));
      if (daysBetween(fixedOn, asOf) > 3) {
        decisions.push({ entry, signedAt: stamp(fixedOn, int(15, 19), int(0, 59)), decision: 'verified', levelObserved: entry.levelClaimed, verifierId: entry.supervisorId });
      }
      continue;
    }
    const adjust = entry.levelClaimed > 1 && chance(0.11);
    decisions.push({
      entry,
      signedAt,
      decision: 'verified',
      levelObserved: adjust ? ((entry.levelClaimed - 1) as Level) : entry.levelClaimed,
      comment: adjust ? 'Needed more guidance than recorded; level adjusted.' : chance(0.05) ? pick(POSITIVE) : undefined,
      verifierId: entry.supervisorId,
    });
  }
  decisions.sort((a, b) => a.signedAt.localeCompare(b.signedAt));
  const verifications: Verification[] = [];
  let prevHash: string | null = null;
  for (const dcs of decisions) {
    const v = createVerification(
      dcs.entry,
      { verifierId: dcs.verifierId, decision: dcs.decision, levelObserved: dcs.levelObserved, comment: dcs.comment, method: 'demo' },
      prevHash,
      dcs.signedAt,
      idOn(dcs.signedAt.slice(0, 10)),
    );
    verifications.push(v);
    prevHash = v.hash;
    dcs.entry.status = statusAfter(v);
    dcs.entry.updatedAt = dcs.signedAt;
  }

  // ---------------------------------------------------------------- reflection diary
  const reflections: Reflection[] = [];
  const addReflection = (date: ISODate, t: Omit<Reflection, 'id' | 'internshipId' | 'date' | 'createdAt' | 'updatedAt' | 'sharedWithSupervisor'>, encounterId?: ID) => {
    const createdAt = stamp(date, int(19, 22), int(0, 59));
    reflections.push({ ...t, id: idOn(date), internshipId, date, encounterId, sharedWithSupervisor: chance(0.3), createdAt, updatedAt: createdAt, deletedAt: null });
  };
  for (const r of rotations) {
    const pool = REFLECTION_TEMPLATES[r.rotation] ?? [];
    const days = workingDays(r);
    for (let w = 0; w * 5 < days.length; w++) {
      const week = days.slice(w * 5, w * 5 + 5);
      const n = chance(0.6) ? 2 : 1;
      for (let i = 0; i < n && pool.length; i++) {
        const d = pick(week);
        const t = pick(pool);
        const enc = encounters.find((e) => e.date === d && e.rotationId === r.id);
        addReflection(d, { ...t, tags: [...t.tags] }, enc?.id);
      }
    }
  }
  // Milestones on the first date the recorded data supports them.
  for (const m of MILESTONES) {
    const enc = encounters.find((e) => e.procedures.some((p) => p.procedureTypeId === m.procedure && p.level >= m.minLevel && (m.stage === undefined || p.stage === m.stage)));
    if (enc) addReflection(enc.date, { title: m.title, learned: m.learned, tags: ['milestone'] }, enc.id);
  }
  reflections.sort((a, b) => a.date.localeCompare(b.date));

  const dataset: Dataset = {
    requirementSet: set,
    rules,
    internship,
    rotations,
    patients,
    supervisors,
    encounters,
    activities,
    entries,
    verifications,
    reflections,
  };
  dataset.assessments = demoAssessments(dataset, asOf, { pick, int, idOn, stamp });
  return dataset;
}

/** Completed KMPDC forms for past meetings (fictional remarks), so the forms screen shows a realistic history. */
function demoAssessments(
  ds: Dataset,
  asOf: ISODate,
  h: { pick: <T>(a: readonly T[]) => T; int: (a: number, b: number) => number; idOn: (d: ISODate) => string; stamp: (d: ISODate, hh: number, mm: number) => string },
): Assessment[] {
  const ix = indexDataset(ds);
  const out: Assessment[] = [];
  const INTERN = {
    a1: ['Instruments adequate; occasional shortage of local anaesthetic cartridges.', 'Equipment generally available; one dental chair under repair for two weeks.'],
    a2: ['Supervisor available daily; consultants hold teaching sessions twice a week.', 'Good availability for consultation, especially during clinics.'],
    a3: ['Busy outpatient clinics; working hours 8am–5pm plus on-call duties.', 'Heavy but manageable workload.'],
    a4: ['Limited exposure to some procedures because of low case numbers.', 'Long queues in the clinic reduce time for complex cases.'],
    a5: ['Request allocation to theatre lists and booking of specific cases.', 'Schedule protected time for complex procedures.'],
  };
  const SUP = {
    b1: ['Punctual, diligent and keen to learn; good rapport with patients.', 'Performing well; improving confidence in procedures.'],
    b3: ['Needs more exposure to surgical cases.', 'Documentation of case notes can improve.'],
    b4: ['Allocate to additional theatre sessions.', 'Review case notes weekly with the supervisor.'],
  };
  const COORD = {
    c1: ['Satisfactory progress.', 'Good progress so far.'],
    c2: ['Case mix limits some codes.', 'None significant.'],
    c3: ['Supervisor to prioritise outstanding procedures.', 'Continue as planned.'],
  };
  for (const r of ds.rotations) {
    for (const f of assessmentSchedule(r)) {
      if (f.due > asOf) continue;
      const base: Assessment = {
        id: h.idOn(f.due),
        internshipId: ds.internship.id,
        rotationId: r.id,
        kind: f.kind,
        sequence: f.sequence,
        formVersion: FORMS_VERSION,
        responses: {},
        grades: {},
        gradeRemarks: {},
        createdAt: h.stamp(f.due, 14, 0),
        updatedAt: h.stamp(f.due, 15, 0),
        deletedAt: null,
      };
      if (f.kind === 'monthly') {
        base.heldOn = f.due;
        base.heldAt = '14:00';
        for (const [k, v] of Object.entries({ ...INTERN, ...SUP, ...COORD })) base.responses[k] = h.pick(v);
        base.responses.b2 = progressSummaryText(ix, r, f.due);
      } else if (f.kind === 'mid_rotation') {
        base.responses = {
          m1: 'Settling well into the rotation; keen to increase hands-on procedures.',
          m2: progressSummaryText(ix, r, f.due),
          m3: 'Progress satisfactory; continue with the agreed plan.',
        };
      } else if (f.kind === 'end_of_rotation') {
        for (const c of criteriaFor(r.rotation).flatMap((g) => g.criteria)) base.grades[c.id] = h.int(0, 3) === 0 ? 2 : 3;
        base.overallGrade = 3;
        base.recommendation = 'Has met the expectations of the rotation. Recommended to proceed.';
      } else {
        base.responses = { o1: 'Satisfactory performance throughout the rotation.', o2: 'Rotation requirements reviewed; satisfactory.' };
        base.outcome = 'completed';
      }
      if (f.kind !== 'overall_rotation') base.progressSnapshot = progressSnapshot(ix, r, f.due);
      out.push(base);
    }
  }
  return out;
}

export const DEMO_FACILITY = { id: 'facility-demo-ecrh', name: 'Example County Referral Hospital', county: 'Example County', facilityType: 'County referral hospital (fictional)' };
