import type { ActivityType, CodeMapping, MappingCondition, ProcedureType } from '../types';
import { communityCaseCode, communityItemCode, COMMUNITY_WEEKLY_REPORT_CODE } from './kmpdc-dental-3rd-2024';

/**
 * Procedure catalogue with KMPDC mapping rules (blueprint §12.1).
 *
 * Mappings are ordered: the first one whose condition matches wins, so a single
 * procedure never counts under two codes (rule R6). Paediatric mappings come
 * first and carry the under-17 condition (rule R7, KMPDC 4.4.1).
 */

const PAED_AGE: MappingCondition = { rotation: 'PAED', maxAgeExclusive: 17 };

const m = (requirementCode: string, when: MappingCondition, rule: string): CodeMapping => ({ requirementCode, when, rule });

const p = (
  id: string,
  name: string,
  shortName: string,
  category: ProcedureType['category'],
  siteKind: ProcedureType['siteKind'],
  typicalRotations: string[],
  mappings: CodeMapping[],
  extra: Partial<ProcedureType> = {},
): ProcedureType => ({ id, name, shortName, category, siteKind, stages: 1, typicalRotations, mappings, ...extra });

export const PROCEDURE_TYPES: ProcedureType[] = [
  // ---- Diagnosis and planning ------------------------------------------------
  p('exam_plan', 'Examination, diagnosis & treatment plan', 'Exam + plan', 'diagnosis', 'none', ['OMF', 'PAED', 'PER', 'CONS'], [
    m('OMF 1', { rotation: 'OMF', requiresDiagnosis: true }, 'R5 one per patient visit with diagnosis'),
    m('PER 01', { rotation: 'PER' }, 'R5 one per patient visit'),
  ], { keywords: ['examination', 'assessment', 'diagnosis', 'consultation', 'opd'] }),
  p('perio_maintenance', 'Periodontal maintenance, counselling or follow-up visit', 'Perio review', 'periodontal', 'none', ['PER'], [
    m('PER 01', { rotation: 'PER' }, 'R5 one per patient visit'),
  ], { keywords: ['maintenance', 'counselling', 'follow up', 'review'] }),

  // ---- Oral surgery ----------------------------------------------------------
  p('extraction', 'Extraction (forceps / elevator)', 'Extraction', 'oral_surgery', 'tooth', ['OMF', 'PAED'], [
    m('PAED 2', PAED_AGE, 'R7 under 17 · R3 per tooth'),
    m('OMF 2', { rotation: 'OMF' }, 'R3 per tooth'),
  ], { keywords: ['exo', 'xla', 'tooth removal'] }),
  p('surgical_extraction', 'Surgical extraction (flap, bone removal or sectioning)', 'Surgical XLA', 'oral_surgery', 'tooth', ['OMF'], [
    m('OMF 9', { rotation: 'OMF' }, 'R3 per tooth'),
  ], { keywords: ['disimpaction', 'third molar', 'odontectomy', 'retained root'] }),
  p('dry_socket', 'Dry socket (alveolar osteitis) management', 'Dry socket', 'oral_surgery', 'tooth', ['OMF'], [
    m('OMF 3', { rotation: 'OMF' }, 'R3 per tooth'),
  ], { keywords: ['alvogyl', 'alveolar osteitis'] }),
  p('suturing', 'Suturing of oro-facial laceration', 'Suturing', 'oral_surgery', 'region', ['OMF'], [
    m('OMF 4', { rotation: 'OMF' }, 'R5 per patient visit'),
  ], { keywords: ['laceration', 'cut', 'soft tissue'] }),
  p('dressing_change', 'Change of dressing', 'Dressing', 'oral_surgery', 'region', ['OMF'], [
    m('OMF 5', { rotation: 'OMF' }, 'R5 per patient visit'),
  ]),
  p('bleeding_socket', 'Management of bleeding socket', 'Bleeding socket', 'oral_surgery', 'tooth', ['OMF'], [
    m('OMF 6', { rotation: 'OMF' }, 'R3 per tooth'),
  ], { keywords: ['haemostasis', 'post extraction bleeding'] }),
  p('incision_drainage', 'Incision and drainage', 'I & D', 'oral_surgery', 'region', ['OMF'], [
    m('OMF 7', { rotation: 'OMF' }, 'R5 per patient visit'),
  ], { keywords: ['abscess', 'cellulitis', 'drainage'] }),
  p('imf', 'Intermaxillary fixation', 'IMF', 'oral_surgery', 'none', ['OMF'], [
    m('OMF 8', { rotation: 'OMF' }, 'R5 per patient visit'),
  ], { keywords: ['arch bars', 'eyelet wiring'] }),
  p('biopsy', 'Incisional or excisional biopsy', 'Biopsy', 'oral_surgery', 'region', ['OMF'], [
    m('OMF 11', { rotation: 'OMF' }, 'R5 per patient visit'),
  ]),
  p('closed_reduction', 'Closed reduction of jaw fracture', 'Closed reduction', 'oral_surgery', 'none', ['OMF'], [
    m('OMF 12', { rotation: 'OMF' }, 'R5 per patient visit'),
  ], { keywords: ['fracture', 'mandible'] }),
  p('tmj_reduction', 'Reduction of TMJ dislocation', 'TMJ reduction', 'oral_surgery', 'none', ['OMF'], [
    m('OMF 13', { rotation: 'OMF' }, 'R5 per patient visit'),
  ]),
  p('minor_oral_surgery', 'Apicectomy or alveoloplasty under LA', 'Apicectomy / alveoloplasty', 'oral_surgery', 'region', ['OMF'], [
    m('OMF 14', { rotation: 'OMF' }, 'R5 per patient visit'),
  ]),
  p('cleft_repair', 'Cleft lip / palate repair', 'Cleft repair', 'oral_surgery', 'none', ['OMF'], [
    m('OMF 15', { rotation: 'OMF' }, 'R5 per patient visit'),
  ], { keywords: ['cheiloplasty', 'palatoplasty', 'theatre'] }),
  p('open_reduction', 'Open reduction of jaw fracture (ORIF)', 'ORIF', 'oral_surgery', 'none', ['OMF'], [
    m('OMF 16', { rotation: 'OMF' }, 'R5 per patient visit'),
  ], { keywords: ['plating', 'fracture', 'theatre'] }),

  // ---- Paediatric and preventive -------------------------------------------
  p('behaviour_ohe', 'Behaviour management, diet counselling or oral health education', 'Behaviour / OHE', 'paediatric', 'none', ['PAED'], [
    m('PAED 1', PAED_AGE, 'R7 under 17 · per patient visit'),
  ], { keywords: ['tell show do', 'diet', 'phobia', 'ohi', 'education'] }),
  p('fluorosis_mgmt', 'Management of dental fluorosis', 'Fluorosis', 'paediatric', 'region', ['PAED'], [
    m('PAED 3', PAED_AGE, 'R7 under 17 · per patient visit'),
  ], { keywords: ['microabrasion', 'bleaching', 'staining'] }),
  p('pulpotomy', 'Pulpotomy', 'Pulpotomy', 'paediatric', 'tooth', ['PAED'], [
    m('PAED 4', PAED_AGE, 'R7 under 17 · R3 per tooth'),
  ]),
  p('pulpectomy', 'Pulpectomy', 'Pulpectomy', 'paediatric', 'tooth', ['PAED'], [
    m('PAED 5', PAED_AGE, 'R7 under 17 · R3 per tooth'),
  ]),
  p('composite', 'Composite / compomer restoration', 'Composite', 'restorative', 'tooth', ['CONS', 'PAED'], [
    m('PAED 6', PAED_AGE, 'R7 under 17 · R3 per tooth'),
    m('CONS 02', { rotation: 'CONS', toothClass: 'anterior' }, 'R3 per tooth · anterior from FDI'),
    m('CONS 01', { rotation: 'CONS', toothClass: 'posterior' }, 'R3 per tooth · posterior from FDI'),
  ], { keywords: ['filling', 'resin', 'tooth coloured'] }),
  p('gic', 'Glass ionomer (GIC) restoration', 'GIC', 'restorative', 'tooth', ['CONS', 'PAED'], [
    m('PAED 6', PAED_AGE, 'R7 under 17 · R3 per tooth'),
    m('CONS 02', { rotation: 'CONS', toothClass: 'anterior' }, 'R3 per tooth · anterior from FDI'),
    m('CONS 01', { rotation: 'CONS', toothClass: 'posterior' }, 'R3 per tooth · posterior from FDI'),
  ], { keywords: ['filling', 'art', 'glass ionomer'] }),
  p('amalgam', 'Amalgam restoration', 'Amalgam', 'restorative', 'tooth', ['CONS'], [
    m('CONS 06', { rotation: 'CONS' }, 'R3 per tooth'),
  ], { keywords: ['filling'] }),
  p('fissure_sealant', 'Fissure sealant', 'Sealant', 'preventive', 'tooth', ['PAED'], [
    m('PAED 7', PAED_AGE, 'R7 under 17 · per patient visit'),
  ]),
  p('fluoride', 'Topical fluoride treatment', 'Fluoride', 'preventive', 'none', ['PAED'], [
    m('PAED 7', PAED_AGE, 'R7 under 17 · per patient visit'),
  ], { keywords: ['varnish', 'apf', 'duraphat'] }),
  p('sdf', 'Silver diamine fluoride application', 'SDF', 'preventive', 'none', ['PAED'], [
    m('PAED 7', PAED_AGE, 'R7 under 17 · per patient visit'),
  ]),
  p('mouthguard', 'Mouth guard', 'Mouth guard', 'preventive', 'none', ['PAED'], [
    m('PAED 7', PAED_AGE, 'R7 under 17 · per patient visit'),
  ]),
  p('paed_crown', 'Paediatric crown (stainless steel / zirconia)', 'SSC / zirconia', 'paediatric', 'tooth', ['PAED'], [
    m('PAED 8', PAED_AGE, 'R7 under 17 · R3 per tooth'),
  ], { keywords: ['ssc', 'hall technique'] }),
  p('dental_trauma', 'Emergency treatment of traumatised teeth', 'Dental trauma', 'emergency', 'region', ['PAED', 'OMF'], [
    m('PAED 9', PAED_AGE, 'R7 under 17 · per patient visit'),
  ], { keywords: ['avulsion', 'splint', 'fracture', 'luxation'] }),
  p('ga_case', 'Paediatric case under general anaesthesia', 'Paed GA case', 'paediatric', 'none', ['PAED'], [
    m('PAED 10', PAED_AGE, 'R7 under 17 · per patient visit'),
  ], { keywords: ['theatre', 'ga'] }),

  // ---- Periodontology ---------------------------------------------------------
  p('scaling_polishing', 'Scaling and polishing', 'Scaling', 'periodontal', 'none', ['PER'], [
    m('PER 02', { rotation: 'PER', systemicAlert: true }, 'Systemic condition alert · per patient visit'),
    m('PER 03', { rotation: 'PER' }, 'R5 per patient visit'),
  ], { keywords: ['s&p', 'prophylaxis', 'cleaning'] }),
  p('root_planing', 'Root surface debridement / root planing', 'Root planing', 'periodontal', 'none', ['PER'], [
    m('PER 02', { rotation: 'PER', systemicAlert: true }, 'Systemic condition alert · per patient visit'),
    m('PER 03', { rotation: 'PER' }, 'R5 per patient visit'),
  ], { keywords: ['rsd', 'deep cleaning'] }),
  p('occlusal_adjustment', 'Occlusal adjustment', 'Occlusal adj.', 'periodontal', 'none', ['PER'], [
    m('PER 03', { rotation: 'PER' }, 'R5 per patient visit'),
  ]),
  p('perio_splint', 'Splinting of periodontally involved teeth', 'Perio splint', 'periodontal', 'region', ['PER'], [
    m('PER 03', { rotation: 'PER' }, 'R5 per patient visit'),
  ]),
  p('gingivectomy', 'Gingivectomy, gingivoplasty or frenectomy', 'Gingivectomy / frenectomy', 'periodontal', 'region', ['PER'], [
    m('PER 04', { rotation: 'PER' }, 'R5 per patient visit'),
  ]),
  p('perio_surgery', 'Flap, osseous or mucogingival surgery / gingival graft', 'Perio flap / graft', 'periodontal', 'region', ['PER'], [
    m('PER 05', { rotation: 'PER' }, 'R5 per patient visit'),
  ]),
  p('implant_team', 'Implant dentistry team participation', 'Implant team', 'prosthodontic', 'none', ['PER', 'CONS'], [
    m('PER 06', { rotation: 'PER' }, 'Per patient visit'),
    m('CONS 05', { rotation: 'CONS' }, 'Per patient visit'),
  ]),

  // ---- Conservative, endodontics and prosthodontics ------------------------
  p('rct', 'Root canal treatment', 'RCT', 'endodontic', 'tooth', ['CONS'], [
    m('CONS 03', { rotation: 'CONS', finalStageOnly: true }, 'R4 counted once at obturation'),
  ], {
    stages: 3,
    stageNames: ['Access & extirpation', 'Cleaning & shaping', 'Obturation'],
    keywords: ['endo', 'root canal', 'obturation'],
  }),
  p('crown_bridge', 'Crown or bridge', 'Crown / bridge', 'prosthodontic', 'tooth', ['CONS'], [
    m('CONS 04', { rotation: 'CONS', finalStageOnly: true }, 'R4 counted once at cementation'),
  ], { stages: 2, stageNames: ['Preparation & impression', 'Cementation'], keywords: ['fpd', 'post crown'] }),
  p('complete_denture', 'Complete denture (any stage)', 'Complete denture', 'prosthodontic', 'none', ['CONS'], [], {
    uncoded: 'PROS-2',
    keywords: ['cd', 'edentulous'],
  }),
  p('partial_denture', 'Partial denture (any stage)', 'Partial denture', 'prosthodontic', 'none', ['CONS'], [], {
    uncoded: 'PROS-2',
    keywords: ['rpd', 'acrylic', 'cobalt chrome'],
  }),
  p('denture_repair', 'Immediate denture, denture repair or reline', 'Denture repair / reline', 'prosthodontic', 'none', ['CONS'], [], {
    uncoded: 'PROS-3',
  }),

  // ---- Orthodontics (uncoded in KMPDC 3rd ed., G1) -------------------------
  p('ortho_assessment', 'Orthodontic assessment / appliance design, delivery or activation', 'Ortho appliance', 'orthodontic', 'none', ['PAED'], [], {
    uncoded: 'ORTHO-1',
    keywords: ['removable appliance', 'activation', 'ortho'],
  }),
  p('space_maintainer', 'Space maintainer', 'Space maintainer', 'orthodontic', 'tooth', ['PAED'], [], { uncoded: 'ORTHO-2' }),
  p('functional_appliance', 'Functional appliance', 'Functional appliance', 'orthodontic', 'none', ['PAED'], [], { uncoded: 'ORTHO-3' }),

  // ---- General (uncoded, 4.2) ------------------------------------------------
  p('venepuncture', 'Venepuncture / IV cannulation or infusion', 'Venepuncture / IV', 'general', 'none', ['OMF'], [], { uncoded: 'GEN-1' }),
  p('resuscitation', 'Resuscitation / airway / life support', 'Resuscitation', 'general', 'none', ['OMF'], [], { uncoded: 'GEN-2' }),

  // ---- Fallback --------------------------------------------------------------
  p('other', 'Other procedure', 'Other', 'general', 'region', [], []),
];

/** Activities that are evidence without a patient (blueprint §12, rule R9). */
export const ACTIVITY_TYPES: ActivityType[] = [
  {
    id: 'diagnostic_session',
    name: 'Diagnostic rotation session (pathology, microbiology, radiology)',
    group: 'clinical',
    typicalRotations: ['OMF'],
    mappings: [m('OMF 10', { rotation: 'OMF' }, 'R9 per session')],
  },
  {
    id: 'ward_theatre',
    name: 'In-patient care / ward round / theatre session',
    group: 'clinical',
    typicalRotations: ['OMF', 'PAED'],
    mappings: [m('OMF 17', { rotation: 'OMF' }, 'R9 per session (unit unconfirmed)')],
  },
  {
    id: 'emergency_call',
    name: 'Casualty / emergency call',
    group: 'clinical',
    typicalRotations: ['OMF'],
    mappings: [m('OMF 18', { rotation: 'OMF' }, 'R9 per call (unit unconfirmed)')],
  },
  {
    id: 'postmortem',
    name: 'Postmortem examination attended',
    group: 'clinical',
    typicalRotations: ['OMF'],
    fixedLevel: 1,
    mappings: [m('OMF 19', { rotation: 'OMF' }, 'R9 per postmortem')],
  },
  {
    id: 'case_presentation',
    name: 'Case presentation (clinicopathological conference, grand round, departmental)',
    group: 'academic',
    typicalRotations: ['OMF', 'PAED', 'PER', 'CONS'],
    mappings: [
      m('OMF 1', { rotation: 'OMF' }, 'R5 case presentation'),
      m('CONS 07', { rotation: 'CONS' }, 'Addendum page (no printed rows)'),
    ],
  },
  {
    id: 'cpd',
    name: 'CPD / CME / journal club / teaching session',
    group: 'academic',
    typicalRotations: ['OMF', 'PAED', 'PER', 'CONS', 'COMM'],
    mappings: [],
  },
  {
    id: 'community_activity',
    name: 'Community dentistry activity (5.7.4)',
    group: 'community',
    needs: 'community_item',
    typicalRotations: ['COMM'],
    mappings: [],
  },
  {
    id: 'community_case_step',
    name: 'Community case follow-up step (5.7.5)',
    group: 'community',
    needs: 'community_case',
    typicalRotations: ['COMM'],
    mappings: [],
  },
  {
    id: 'weekly_report',
    name: 'Community weekly report (5.7.6)',
    group: 'community',
    needs: 'weekly_report',
    typicalRotations: ['COMM'],
    mappings: [m(COMMUNITY_WEEKLY_REPORT_CODE, { rotation: 'COMM' }, 'One per weekly report')],
  },
  {
    id: 'health_education',
    name: 'Health education / outreach (outside community rotation)',
    group: 'community',
    typicalRotations: ['OMF', 'PAED', 'PER', 'CONS'],
    mappings: [],
  },
  {
    id: 'other_activity',
    name: 'Other activity',
    group: 'other',
    typicalRotations: [],
    mappings: [],
  },
];

/** Dynamic community codes (not expressible as static mappings). */
export function communityActivityCode(activity: {
  activityTypeId: string;
  communityItem?: number;
  caseType?: string;
}): string | null {
  if (activity.activityTypeId === 'community_activity' && activity.communityItem) {
    return communityItemCode(activity.communityItem);
  }
  if (activity.activityTypeId === 'community_case_step' && activity.caseType) {
    return communityCaseCode(activity.caseType);
  }
  return null;
}

const procedureIndex = new Map(PROCEDURE_TYPES.map((t) => [t.id, t]));
const activityIndex = new Map(ACTIVITY_TYPES.map((t) => [t.id, t]));

export const getProcedureType = (id: string) => procedureIndex.get(id);
export const getActivityType = (id: string) => activityIndex.get(id);

export const RADIOGRAPH_KINDS = ['IOPA', 'Bitewing', 'OPG', 'Occlusal', 'Lateral ceph', 'CBCT', 'Skull / facial views'];
export const INVESTIGATION_KINDS = [...RADIOGRAPH_KINDS, 'FBC', 'Blood sugar', 'Biopsy histology', 'Culture & sensitivity', 'Pulp vitality test'];

export const CATEGORY_LABELS: Record<ProcedureType['category'], string> = {
  diagnosis: 'Diagnosis & planning',
  oral_surgery: 'Oral surgery',
  restorative: 'Restorative',
  endodontic: 'Endodontics',
  periodontal: 'Periodontology',
  prosthodontic: 'Prosthodontics',
  paediatric: 'Paediatric',
  preventive: 'Preventive',
  orthodontic: 'Orthodontics',
  emergency: 'Emergency',
  general: 'General',
};
