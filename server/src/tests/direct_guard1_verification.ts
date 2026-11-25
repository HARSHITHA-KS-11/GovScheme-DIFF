import { runGuard1InputGate, runGuard1InputGateAsync } from '../services/astraBackend.js';

async function runDirectGuard1Tests() {
  console.log('====================================================');
  console.log('🛡️  DIRECT GUARD 1 GOVERNMENT CIRCULAR VALIDATION TEST');
  console.log('====================================================\n');

  const GOV_CIRCULAR_1 = `GOVERNMENT OF KARNATAKA
DEPARTMENT OF SOCIAL WELFARE
Circular No. SWD/2026/104, Dated: 15th April 2026

Sub: State Senior Citizen & Family Welfare Assistance Scheme — Eligibility and Application Guidelines

1. SCHEME OVERVIEW: The State Government hereby launches direct monthly financial assistance of Rs. 2,000 per month for eligible senior citizens through Direct Benefit Transfer (DBT).
2. ELIGIBILITY & INCOME LIMIT: Applicants must be aged 60 years or above and permanent residents of Karnataka with annual family income not exceeding Rs. 2,50,000.
3. REQUIRED DOCUMENTS: Aadhaar card, Tehsildar Income Certificate, age proof, and bank passbook copy.
4. DEADLINE: Applications must be submitted on the official State Welfare Portal on or before 30th September 2026.`;

  const GOV_ORDER_2 = `G.O. Ms. No. 48, Department of Agriculture, Dated: 10th May 2026
GOVERNMENT ORDER — FARMER INPUT SUBSIDY SCHEME
In partial modification of earlier scheme guidelines, the Government of India and State Agriculture Department sanction a crop input grant of Rs. 6,000 per hectare for small and marginal farmers owning up to 2 hectares of cultivable land.
Beneficiaries must link Aadhaar and land records on the PM-KISAN / State Portal before 15th November 2026.`;

  const NOTIFICATION_3 = `OFFICIAL NOTIFICATION No. EDU/SCH/2026/12
Ministry of Education — Post-Matric Scholarship Notification
It is hereby notified for the information of all eligible students belonging to economically weaker sections (annual household income below Rs. 3,00,000) that online applications for the 2026-27 Scholarship Scheme are open. Last date for renewal and fresh registration is 31st October 2026.`;

  const AMENDMENT_4 = `CORRIGENDUM & POLICY AMENDMENT
Office Memorandum No. F.12/2026-Housing
Department of Urban Development
In partial modification and supersession of Para 3 of Circular No. HUD/2025/88 regarding the Urban Housing Subsidy Scheme:
1. Income Limit Amendment: The annual household income ceiling is enhanced from Rs. 3,00,000 to Rs. 4,50,000 with immediate effect.
2. Deadline Extension: The last date to submit required documents is extended up to 31st December 2026.`;

  const GUIDELINES_5 = `OPERATIONAL GUIDELINES FOR MSME CREDIT SUPPORT SCHEME (2026)
Issued by Ministry of Micro, Small and Medium Enterprises
1. Eligibility Criteria: Registered micro and small enterprises with valid Udyam Registration.
2. Benefits & Assistance: Interest subsidy of 3% per annum on working capital loans up to Rs. 10,00,000.
3. Exclusions: Units that have defaulted on prior government grants are ineligible.
4. Grievance Redressal: Contact the District Nodal Officer or MSME Helpline.`;

  const REJECT_PRIVATE_LEASE = `RESIDENTIAL LEASE AGREEMENT
This Agreement is made on the 1st day of April, 2026, between Mr. Rakesh Kumar Sharma (Lessor) and Ms. Ananya Iyer (Lessee), for Flat No. 402, Sunrise Apartments, Bengaluru.
1. TERM: This lease shall be for 11 months with a 6-month lock-in period.
2. RENT: The monthly rent shall be Rs. 32,000/- payable on or before the 5th of every month.
3. SECURITY DEPOSIT: Interest-free security deposit of Rs. 1,60,000/-.
IN WITNESS WHEREOF, the parties have signed above.`;

  const REJECT_TECH_CHANGELOG = `GovScheme Pipeline Grounding, Risk Alignment & Taxonomy Walkthrough
Refactored pipeline code to use pure CSS Tailwind breakpoints. Unit test suite passing 100%.
npm run dev:client running on port 5173. Fixed bug where Guard 1 bypassed non-circular documents.
Changelog:
- Refactored Astra backend classifier.
- Added dual engine Groq key failover.`;

  const REJECT_RECIPE = `Delicious Butter Chicken Recipe
Ingredients:
- 500g Chicken thighs, boneless
- 1 cup Heavy cream
- 2 tbsp Butter
Instructions:
1. Marinate chicken in yogurt and spices for 30 minutes.
2. Simmer in tomato gravy with cream and butter.`;

  const testCases = [
    { type: 'CIRCULAR', name: 'Scheme Circular (Social Welfare)', text: GOV_CIRCULAR_1, expectPass: true },
    { type: 'G.O.', name: 'Government Order (Farmer Subsidy)', text: GOV_ORDER_2, expectPass: true },
    { type: 'NOTIFICATION', name: 'Official Notification (Scholarship)', text: NOTIFICATION_3, expectPass: true },
    { type: 'AMENDMENT', name: 'Corrigendum & Policy Amendment (Housing)', text: AMENDMENT_4, expectPass: true },
    { type: 'GUIDELINES', name: 'Operational Scheme Guidelines (MSME)', text: GUIDELINES_5, expectPass: true },
    { type: 'REJECT', name: 'Private Residential Lease Agreement', text: REJECT_PRIVATE_LEASE, expectPass: false },
    { type: 'REJECT', name: 'Engineering Changelog Walkthrough', text: REJECT_TECH_CHANGELOG, expectPass: false },
    { type: 'REJECT', name: 'Cooking Recipe', text: REJECT_RECIPE, expectPass: false },
  ];

  let passedAll = true;

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    console.log(`----------------------------------------------------`);
    console.log(`🧪 TEST ${i + 1} [${tc.type}]: ${tc.name}`);
    console.log(`----------------------------------------------------`);

    const t0 = Date.now();
    const syncRes = runGuard1InputGate(tc.text);
    const asyncRes = await runGuard1InputGateAsync(tc.text);
    const elapsed = Date.now() - t0;

    console.log(`   ⏱️ Elapsed Time: ${elapsed}ms`);
    console.log(`   Sync Rule Engine Result  : ${syncRes.is_valid_circular ? '✅ ACCEPTED' : '❌ REJECTED'} (${syncRes.document_kind || 'other'} | ${syncRes.category})`);
    console.log(`   Async Classifier Result  : ${asyncRes.is_valid_circular ? '✅ ACCEPTED' : '❌ REJECTED'} (${asyncRes.document_kind || 'other'} | ${asyncRes.category})`);
    if (!asyncRes.is_valid_circular) {
      console.log(`   Rejection Reason: "${asyncRes.rejection_reason}"`);
    }

    if (tc.expectPass) {
      if (syncRes.is_valid_circular && asyncRes.is_valid_circular) {
        console.log(`✅ [PASS] ${tc.name} ACCEPTED as expected`);
      } else {
        console.error(`❌ [FAIL] ${tc.name} was REJECTED unexpectedly!`);
        passedAll = false;
      }
    } else {
      if (!syncRes.is_valid_circular && !asyncRes.is_valid_circular) {
        console.log(`✅ [PASS] ${tc.name} REJECTED as expected`);
      } else {
        console.error(`❌ [FAIL] ${tc.name} was ACCEPTED unexpectedly!`);
        passedAll = false;
      }
    }
  }

  // Cancel Control Signal Test
  console.log('\n----------------------------------------------------');
  console.log('🧪 TEST 9: Cancel AbortSignal test on runGuard1InputGateAsync');
  console.log('----------------------------------------------------');

  const controller = new AbortController();
  controller.abort();

  const cancelStart = Date.now();
  const cancelRes = await runGuard1InputGateAsync(GOV_CIRCULAR_1, controller.signal);
  const cancelElapsed = Date.now() - cancelStart;

  console.log(`   ⏱️ Aborted Guard 1 Call Resolved in ${cancelElapsed}ms`);
  console.log(`   Result: ${cancelRes.is_valid_circular ? 'ACCEPTED' : 'REJECTED'}`);
  if (!cancelRes.is_valid_circular) {
    passedAll = false;
  } else {
    console.log(`✅ [PASS] Pre-aborted signal handled instantly (${cancelElapsed}ms) without hanging!`);
  }

  if (passedAll) {
    console.log('\n====================================================');
    console.log('🎉 ALL 9 DIRECT GUARD 1 TESTS PASSED PERFECTLY!');
    console.log('====================================================\n');
  } else {
    console.error('\n❌ Some Guard 1 tests failed.');
    process.exit(1);
  }
}

runDirectGuard1Tests().catch((err) => {
  console.error('❌ Test crashed:', err);
  process.exit(1);
});
