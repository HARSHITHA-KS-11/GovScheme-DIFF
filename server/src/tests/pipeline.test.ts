import assert from 'assert';
import {
  extractAndCleanDocumentText,
  extractAndCleanDocumentTextAsync,
  chunkDocumentTextIntoClauses,
  verifyGuard2aGrounding,
  analyzeDocumentText,
  compareTwoDocuments,
} from '../services/astraBackend';

const CIRCULAR_A = `--- Page 1 ---
GOVERNMENT OF KARNATAKA
Government Order No. EDN-101/2025
Subject: State Scholarship Scheme Circular 2025

1. Eligibility Criteria
Students aged 17 to 25 years with family income below Rs. 2,00,000 may apply.

2. Scholarship Benefits
Students receive Rs. 20,000 annual grant.

3. Required Documents
Aadhaar Card and Income Certificate must be uploaded.

4. Application Deadline
Last date to apply is 30 June 2025.`;

const CIRCULAR_B = `--- Page 1 ---
GOVERNMENT OF KARNATAKA
Government Order No. EDN-102/2026
Subject: Revised State Scholarship Scheme Circular 2026

1. Eligibility Criteria
Students aged 17 to 28 years with family income below Rs. 2,50,000 may apply.

2. Scholarship Benefits
Students receive Rs. 25,000 annual grant.

3. Required Documents
Aadhaar Card, Income Certificate, and Bonafide Certificate must be uploaded.

4. Application Deadline
Last date to apply is 31 July 2026.

5. Grievance Redressal
Appeals may be filed online within 30 days.`;

async function runPipelineHardeningTests() {
  console.log('====================================================');
  console.log('  GOVSCHEME-DIFF PIPELINE STAGES 1-4 TEST SUITE');
  console.log('====================================================\n');

  // Stage 1: Clean extraction & empty scan rejection
  const txtBuf = Buffer.from(CIRCULAR_A, 'utf8');
  const extracted = extractAndCleanDocumentText(txtBuf, 'text/plain', 'circular_2025.txt');
  assert(extracted.includes('Government Order No. EDN-101/2025'), 'Circular extraction missing G.O. number');

  let threwOnGarbageImage = false;
  try {
    await extractAndCleanDocumentTextAsync(Buffer.from('degraded image data'), 'image/jpeg', 'blurry.jpg');
  } catch {
    threwOnGarbageImage = true;
  }
  assert(threwOnGarbageImage, 'Expected rejection for unreadable image buffer');
  console.log('✅ [PASS] Stage 1: Circular extraction & unreadable image rejection verified.');

  // Stage 2: Section chunking & new taxonomy
  const sectionsA = chunkDocumentTextIntoClauses(CIRCULAR_A);
  assert(sectionsA.some((s) => s.clause_type === 'eligibility criteria' || s.clause_type === 'income & age limits'), 'Missing eligibility section type');
  assert(sectionsA.some((s) => s.clause_type === 'benefits & financial assistance'), 'Missing benefits section type');
  assert(sectionsA.some((s) => s.clause_type === 'required documents'), 'Missing documents section type');
  assert(sectionsA.some((s) => s.clause_type === 'deadlines & validity'), 'Missing deadline section type');
  assert(sectionsA.every((s) => s.page_number === 1), 'Expected page_number === 1');
  console.log(`✅ [PASS] Stage 2: Extracted ${sectionsA.length} circular sections with GovScheme taxonomy & page numbers.`);

  // Stage 3: Guard 2a grounding check
  const goodGround = verifyGuard2aGrounding('Family income up to Rs. 2,00,000 eligible.', 'Income cap is Rs. 2,00,000 per year.');
  assert.strictEqual(goodGround.isGrounded, true, 'Grounded statement misflagged');
  const badGround = verifyGuard2aGrounding('Family income up to Rs. 2,00,000 eligible.', 'Income cap is Rs. 99,00,000 per year.');
  assert.strictEqual(badGround.isGrounded, false, 'Ungrounded amount not caught');
  console.log('✅ [PASS] Stage 3: Guard 2a grounding verified.');

  // Stage 4: Synthesis & deterministic circular comparison
  const resA = await analyzeDocumentText(CIRCULAR_A);
  const resB = await analyzeDocumentText(CIRCULAR_B);
  assert(resA.disclaimer && resA.checklist.disclaimer && resA.lawyer_briefing.disclaimer, 'Disclaimers missing');

  const comp = await compareTwoDocuments(resA, resB);
  assert(comp.disclaimer, 'Comparison disclaimer missing');
  assert(comp.added_count === 1, `Expected 1 added section (Grievance), got ${comp.added_count}`);
  assert((comp.modified_count ?? 0) >= 3, `Expected >=3 modified sections, got ${comp.modified_count}`);
  assert.strictEqual(comp.winner_recommendation, undefined, 'Contract winner_recommendation must remain omitted');
  console.log('✅ [PASS] Stage 4: Circular synthesis & deterministic diff verified.');

  console.log('\n🟢 ALL 4 PIPELINE STAGES PASSED CLEANLY!');
}

runPipelineHardeningTests().catch((err) => {
  console.error('❌ Pipeline test failed:', err);
  process.exit(1);
});
