import type { RotationCode } from '../types';

/**
 * KMPDC assessment and evaluation forms (5.x.6, 5.x.7), transcribed from the
 * 3rd edition. Field ids are short lowercase tokens so they survive the
 * camelCase/snake_case wire conversion unchanged.
 */

export const FORMS_VERSION = 'kmpdc-dental-3rd-2024';

export type AssessmentKind = 'monthly' | 'mid_rotation' | 'end_of_rotation' | 'overall_rotation';

export interface FormItem {
  id: string;
  label: string;
}

export interface FormSection {
  id: 'intern' | 'supervisor' | 'coordinator';
  title: string;
  items: FormItem[];
}

export const MONTHLY_SECTIONS: FormSection[] = [
  {
    id: 'intern',
    title: 'A. Remarks by intern on their experience in this rotation',
    items: [
      { id: 'a1', label: 'Availability of necessary equipment and supplies to support service delivery' },
      { id: 'a2', label: 'Availability of the Internship Supervisor and other Specialists in the department for consultation and teaching' },
      { id: 'a3', label: 'Workload in the department and working hours' },
      { id: 'a4', label: 'Challenge(s) faced by the Intern in the department' },
      { id: 'a5', label: 'Proposed corrective action(s)' },
    ],
  },
  {
    id: 'supervisor',
    title: 'B. Remarks by Internship Supervisor',
    items: [
      { id: 'b1', label: 'Intern’s performance in the rotation so far' },
      { id: 'b2', label: 'Intern’s progress in achieving logbook targets' },
      { id: 'b3', label: 'Challenge(s) or gap(s) noted' },
      { id: 'b4', label: 'Proposed corrective action(s)' },
    ],
  },
  {
    id: 'coordinator',
    title: 'C. Remarks by Dental Internship Coordinator',
    items: [
      { id: 'c1', label: 'Intern’s progress and performance in the rotation' },
      { id: 'c2', label: 'Challenges noted' },
      { id: 'c3', label: 'Agreed corrective action(s)' },
    ],
  },
];

export const MID_ROTATION_SECTIONS: FormSection[] = [
  { id: 'intern', title: 'Remarks by intern on their experience and performance', items: [{ id: 'm1', label: 'Remarks' }] },
  { id: 'supervisor', title: 'Remarks by Internship Supervisor', items: [{ id: 'm2', label: 'Remarks' }] },
  { id: 'coordinator', title: 'Remarks by Dental Internship Coordinator', items: [{ id: 'm3', label: 'Remarks' }] },
];

export interface CriteriaGroup {
  title: string;
  criteria: FormItem[];
}

const PROFESSIONAL_CONDUCT: CriteriaGroup = {
  title: '3. Professional conduct',
  criteria: [
    { id: 'p1', label: 'With patients and their caregivers' },
    { id: 'p2', label: 'With senior colleagues, fellow interns and other healthcare professionals' },
    { id: 'p3', label: 'With the public' },
    { id: 'p4', label: 'Punctuality, availability and time management' },
  ],
};

export const CLINICAL_CRITERIA: CriteriaGroup[] = [
  {
    title: '1. Knowledge',
    criteria: [
      { id: 'k1', label: 'Basic sciences' },
      { id: 'k2', label: 'Theoretical knowledge in the discipline' },
      { id: 'k3', label: 'Participation in CPD' },
    ],
  },
  {
    title: '2. Clinical skills',
    criteria: [
      { id: 's1', label: 'History taking' },
      { id: 's2', label: 'Clinical examination' },
      { id: 's3', label: 'Interpretation of laboratory and imaging results' },
      { id: 's4', label: 'Overall patient management' },
      { id: 's5', label: 'Prudent use of drugs and non-pharmaceutical supplies' },
      { id: 's6', label: 'Patient notes' },
      { id: 's7', label: 'Case report writing' },
    ],
  },
  PROFESSIONAL_CONDUCT,
];

export const COMMUNITY_CRITERIA: CriteriaGroup[] = [
  {
    title: '1. Knowledge',
    criteria: [
      { id: 'k1', label: 'Basic principles of public health and its importance in clinical practice' },
      { id: 'k2', label: 'Basic principles of epidemiology' },
      { id: 'k3', label: 'Participation in CPD' },
    ],
  },
  {
    title: '2. Application of community dentistry',
    criteria: [
      { id: 's1', label: 'Case identification' },
      { id: 's2', label: 'Preparation of genogram' },
      { id: 's3', label: 'Oral examination' },
      { id: 's4', label: 'Patient care plan' },
      { id: 's5', label: 'Patient follow up' },
      { id: 's6', label: 'Participation in health education and health promotion activities' },
      { id: 's7', label: 'Case report writing' },
    ],
  },
  PROFESSIONAL_CONDUCT,
];

export const GRADE_DESCRIPTIONS: Record<0 | 1 | 2 | 3, string> = {
  3: 'The Intern meets most of the criteria without assistance.',
  2: 'The Intern requires some assistance to meet stated criteria.',
  1: 'The Intern requires considerable assistance to meet stated criteria.',
  0: 'The Intern is completely unable to meet the criteria.',
};

export const OVERALL_SECTIONS: FormSection[] = [
  { id: 'supervisor', title: 'Assessment by Internship Supervisor', items: [{ id: 'o1', label: 'Assessment' }] },
  { id: 'coordinator', title: 'Assessment by Dental Internship Coordinator', items: [{ id: 'o2', label: 'Assessment' }] },
];

export const OUTCOME_LABELS = {
  completed: 'The Intern has successfully completed the rotation.',
  extend: 'To extend rotation by a period of',
  irredeemable: 'Irredeemable. Refer back to Council for further action.',
} as const;

export const criteriaFor = (rotation: RotationCode) => (rotation === 'COMM' ? COMMUNITY_CRITERIA : CLINICAL_CRITERIA);

/** Monthly forms per rotation: two for clinical rotations, one for community (blueprint §1.6). */
export const monthlyCountFor = (rotation: RotationCode) => (rotation === 'COMM' ? 1 : 2);

export const KIND_LABELS: Record<AssessmentKind, string> = {
  monthly: 'Monthly assessment',
  mid_rotation: 'Mid-rotation assessment',
  end_of_rotation: 'End-of-rotation evaluation',
  overall_rotation: 'Overall assessment',
};

/** Paper-book sub-section number for a form within a rotation section (e.g. 5.3 → 5.3.6.1). */
export function formSectionNumber(rotationSection: string, kind: AssessmentKind, rotation: RotationCode): string {
  const evalNo = rotation === 'COMM' ? '7' : '6';
  const overallNo = rotation === 'COMM' ? '8' : '7';
  switch (kind) {
    case 'monthly':
      return `${rotationSection}.${evalNo}.1`;
    case 'mid_rotation':
      return `${rotationSection}.${evalNo}.2`;
    case 'end_of_rotation':
      return `${rotationSection}.${evalNo}.3`;
    default:
      return `${rotationSection}.${overallNo}`;
  }
}
