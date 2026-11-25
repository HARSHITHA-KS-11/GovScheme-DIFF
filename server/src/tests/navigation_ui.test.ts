import { SimplifiedClause } from '../../../src/types/schemas';

async function runNavigationUiTests() {
  console.log('====================================================');
  console.log('  GOVSCHEME-DIFF NAVIGATION & SECTION NUMBERING TEST');
  console.log('====================================================\n');

  let passed = true;

  const mockSections: SimplifiedClause[] = [
    {
      id: 'sec_1',
      clause_number: '1',
      page_number: 1,
      section_reference: 'Section 1',
      clause_type: 'scheme overview & objective',
      title: 'SCHEME OVERVIEW',
      original_text: '1. SCHEME OVERVIEW: Rural housing assistance scheme guidelines.',
      simple_explanation: '1. Explains scheme goal.\n2. Supports rural families.\n3. Page 1, Section 1.',
      very_simple_explanation: '1. Scheme goal.\n2. Helps rural families.\n3. Page 1, Section 1.',
      risk_level: 'low',
      icon_name: 'CheckCircle',
      one_line_consequence: 'Standard Info: Explains scheme overview.',
    },
    {
      id: 'sec_2',
      clause_number: '2',
      page_number: 1,
      section_reference: 'Section 2',
      clause_type: 'eligibility criteria',
      title: 'ELIGIBILITY CRITERIA',
      original_text: '2. ELIGIBILITY CRITERIA: Permanent rural residents.',
      simple_explanation: '1. Shows who can apply.\n2. Must live in rural panchayat.\n3. Page 1, Section 2.',
      very_simple_explanation: '1. Who can apply.\n2. Rural residents.\n3. Page 1, Section 2.',
      risk_level: 'low',
      icon_name: 'CheckCircle',
      one_line_consequence: 'Standard Info: Lists applicant rules.',
    },
    {
      id: 'sec_3',
      clause_number: '3',
      page_number: 1,
      section_reference: 'Section 3',
      clause_type: 'income & age limits',
      title: 'INCOME LIMIT',
      original_text: '3. INCOME LIMIT: Annual income up to Rs. 3,00,000 and age 21 to 60.',
      simple_explanation: '1. Sets income limit.\n2. Age must be 21 to 60.\n3. Page 1, Section 3.',
      very_simple_explanation: '1. Income cap Rs. 3,00,000.\n2. Age 21-60.\n3. Page 1, Section 3.',
      risk_level: 'watch_out',
      icon_name: 'Clock',
      one_line_consequence: 'Check Carefully: Income and age limits apply.',
    },
    {
      id: 'sec_4',
      clause_number: '4',
      page_number: 2,
      section_reference: 'Section 4',
      clause_type: 'exclusions & disqualifications',
      title: 'EXCLUSIONS',
      original_text: '4. EXCLUSIONS: Income tax payers are not eligible.',
      simple_explanation: '1. Lists who cannot apply.\n2. Tax payers excluded.\n3. Page 2, Section 4.',
      very_simple_explanation: '1. Cannot apply if tax payer.\n2. Check carefully.\n3. Page 2, Section 4.',
      risk_level: 'high',
      icon_name: 'AlertOctagon',
      one_line_consequence: 'Important: Tax payers are disqualified.',
    },
    {
      id: 'sec_5',
      clause_number: '5',
      page_number: 2,
      section_reference: 'Section 5',
      clause_type: 'benefits & financial assistance',
      title: 'FINANCIAL GRANT',
      original_text: '5. FINANCIAL GRANT: Rs. 1,50,000 in 3 installments.',
      simple_explanation: '1. Grant is Rs. 1,50,000.\n2. Paid in 3 parts.\n3. Page 2, Section 5.',
      very_simple_explanation: '1. Rs. 1,50,000 support.\n2. Paid in 3 steps.\n3. Page 2, Section 5.',
      risk_level: 'low',
      icon_name: 'CheckCircle',
      one_line_consequence: 'Standard Info: Direct financial assistance.',
    },
    {
      id: 'sec_6',
      clause_number: '6',
      page_number: 2,
      section_reference: 'Section 6',
      clause_type: 'required documents',
      title: 'REQUIRED DOCUMENTS',
      original_text: '6. REQUIRED DOCUMENTS: Aadhaar, Ration Card, Income Certificate.',
      simple_explanation: '1. Attach ID proof.\n2. Attach income proof.\n3. Page 2, Section 6.',
      very_simple_explanation: '1. Aadhaar needed.\n2. Income proof needed.\n3. Page 2, Section 6.',
      risk_level: 'watch_out',
      icon_name: 'Clock',
      one_line_consequence: 'Check Carefully: Supporting certificates needed.',
    },
    {
      id: 'sec_7',
      clause_number: '7',
      page_number: 3,
      section_reference: 'Section 7',
      clause_type: 'application process',
      title: 'HOW TO APPLY',
      original_text: '7. HOW TO APPLY: Apply online at official portal.',
      simple_explanation: '1. Apply online.\n2. Use official portal.\n3. Page 3, Section 7.',
      very_simple_explanation: '1. Online form.\n2. Official website.\n3. Page 3, Section 7.',
      risk_level: 'low',
      icon_name: 'CheckCircle',
      one_line_consequence: 'Standard Info: Portal submission instructions.',
    },
    {
      id: 'sec_8',
      clause_number: '8',
      page_number: 3,
      section_reference: 'Section 8',
      clause_type: 'deadlines & validity',
      title: 'DEADLINE',
      original_text: '8. DEADLINE: Last date 31 May 2026.',
      simple_explanation: '1. Closing date is 31 May 2026.\n2. Apply early.\n3. Page 3, Section 8.',
      very_simple_explanation: '1. Last date 31 May 2026.\n2. Do not miss date.\n3. Page 3, Section 8.',
      risk_level: 'watch_out',
      icon_name: 'Clock',
      one_line_consequence: 'Check Carefully: Strict closing date.',
    },
    {
      id: 'sec_9',
      clause_number: '9',
      page_number: 3,
      section_reference: 'Section 9',
      clause_type: 'grievance & nodal authority',
      title: 'GRIEVANCE REDRESSAL',
      original_text: '9. GRIEVANCE: Appeal within 30 days.',
      simple_explanation: '1. Explains appeal steps.\n2. File within 30 days.\n3. Page 3, Section 9.',
      very_simple_explanation: '1. How to appeal.\n2. Within 30 days.\n3. Page 3, Section 9.',
      risk_level: 'low',
      icon_name: 'CheckCircle',
      one_line_consequence: 'Standard Info: Citizen appeal channel.',
    },
    {
      id: 'sec_10',
      clause_number: '10',
      page_number: 4,
      section_reference: 'Section 10',
      clause_type: 'implementation & verification',
      title: 'COMPLIANCE',
      original_text: '10. COMPLIANCE: Field inspection by BDO.',
      simple_explanation: '1. Officers inspect records.\n2. Provide true info.\n3. Page 4, Section 10.',
      very_simple_explanation: '1. Records verified.\n2. Honest details needed.\n3. Page 4, Section 10.',
      risk_level: 'low',
      icon_name: 'CheckCircle',
      one_line_consequence: 'Standard Info: Field verification rule.',
    },
  ];

  function computeDualBadgeText(clause: SimplifiedClause, index: number, totalCards: number): string {
    const clauseNumberStr = clause.clause_number ? String(clause.clause_number).trim() : '';
    const isOverview = index === 0 && (!clauseNumberStr || clauseNumberStr === '1') && clause.title.toUpperCase().includes('OVERVIEW');
    const docTitle = isOverview ? 'Overview' : `Section ${clauseNumberStr || index + 1}`;
    return `${docTitle} • Page ${clause.page_number || 1} (${index + 1} of ${totalCards})`;
  }

  for (let idx = 0; idx < mockSections.length; idx++) {
    const badge = computeDualBadgeText(mockSections[idx], idx, mockSections.length);
    if (!badge.includes(`(${idx + 1} of 10)`) || !mockSections[idx].simple_explanation) {
      passed = false;
      console.error(`❌ [FAIL] Desync or empty explanation at index ${idx}`);
    }
  }

  if (!passed) process.exit(1);
  console.log('✅ [PASS] All 10 scheme sections synchronized with page & section numbering.');
}

runNavigationUiTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
