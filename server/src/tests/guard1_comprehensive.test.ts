import {
  runGuard1InputGate,
  runGuard1InputGateAsync,
  extractAndCleanDocumentTextAsync,
  isBufferAnImage,
} from '../services/astraBackend';

const testCases = [
  {
    name: '01_G.O._Rural_Housing_Circular.txt',
    expectedCircular: true,
    text: `GOVERNMENT OF INDIA — RURAL DEVELOPMENT DEPARTMENT
Government Order No. RD-402/2025
Subject: Rural Housing Assistance Scheme Guidelines FY 2025-26

1. Eligibility Criteria: Permanent rural residents aged 21 to 60 years with annual income up to Rs. 3,00,000 may apply.
2. Benefits: Financial grant of Rs. 1,50,000 credited via Direct Benefit Transfer.
3. Deadline: Apply online on or before 31 May 2026.`,
  },
  {
    name: '02_Scheme_Notification_Scholarship.txt',
    expectedCircular: true,
    text: `DEPARTMENT OF HIGHER EDUCATION
Official Notification No. EDN-118/2025
Subject: Post-Matric Student Scholarship Scheme Circular

1. Eligibility: Students with 50% marks and household income up to Rs. 2,50,000.
2. Required Documents: Aadhaar Card, Bonafide Certificate, Income Certificate.
3. Deadline: National Scholarship Portal closes 15 July 2026.`,
  },
  {
    name: '03_Corrigendum_Pension_Amendment.txt',
    expectedCircular: true,
    text: `DEPARTMENT OF SOCIAL WELFARE
Corrigendum & Amendment Order No. SWD-290/2026
Subject: Amendment to Old Age & Widow Monthly Pension Scheme Guidelines

In partial modification of earlier scheme circular, monthly assistance is enhanced to Rs. 2,500 per beneficiary.`,
  },
  {
    name: '04_REJECT_private_rental_contract.txt',
    expectedCircular: false,
    text: `RESIDENTIAL LEASE AGREEMENT

This Agreement is made on the 1st day of April, 2026, between Mr. Rakesh Kumar Sharma ("Lessor") and Ms. Ananya Iyer ("Lessee"), for Flat No. 402, Bengaluru.
1. TERM: 11 months with mandatory lock-in period of 6 months.
2. RENT: Monthly rent Rs. 32,000. Security deposit Rs. 1,60,000.
3. DISPUTE RESOLUTION: Arbitration under Arbitration Act, 1996.
IN WITNESS WHEREOF, the parties have set their hands.`,
  },
  {
    name: '05_REJECT_news_article.txt',
    expectedCircular: false,
    text: `CITY METRO EXPANSION TO ADD FOUR NEW STATIONS BY NEXT YEAR

Bengaluru, September 2026 — The metro rail corporation announced four new stations for the Purple Line extension next year.`,
  },
  {
    name: '06_REJECT_tech_blog.txt',
    expectedCircular: false,
    text: `UNDERSTANDING MODERN WEB FRAMEWORKS IN 2026

When choosing a frontend tech stack, engineers often debate React, Vue, and Svelte state management and bundle overhead.`,
  },
  {
    name: '07_REJECT_exam_paper.txt',
    expectedCircular: false,
    text: `CENTRAL BOARD OF SECONDARY EDUCATION
GRADE 10 SCIENCE EXAMINATION - 2026
Time Allowed: 3 Hours | Maximum Marks: 80
Q1. Which chemical equation represents a balanced neutralization reaction?`,
  },
  {
    name: '08_REJECT_cooking_recipe.txt',
    expectedCircular: false,
    text: `DELICIOUS PANEER BUTTER MASALA RECIPE
Ingredients Needed: 250g Paneer, 2 tbsp Butter, Tomatoes, Ginger-Garlic paste, Garam Masala.`,
  },
  {
    name: '09_REJECT_casual_chat.txt',
    expectedCircular: false,
    text: `Hey! How are you doing today? Are we still meeting up for badminton on Saturday afternoon?`,
  },
];

async function runGuard1Suite() {
  console.log('====================================================');
  console.log('🛡️  GUARD 1 CIRCULAR GATE COMPREHENSIVE SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    const syncRes = runGuard1InputGate(tc.text);
    const asyncRes = await runGuard1InputGateAsync(tc.text);

    const syncOk = syncRes.is_valid_circular === tc.expectedCircular;
    const asyncOk = asyncRes.is_valid_circular === tc.expectedCircular;

    if (syncOk && asyncOk) {
      passed += 1;
      console.log(`✅ [PASS] ${tc.name} (Accepted=${tc.expectedCircular})`);
    } else {
      failed += 1;
      console.error(`❌ [FAIL] ${tc.name} (Expected=${tc.expectedCircular}, Sync=${syncRes.is_valid_circular}, Async=${asyncRes.is_valid_circular})`);
    }
  }

  // Extensionless PNG Buffer check
  const fakePngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  if (isBufferAnImage(fakePngBuffer, 'application/octet-stream', '26fe6b94-e5c2-481e-835b-5042fc7bau2a')) {
    try {
      const extracted = await extractAndCleanDocumentTextAsync(fakePngBuffer, 'application/octet-stream', '26fe6b94-e5c2-481e-835b-5042fc7bau2a');
      const g1Res = await runGuard1InputGateAsync(extracted);
      if (!g1Res.is_valid_circular) {
        passed += 1;
        console.log('✅ [PASS] Extensionless non-text PNG cleanly rejected.');
      } else {
        failed += 1;
      }
    } catch {
      passed += 1;
      console.log('✅ [PASS] Dummy PNG buffer rejected cleanly without crash.');
    }
  } else {
    failed += 1;
  }

  console.log(`\nSUMMARY: ${passed} Passed, ${failed} Failed`);
  if (failed > 0) process.exit(1);
}

runGuard1Suite().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
