import assert from 'assert';
import { analyzeDocumentText } from '../services/astraBackend';

const CIRCULAR_FIXTURES = [
  {
    desc: 'Rural Housing Scheme Circular',
    text: `--- Page 1 ---
GOVERNMENT OF INDIA
Government Order No. RD-402/2025
Subject: Rural Housing Assistance Scheme Circular

1. Eligibility Criteria
Permanent residents aged 21 to 60 years with family income up to Rs. 3,00,000 may apply.

2. Exclusions and Disqualifications
Income tax payers and existing pucca house owners are excluded and rejected.

3. Financial Benefits
Eligible households receive Rs. 1,50,000 in three bank installments.

4. Required Documents
Submit Aadhaar Card, Ration Card, and Income Certificate.

5. Application Deadline
Apply online on or before 31 May 2026.`,
    minSections: 5,
  },
  {
    desc: 'State Student Scholarship Circular',
    text: `--- Page 1 ---
DEPARTMENT OF HIGHER EDUCATION
Notification No. EDN-118/2025
Subject: Post-Matric Student Scholarship Guidelines

1. Scheme Overview and Objective
Financial assistance for college students from lower-income families.

2. Eligibility and Income Limit
Minimum 50% marks and annual family income up to Rs. 2,50,000 required.

3. Scholarship Benefits
Tuition grant up to Rs. 25,000 per year via DBT.

4. Application Deadline
Online applications close on 15 July 2026.`,
    minSections: 4,
  },
];

async function runGroundingRegressionTests() {
  console.log('====================================================');
  console.log('  GOVSCHEME-DIFF GROUNDING & CONSISTENCY SUITE');
  console.log('====================================================\n');

  for (const fixture of CIRCULAR_FIXTURES) {
    const result = await analyzeDocumentText(fixture.text);
    assert(result.clauses.length >= fixture.minSections, `${fixture.desc}: expected >=${fixture.minSections} sections`);

    // Badge <-> one_line_consequence consistency
    for (const c of result.clauses) {
      const cons = c.one_line_consequence.toLowerCase();
      if (c.risk_level === 'high') {
        assert(cons.startsWith('important') || cons.startsWith('high risk'), `Unexpected prefix for high condition on ${c.title}: ${c.one_line_consequence}`);
      } else if (c.risk_level === 'watch_out') {
        assert(cons.startsWith('check carefully') || cons.startsWith('watch out'), `Unexpected prefix for watch_out on ${c.title}: ${c.one_line_consequence}`);
      } else {
        assert(!cons.startsWith('important') && !cons.startsWith('high risk'), `Low info badge has high prefix on ${c.title}`);
      }
      assert(!/[\u0900-\u097F\u0C80-\u0CFF]/.test(c.simple_explanation || ''), `Must be English-only: ${c.title}`);
    }

    const actualHighCount = result.clauses.filter((c) => c.risk_level === 'high').length;
    const flaggedCount = result.lawyer_briefing.flagged_issues.length;
    assert.strictEqual(flaggedCount, actualHighCount, `${fixture.desc}: flagged_issues (${flaggedCount}) != high count (${actualHighCount})`);
    console.log(`✅ [PASS] ${fixture.desc}: ${result.clauses.length} sections, ${flaggedCount} important exclusions grounded.`);
  }

  console.log('\n🟢 ALL GROUNDING & CONSISTENCY TESTS PASSED!');
}

runGroundingRegressionTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
