import type { Level, Reflection } from '../types';

/**
 * Fictional reflection-diary templates for the demo intern. They describe
 * learning, never identifiable patients.
 */

type Template = Pick<Reflection, 'title' | 'interesting' | 'learned' | 'challenged' | 'doDifferently' | 'revise' | 'needExposure'> & {
  tags: Reflection['tags'];
};

export const REFLECTION_TEMPLATES: Record<string, Template[]> = {
  OMF: [
    {
      title: 'Difficult lower molar extraction',
      interesting: 'Divergent roots seen on the IOPA predicted the difficulty well.',
      learned: 'Sectioning early saves time and preserves bone.',
      challenged: 'Keeping the patient calm during prolonged elevation.',
      doDifferently: 'Request the radiograph before starting, not midway.',
      revise: 'Surgical anatomy of the inferior alveolar canal.',
      needExposure: 'Surgical extractions with flap design.',
      tags: ['challenging', 'learning'],
    },
    {
      title: 'Fascial space infection admitted from casualty',
      interesting: 'How quickly a submandibular infection can threaten the airway.',
      learned: 'Airway assessment and early incision and drainage come before definitive dental treatment.',
      challenged: 'Deciding when to escalate to the consultant at night.',
      revise: 'Fascial spaces of the head and neck; antibiotic choices.',
      tags: ['important', 'learning'],
    },
    {
      title: 'Mandibular fracture: closed reduction',
      learned: 'Occlusion is the best guide to reduction.',
      challenged: 'Placing arch bars efficiently.',
      needExposure: 'Open reduction and internal fixation in theatre.',
      tags: ['learning'],
    },
    {
      title: 'Biopsy of a white patch',
      interesting: 'The differential diagnosis for oral white lesions is wide.',
      learned: 'Choose the most representative site; incisional biopsy for large lesions.',
      revise: 'Potentially malignant disorders and referral pathways.',
      tags: ['learning', 'revision'],
    },
    {
      title: 'Post-extraction bleeding at night',
      learned: 'Local measures first: pressure, packing and suturing before systemic causes.',
      doDifferently: 'Take a fuller medication history — anticoagulants were missed initially.',
      tags: ['challenging'],
    },
    {
      title: 'Ward round: post-operative care',
      learned: 'Fluid balance and nutrition matter for patients on IMF.',
      revise: 'Post-operative fluid management.',
      tags: ['revision'],
    },
  ],
  PAED: [
    {
      title: 'Anxious six-year-old for extraction',
      interesting: 'Tell-show-do worked better than I expected.',
      learned: 'Short appointments and praise build cooperation.',
      challenged: 'Balancing parental anxiety with the child\'s.',
      doDifferently: 'Start with a non-invasive visit when possible.',
      tags: ['learning', 'challenging'],
    },
    {
      title: 'Pulpotomy on a primary molar',
      learned: 'Haemostasis after coronal pulp removal guides the diagnosis.',
      revise: 'Indications for pulpotomy versus pulpectomy.',
      tags: ['learning', 'revision'],
    },
    {
      title: 'Trauma clinic: avulsed incisor',
      interesting: 'Extra-oral dry time changes the prognosis completely.',
      learned: 'Splinting duration depends on the injury type.',
      revise: 'IADT dental trauma guidelines.',
      tags: ['important', 'revision'],
    },
    {
      title: 'Preventive session at the clinic',
      learned: 'Diet diaries reveal sugar exposure that families do not mention.',
      tags: ['learning'],
    },
    {
      title: 'Orthodontic assessment clinic',
      learned: 'Systematic assessment: skeletal, dental, soft tissue.',
      needExposure: 'Removable appliance design and activation.',
      tags: ['revision'],
    },
  ],
  PER: [
    {
      title: 'Periodontitis with diabetes',
      interesting: 'Glycaemic control and periodontal health affect each other.',
      learned: 'Coordinate with the physician and set realistic hygiene goals.',
      revise: 'Periodontal classification (2017).',
      tags: ['important', 'learning'],
    },
    {
      title: 'Root surface debridement',
      learned: 'Systematic quadrant work with sharp instruments saves time.',
      challenged: 'Hand fatigue on long sessions.',
      doDifferently: 'Sharpen instruments before the clinic.',
      tags: ['learning'],
    },
    {
      title: 'Assisted flap surgery',
      interesting: 'Direct visualisation of calculus on root surfaces.',
      needExposure: 'Periodontal surgery as operator under supervision.',
      tags: ['learning'],
    },
    {
      title: 'Motivating a patient who smokes',
      learned: 'Brief interventions work best when linked to the patient\'s own goals.',
      challenged: 'Avoiding a lecturing tone.',
      tags: ['challenging'],
    },
  ],
  CONS: [
    {
      title: 'Curved canal on a lower molar',
      interesting: 'Pre-curving files made negotiation possible.',
      learned: 'Working length confirmation radiographs avoid over-instrumentation.',
      challenged: 'Time management with multiple canals.',
      needExposure: 'Molar endodontics.',
      tags: ['challenging', 'learning'],
    },
    {
      title: 'Class IV composite build-up',
      learned: 'A silicone index makes palatal shell placement predictable.',
      revise: 'Shade selection and layering.',
      tags: ['learning'],
    },
    {
      title: 'Partial denture try-in',
      learned: 'Checking occlusion at try-in prevents remakes.',
      needExposure: 'Complete denture stages.',
      tags: ['learning'],
    },
    {
      title: 'Crown preparation',
      challenged: 'Achieving adequate occlusal reduction.',
      doDifferently: 'Use depth grooves.',
      revise: 'Preparation principles for full-coverage crowns.',
      tags: ['challenging', 'revision'],
    },
    {
      title: 'Amalgam versus composite discussion',
      learned: 'Material choice depends on isolation, cavity size and patient factors.',
      tags: ['learning'],
    },
  ],
  COMM: [
    {
      title: 'Primary school oral health talk',
      interesting: 'Children knew about brushing but not about sugary drinks.',
      learned: 'Interactive demonstrations hold attention better than slides.',
      tags: ['learning'],
    },
    {
      title: 'Home visit for a patient with diabetes',
      interesting: 'Access to fluoride toothpaste was a barrier.',
      learned: 'Social determinants shape oral health more than clinic advice alone.',
      tags: ['important', 'learning'],
    },
    {
      title: 'CHMT meeting observation',
      learned: 'How oral health competes for priority in county planning.',
      tags: ['learning'],
    },
    {
      title: 'ANC health education session',
      learned: 'Pregnant mothers are receptive to messages about their children\'s teeth.',
      challenged: 'Explaining in Kiswahili without jargon.',
      tags: ['challenging'],
    },
  ],
};

export const MILESTONES: { procedure: string; minLevel: Level; stage?: number; title: string; learned: string }[] = [
  { procedure: 'extraction', minLevel: 5, title: 'First independent extraction', learned: 'Confidence in case assessment and technique.' },
  { procedure: 'surgical_extraction', minLevel: 3, title: 'First surgical extraction performed under direct supervision', learned: 'Flap design and bone removal.' },
  { procedure: 'incision_drainage', minLevel: 4, title: 'First incision and drainage under indirect supervision', learned: 'Managing an acute infection end to end.' },
  { procedure: 'pulpotomy', minLevel: 4, title: 'First pulpotomy under indirect supervision', learned: 'Paediatric pulp therapy.' },
  { procedure: 'root_planing', minLevel: 5, title: 'First independent root surface debridement', learned: 'Systematic non-surgical periodontal therapy.' },
  { procedure: 'rct', minLevel: 4, stage: 3, title: 'First root canal obturation under indirect supervision', learned: 'Completing an endodontic case.' },
];
