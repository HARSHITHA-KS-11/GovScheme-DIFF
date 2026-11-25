import { synthesizeDocumentAnalysis, verifyModelAvailabilityHealthCheck } from '../services/astraBackend';
import { Guard1InputGate, SimplifiedClause } from '../../../src/types/schemas';

const canaryGuard1: Guard1InputGate = {
  is_valid_circular: true,
  document_kind: 'scheme_circular',
  category: 'welfare & subsidy scheme',
  confidence: 0.99,
};

const canaryClause: SimplifiedClause = {
  id: 'clause_canary_1',
  clause_number: '1',
  page_number: 1,
  section_reference: 'Section 1',
  clause_type: 'deadlines & validity',
  title: 'APPLICATION DEADLINE CANARY',
  original_text: 'Eligible applicants must submit online applications before 31 May 2026.',
  simple_explanation: null,
  very_simple_explanation: null,
  risk_level: 'watch_out',
  icon_name: 'Clock',
  one_line_consequence: 'Check Carefully: Submit application before 31 May 2026.',
};

async function runLiveAiCanaryTest() {
  console.log('====================================================');
  console.log('  GOVSCHEME-DIFF AI CANARY & HEALTH SMOKE TEST');
  console.log('====================================================\n');

  console.log('--- STEP 1: EXECUTING MODEL AVAILABILITY HEALTH CHECK ---');
  await verifyModelAvailabilityHealthCheck();

  console.log('\n--- STEP 2: RUNNING END-TO-END CIRCULAR ANALYSIS ---');
  const sampleText = `GOVERNMENT SCHEME CIRCULAR No. SW-101/2026\n1. APPLICATION DEADLINE: Eligible applicants must submit online applications before 31 May 2026.`;

  const result = await synthesizeDocumentAnalysis(sampleText, [canaryClause], canaryGuard1, undefined, 'en');

  if (!result || !result.clauses || result.clauses.length === 0) {
    console.error('❌ [FAIL] Live Canary Test: Circular synthesis returned empty result!');
    process.exit(1);
  }

  const outputClause = result.clauses[0];
  console.log(`\nCanary Output Section Title: "${outputClause.title}"`);
  console.log(`Canary Output Simple Explanation:\n${outputClause.simple_explanation}`);
  console.log(`Canary Output Meaning Error: ${outputClause.meaning_error}`);

  if (outputClause.meaning_error) {
    console.error('❌ [FAIL] Live Canary Test: Output section returned meaning_error = true!');
    process.exit(1);
  }

  if (!outputClause.simple_explanation || outputClause.simple_explanation.length < 10) {
    console.error('❌ [FAIL] Live Canary Test: Output section returned empty or invalid simple_explanation!');
    process.exit(1);
  }

  console.log('\n====================================================');
  console.log('✅ CANARY TEST PASSED!');
  console.log('====================================================');
}

runLiveAiCanaryTest();
