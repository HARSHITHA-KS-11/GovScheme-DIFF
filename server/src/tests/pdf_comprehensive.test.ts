import fs from 'fs';
import os from 'os';
import path from 'path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PDFParse } from 'pdf-parse';
import {
  extractAndCleanDocumentTextAsync,
  runGuard1InputGateAsync,
  chunkDocumentTextIntoClauses,
  containsPdfObjectNoise,
  isReadableProse,
} from '../services/astraBackend';
import { MAX_PDF_PAGES_ERROR_MSG } from '../config/constants';

async function generateTestFixtures() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'govscheme-pdf-test-'));

  // 1. Multi-page Digital Government Scheme Circular PDF (3 pages)
  const circularDoc = await PDFDocument.create();
  const font = await circularDoc.embedFont(StandardFonts.Helvetica);

  const p1 = circularDoc.addPage([600, 800]);
  p1.drawText(
    [
      'GOVERNMENT OF INDIA',
      'MINISTRY OF SOCIAL JUSTICE AND EMPOWERMENT',
      'Circular No. MSJE/2026/210, Dated: 10th April 2026',
      '',
      '1. SCHEME OVERVIEW: National Senior Citizen Financial Assistance Scheme provides Rs. 2,000 per month via DBT.',
      '2. ELIGIBILITY CRITERIA: Permanent Indian residents aged 60 years or above.',
    ].join('\n'),
    { x: 45, y: 740, size: 11, font, color: rgb(0, 0, 0), maxWidth: 510, lineHeight: 16 }
  );

  const p2 = circularDoc.addPage([600, 800]);
  p2.drawText(
    [
      'Para 3: INCOME LIMIT AND EXCLUSIONS',
      'Annual household income must not exceed Rs. 2,50,000 from all sources.',
      'Taxpayers and government pensioners are excluded from this benefit.',
      '',
      '4. REQUIRED DOCUMENTS: Aadhaar card, Income Certificate, Age Proof, and Aadhaar-linked Bank Passbook.',
    ].join('\n'),
    { x: 45, y: 740, size: 11, font, color: rgb(0, 0, 0), maxWidth: 510, lineHeight: 16 }
  );

  const p3 = circularDoc.addPage([600, 800]);
  p3.drawText(
    [
      'ANNEXURE I: APPLICATION DEADLINES AND NODAL OFFICER',
      'Online applications must be submitted on the National Welfare Portal on or before 30th September 2026.',
      'Contact District Welfare Nodal Officer for grievance redressal.',
    ].join('\n'),
    { x: 45, y: 740, size: 11, font, color: rgb(0, 0, 0), maxWidth: 510, lineHeight: 16 }
  );

  const circularPdfPath = path.join(tmpDir, 'gov_scheme_circular_3page.pdf');
  fs.writeFileSync(circularPdfPath, await circularDoc.save());

  // 2. Real Scanned / Image-Only PDF (rasterize circular pages to PNG and embed as pure images, ZERO selectable text)
  const parser = new PDFParse(new Uint8Array(fs.readFileSync(circularPdfPath)));
  const screenshots = await parser.getScreenshot({ partial: [1, 2], scale: 2, imageBuffer: true });
  await parser.destroy();

  const scannedDoc = await PDFDocument.create();
  for (const shot of screenshots.pages) {
    const pngImage = await scannedDoc.embedPng(shot.data);
    const page = scannedDoc.addPage([600, 800]);
    page.drawImage(pngImage, { x: 0, y: 0, width: 600, height: 800 });
  }
  const scannedPdfPath = path.join(tmpDir, 'scanned_gov_circular.pdf');
  fs.writeFileSync(scannedPdfPath, await scannedDoc.save());

  // Standalone PNG image of Page 1 for image OCR verification
  const scannedPngPath = path.join(tmpDir, 'scanned_circular_page1.png');
  fs.writeFileSync(scannedPngPath, screenshots.pages[0].data);

  // 3. News Article PDF (Should be rejected by Guard 1)
  const newsDoc = await PDFDocument.create();
  const newsFont = await newsDoc.embedFont(StandardFonts.Helvetica);
  const newsPage = newsDoc.addPage([600, 800]);
  newsPage.drawText(
    'CITY METRO EXPANSION TO ADD FOUR NEW STATIONS BY NEXT YEAR\n\nBengaluru, September 2026 — The city metro rail corporation announced yesterday that four new stations will be added to the Purple Line extension.',
    { x: 50, y: 740, size: 11, font: newsFont, color: rgb(0, 0, 0), maxWidth: 500, lineHeight: 16 }
  );
  const newsPdfPath = path.join(tmpDir, 'reject_news_article.pdf');
  fs.writeFileSync(newsPdfPath, await newsDoc.save());

  // 4. Private Legal Contract PDF (Should be rejected by Guard 1)
  const leaseDoc = await PDFDocument.create();
  const leaseFont = await leaseDoc.embedFont(StandardFonts.Helvetica);
  const leasePage = leaseDoc.addPage([600, 800]);
  leasePage.drawText(
    'RESIDENTIAL LEASE AGREEMENT\n\nThis Agreement is made between Mr. Rakesh Sharma (Lessor) and Ms. Ananya Iyer (Lessee).\n1. RENT: Monthly rent shall be Rs. 32,000.\n2. SECURITY DEPOSIT: Rs. 1,60,000 refundable upon vacating.',
    { x: 50, y: 740, size: 11, font: leaseFont, color: rgb(0, 0, 0), maxWidth: 500, lineHeight: 16 }
  );
  const leasePdfPath = path.join(tmpDir, 'reject_private_lease.pdf');
  fs.writeFileSync(leasePdfPath, await leaseDoc.save());

  // 5. 35-Page PDF (> 30 Page Cap)
  const overCapDoc = await PDFDocument.create();
  const overCapFont = await overCapDoc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 35; i++) {
    const p = overCapDoc.addPage([600, 800]);
    p.drawText(`Page ${i} of 35 - Government Circular Section ${i}`, { x: 50, y: 750, font: overCapFont, size: 12 });
  }
  const overCapPath = path.join(tmpDir, '35_pages_over_limit.pdf');
  fs.writeFileSync(overCapPath, await overCapDoc.save());

  // 6. 10-Page Government Circular PDF (<= 30 Page Cap)
  const underCapDoc = await PDFDocument.create();
  const underCapFont = await underCapDoc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 10; i++) {
    const p = underCapDoc.addPage([600, 800]);
    p.drawText(
      `GOVERNMENT ORDER PAGE ${i}\nCircular No. G.O./2026/${i}\n${i}. ELIGIBILITY & BENEFITS: Eligible beneficiaries receive scheme subsidy and grants upon submitting required documents.`,
      { x: 50, y: 750, font: underCapFont, size: 11, maxWidth: 500, lineHeight: 16 }
    );
  }
  const underCapPath = path.join(tmpDir, '10_pages_under_limit.pdf');
  fs.writeFileSync(underCapPath, await underCapDoc.save());

  return { tmpDir, circularPdfPath, scannedPdfPath, scannedPngPath, newsPdfPath, leasePdfPath, overCapPath, underCapPath };
}

async function runPdfRegressionSuite() {
  console.log('====================================================');
  console.log('📄 PHASE 2: PDF EXTRACTION, SCANNED OCR & PAGE PRESERVATION');
  console.log('====================================================\n');

  const fixtures = await generateTestFixtures();
  let passed = 0;
  let failed = 0;

  try {
    // TEST 1: Multi-page Digital Circular PDF -> Page Markers + Section References + Guard 1
    console.log('📁 TEST 1: Multi-page Digital Government Circular PDF...');
    const circularBuf = fs.readFileSync(fixtures.circularPdfPath);
    const extracted = await extractAndCleanDocumentTextAsync(circularBuf, 'application/pdf', 'gov_scheme_circular_3page.pdf');
    const g1 = await runGuard1InputGateAsync(extracted);
    const sections = chunkDocumentTextIntoClauses(extracted);

    const hasPageMarkers = extracted.includes('--- Page 1 ---') && extracted.includes('--- Page 2 ---') && extracted.includes('--- Page 3 ---');
    const p1Sec = sections.find((s) => s.original_text.includes('SCHEME OVERVIEW'));
    const p2Sec = sections.find((s) => s.original_text.includes('INCOME LIMIT') || s.title.includes('INCOME LIMIT'));
    const p3Sec = sections.find((s) => s.original_text.includes('National Welfare Portal'));
    const pagesPreserved = p1Sec?.page_number === 1 && p2Sec?.page_number === 2 && p3Sec?.page_number === 3;
    const refsPreserved = Boolean(p2Sec?.section_reference === 'Para 3' && p3Sec?.section_reference === 'Annexure I');

    if (!containsPdfObjectNoise(extracted) && isReadableProse(extracted) && g1.is_valid_circular && hasPageMarkers && pagesPreserved && refsPreserved) {
      passed++;
      console.log(`✅ [PASS] 3-page circular extracted (${sections.length} sections) with exact page_number (1,2,3) & section_reference (Para 3, Annexure I).`);
    } else {
      failed++;
      console.error('❌ [FAIL] Multi-page circular check failed:', {
        valid: g1.is_valid_circular,
        hasPageMarkers,
        pagesPreserved,
        refsPreserved,
        p1Page: p1Sec?.page_number,
        p2Page: p2Sec?.page_number,
        p2Ref: p2Sec?.section_reference,
        p3Page: p3Sec?.page_number,
        p3Ref: p3Sec?.section_reference,
      });
    }

    // TEST 2: Real Scanned / Image-Only PDF (0 selectable text -> PDFParse.getScreenshot + Tesseract OCR)
    console.log('\n📁 TEST 2: Scanned Image-Only PDF OCR (PDF -> PNG -> Tesseract)...');
    const scannedBuf = fs.readFileSync(fixtures.scannedPdfPath);
    // Verify the test fixture truly has NO selectable text first
    const checkParser = new PDFParse(new Uint8Array(scannedBuf));
    const rawSelectable = await checkParser.getText();
    await checkParser.destroy();
    const rawSelectableLen = (rawSelectable.text || '').replace(/--\s*\d+\s+of\s+\d+\s*--/gi, '').trim().length;

    const ocrText = await extractAndCleanDocumentTextAsync(scannedBuf, 'application/pdf', 'scanned_gov_circular.pdf');
    const g1Scanned = await runGuard1InputGateAsync(ocrText);
    const scannedSections = chunkDocumentTextIntoClauses(ocrText);
    const hasScannedPages = ocrText.includes('--- Page 1 ---') && ocrText.includes('--- Page 2 ---');
    const hasExpectedTerms = /MINISTRY OF SOCIAL JUSTICE/i.test(ocrText) && /2,50,000/.test(ocrText);

    if (rawSelectableLen === 0 && hasScannedPages && hasExpectedTerms && g1Scanned.is_valid_circular && scannedSections.some((s) => s.page_number === 2)) {
      passed++;
      console.log(`✅ [PASS] Scanned PDF (0 digital chars) OCR succeeded across 2 pages and passed Guard 1 (${scannedSections.length} sections).`);
    } else {
      failed++;
      console.error('❌ [FAIL] Scanned PDF OCR failed:', { rawSelectableLen, hasScannedPages, hasExpectedTerms, valid: g1Scanned.is_valid_circular });
    }

    // TEST 3: Standalone PNG Image OCR
    console.log('\n📁 TEST 3: Standalone PNG Image OCR...');
    const pngBuf = fs.readFileSync(fixtures.scannedPngPath);
    const pngText = await extractAndCleanDocumentTextAsync(pngBuf, 'application/octet-stream', 'circular_photo');
    const g1Png = await runGuard1InputGateAsync(pngText);
    if (isReadableProse(pngText) && /ELIGIBILITY/i.test(pngText) && g1Png.is_valid_circular) {
      passed++;
      console.log(`✅ [PASS] PNG image OCR extracted ${pngText.length} chars (magic-byte MIME detection) and passed Guard 1.`);
    } else {
      failed++;
      console.error('❌ [FAIL] PNG image OCR failed:', { len: pngText.length, valid: g1Png.is_valid_circular });
    }

    // TEST 4: News PDF Rejected by Guard 1
    console.log('\n📁 TEST 4: News Article PDF Rejection...');
    const newsText = await extractAndCleanDocumentTextAsync(fs.readFileSync(fixtures.newsPdfPath), 'application/pdf', 'reject_news_article.pdf');
    const g1News = await runGuard1InputGateAsync(newsText);
    if (!g1News.is_valid_circular) {
      passed++;
      console.log(`✅ [PASS] News PDF rejected by Guard 1: "${g1News.rejection_reason}"`);
    } else {
      failed++;
      console.error('❌ [FAIL] News PDF was accepted unexpectedly.');
    }

    // TEST 5: Private Legal Contract PDF Rejected by Guard 1
    console.log('\n📁 TEST 5: Private Lease Contract PDF Rejection...');
    const leaseText = await extractAndCleanDocumentTextAsync(fs.readFileSync(fixtures.leasePdfPath), 'application/pdf', 'reject_private_lease.pdf');
    const g1Lease = await runGuard1InputGateAsync(leaseText);
    if (!g1Lease.is_valid_circular) {
      passed++;
      console.log(`✅ [PASS] Private Lease PDF rejected by Guard 1: "${g1Lease.rejection_reason}"`);
    } else {
      failed++;
      console.error('❌ [FAIL] Private Lease PDF was accepted unexpectedly.');
    }

    // TEST 6: 35-Page PDF (> 30 Page Cap) Rejected
    console.log('\n📁 TEST 6: 35-Page PDF (> 30 Page Limit)...');
    try {
      await extractAndCleanDocumentTextAsync(fs.readFileSync(fixtures.overCapPath), 'application/pdf', '35_pages_over_limit.pdf');
      failed++;
      console.error('❌ [FAIL] 35-Page PDF was not rejected by page limit.');
    } catch (err: any) {
      if (err.message === MAX_PDF_PAGES_ERROR_MSG) {
        passed++;
        console.log(`✅ [PASS] 35-Page PDF rejected with exact limit error: "${err.message}"`);
      } else {
        failed++;
        console.error('❌ [FAIL] 35-Page PDF threw unexpected error:', err.message);
      }
    }

    // TEST 7: 10-Page Circular PDF (<= 30 Page Cap) Accepted with 10 Pages Preserved
    console.log('\n📁 TEST 7: 10-Page Circular PDF (<= 30 Page Limit)...');
    const text10 = await extractAndCleanDocumentTextAsync(fs.readFileSync(fixtures.underCapPath), 'application/pdf', '10_pages_under_limit.pdf');
    const g1Under = await runGuard1InputGateAsync(text10);
    const sections10 = chunkDocumentTextIntoClauses(text10);
    const maxPage = Math.max(...sections10.map((s) => s.page_number || 0));
    if (g1Under.is_valid_circular && maxPage === 10) {
      passed++;
      console.log(`✅ [PASS] 10-Page Circular accepted with all 10 pages preserved (${sections10.length} sections).`);
    } else {
      failed++;
      console.error('❌ [FAIL] 10-Page Circular failed:', { valid: g1Under.is_valid_circular, maxPage });
    }
  } finally {
    fs.rmSync(fixtures.tmpDir, { recursive: true, force: true });
  }

  console.log('\n====================================================');
  console.log(` SUMMARY: ${passed} Passed, ${failed} Failed out of 7 Phase 2 PDF/OCR Tests`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPdfRegressionSuite().catch((err) => {
  console.error('❌ Phase 2 test crashed:', err);
  process.exit(1);
});
