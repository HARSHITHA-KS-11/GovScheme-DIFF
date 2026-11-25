import assert from 'assert';
import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(process.cwd(), 'server/.env'), override: true });

import { connectDatabase, disconnectDatabase } from '../config/db';
import { analyzeDocumentText, compareTwoDocuments } from '../services/astraBackend';
import {
  saveOrReuseCircularAnalysis,
  saveOrReuseComparisonHistory,
  listCircularsWithHistory,
  getCircularByIdWithVersions,
  getCircularVersionById,
  listComparisonHistory,
  getComparisonHistoryById,
} from '../services/circularHistoryService';
import {
  CircularModel,
  CircularVersionModel,
  ComparisonHistoryModel,
} from '../models/CircularModels';

async function runCircularPersistenceTests() {
  console.log('====================================================');
  console.log('  MONGODB CIRCULAR STORAGE & VERSION HISTORY TESTS');
  console.log('====================================================\n');

  const dbStatus = await connectDatabase();
  if (!dbStatus.connected || dbStatus.databaseName !== 'govscheme_diff') {
    throw new Error(`MongoDB must be connected to govscheme_diff before running persistence tests (got: ${JSON.stringify(dbStatus)})`);
  }
  console.log(`✅ [PASS] Connected to MongoDB Atlas database "${dbStatus.databaseName}".`);

  const runToken = `${Date.now()}`;
  const createdCircularIds: string[] = [];
  const createdVersionIds: string[] = [];
  const createdComparisonIds: string[] = [];

  const originalCircularText = `--- Page 1 ---
GOVERNMENT OF KARNATAKA
Government Order No. TEST-GW-${runToken}/2026
Subject: Test Rural Solar Pump Subsidy Scheme Guidelines ${runToken}

1. Eligibility Criteria
Farmers owning up to 5 acres of agricultural land aged 21 to 60 years with family income up to Rs. 2,00,000 may apply.

--- Page 2 ---
2. Financial Subsidy Benefit
Eligible beneficiaries receive Rs. 1,00,000 capital subsidy via Direct Benefit Transfer.

3. Required Documents
Submit Aadhaar Card, Land Record (RTC), and Bank Passbook copy before 30 June 2026.`;

  const amendmentCircularText = `--- Page 1 ---
GOVERNMENT OF KARNATAKA
Corrigendum Order No. TEST-GW-${runToken}-AMD/2026
In partial modification of Government Order No. TEST-GW-${runToken}/2026
Subject: Revised Rural Solar Pump Subsidy Scheme Guidelines ${runToken}

1. Eligibility Criteria
Farmers owning up to 7 acres of agricultural land aged 21 to 65 years with family income up to Rs. 2,50,000 may apply.

--- Page 2 ---
2. Financial Subsidy Benefit
Eligible beneficiaries receive Rs. 1,25,000 capital subsidy via Direct Benefit Transfer.

3. Required Documents
Submit Aadhaar Card, Land Record (RTC), Income Certificate, and Bank Passbook copy before 31 August 2026.

4. Grievance Officer
Citizens may appeal to the District Agriculture Officer within 30 days.`;

  try {
    // 1. Save initial circular & verify sections, page numbers, source info
    const analysisV1 = await analyzeDocumentText(originalCircularText);
    const saveV1 = await saveOrReuseCircularAnalysis({
      extractedText: originalCircularText,
      analysisResult: analysisV1,
      sourceType: 'upload',
      sourceFilename: `solar_scheme_${runToken}.pdf`,
      mimeType: 'application/pdf',
    });

    assert.strictEqual(saveV1.saved, true, 'Expected saveV1.saved = true');
    assert.strictEqual(saveV1.deduplicated, false, 'Expected new save (deduplicated = false)');
    assert.strictEqual(saveV1.versionNumber, 1, 'Expected versionNumber = 1');
    assert.strictEqual(saveV1.pageCount, 2, 'Expected pageCount = 2');
    assert(saveV1.circularId && saveV1.versionId, 'Expected circularId and versionId');
    createdCircularIds.push(saveV1.circularId!);
    createdVersionIds.push(saveV1.versionId!);
    console.log(`✅ [PASS] Test 1: Saved original circular v1 (pages=${saveV1.pageCount}, sections=${saveV1.sectionCount}).`);

    // 2. Upload identical content again -> MUST deduplicate (no duplicate record)
    const dupRes = await saveOrReuseCircularAnalysis({
      extractedText: originalCircularText.replace(/\n/g, '\r\n') + '   ',
      analysisResult: analysisV1,
      sourceType: 'paste',
      sourceFilename: 'duplicate_paste.txt',
    });
    assert.strictEqual(dupRes.saved, true);
    assert.strictEqual(dupRes.deduplicated, true, 'Duplicate upload must set deduplicated=true');
    assert.strictEqual(dupRes.versionId, saveV1.versionId, 'Duplicate upload must reuse exact versionId');
    const verCountAfterDup = await CircularVersionModel.countDocuments({ circularId: new mongoose.Types.ObjectId(saveV1.circularId!) });
    assert.strictEqual(verCountAfterDup, 1, 'Expected exactly 1 CircularVersion after duplicate upload');
    console.log('✅ [PASS] Test 2: Identical circular upload deduplicated cleanly (0 duplicate records created).');

    // 3. Save amendment & verify automatic/parent version linking
    const analysisV2 = await analyzeDocumentText(amendmentCircularText);
    const saveV2 = await saveOrReuseCircularAnalysis({
      extractedText: amendmentCircularText,
      analysisResult: analysisV2,
      sourceType: 'upload',
      sourceFilename: `solar_scheme_${runToken}_corrigendum.pdf`,
      mimeType: 'application/pdf',
    });
    assert.strictEqual(saveV2.saved, true);
    assert.strictEqual(saveV2.deduplicated, false);
    assert.strictEqual(saveV2.circularId, saveV1.circularId, 'Amendment must link to parent circularId');
    assert.strictEqual(saveV2.parentVersionId, saveV1.versionId, 'Amendment must point parentVersionId -> v1');
    assert.strictEqual(saveV2.versionNumber, 2, 'Expected versionNumber = 2');
    assert.strictEqual(saveV2.isAmendment, true, 'Expected isAmendment = true');
    createdVersionIds.push(saveV2.versionId!);
    console.log('✅ [PASS] Test 3: Amendment stored as v2 with parentVersionId linked to v1.');

    // 4. Retrieve circular list & version history + preserved page/section refs
    const list = await listCircularsWithHistory(20);
    const matchedInList = list.find((c) => c.id === saveV1.circularId);
    assert(matchedInList && matchedInList.versions.length === 2, 'Listed circular must include 2 ordered versions');

    const fullCircular = await getCircularByIdWithVersions(saveV1.circularId!);
    assert(fullCircular && fullCircular.versions.length === 2, 'Expected 2 versions from getCircularByIdWithVersions');
    const page2Section = fullCircular.versions[0].sections.find((s: any) => s.page_number === 2);
    assert(page2Section && page2Section.section_reference, 'Expected preserved page_number=2 & section_reference');
    assert.strictEqual(fullCircular.versions[0].sourceFilename, `solar_scheme_${runToken}.pdf`);

    const fetchedV2 = await getCircularVersionById(saveV2.versionId!);
    assert(fetchedV2 && fetchedV2.extractedText.includes('--- Page 2 ---'), 'Expected extractedText with Page 2 marker preserved');
    console.log('✅ [PASS] Test 4: Retrieved list, version lineage (v1 -> v2), page numbers, section refs, and source info.');

    // 5. Save comparison results (Added/Removed/Modified/Unchanged) & verify deduplication
    const cmp = await compareTwoDocuments(analysisV1, analysisV2);
    const cmpSave = await saveOrReuseComparisonHistory({
      docA: analysisV1,
      docB: analysisV2,
      comparisonResult: cmp,
      circularAId: saveV1.circularId,
      circularBId: saveV2.circularId,
      versionAId: saveV1.versionId,
      versionBId: saveV2.versionId,
    });
    assert.strictEqual(cmpSave.saved, true);
    assert.strictEqual(cmpSave.deduplicated, false);
    assert(cmpSave.comparisonId, 'Expected comparisonId');
    createdComparisonIds.push(cmpSave.comparisonId!);

    const cmpDup = await saveOrReuseComparisonHistory({
      docA: analysisV1,
      docB: analysisV2,
      comparisonResult: cmp,
      versionAId: saveV1.versionId,
      versionBId: saveV2.versionId,
    });
    assert.strictEqual(cmpDup.deduplicated, true, 'Identical comparison must deduplicate');
    assert.strictEqual(cmpDup.comparisonId, cmpSave.comparisonId);

    const cmpList = await listComparisonHistory(20);
    assert(cmpList.some((r) => r.id === cmpSave.comparisonId), 'Saved comparison missing from listComparisonHistory');

    const fetchedCmp = await getComparisonHistoryById(cmpSave.comparisonId!);
    assert(fetchedCmp && fetchedCmp.addedCount >= 1 && fetchedCmp.modifiedCount >= 1, 'Expected stored Added & Modified counts');
    assert(
      fetchedCmp.alignedPairs.some((p: any) => p.doc_a_page !== null || p.doc_b_page !== null),
      'Expected page references preserved in alignedPairs'
    );
    console.log(`✅ [PASS] Test 5: Saved & retrieved ComparisonHistory (Added=${fetchedCmp.addedCount}, Modified=${fetchedCmp.modifiedCount}, Removed=${fetchedCmp.removedCount}, Unchanged=${fetchedCmp.unchangedCount}).`);
  } finally {
    // Cleanup temporary test records from Atlas govscheme_diff
    for (const id of createdComparisonIds) {
      await ComparisonHistoryModel.deleteOne({ _id: id }).catch(() => {});
    }
    for (const id of createdVersionIds) {
      await CircularVersionModel.deleteOne({ _id: id }).catch(() => {});
    }
    for (const id of createdCircularIds) {
      await CircularModel.deleteOne({ _id: id }).catch(() => {});
    }
    await disconnectDatabase();
  }

  console.log('\n====================================================');
  console.log('  SUMMARY: ALL MONGODB PERSISTENCE TESTS PASSED! 🟢');
  console.log('====================================================');
}

runCircularPersistenceTests().catch((err) => {
  console.error('❌ MongoDB persistence test failed:', err?.message || err);
  process.exit(1);
});
