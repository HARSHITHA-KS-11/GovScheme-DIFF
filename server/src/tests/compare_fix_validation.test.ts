import fs from 'fs';
import path from 'path';
import { alignClauses } from '../../../src/utils/clauseAlignment';
import { compareTwoDocuments, analyzeDocumentText } from '../services/astraBackend';
import { DocumentAnalysisResult, SimplifiedClause } from '../../../src/types/schemas';

async function runCompareFixValidationTestSuite() {
  console.log('====================================================');
  console.log('  PHASE 3: DETERMINISTIC CIRCULAR COMPARISON TESTS');
  console.log('====================================================\n');

  // TEST 1: Added, Removed, Modified, Unchanged + All 6 Policy Field Change Detectors
  console.log('--- TEST 1: ADDED / REMOVED / MODIFIED / UNCHANGED & 6 FIELD DETECTORS ---');

  const circularAClauses: SimplifiedClause[] = [
    {
      id: 'a1',
      clause_number: '1',
      title: 'Scheme Overview',
      clause_type: 'scheme overview & objective',
      page_number: 1,
      section_reference: 'Section 1',
      original_text: 'Circular No. SWD/2025/10 provides financial assistance to eligible residents.',
      simple_explanation: 'Overview',
      very_simple_explanation: 'Overview',
      risk_level: 'low',
      icon_name: 'FileText',
      one_line_consequence: 'Overview',
    },
    {
      id: 'a2',
      clause_number: '2',
      title: 'Eligibility, Income & Age Limits',
      clause_type: 'income & age limits',
      page_number: 1,
      section_reference: 'Section 2',
      original_text:
        'Applicants must be permanent residents aged 60 to 75 years with annual family income not exceeding Rs. 2,50,000. Only BPL families are eligible.',
      simple_explanation: 'Eligibility',
      very_simple_explanation: 'Eligibility',
      risk_level: 'watch_out',
      icon_name: 'Clock',
      one_line_consequence: 'Income & Age limits',
    },
    {
      id: 'a3',
      clause_number: '3',
      title: 'Benefits & Required Documents',
      clause_type: 'benefits & financial assistance',
      page_number: 1,
      section_reference: 'Section 3',
      original_text:
        'Beneficiaries receive financial assistance of Rs. 2,000 per month. Applicants must submit Aadhaar Card and Income Certificate before 30th September 2026.',
      simple_explanation: 'Benefits',
      very_simple_explanation: 'Benefits',
      risk_level: 'low',
      icon_name: 'CheckCircle',
      one_line_consequence: 'Benefits',
    },
    {
      id: 'a4',
      clause_number: '4',
      title: 'Legacy Physical Verification Camp',
      clause_type: 'implementation & verification',
      page_number: 2,
      section_reference: 'Section 4',
      original_text: 'Applicants must attend a physical ward verification camp.',
      simple_explanation: 'Camp verification',
      very_simple_explanation: 'Camp verification',
      risk_level: 'low',
      icon_name: 'FileText',
      one_line_consequence: 'Camp verification',
    },
  ];

  const circularBClauses: SimplifiedClause[] = [
    {
      id: 'b1',
      clause_number: '1',
      title: 'Scheme Overview',
      clause_type: 'scheme overview & objective',
      page_number: 1,
      section_reference: 'Section 1',
      original_text: 'Circular No. SWD/2025/10 provides financial assistance to eligible residents.',
      simple_explanation: 'Overview',
      very_simple_explanation: 'Overview',
      risk_level: 'low',
      icon_name: 'FileText',
      one_line_consequence: 'Overview',
    },
    {
      id: 'b2',
      clause_number: '2',
      title: 'Eligibility, Income & Age Limits',
      clause_type: 'income & age limits',
      page_number: 1,
      section_reference: 'Section 2',
      original_text:
        'Applicants must be permanent residents aged 58 to 80 years with annual family income not exceeding Rs. 3,50,000. Both BPL and EWS families are eligible.',
      simple_explanation: 'Updated eligibility',
      very_simple_explanation: 'Updated eligibility',
      risk_level: 'watch_out',
      icon_name: 'Clock',
      one_line_consequence: 'Updated limits',
    },
    {
      id: 'b3',
      clause_number: '3',
      title: 'Benefits & Required Documents',
      clause_type: 'benefits & financial assistance',
      page_number: 1,
      section_reference: 'Section 3',
      original_text:
        'Beneficiaries receive financial assistance of Rs. 3,000 per month. Applicants must submit Aadhaar Card, Income Certificate, and Bank Passbook before 31st December 2026.',
      simple_explanation: 'Updated benefits',
      very_simple_explanation: 'Updated benefits',
      risk_level: 'low',
      icon_name: 'CheckCircle',
      one_line_consequence: 'Updated benefits',
    },
    {
      id: 'b4',
      clause_number: '4',
      title: 'Grievance Redressal Portal',
      clause_type: 'grievance & nodal authority',
      page_number: 2,
      section_reference: 'Section 4',
      original_text: 'Applicants may submit grievances online to the District Nodal Officer.',
      simple_explanation: 'Online grievance',
      very_simple_explanation: 'Online grievance',
      risk_level: 'low',
      icon_name: 'FileText',
      one_line_consequence: 'Online grievance',
    },
  ];

  const docAObj: DocumentAnalysisResult = {
    guard1: { is_valid_circular: true, document_kind: 'scheme_circular', category: 'welfare & subsidy scheme', confidence: 0.96 },
    document_title: 'Welfare Assistance Circular 2025',
    category: 'welfare & subsidy scheme',
    overall_risk_score: 40,
    summary_simple: 'Circular A',
    summary_very_simple: 'Circular A',
    clauses: circularAClauses,
    contradictions: [],
    checklist: { title: 'Checklist', items: [], stamp_duty_required: false, disclaimer: '' },
    options_next_steps: [],
    lawyer_briefing: { document_summary: 'Circular A', flagged_issues: [], questions_to_ask_lawyer: [], missing_protective_clauses: [], recommended_next_steps: [], disclaimer: '' },
    disclaimer: '',
  };

  const docBObj: DocumentAnalysisResult = {
    guard1: { is_valid_circular: true, document_kind: 'amendment', category: 'welfare & subsidy scheme', confidence: 0.96 },
    document_title: 'Welfare Assistance Circular 2026 (Amended)',
    category: 'welfare & subsidy scheme',
    overall_risk_score: 20,
    summary_simple: 'Circular B',
    summary_very_simple: 'Circular B',
    clauses: circularBClauses,
    contradictions: [],
    checklist: { title: 'Checklist', items: [], stamp_duty_required: false, disclaimer: '' },
    options_next_steps: [],
    lawyer_briefing: { document_summary: 'Circular B', flagged_issues: [], questions_to_ask_lawyer: [], missing_protective_clauses: [], recommended_next_steps: [], disclaimer: '' },
    disclaimer: '',
  };

  const compRes = await compareTwoDocuments(docAObj, docBObj);

  if (compRes.added_count !== 1 || compRes.removed_count !== 1 || compRes.modified_count !== 2 || compRes.unchanged_count !== 1) {
    console.error('❌ [FAIL] Test 1a: Diff counts mismatch:', {
      added: compRes.added_count,
      removed: compRes.removed_count,
      modified: compRes.modified_count,
      unchanged: compRes.unchanged_count,
    });
    process.exit(1);
  }
  console.log('✅ [PASS] Test 1a: Exact Added (1), Removed (1), Modified (2), Unchanged (1) counts computed deterministically.');

  if (compRes.winner_recommendation !== undefined || JSON.stringify(compRes).toLowerCase().includes('safer')) {
    console.error('❌ [FAIL] Test 1b: Found forbidden winner_recommendation or contract safety recommendation:', compRes.winner_recommendation);
    process.exit(1);
  }
  console.log('✅ [PASS] Test 1b: No contract risk score comparison or winner_recommendation emitted.');

  const allChanges = compRes.aligned_pairs.flatMap((p) => p.detected_field_changes || []);
  const detectedFields = new Set(allChanges.map((c) => c.field));
  const requiredFields = ['eligibility', 'income_limit', 'age_limit', 'benefit', 'required_documents', 'deadline'] as const;

  for (const rf of requiredFields) {
    if (!detectedFields.has(rf)) {
      console.error(`❌ [FAIL] Test 1c: Expected field change "${rf}" was not detected. Found:`, Array.from(detectedFields));
      process.exit(1);
    }
  }
  console.log('✅ [PASS] Test 1c: All 6 required policy dimensions detected (eligibility, income_limit, age_limit, benefit, required_documents, deadline).');

  const modifiedPair2 = compRes.aligned_pairs.find((p) => p.doc_a_clause?.id === 'a2');
  if (
    !modifiedPair2 ||
    modifiedPair2.old_text !== circularAClauses[1].original_text ||
    modifiedPair2.new_text !== circularBClauses[1].original_text
  ) {
    console.error('❌ [FAIL] Test 1d: Exact old_text and new_text not preserved on modified pair.');
    process.exit(1);
  }
  console.log('✅ [PASS] Test 1d: Exact old_text and new_text preserved verbatim.');

  // TEST 2: Zero occurrences of literal "undefined"
  console.log('\n--- TEST 2: ZERO "UNDEFINED" IN OUTPUT ---');
  const compStr = JSON.stringify(compRes);
  if (compStr.toLowerCase().includes('undefined')) {
    console.error('❌ [FAIL] Test 2: Literal "undefined" found in comparison output.');
    process.exit(1);
  }
  console.log('✅ [PASS] Test 2: 0 occurrences of "undefined" in comparison output.');

  // TEST 3: Duplicate Category Alignment
  console.log('\n--- TEST 3: DUPLICATE CATEGORY ALIGNMENT & COMPLETENESS ---');
  const docADup: SimplifiedClause[] = [
    { id: 'doc_1', clause_number: '1', title: 'Income Documents', clause_type: 'required documents', original_text: 'Submit Income Certificate and Ration Card.', simple_explanation: 'Income docs', very_simple_explanation: 'Income docs', risk_level: 'low', icon_name: 'FileText', one_line_consequence: 'Docs' },
    { id: 'doc_2', clause_number: '2', title: 'Land Documents', clause_type: 'required documents', original_text: 'Submit Land Record RTC and Aadhaar.', simple_explanation: 'Land docs', very_simple_explanation: 'Land docs', risk_level: 'low', icon_name: 'FileText', one_line_consequence: 'Docs' },
  ];
  const docBDup: SimplifiedClause[] = [
    { id: 'doc_3', clause_number: '1', title: 'Updated Land Documents', clause_type: 'required documents', original_text: 'Submit Land Record RTC, Aadhaar, and Bank Passbook.', simple_explanation: 'Land docs', very_simple_explanation: 'Land docs', risk_level: 'low', icon_name: 'FileText', one_line_consequence: 'Docs' },
  ];

  const dupAlign = alignClauses(docADup, docBDup);
  const matchedDup = dupAlign.alignedPairs.filter((p) => p.status === 'matched');
  const removedDup = dupAlign.alignedPairs.filter((p) => p.change_type === 'removed');

  if (matchedDup.length !== 1 || removedDup.length !== 1 || matchedDup[0].doc_a_clause?.id !== 'doc_2') {
    console.error('❌ [FAIL] Test 3: Duplicate category alignment failed:', { matchedDup, removedDup });
    process.exit(1);
  }
  console.log('✅ [PASS] Test 3: Duplicate section categories paired highest similarity first; unmatched retained as Removed.');

  // TEST 4 & 5: Code Integrity Audits
  const projectRoot = path.resolve(process.cwd(), '..');
  const getFilePath = (relPath: string) => {
    if (fs.existsSync(path.join(process.cwd(), relPath))) return path.join(process.cwd(), relPath);
    return path.join(projectRoot, relPath);
  };

  console.log('\n--- TEST 4: NO RAW-TEXT-SLICE FALLBACK AUDIT ---');
  const compViewText = fs.readFileSync(getFilePath('src/components/ComparisonView.tsx'), 'utf8');
  if (compViewText.includes('.slice(0, 200)') || compViewText.includes('.slice(0,200)')) {
    console.error('❌ [FAIL] Test 4: ComparisonView.tsx contains raw text slice fallback (.slice(0, 200))!');
    process.exit(1);
  }
  console.log('✅ [PASS] Test 4: 0 raw-text-slice fallbacks in ComparisonView.tsx.');

  console.log('\n--- TEST 5: SINGLE SHARED MODULE AUDIT ---');
  const backendText = fs.readFileSync(getFilePath('server/src/services/astraBackend.ts'), 'utf8');
  if (!backendText.includes("from '../../../src/utils/clauseAlignment'")) {
    console.error('❌ [FAIL] Test 5: astraBackend.ts does not import single shared clauseAlignment.ts!');
    process.exit(1);
  }
  console.log('✅ [PASS] Test 5: astraBackend.ts imports shared clauseAlignment.ts.');

  // TEST 6: End-to-End Two-Circular Ingestion -> Deterministic Comparison
  console.log('\n--- TEST 6: E2E TWO-CIRCULAR ANALYSIS & DETERMINISTIC DIFF ---');
  const circularTextA = `GOVERNMENT OF KARNATAKA
DEPARTMENT OF EDUCATION
Circular No. EDU/2025/01
Sub: Post-Matric Scholarship Scheme
1. ELIGIBILITY CRITERIA: Students aged 18 to 25 years with annual family income up to Rs. 2,00,000.
2. BENEFITS: Annual scholarship grant of Rs. 15,000.
3. REQUIRED DOCUMENTS: Aadhaar Card and Income Certificate.
4. DEADLINE: Last date to apply is 31st October 2025.`;

  const circularTextB = `GOVERNMENT OF KARNATAKA
DEPARTMENT OF EDUCATION
Circular No. EDU/2026/01 (Corrigendum)
Sub: Post-Matric Scholarship Scheme Revised Guidelines
1. ELIGIBILITY CRITERIA: Students aged 18 to 28 years with annual family income up to Rs. 2,50,000.
2. BENEFITS: Annual scholarship grant of Rs. 20,000.
3. REQUIRED DOCUMENTS: Aadhaar Card, Income Certificate, and Bonafide Certificate.
4. DEADLINE: Last date to apply is 30th November 2026.
5. GRIEVANCE REDRESSAL: Contact District Scholarship Nodal Officer for support.`;

  const analyzedA = await analyzeDocumentText(circularTextA);
  const analyzedB = await analyzeDocumentText(circularTextB);
  const e2eComp = await compareTwoDocuments(analyzedA, analyzedB);

  const e2eFields = new Set(e2eComp.aligned_pairs.flatMap((p) => p.detected_field_changes || []).map((f) => f.field));
  if (
    (e2eComp.added_count ?? 0) >= 1 &&
    (e2eComp.modified_count ?? 0) >= 3 &&
    e2eFields.has('income_limit') &&
    e2eFields.has('age_limit') &&
    e2eFields.has('benefit') &&
    e2eFields.has('required_documents') &&
    e2eFields.has('deadline') &&
    e2eComp.winner_recommendation === undefined
  ) {
    console.log(
      `✅ [PASS] Test 6: E2E comparison detected Added=${e2eComp.added_count}, Modified=${e2eComp.modified_count}, Unchanged=${e2eComp.unchanged_count}, Fields=${Array.from(e2eFields).join(', ')}.`
    );
  } else {
    console.error('❌ [FAIL] Test 6: E2E comparison missed expected diffs:', {
      added: e2eComp.added_count,
      modified: e2eComp.modified_count,
      fields: Array.from(e2eFields),
      winner: e2eComp.winner_recommendation,
    });
    process.exit(1);
  }

  console.log('\n====================================================');
  console.log('  SUMMARY: ALL PHASE 3 COMPARISON TESTS PASSED! 🟢');
  console.log('====================================================\n');
}

runCompareFixValidationTestSuite().catch((err) => {
  console.error('❌ Phase 3 test crashed:', err);
  process.exit(1);
});
