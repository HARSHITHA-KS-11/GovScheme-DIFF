import { synthesizeDocumentAnalysis } from '../services/astraBackend';
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
  original_text: 'Eligible beneficiaries must submit applications online before 31 May 2026.',
  simple_explanation: null,
  very_simple_explanation: null,
  risk_level: 'watch_out',
  icon_name: 'Clock',
  one_line_consequence: 'Check Carefully: Application must be submitted before 31 May 2026.',
};

async function test() {
  const sampleText = `GOVERNMENT CIRCULAR No. SW-101/2026\n1. APPLICATION DEADLINE: Eligible beneficiaries must submit applications online before 31 May 2026.`;
  const result = await synthesizeDocumentAnalysis(sampleText, [canaryClause], canaryGuard1, undefined, 'en');
  console.log('RESULT SECTIONS:', JSON.stringify(result.clauses, null, 2));
}

test();
