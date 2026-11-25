import assert from 'assert';
import { analyzeDocumentText } from '../services/astraBackend';

const HOUSING_CIRCULAR = `--- Page 1 ---
GOVERNMENT OF INDIA — RURAL DEVELOPMENT DEPARTMENT
Government Order No. RD-402/2025
Subject: Rural Housing Assistance Scheme Guidelines

1. Eligibility Criteria and Income Limit
Permanent rural residents aged 21 to 60 years with annual income up to Rs. 3,00,000 are eligible.

2. Exclusions and Disqualifications
Income tax payers and pucca house owners are excluded and applications shall be rejected.

3. Required Documents
Submit Aadhaar Card, Ration Card, and valid Income Certificate issued by the Tehsildar.

4. Application Deadline
Submit applications online on or before 31 May 2026.`;

async function runActionableOutputsTestSuite() {
  console.log('\n====================================================');
  console.log('   GOVSCHEME-DIFF CITIZEN CHECKLIST & BRIEFING SUITE');
  console.log('====================================================\n');

  const res = await analyzeDocumentText(HOUSING_CIRCULAR);

  // Test 1: Checklist items grounded in circular sections
  const items = res.checklist?.items || [];
  assert(items.length >= 4, `Expected >=4 checklist items, got ${items.length}`);
  const allText = items.map((i) => `${i.title} ${i.description} ${i.action_required}`).join(' ');
  assert(/deadline|31 may|date/i.test(allText), 'Checklist missing deadline item');
  assert(/document|certificate/i.test(allText), 'Checklist missing document item');
  console.log(`✅ [PASS] Test 1: Surfaced ${items.length} circular-grounded checklist items.`);

  // Test 2: Next steps grounded in circular sections
  const options = res.options_next_steps || [];
  assert(options.length >= 3, `Expected >=3 next step options, got ${options.length}`);
  for (const opt of options) {
    assert(opt.title && opt.description && opt.benefit, `Incomplete next step: ${JSON.stringify(opt)}`);
  }
  console.log(`✅ [PASS] Test 2: Surfaced ${options.length} citizen next-step entries.`);

  // Test 3: Citizen briefing contains exclusions & helpdesk questions
  const flagged = res.lawyer_briefing?.flagged_issues || [];
  assert(flagged.length >= 1, `Expected at least 1 flagged exclusion condition, got ${flagged.length}`);
  const questions = res.lawyer_briefing?.questions_to_ask_lawyer || [];
  assert(questions.length >= 1, 'Expected at least 1 helpdesk clarification question');
  assert(!JSON.stringify(res).includes('Advocate Act 1961'), 'Legacy LegalLens Advocate Act disclaimer leaked');
  console.log(`✅ [PASS] Test 3: Citizen briefing surfaced ${flagged.length} condition(s) and ${questions.length} helpdesk question(s).`);

  console.log('\n🟢 ALL CITIZEN CHECKLIST & BRIEFING TESTS PASSED!');
}

runActionableOutputsTestSuite().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
