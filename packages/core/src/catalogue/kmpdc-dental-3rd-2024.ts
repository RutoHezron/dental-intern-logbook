import type { Requirement, RequirementSet, UncodedCompetency } from '../types';

/**
 * KMPDC National Guidelines and Logbook for Dental Interns, 3rd edition (October 2024).
 *
 * Transcribed from the required-competence tables 5.3.3, 5.4.3, 5.5.3, 5.6.3 and
 * the community dentistry section 5.7. Known source issues are noted inline
 * (blueprint §1.9, G1–G12). This is configuration data: a new edition is a new
 * requirement set, not a code change.
 */

export const KMPDC_DENTAL_3_ID = 'kmpdc-dental-3rd-2024';

const r = (
  code: string,
  rotation: string,
  description: string,
  minCount: number,
  expectedLevel: Requirement['expectedLevel'],
  extra: Partial<Requirement> = {},
): Requirement => ({
  code,
  rotation,
  description,
  minCount,
  expectedLevel,
  printedRows: minCount,
  unitRule: 'per_tooth',
  needsPatient: true,
  ...extra,
});

const OMF: Requirement[] = [
  r('OMF 1', 'OMF', 'Oral diagnosis / treatment planning / case presentation', 200, 5, { unitRule: 'per_patient_visit' }),
  r('OMF 2', 'OMF', 'Dental extractions', 20, 5),
  r('OMF 3', 'OMF', 'Dry socket management', 5, 5),
  r('OMF 4', 'OMF', 'Suturing oro-facial cuts', 10, 5, { unitRule: 'per_patient_visit' }),
  r('OMF 5', 'OMF', 'Change of dressing', 5, 5, { unitRule: 'per_patient_visit' }),
  r('OMF 6', 'OMF', 'Management of bleeding sockets', 5, 5),
  r('OMF 7', 'OMF', 'Incision and drainage', 5, 5, { unitRule: 'per_patient_visit' }),
  r('OMF 8', 'OMF', 'Intermaxillary fixation', 3, 4, { unitRule: 'per_patient_visit' }),
  r('OMF 9', 'OMF', 'Surgical removal of teeth', 10, 3),
  r('OMF 10', 'OMF', 'Diagnostic rotation: pathology, microbiology, radiology', 10, 3, {
    unitRule: 'per_session',
    needsPatient: false,
    notes: 'Not patient-specific (G8).',
  }),
  r('OMF 11', 'OMF', 'Incision and excision biopsy', 10, 3, { unitRule: 'per_patient_visit' }),
  r('OMF 12', 'OMF', 'Closed reduction of jaw fractures', 5, 3, { unitRule: 'per_patient_visit' }),
  r('OMF 13', 'OMF', 'Management of TMJ dislocations', 4, 3, { unitRule: 'per_patient_visit' }),
  r('OMF 14', 'OMF', 'Surgery under local anaesthesia: apicectomy, alveoloplasty', 5, 3, { unitRule: 'per_patient_visit' }),
  r('OMF 15', 'OMF', 'Repair of cleft lip and palate', 2, 3, { unitRule: 'per_patient_visit' }),
  r('OMF 16', 'OMF', 'Open reduction of jaw fractures', 3, 3, { unitRule: 'per_patient_visit' }),
  r('OMF 17', 'OMF', 'Care of in-patients and theatre routine', 10, 5, {
    unitRule: 'per_session',
    needsPatient: false,
    notes: 'Unit of count undefined in source (Q13); default: one per session.',
  }),
  r('OMF 18', 'OMF', 'Casualty and emergency care calls', 10, 5, {
    unitRule: 'per_session',
    needsPatient: false,
    notes: 'Unit of count undefined in source (Q13); default: one per call.',
  }),
  r('OMF 19', 'OMF', 'Postmortem examination', 5, 1, { unitRule: 'per_session', needsPatient: false }),
];

const PAED: Requirement[] = [
  r('PAED 1', 'PAED', 'Behaviour management, diet counselling, phobia management, oral health education', 20, 5, {
    unitRule: 'per_patient_visit',
  }),
  r('PAED 2', 'PAED', 'Extractions', 20, 5),
  r('PAED 3', 'PAED', 'Management of dental fluorosis', 5, 5, {
    unitRule: 'per_patient_visit',
    notes: 'What qualifies is undefined in source (Q14).',
  }),
  r('PAED 4', 'PAED', 'Pulpotomy procedures', 10, 5),
  r('PAED 5', 'PAED', 'Pulpectomy procedures', 10, 5),
  r('PAED 6', 'PAED', 'Restorations: composites, glass ionomer cement (GIC)', 20, 5),
  r('PAED 7', 'PAED', 'Preventive procedures: SDF, fissure sealants, fluoride treatments, mouth guards', 80, 5, {
    unitRule: 'per_patient_visit',
    notes: 'Four procedures pooled in one count; unit undefined in source (Q5).',
  }),
  r('PAED 8', 'PAED', 'Paediatric crowns: stainless steel, zirconia', 5, 4),
  r('PAED 9', 'PAED', 'Emergency treatment of traumatised teeth', 5, 3, { unitRule: 'per_patient_visit' }),
  r('PAED 10', 'PAED', 'Management of paediatric cases under general anaesthesia', 1, 3, { unitRule: 'per_patient_visit' }),
];

const PER: Requirement[] = [
  r('PER 01', 'PER', 'Diagnosis / treatment planning / periodontal maintenance / counselling and follow up', 50, 5, {
    unitRule: 'per_patient_visit',
  }),
  r('PER 02', 'PER', 'Management of periodontal disease in patients with systemic disease', 10, 5, {
    unitRule: 'per_patient_visit',
    notes: 'Overlap with PER 01/03 undefined in source (Q7).',
  }),
  r('PER 03', 'PER', 'Non-surgical periodontal procedures (scaling and polishing, occlusal adjustment, root planing, splinting)', 50, 5, {
    unitRule: 'per_patient_visit',
  }),
  r('PER 04', 'PER', 'Surgical periodontal procedures: gingivectomy, gingivoplasty, frenectomy', 5, 5, { unitRule: 'per_patient_visit' }),
  r('PER 05', 'PER', 'Periodontal flap, osseous and mucogingival surgery, gingival grafting', 5, 2, { unitRule: 'per_patient_visit' }),
  r('PER 06', 'PER', 'Implant dentistry team', 2, 2, { unitRule: 'per_patient_visit' }),
];

const CONS: Requirement[] = [
  r('CONS 01', 'CONS', 'Tooth-coloured restorations, posterior teeth', 60, 5),
  r('CONS 02', 'CONS', 'Tooth-coloured restorations, anterior teeth', 20, 5, {
    notes: 'Log heading in the paper book says "posterior" — treated as anterior (G4).',
  }),
  r('CONS 03', 'CONS', 'Endodontic procedures (anterior and posterior)', 20, 5, {
    unitRule: 'per_case_completion',
    notes: 'Counted once per tooth at obturation (default rule R4, Q5).',
  }),
  r('CONS 04', 'CONS', 'Crown and bridge work', 5, 5, {
    unitRule: 'per_case_completion',
    notes: 'Counted at cementation (default rule R4).',
  }),
  r('CONS 05', 'CONS', 'Participation in implant dentistry team', 2, 2, { unitRule: 'per_patient_visit' }),
  r('CONS 06', 'CONS', 'Amalgam restorations', 20, 5),
  r('CONS 07', 'CONS', 'Presentation of cases in clinicopathological-radiological conferences, grand rounds, etc.', 10, 5, {
    unitRule: 'per_activity',
    needsPatient: false,
    printedRows: 0,
    notes: 'No log rows printed in the book; logged as an activity with an addendum page (G3).',
  }),
];

/** 5.7.4 Log of community dentistry activities: 16 rows, each dated and signed. Expected level 4 (5.7.3). */
export const COMMUNITY_ITEMS: string[] = [
  'Primary school talk on oral health',
  'Secondary school talk on oral health',
  'Community talk on oral health',
  'Community talk on child nutrition and oral health',
  'Community talk on tobacco use and its impact on oral health',
  'Community outreach activity',
  'Child nutrition education and oral assessment of children under 5 at Level 2 or 3 facility',
  'Child nutrition education and oral assessment of children under 5 at Level 2 or 3 facility (second)',
  'Oral health education to pregnant mothers at the ANC in Level 2 or 3 facility',
  'Oral health education to adults in Level 2 or 3 facility',
  'Child nutrition education and oral assessment of children under 5 in the ITC',
  'Child nutrition education and oral assessment of children under 5 in the ITC (second)',
  'Oral health education to pregnant mothers at the ANC in the ITC',
  'Oral health education to adult inpatients in the ITC',
  'Attend HMT meeting',
  'Attend CHMT/SCHMT meeting',
];

/** 5.7.5 Case follow-up for oral manifestations in systemic illness. Each case has four signed steps. */
export const COMMUNITY_CASE_TYPES: { id: string; abbr: string; name: string; cases: number }[] = [
  { id: 'diabetes', abbr: 'DM', name: 'Diabetes', cases: 2 },
  { id: 'hypertension', abbr: 'HTN', name: 'Hypertension', cases: 2 },
  { id: 'cardiac', abbr: 'CARD', name: 'Cardiac disease', cases: 2 },
  { id: 'special_needs', abbr: 'SN', name: 'Child with special needs', cases: 2 },
  { id: 'hiv', abbr: 'HIV', name: 'HIV', cases: 2 },
  { id: 'tobacco', abbr: 'TOB', name: 'Smoking and tobacco use', cases: 4 },
  { id: 'oral_cancer', abbr: 'OC', name: 'Oral cancer', cases: 2 },
];

export const FOLLOW_UP_STEPS = [
  { id: 'identification', name: 'Case identification' },
  { id: 'genogram', name: 'Genogram / family tree' },
  { id: 'home_visit', name: 'Home visitation and report' },
  { id: 'clinic_review', name: 'Follow-up during hospital/clinic review' },
] as const;

export const communityItemCode = (item: number) => `COMM A${String(item).padStart(2, '0')}`;
export const communityCaseCode = (caseType: string) =>
  `COMM C-${COMMUNITY_CASE_TYPES.find((c) => c.id === caseType)?.abbr ?? caseType.toUpperCase()}`;
export const COMMUNITY_WEEKLY_REPORT_CODE = 'COMM W';

const COMM: Requirement[] = [
  ...COMMUNITY_ITEMS.map((description, i) =>
    r(communityItemCode(i + 1), 'COMM', description, 1, 4, {
      unitRule: 'per_activity',
      needsPatient: false,
      group: 'Community activities (5.7.4)',
      notes: i === 7 || i === 11 ? 'Repeats the previous row in the source; read as "do this twice".' : undefined,
    }),
  ),
  ...COMMUNITY_CASE_TYPES.map((c) =>
    r(communityCaseCode(c.id), 'COMM', `Case follow-up: ${c.name} (${c.cases} cases × 4 steps)`, c.cases * 4, 4, {
      unitRule: 'per_activity',
      needsPatient: false,
      group: 'Case follow-up (5.7.5)',
      notes: 'No patient column in the source: case type and slot only, never linked to a patient.',
    }),
  ),
  r(COMMUNITY_WEEKLY_REPORT_CODE, 'COMM', 'Weekly reports on community dentistry activities', 8, 4, {
    unitRule: 'per_activity',
    needsPatient: false,
    group: 'Weekly reports (5.7.6)',
  }),
];

const UNCODED: UncodedCompetency[] = [
  { code: 'ORTHO-1', area: 'Orthodontics', description: 'Orthodontic case assessment; design, construction, delivery, follow-up and activation of appliances', source: '4.4.2 a' },
  { code: 'ORTHO-2', area: 'Orthodontics', description: 'Space maintainers', source: '4.4.2 b' },
  { code: 'ORTHO-3', area: 'Orthodontics', description: 'Functional appliances', source: '4.4.2 c' },
  { code: 'PROS-1', area: 'Prosthodontics', description: 'Diagnosis and treatment of partially dentate and edentulous patients', source: '4.6.2 a' },
  { code: 'PROS-2', area: 'Prosthodontics', description: 'Provision of partial and complete dentures', source: '4.6.2 b' },
  { code: 'PROS-3', area: 'Prosthodontics', description: 'Immediate dentures, denture repairs and relines', source: '4.6.2 c' },
  { code: 'GEN-1', area: 'General', description: 'Venepuncture and intravenous infusion', source: '4.2 i' },
  { code: 'GEN-2', area: 'General', description: 'Resuscitation, intubation and life support', source: '4.2 i' },
  { code: 'GEN-3', area: 'General', description: 'Obtain and record informed consent', source: '4.2 n' },
  { code: 'GEN-4', area: 'General', description: 'Continuing professional development (CPD), research and innovation', source: '4.2 p' },
];

export const KMPDC_DENTAL_3: RequirementSet = {
  id: KMPDC_DENTAL_3_ID,
  issuer: 'KMPDC',
  title: 'National Guidelines and Logbook for Dental Interns',
  edition: '3rd edition, October 2024',
  effectiveFrom: '2024-10-01',
  rotations: [
    { code: 'OMF', name: 'Oral and Maxillofacial Surgery', weeks: 11, section: '5.3' },
    { code: 'PAED', name: 'Paediatric Dentistry and Orthodontics', weeks: 11, section: '5.4' },
    { code: 'PER', name: 'Periodontology', weeks: 11, section: '5.5' },
    { code: 'CONS', name: 'Prosthodontics and Conservative Dentistry', weeks: 11, section: '5.6' },
    { code: 'COMM', name: 'Community Dentistry', weeks: 8, section: '5.7' },
  ],
  requirements: [...OMF, ...PAED, ...PER, ...CONS, ...COMM],
  uncoded: UNCODED,
};
