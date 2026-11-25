import { chunkDocumentTextIntoClauses } from '../services/astraBackend.js';

function buildMultiPageGovernmentCircularText(): string {
  const pages: string[] = [];

  pages.push(`--- Page 1 ---
GOVERNMENT OF KARNATAKA
DEPARTMENT OF AGRICULTURE
Circular No. AGRI/2026/101, Dated: 01 April 2026

Subject: Crop Input Subsidy Scheme Guidelines 2026-27

1. SCHEME OVERVIEW AND OBJECTIVE
1.1 The State Government launches the Crop Input Subsidy Scheme to support small and marginal farmers.
1.2 Financial assistance is credited directly to Aadhaar-linked bank accounts via DBT.

2. ELIGIBILITY CRITERIA
2.1 Applicants must own or cultivate up to 2 hectares of agricultural land.
(a) Must hold valid land passbook or tenancy record.
(b) Must be a permanent resident of Karnataka.`);

  for (let i = 3; i <= 10; i++) {
    pages.push(`--- Page ${i - 1} ---
Section ${i}: Implementation Provision ${i}
${i}.1 District Verification: Tehsildar and Agriculture Officer shall verify applicant records for phase ${i}.
${i}.2 Disbursement Schedule: Subsidy amount of Rs. 6,000 per hectare shall be released within 30 days.`);
  }

  pages.push(`--- Page 10 ---
ANNEXURE I: REQUIRED DOCUMENTS AND DEADLINE
(a) Aadhaar Card and Bank Passbook Copy
(b) Latest Land Record Extract (RTC)
Last date to submit online application: 30th November 2026.`);

  return pages.join('\n\n');
}

async function runGranularityTests() {
  console.log('====================================================');
  console.log('  GOVSCHEME DIFF SECTION GRANULARITY & PAGE TEST');
  console.log('====================================================\n');

  let passed = true;

  // Test 1: Multi-page Circular Chunking & Sub-point Grouping
  const circularText = buildMultiPageGovernmentCircularText();
  const sections = chunkDocumentTextIntoClauses(circularText);
  console.log(`Test 1: 10-Page Circular -> ${sections.length} top-level sections extracted.`);

  if (sections.length >= 10 && sections.length <= 15) {
    console.log(`✅ [PASS] Section count (${sections.length}) matches top-level circular sections without over-fragmentation.`);
  } else {
    console.error(`❌ [FAIL] Section count (${sections.length}) out of expected range (10-15).`);
    passed = false;
  }

  // Test 2: Sub-points grouped under parent section
  const eligSection = sections.find((s) => s.title.toUpperCase().includes('ELIGIBILITY'));
  if (
    eligSection &&
    eligSection.original_text.includes('2.1 Applicants') &&
    eligSection.original_text.includes('(a) Must hold valid land passbook') &&
    eligSection.page_number === 1 &&
    eligSection.section_reference === 'Section 2'
  ) {
    console.log(`✅ [PASS] Sub-points (2.1, (a), (b)) grouped cleanly with page_number=1 and section_reference="Section 2".`);
  } else {
    console.error('❌ [FAIL] Eligibility section grouping/metadata check failed:', eligSection);
    passed = false;
  }

  // Test 3: Page 10 Annexure preservation (no raw --- Page 10 --- leaked into text)
  const annexSection = sections.find((s) => s.section_reference === 'Annexure I');
  if (
    annexSection &&
    annexSection.page_number === 10 &&
    !annexSection.original_text.includes('--- Page') &&
    annexSection.clause_type === 'required documents'
  ) {
    console.log(`✅ [PASS] Annexure I preserved page_number=10, section_reference="Annexure I", and stripped raw page markers.`);
  } else {
    console.error('❌ [FAIL] Annexure I page/reference check failed:', annexSection);
    passed = false;
  }

  // Test 4: Named Headings Without Numbers (Circular style)
  const namedCircular = `--- Page 1 ---
CIRCULAR NO. EDU/2026/05
Department of Higher Education

Eligibility Criteria:
Students enrolled in recognized degree courses with family income below Rs. 2,50,000.

Required Documents:
Income certificate, Aadhaar card, and college bonafide certificate.

--- Page 2 ---
Last Date:
Applications close on 15th October 2026.`;

  const namedSections = chunkDocumentTextIntoClauses(namedCircular);
  const docsSec = namedSections.find((s) => s.clause_type === 'required documents');
  const deadlineSec = namedSections.find((s) => s.clause_type === 'deadlines & validity');

  if (docsSec && docsSec.page_number === 1 && deadlineSec && deadlineSec.page_number === 2) {
    console.log(`✅ [PASS] Unnumbered circular headings parsed cleanly across pages 1 and 2 (${namedSections.length} sections).`);
  } else {
    console.error('❌ [FAIL] Unnumbered circular heading test failed:', namedSections);
    passed = false;
  }

  if (!passed) {
    process.exit(1);
  }
  console.log('\n🟢 ALL PHASE 2 SECTION CHUNKING & PAGE PRESERVATION TESTS PASSED!\n');
}

runGranularityTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
