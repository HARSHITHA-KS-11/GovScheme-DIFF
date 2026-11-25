import { DocumentAnalysisResult } from '../../../src/types/schemas';

export const SAMPLE_WELFARE_CIRCULAR: DocumentAnalysisResult = {
  guard1: {
    is_valid_circular: true,
    document_kind: 'scheme_circular',
    category: 'welfare & subsidy scheme',
    confidence: 0.98,
  },
  document_title: 'State Senior Citizen & Family Welfare Assistance Circular (2026)',
  category: 'welfare & subsidy scheme',
  overall_risk_score: 25,
  summary_simple:
    'Government welfare circular providing Rs. 2,000 monthly financial assistance to eligible senior citizens and low-income families with annual household income up to Rs. 2,50,000.',
  summary_very_simple:
    'Eligible citizens get Rs. 2,000 every month if family income is Rs. 2,50,000 or less.',
  clauses: [
    {
      id: 'clause_1',
      clause_number: '1',
      clause_type: 'scheme overview & objective',
      title: 'Circular Objective & Issuing Department',
      original_text:
        'Circular No. SWD/2026/104 issued by the Department of Social Welfare announces direct monthly financial support for senior citizens and economically weaker households.',
      simple_explanation:
        '1. The Department of Social Welfare issued Circular No. SWD/2026/104.\n2. It provides monthly financial support to senior citizens and low-income families.\n3. Funds are sent directly to the beneficiary bank account.',
      very_simple_explanation:
        '1. Social Welfare Department started monthly help.\n2. Senior citizens and low-income families can apply.\n3. Money goes directly to the bank account.',
      risk_level: 'low',
      icon_name: 'CheckCircle',
      one_line_consequence: 'Official welfare scheme circular issued by the Department of Social Welfare.',
    },
    {
      id: 'clause_2',
      clause_number: '2',
      clause_type: 'income & age limits',
      title: 'Eligibility, Age & Income Ceiling',
      original_text:
        'Applicants must be permanent residents aged 60 years or above, with total annual family income not exceeding Rs. 2,50,000 from all sources.',
      simple_explanation:
        '1. You must be at least 60 years old and a permanent resident.\n2. Total yearly family income must be Rs. 2,50,000 or less.\n3. Income from all sources is counted toward this limit.',
      very_simple_explanation:
        '1. Age must be 60 years or more.\n2. Yearly family income must not cross Rs. 2,50,000.\n3. You must live permanently in the state.',
      risk_level: 'watch_out',
      icon_name: 'Clock',
      one_line_consequence: 'Strict age (60+) and annual income ceiling (Rs. 2,50,000) apply.',
      deadlines: [],
    },
    {
      id: 'clause_3',
      clause_number: '3',
      clause_type: 'required documents',
      title: 'Required Supporting Documents',
      original_text:
        'Applicants must submit Aadhaar card, valid Income Certificate issued by Tehsildar, age proof, and Aadhaar-seeded bank passbook copy.',
      simple_explanation:
        '1. Submit your Aadhaar card and age proof.\n2. Attach an official Income Certificate from the Tehsildar.\n3. Provide a bank passbook copy linked to Aadhaar.',
      very_simple_explanation:
        '1. Bring Aadhaar card and age proof.\n2. Bring Income Certificate.\n3. Bring Aadhaar-linked bank passbook.',
      risk_level: 'watch_out',
      icon_name: 'Clock',
      one_line_consequence: 'Application requires Aadhaar-linked bank account and Tehsildar Income Certificate.',
    },
    {
      id: 'clause_4',
      clause_number: '4',
      clause_type: 'deadlines & validity',
      title: 'Application Last Date',
      original_text:
        'Completed online applications must be submitted on the State Welfare Portal on or before 30th September 2026.',
      simple_explanation:
        '1. Apply online through the State Welfare Portal.\n2. Submit your form on or before 30th September 2026.\n3. Late submissions are not accepted under this cycle.',
      very_simple_explanation:
        '1. Apply online on the portal.\n2. Last date is 30th September 2026.\n3. Apply before the deadline.',
      risk_level: 'high',
      icon_name: 'AlertOctagon',
      one_line_consequence: 'Strict submission deadline: 30th September 2026.',
      deadlines: ['30th September 2026'],
    },
  ],
  contradictions: [],
  checklist: {
    title: 'Scheme Application Checklist',
    stamp_duty_required: false,
    items: [
      {
        id: 'chk_1',
        category: 'deadline',
        title: 'Submit Online Application',
        description: 'Apply on State Welfare Portal before deadline.',
        due_date_or_timeframe: '2026-09-30',
        action_required: 'Complete portal form before 30th September 2026',
        associated_clause_id: 'clause_4',
      },
    ],
    disclaimer: 'Informational summary generated from the uploaded circular. Verify with the official portal.',
  },
  options_next_steps: [
    {
      id: 'opt_1',
      title: 'Verify Income Certificate & Bank Seeding',
      description: 'Confirm your Income Certificate is current and bank account is Aadhaar-seeded before applying.',
      benefit: 'Prevents automatic rejection or failed benefit transfer.',
    },
  ],
  lawyer_briefing: {
    document_summary: 'State Senior Citizen & Family Welfare Assistance Circular (2026).',
    flagged_issues: [],
    questions_to_ask_lawyer: [],
    missing_protective_clauses: [],
    recommended_next_steps: ['Verify eligibility and submit documents on the official portal before deadline.'],
    disclaimer: 'Informational summary only. Verify with the issuing government department.',
  },
  disclaimer: 'GovScheme Diff provides AI-assisted explanations of government circulars for informational purposes only.',
};

export const SAMPLE_RENTAL_AGREEMENT = SAMPLE_WELFARE_CIRCULAR;
export const SAMPLE_EMPLOYMENT_CONTRACT = SAMPLE_WELFARE_CIRCULAR;
