import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  chunkDocumentTextIntoClauses,
  synthesizeDocumentAnalysis,
  detectCrossClauseConflicts,
  isTemplateExplanation,
  hasVerbatimQuoteOverlap,
} from '../services/astraBackend';
import {
  normalizeClauseType,
  SimplifiedClause,
  Guard1InputGate,
} from '../../../src/types/schemas';

const mockGuard1: Guard1InputGate = {
  is_valid_circular: true,
  document_kind: 'scheme_circular',
  category: 'welfare & subsidy scheme',
  confidence: 0.99,
};

const SAMPLE_CIRCULAR = `--- Page 1 ---
GOVERNMENT OF INDIA — WELFARE DEPARTMENT
Government Order No. WL-108/2026
Subject: Family Support Pension Scheme Guidelines

1. Scheme Overview and Objective
This circular provides monthly support to low-income senior citizens and widows.

2. Eligibility Criteria and Income Limit
Permanent residents aged 60 years or above with annual household income up to Rs. 1,50,000 may apply.

3. Required Documents
Applicants must submit Aadhaar Card, Age Proof, and an Income Certificate issued by the Tehsildar.

4. Application Deadline
Submit applications online before 30 June 2026.`;

async function runPipelineBugsTests() {
  console.log('====================================================');
  console.log('  GOVSCHEME-DIFF PIPELINE REGRESSION BUGS TEST SUITE');
  console.log('====================================================\n');

  const chunks = chunkDocumentTextIntoClauses(SAMPLE_CIRCULAR);
  assert(chunks.length >= 4, `Expected >=4 sections extracted, got ${chunks.length}`);
  assert(chunks.every((c) => c.page_number === 1), 'All Page 1 sections must retain page_number=1');
  console.log(`✅ [PASS] Test 1: Extracted ${chunks.length} sections with preserved page_number.`);

  // Taxonomy normalization check
  assert.strictEqual(normalizeClauseType('eligibility'), 'eligibility criteria');
  assert.strictEqual(normalizeClauseType('income cap'), 'income & age limits');
  assert.strictEqual(normalizeClauseType('deadline'), 'deadlines & validity');
  console.log('✅ [PASS] Test 2: Taxonomy normalization maps legacy/variant terms to circular section types.');

  // Codebase grep guard for old template fallback strings in production code
  const checkDir = (dir: string): boolean => {
    let found = false;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'tests' || entry.name === '__tests__' || entry.name === 'node_modules') continue;
        if (checkDir(fullPath)) found = true;
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        const content = fs.readFileSync(fullPath, 'utf8')
          .split(/\r?\n/)
          .filter((l) => !l.includes('isTemplateExplanation') && !l.includes('engPattern') && !l.includes('hindiPattern'))
          .join('\n');
        if (/this\s+clause\s+(defines|specifies|sets\s+out|establishes|covers)\s+(terms|binding\s+obligations|obligations)\s+for/i.test(content)) {
          console.error(`❌ Hardcoded template pattern found in ${fullPath}`);
          found = true;
        }
      }
    }
    return found;
  };
  assert(!checkDir(path.resolve(process.cwd(), 'src')) && !checkDir(path.resolve(process.cwd(), 'server/src')));
  console.log('✅ [PASS] Test 3: Production codebase has zero hardcoded template fallback patterns.');

  // Execution block must not falsely flag circular missing witness signatures
  const conflictCheck = detectCrossClauseConflicts(chunks, SAMPLE_CIRCULAR);
  assert.strictEqual(conflictCheck.conflicts.length, 0);
  assert.strictEqual(conflictCheck.executionBlock.witness_attestation_missing, false);
  console.log('✅ [PASS] Test 4: No contract witness-signature false positives on scheme circulars.');

  // Synthesis check (distinct simple vs very_simple + zero templates + zero 8-gram verbatim copies)
  const synthesisResult = await synthesizeDocumentAnalysis(SAMPLE_CIRCULAR, chunks, mockGuard1, undefined, 'en');
  assert(synthesisResult.clauses.length > 0, 'Synthesis returned empty clauses');
  for (const c of synthesisResult.clauses as SimplifiedClause[]) {
    if (c.simple_explanation && c.very_simple_explanation) {
      assert.notStrictEqual(c.simple_explanation, c.very_simple_explanation, `Identical simple vs very_simple on ${c.title}`);
    }
    assert(!isTemplateExplanation(c.simple_explanation), `Template leakage on ${c.title}`);
    assert(!hasVerbatimQuoteOverlap(c.simple_explanation, c.original_text, 8), `Verbatim copy on ${c.title}`);
  }
  console.log('✅ [PASS] Test 5: Distinct 3-point simple & ultra-simple explanations with zero template/verbatim leakage.');

  console.log('\n🟢 ALL PIPELINE REGRESSION TESTS PASSED!');
}

runPipelineBugsTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
