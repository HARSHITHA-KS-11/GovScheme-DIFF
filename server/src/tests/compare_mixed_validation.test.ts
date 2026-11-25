import { runGuard1InputGateAsync, compareTwoDocuments } from '../services/astraBackend';
import { DocumentAnalysisResult } from '../../../src/types/schemas';

async function runMixedDocumentValidationTests() {
  console.log('====================================================');
  console.log('  MIXED CIRCULAR / NON-CIRCULAR VALIDATION TESTS');
  console.log('====================================================\n');

  console.log('--- TEST 1: GUARD 1 REJECTS NON-CIRCULAR INPUT ---');
  const nonCircularText = 'x^2 + y^2 = z^2. Solve for x when y = 3 and z = 5. Calculus assignment step 1.';
  const g1Result = await runGuard1InputGateAsync(nonCircularText);

  if (g1Result.is_valid_circular) {
    console.error('❌ [FAIL] Test 1: Guard 1 failed to reject non-circular text.');
    process.exit(1);
  }
  console.log(`✅ [PASS] Test 1: Non-circular text rejected by Guard 1 (Reason: "${g1Result.rejection_reason}")`);

  console.log('\n--- TEST 2: SLOT-ISOLATED ERROR FORMATTING (CIRCULAR B INVALID) ---');
  const formatDocumentRejectReason = (rawError: string, docLabel: string): string => {
    let cleanMsg = rawError
      .replace(/^Error:\s*/i, '')
      .replace(/^Document rejected by Guard 1:\s*/i, '')
      .trim();

    if (!cleanMsg || cleanMsg.toLowerCase().includes('analysis failed')) {
      cleanMsg = 'this does not appear to be a valid government circular or scheme guideline. Please upload or paste an official government circular.';
    } else if (!cleanMsg.toLowerCase().includes('government circular') && !cleanMsg.toLowerCase().includes('scheme')) {
      cleanMsg = `${cleanMsg}. Please upload or paste a valid government circular.`;
    }

    const prefix = `${docLabel} could not be compared:`;
    return cleanMsg.toLowerCase().includes(docLabel.toLowerCase()) ? cleanMsg : `${prefix} ${cleanMsg}`;
  };

  const errB = formatDocumentRejectReason(g1Result.rejection_reason || '', 'Circular B');
  if (!errB.startsWith('Circular B could not be compared:')) {
    console.error(`❌ [FAIL] Test 2: Formatted error "${errB}" does not identify Circular B.`);
    process.exit(1);
  }
  console.log(`✅ [PASS] Test 2: Circular B rejection message named slot: "${errB}"`);

  console.log('\n--- TEST 3: VALID CIRCULAR PAIR COMPARISON ---');
  const validDocA: DocumentAnalysisResult = {
    guard1: { is_valid_circular: true, document_kind: 'scheme_circular', category: 'housing & infrastructure', confidence: 0.98 },
    document_title: 'Rural Housing Circular 2025',
    category: 'housing & infrastructure',
    overall_risk_score: 25,
    summary_simple: '1. Circular A overview.\n2. Covers grant rules.\n3. Page 1.',
    summary_very_simple: '1. Circular A.\n2. Grant rules.\n3. Page 1.',
    clauses: [
      {
        id: 'c1',
        clause_number: '1',
        page_number: 1,
        section_reference: 'Section 1',
        title: 'Grant Amount',
        clause_type: 'benefits & financial assistance',
        original_text: 'Eligible families receive Rs. 1,20,000 grant.',
        simple_explanation: '1. Eligible families get Rs. 1,20,000.\n2. Paid via bank transfer.\n3. Page 1, Section 1.',
        very_simple_explanation: '1. Get Rs. 1,20,000.\n2. Bank transfer.\n3. Page 1, Section 1.',
        risk_level: 'low',
        icon_name: 'CheckCircle',
        one_line_consequence: 'Standard Info: Financial assistance amount.',
      },
    ],
    contradictions: [],
    checklist: { title: 'Checklist', items: [], stamp_duty_required: false, disclaimer: '' },
    options_next_steps: [],
    lawyer_briefing: {
      document_summary: 'Summary',
      flagged_issues: [],
      questions_to_ask_lawyer: [],
      missing_protective_clauses: [],
      recommended_next_steps: [],
      disclaimer: '',
    },
    disclaimer: '',
  };

  const validDocB: DocumentAnalysisResult = {
    guard1: { is_valid_circular: true, document_kind: 'amendment', category: 'housing & infrastructure', confidence: 0.98 },
    document_title: 'Rural Housing Circular 2026',
    category: 'housing & infrastructure',
    overall_risk_score: 30,
    summary_simple: '1. Circular B overview.\n2. Updated grant rules.\n3. Page 1.',
    summary_very_simple: '1. Circular B.\n2. Updated grant.\n3. Page 1.',
    clauses: [
      {
        id: 'c1',
        clause_number: '1',
        page_number: 1,
        section_reference: 'Section 1',
        title: 'Grant Amount',
        clause_type: 'benefits & financial assistance',
        original_text: 'Eligible families receive Rs. 1,50,000 grant.',
        simple_explanation: '1. Eligible families get Rs. 1,50,000.\n2. Paid via bank transfer.\n3. Page 1, Section 1.',
        very_simple_explanation: '1. Get Rs. 1,50,000.\n2. Bank transfer.\n3. Page 1, Section 1.',
        risk_level: 'watch_out',
        icon_name: 'Clock',
        one_line_consequence: 'Check Carefully: Updated financial grant amount.',
      },
    ],
    contradictions: [],
    checklist: { title: 'Checklist', items: [], stamp_duty_required: false, disclaimer: '' },
    options_next_steps: [],
    lawyer_briefing: {
      document_summary: 'Summary',
      flagged_issues: [],
      questions_to_ask_lawyer: [],
      missing_protective_clauses: [],
      recommended_next_steps: [],
      disclaimer: '',
    },
    disclaimer: '',
  };

  const compRes = await compareTwoDocuments(validDocA, validDocB);
  if (!compRes || !compRes.aligned_pairs || compRes.aligned_pairs.length === 0 || compRes.modified_count !== 1) {
    console.error('❌ [FAIL] Test 3: Valid circular pair comparison did not return modified_count=1.');
    process.exit(1);
  }
  console.log('✅ [PASS] Test 3: Valid government circular pair comparison detected grant increase accurately.');
  console.log('\n🟢 ALL MIXED VALIDATION TESTS PASSED!');
}

runMixedDocumentValidationTests();
