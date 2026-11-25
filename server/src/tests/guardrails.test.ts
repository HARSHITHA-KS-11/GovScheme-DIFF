import fs from 'fs';
import path from 'path';
import { runGuard1InputGate, runGuard1InputGateAsync } from '../services/astraBackend.js';

interface TestCase {
  name: string;
  filePath?: string;
  inlineText?: string;
  expectedResult: 'REJECTED' | 'ACCEPTED';
}

const getDirName = () => {
  if (typeof __dirname !== 'undefined') return __dirname;
  return path.resolve(process.cwd(), 'server/src/tests');
};

const FIXTURES_DIR = path.resolve(getDirName(), 'fixtures');

const testCases: TestCase[] = [
  {
    name: 'Government Order (G.O.) — Housing Subsidy',
    inlineText: `GOVERNMENT OF KARNATAKA
HOUSING DEPARTMENT
G.O. Ms. No. 112/HUD/2026, Dated 01.04.2026
Sub: Affordable Housing Subsidy Scheme Guidelines
1. Eligibility: Economically Weaker Section households with annual family income up to Rs. 3,00,000.
2. Benefit: Financial assistance grant of Rs. 1,50,000 per beneficiary via DBT.
3. Required Documents: Aadhaar card, Income Certificate, and residence proof.
4. Last Date: Submit online applications by 30th November 2026.`,
    expectedResult: 'ACCEPTED',
  },
  {
    name: 'Scheme Circular — Post-Matric Scholarship',
    inlineText: `Circular No. DHE/SCH/2026/09
Department of Higher Education, State Government
Sub: Post-Matric Student Scholarship Scheme 2026-27
1. Objective: Provide annual tuition fee reimbursement and stipend to eligible college students.
2. Income Limit: Parental annual income must not exceed Rs. 2,50,000.
3. Application Process: Apply online on the State Scholarship Portal before 31st October 2026.`,
    expectedResult: 'ACCEPTED',
  },
  {
    name: 'Official Gazette Notification — Rural Pension Scheme',
    inlineText: `OFFICIAL NOTIFICATION
Ministry of Rural Development — Gazette Notification No. RD-45/2026
It is hereby notified that under the National Social Assistance Pension Scheme, eligible beneficiaries aged 60 to 79 years shall receive Rs. 1,500 per month. Aadhaar-seeded bank account and age proof are mandatory documents.`,
    expectedResult: 'ACCEPTED',
  },
  {
    name: 'Policy Amendment / Corrigendum — Farmer Support Scheme',
    inlineText: `CORRIGENDUM / AMENDMENT CIRCULAR
Department of Agriculture & Farmers Welfare
Office Memorandum No. AGRI/2026/22
In partial modification of earlier Scheme Circular No. AGRI/2025/10, the deadline for farmer crop insurance registration is extended from 31st July 2026 to 31st August 2026. All other eligibility criteria and subsidy benefits remain unchanged.`,
    expectedResult: 'ACCEPTED',
  },
  {
    name: 'Scheme Guidelines — Skill Development Mission',
    inlineText: `OPERATIONAL GUIDELINES — YOUTH SKILL & APPRENTICESHIP MISSION
Issued by Ministry of Skill Development
1. Target Beneficiaries: Unemployed youth aged 18 to 35 years.
2. Benefits: Free training and monthly stipend of Rs. 3,000 during the 6-month training period.
3. Nodal Officer: District Skill Development Officer for grievance redressal.`,
    expectedResult: 'ACCEPTED',
  },
  {
    name: 'Private Residential Lease Agreement (Rejected)',
    filePath: path.join(FIXTURES_DIR, '01_rental_agreement.txt'),
    expectedResult: 'REJECTED',
  },
  {
    name: 'Private NDA Contract (Rejected)',
    filePath: path.join(FIXTURES_DIR, '03_nda.txt'),
    expectedResult: 'REJECTED',
  },
  {
    name: 'Private Employment Agreement (Rejected)',
    filePath: path.join(FIXTURES_DIR, '04_employment_agreement.txt'),
    expectedResult: 'REJECTED',
  },
  {
    name: 'School Exam Paper Fixture (Rejected)',
    filePath: path.join(FIXTURES_DIR, 'failing_exam_paper.txt'),
    expectedResult: 'REJECTED',
  },
  {
    name: 'Random Photo / Non-Document Media OCR (Rejected)',
    filePath: path.join(FIXTURES_DIR, 'failing_random_photo_ocr.txt'),
    expectedResult: 'REJECTED',
  },
  {
    name: 'News Article Report Fixture (Rejected)',
    filePath: path.join(FIXTURES_DIR, 'failing_news_article.txt'),
    expectedResult: 'REJECTED',
  },
  {
    name: 'Casual Ordinary Text: Weather Query (Rejected)',
    inlineText: 'What is the weather like in Mumbai today? Is it going to rain in the evening?',
    expectedResult: 'REJECTED',
  },
  {
    name: 'Casual Ordinary Text: Hobby Paragraph (Rejected)',
    inlineText: 'I love playing badminton on weekends with my friends at the local sports club.',
    expectedResult: 'REJECTED',
  },
];

async function runGuardrailRegressionTests() {
  console.log('====================================================');
  console.log('   GOVSCHEME DIFF GUARD 1 REGRESSION SUITE');
  console.log('====================================================\n');

  let passedCount = 0;
  let failedCount = 0;

  for (const tc of testCases) {
    let content = '';
    if (tc.filePath) {
      if (!fs.existsSync(tc.filePath)) {
        console.error(`❌ [MISSING FIXTURE] ${tc.name}: ${tc.filePath}`);
        failedCount++;
        continue;
      }
      content = fs.readFileSync(tc.filePath, 'utf-8');
    } else if (tc.inlineText) {
      content = tc.inlineText;
    }

    const syncResult = runGuard1InputGate(content);
    const asyncResult = await runGuard1InputGateAsync(content);
    const guard1Result = asyncResult || syncResult;

    const actualResult: 'ACCEPTED' | 'REJECTED' = guard1Result.is_valid_circular ? 'ACCEPTED' : 'REJECTED';
    const isMatch = actualResult === tc.expectedResult && (syncResult.is_valid_circular ? 'ACCEPTED' : 'REJECTED') === tc.expectedResult;

    if (isMatch) {
      passedCount++;
      console.log(`✅ [PASS] ${tc.name}`);
      console.log(`   Guard 1 Status: ${actualResult} (Kind: ${guard1Result.document_kind || 'other'}, Category: ${guard1Result.category})`);
      if (actualResult === 'REJECTED') {
        console.log(`   Rejection Reason: "${guard1Result.rejection_reason}"`);
      }
      console.log('----------------------------------------------------');
    } else {
      failedCount++;
      console.error(`❌ [FAIL] ${tc.name}`);
      console.error(`   Expected: ${tc.expectedResult}, Sync: ${syncResult.is_valid_circular}, Async: ${asyncResult.is_valid_circular}`);
      console.error(`   Rejection Reason: "${guard1Result.rejection_reason}"`);
      console.error('----------------------------------------------------');
    }
  }

  console.log(`\nTEST SUMMARY: ${passedCount} Passed, ${failedCount} Failed out of ${testCases.length} tests.`);

  if (failedCount > 0) {
    console.error('\n🔴 REGRESSION TESTS FAILED! Fix Guard 1 before proceeding.');
    process.exit(1);
  } else {
    console.log('\n🟢 ALL GUARD 1 REGRESSION TESTS PASSED CLEANLY!\n');
    process.exit(0);
  }
}

runGuardrailRegressionTests();
