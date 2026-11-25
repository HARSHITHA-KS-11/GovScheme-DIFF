import {
  SimplifiedClause,
  AlignedClausePair,
  ClauseType,
  DiffChangeType,
  DetectedFieldChange,
} from '../types/schemas.js';

// Simple TF-IDF / Token Cosine Similarity calculation for section text matching
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function calculateCosineSimilarity(textA: string, textB: string): number {
  const tokensA = tokenize(textA);
  const tokensB = tokenize(textB);

  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const freqA: Record<string, number> = {};
  const freqB: Record<string, number> = {};

  tokensA.forEach((t) => (freqA[t] = (freqA[t] || 0) + 1));
  tokensB.forEach((t) => (freqB[t] = (freqB[t] || 0) + 1));

  const allWords = new Set([...Object.keys(freqA), ...Object.keys(freqB)]);
  let dotProduct = 0;
  let magA = 0;
  let magB = 0;

  allWords.forEach((word) => {
    const a = freqA[word] || 0;
    const b = freqB[word] || 0;
    dotProduct += a * b;
    magA += a * a;
    magB += b * b;
  });

  if (magA === 0 || magB === 0) return 0;
  return dotProduct / (Math.sqrt(magA) * Math.sqrt(magB));
}

function normalizeTextForDiff(text: string): string {
  return (text || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForComparison(text: string): string {
  return normalizeTextForDiff(text).toLowerCase();
}

function splitCircularSentences(text: string): string[] {
  // Protect common circular abbreviations (Rs., No., Govt., Dept., etc.) before splitting sentences
  const protectedText = text
    .replace(/\b(Rs|INR|No|Nos|Mr|Mrs|Ms|Dr|St|Sec|Para|Ref|Govt|Dept|G\.O|O\.M|w\.e\.f|i\.e|e\.g)\.\s+/gi, '$1__ABBR__ ')
    .replace(/\b([A-Z])\.\s+/g, '$1__ABBR__ ');

  return protectedText
    .split(/(?<=[.!?;\n])\s+|\n+/)
    .map((s) => s.replace(/__ABBR__/g, '.').trim())
    .filter(Boolean);
}

function extractMoneyWithContext(text: string, contextRegex: RegExp): string[] {
  const sentences = splitCircularSentences(text);
  const matches: string[] = [];
  const moneyRegex =
    /(?:(?:Rs\.?|INR|₹)\s*[\d,]+(?:\.\d+)?(?:\s*(?:lakh|lakhs|crore|crores))?|\b\d+(?:\.\d+)?\s*(?:lakh|lakhs|crore|crores))\b(?:\s*(?:per\s+month|per\s+annum|per\s+year|per\s+hectare|\/-))?/gi;

  for (const s of sentences) {
    if (contextRegex.test(s)) {
      const found = s.match(moneyRegex);
      if (found) {
        matches.push(...found.map((m) => normalizeTextForDiff(m)));
      }
    }
  }
  return Array.from(new Set(matches));
}

function extractAgeLimits(text: string): string[] {
  const patterns = [
    /\baged?\s+(?:between\s+)?\d{1,3}\s*(?:to|and|-|–)\s*\d{1,3}\s*years?\b/gi,
    /\b(?:minimum|maximum|upper|lower)?\s*age\s*(?:limit|ceiling)?\s*(?:is|of|:)?\s*(?:not\s+(?:exceeding|more\s+than)|above|below|up\s+to|at\s+least)?\s*\d{1,3}\s*(?:to\s*\d{1,3}\s*)?years?(?:\s+or\s+(?:above|more|below))?\b/gi,
    /\b\d{1,3}\s*years?\s*(?:or\s+above|and\s+above|or\s+more|or\s+below)\b/gi,
    /\bbetween\s+\d{1,3}\s+and\s+\d{1,3}\s+years?\b/gi,
  ];
  const found: string[] = [];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) found.push(...m.map((x) => normalizeTextForDiff(x)));
  }
  return Array.from(new Set(found));
}

function extractDeadlines(text: string): string[] {
  const patterns = [
    /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2}\b/gi,
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+20\d{2}\b/gi,
    /\b\d{1,2}[\/.-]\d{1,2}[\/.-]20\d{2}\b/g,
    /\b20\d{2}[\/.-]\d{1,2}[\/.-]\d{1,2}\b/g,
    /\bwithin\s+\d+\s+(?:day|days|month|months|week|weeks)\b/gi,
  ];
  const found: string[] = [];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) found.push(...m.map((x) => normalizeTextForDiff(x)));
  }
  return Array.from(new Set(found));
}

const KNOWN_DOCUMENT_ITEMS: Array<{ label: string; regex: RegExp }> = [
  { label: 'Aadhaar Card', regex: /\baadhaar(?:\s+card)?\b/i },
  { label: 'Income Certificate', regex: /\bincome\s+certificate\b/i },
  { label: 'Caste Certificate', regex: /\bcaste\s+certificate\b/i },
  { label: 'Domicile / Residence Proof', regex: /\b(?:domicile(?:\s+certificate)?|residence\s+proof|residential\s+proof)\b/i },
  { label: 'Ration Card', regex: /\bration\s+card\b/i },
  { label: 'Bank Passbook / Account Details', regex: /\b(?:bank\s+passbook|bank\s+account(?:\s+details)?|cancelled\s+cheque)\b/i },
  { label: 'PAN Card', regex: /\bpan\s+card\b/i },
  { label: 'Land Record / Passbook', regex: /\b(?:land\s+record|land\s+passbook|rtc|khata|patta)\b/i },
  { label: 'Bonafide Certificate', regex: /\bbonafide\s+certificate\b/i },
  { label: 'Age Proof / Birth Certificate', regex: /\b(?:age\s+proof|birth\s+certificate)\b/i },
  { label: 'Udyam Registration', regex: /\budyam\s+registration\b/i },
  { label: 'Disability Certificate', regex: /\bdisability\s+certificate\b/i },
  { label: 'BPL Card', regex: /\bbpl\s+card\b/i },
  { label: 'Marksheet / Fee Receipt', regex: /\b(?:marksheet|mark\s+sheet|fee\s+receipt)\b/i },
  { label: 'Passport-size Photograph', regex: /\bpassport[\s-]?size\s+photo(?:graph)?s?\b/i },
];

function extractRequiredDocuments(text: string): string[] {
  const docs: string[] = [];
  for (const item of KNOWN_DOCUMENT_ITEMS) {
    if (item.regex.test(text)) {
      docs.push(item.label);
    }
  }
  return docs;
}

function extractBenefitPhrases(text: string): string[] {
  const moneyBenefits = extractMoneyWithContext(
    text,
    /\b(?:benefit|assistance|subsidy|grant|scholarship|stipend|pension|allowance|ex-gratia|financial\s+support|credit|reimbursement|per\s+month|per\s+hectare|per\s+annum)\b/i
  );
  const pctMatches =
    text.match(/\b\d+(?:\.\d+)?%\s*(?:interest\s+subsidy|subsidy|grant|reimbursement|rebate|waiver|assistance)\b/gi) || [];
  return Array.from(new Set([...moneyBenefits, ...pctMatches.map((m) => normalizeTextForDiff(m))]));
}

function extractEligibilitySummary(text: string): string {
  const sentences = splitCircularSentences(text)
    .map((s) => normalizeTextForDiff(s))
    .filter(Boolean);
  const eligSentences = sentences.filter((s) =>
    /\b(?:eligib|ineligib|excluded|disqualif|resident|domicile|citizen|farmer|student|senior\s+citizen|widow|woman|women|bpl|ews|sc\/st|obc|enterprise|msme|must\s+be|applicants\s+must|beneficiar)\b/i.test(
      s
    )
  );
  return eligSentences.join(' ').trim();
}

export function detectSectionFieldChanges(
  clauseType: ClauseType,
  oldText: string,
  newText: string,
  changeType: DiffChangeType
): DetectedFieldChange[] {
  if (changeType === 'unchanged') return [];

  const changes: DetectedFieldChange[] = [];
  const oldNorm = normalizeTextForDiff(oldText);
  const newNorm = normalizeTextForDiff(newText);

  // 1. Income Limits
  const incomeCtx = /\b(?:income|earning|salary|ceiling|bpl|ews)\b/i;
  const oldIncomes = oldNorm ? extractMoneyWithContext(oldNorm, incomeCtx) : [];
  const newIncomes = newNorm ? extractMoneyWithContext(newNorm, incomeCtx) : [];
  if (oldIncomes.join(', ') !== newIncomes.join(', ') && (oldIncomes.length > 0 || newIncomes.length > 0)) {
    changes.push({
      field: 'income_limit',
      label: 'Income Limit',
      old_value: oldIncomes.length > 0 ? oldIncomes.join('; ') : 'Not specified',
      new_value: newIncomes.length > 0 ? newIncomes.join('; ') : 'Removed / Not specified',
    });
  }

  // 2. Age Limits
  const oldAges = oldNorm ? extractAgeLimits(oldNorm) : [];
  const newAges = newNorm ? extractAgeLimits(newNorm) : [];
  if (oldAges.join(', ') !== newAges.join(', ') && (oldAges.length > 0 || newAges.length > 0)) {
    changes.push({
      field: 'age_limit',
      label: 'Age Limit',
      old_value: oldAges.length > 0 ? oldAges.join('; ') : 'Not specified',
      new_value: newAges.length > 0 ? newAges.join('; ') : 'Removed / Not specified',
    });
  }

  // 3. Benefits / Financial Assistance
  const oldBenefits = oldNorm ? extractBenefitPhrases(oldNorm) : [];
  const newBenefits = newNorm ? extractBenefitPhrases(newNorm) : [];
  if (oldBenefits.join(', ') !== newBenefits.join(', ') && (oldBenefits.length > 0 || newBenefits.length > 0)) {
    changes.push({
      field: 'benefit',
      label: 'Benefits',
      old_value: oldBenefits.length > 0 ? oldBenefits.join('; ') : 'Not specified',
      new_value: newBenefits.length > 0 ? newBenefits.join('; ') : 'Removed / Not specified',
    });
  }

  // 4. Required Documents
  const oldDocs = oldNorm ? extractRequiredDocuments(oldNorm) : [];
  const newDocs = newNorm ? extractRequiredDocuments(newNorm) : [];
  const docsChanged =
    oldDocs.length !== newDocs.length || oldDocs.some((d) => !newDocs.includes(d)) || newDocs.some((d) => !oldDocs.includes(d));
  if (docsChanged && (oldDocs.length > 0 || newDocs.length > 0)) {
    changes.push({
      field: 'required_documents',
      label: 'Required Documents',
      old_value: oldDocs.length > 0 ? oldDocs.join(', ') : 'None listed',
      new_value: newDocs.length > 0 ? newDocs.join(', ') : 'Removed / None listed',
    });
  }

  // 5. Deadlines & Validity Dates
  const oldDeadlines = oldNorm ? extractDeadlines(oldNorm) : [];
  const newDeadlines = newNorm ? extractDeadlines(newNorm) : [];
  if (oldDeadlines.join(', ') !== newDeadlines.join(', ') && (oldDeadlines.length > 0 || newDeadlines.length > 0)) {
    changes.push({
      field: 'deadline',
      label: 'Deadlines',
      old_value: oldDeadlines.length > 0 ? oldDeadlines.join('; ') : 'Not specified',
      new_value: newDeadlines.length > 0 ? newDeadlines.join('; ') : 'Removed / Not specified',
    });
  }

  // 6. Eligibility & Exclusions
  const oldElig = oldNorm ? extractEligibilitySummary(oldNorm) : '';
  const newElig = newNorm ? extractEligibilitySummary(newNorm) : '';
  const isEligSection = clauseType === 'eligibility criteria' || clauseType === 'exclusions & disqualifications';
  if ((isEligSection || oldElig || newElig) && normalizeForComparison(oldElig) !== normalizeForComparison(newElig)) {
    changes.push({
      field: 'eligibility',
      label: 'Eligibility',
      old_value: oldElig || (oldNorm ? oldNorm : 'Not present in Circular A'),
      new_value: newElig || (newNorm ? newNorm : 'Removed in Circular B'),
    });
  }

  return changes;
}

function buildDifferenceSummary(
  changeType: DiffChangeType,
  sectionTitle: string,
  fieldChanges: DetectedFieldChange[]
): string {
  if (changeType === 'unchanged') {
    return 'Unchanged: Section wording is identical in Circular A and Circular B.';
  }
  if (changeType === 'added') {
    if (fieldChanges.length > 0) {
      const details = fieldChanges.map((fc) => `${fc.label}: ${fc.new_value}`).join('; ');
      return `Added in Circular B (${sectionTitle}): ${details}.`;
    }
    return `Added in Circular B: New section "${sectionTitle}".`;
  }
  if (changeType === 'removed') {
    if (fieldChanges.length > 0) {
      const details = fieldChanges.map((fc) => `${fc.label}: ${fc.old_value}`).join('; ');
      return `Removed from Circular A (${sectionTitle}): Previously specified ${details}.`;
    }
    return `Removed in Circular B: Section "${sectionTitle}" from Circular A is no longer present.`;
  }
  if (fieldChanges.length > 0) {
    const details = fieldChanges.map((fc) => `${fc.label} (${fc.old_value} -> ${fc.new_value})`).join('; ');
    return `Modified: ${details}.`;
  }
  return `Modified: Wording updated in "${sectionTitle}". Compare exact old and new text below.`;
}

function getNormalizedCategory(clause: SimplifiedClause, index: number): ClauseType {
  const typeStr = (clause.clause_type || '').toLowerCase();
  const titleStr = (clause.title || '').toLowerCase();

  const isOverviewOrPreamble =
    index === 0 ||
    typeStr.includes('overview') ||
    typeStr.includes('objective') ||
    typeStr.includes('preamble') ||
    titleStr.includes('overview') ||
    titleStr.includes('objective') ||
    titleStr.includes('circular') ||
    titleStr.includes('government order') ||
    titleStr.includes('notification') ||
    titleStr.includes('preamble');

  if (
    isOverviewOrPreamble &&
    !typeStr.includes('eligibility') &&
    !typeStr.includes('benefits') &&
    !typeStr.includes('income') &&
    !typeStr.includes('documents') &&
    !typeStr.includes('application') &&
    !typeStr.includes('deadlines') &&
    !typeStr.includes('exclusions') &&
    !typeStr.includes('amendment')
  ) {
    return 'scheme overview & objective' as ClauseType;
  }

  return clause.clause_type;
}

export function alignClauses(
  clausesA: SimplifiedClause[],
  clausesB: SimplifiedClause[]
): {
  alignedPairs: AlignedClausePair[];
  aOnlyClauses: SimplifiedClause[];
  bOnlyClauses: SimplifiedClause[];
  pairsNeedingDiff: AlignedClausePair[];
} {
  const alignedPairs: AlignedClausePair[] = [];
  const usedBIds = new Set<string>();
  const usedAIds = new Set<string>();

  // Group sections by effective category
  const typeMapA = new Map<ClauseType, SimplifiedClause[]>();
  const typeMapB = new Map<ClauseType, SimplifiedClause[]>();

  clausesA.forEach((c, idx) => {
    const cat = getNormalizedCategory(c, idx);
    const list = typeMapA.get(cat) || [];
    list.push(c);
    typeMapA.set(cat, list);
  });

  clausesB.forEach((c, idx) => {
    const cat = getNormalizedCategory(c, idx);
    const list = typeMapB.get(cat) || [];
    list.push(c);
    typeMapB.set(cat, list);
  });

  // Collect all unique section categories across both documents
  const allCategories = new Set<ClauseType>([...Array.from(typeMapA.keys()), ...Array.from(typeMapB.keys())]);

  allCategories.forEach((cat) => {
    const aList = typeMapA.get(cat) || [];
    const bList = typeMapB.get(cat) || [];

    if (aList.length > 0 && bList.length > 0) {
      const candidatePairs: Array<{
        clauseA: SimplifiedClause;
        clauseB: SimplifiedClause;
        similarity: number;
      }> = [];

      aList.forEach((cA) => {
        bList.forEach((cB) => {
          const sim = calculateCosineSimilarity(
            cA.original_text + ' ' + cA.title,
            cB.original_text + ' ' + cB.title
          );
          candidatePairs.push({ clauseA: cA, clauseB: cB, similarity: sim });
        });
      });

      candidatePairs.sort((x, y) => y.similarity - x.similarity);

      candidatePairs.forEach(({ clauseA, clauseB, similarity }) => {
        if (usedAIds.has(clauseA.id) || usedBIds.has(clauseB.id)) return;

        if (similarity >= 0.05 || cat === 'scheme overview & objective' || (aList.length === 1 && bList.length === 1)) {
          usedAIds.add(clauseA.id);
          usedBIds.add(clauseB.id);

          const isExactMatch = normalizeForComparison(clauseA.original_text) === normalizeForComparison(clauseB.original_text);
          const changeType: DiffChangeType = isExactMatch ? 'unchanged' : 'modified';
          const fieldChanges = detectSectionFieldChanges(cat, clauseA.original_text, clauseB.original_text, changeType);
          const diffSummary = buildDifferenceSummary(changeType, clauseB.title || clauseA.title, fieldChanges);

          alignedPairs.push({
            id: `pair_${clauseA.id}_${clauseB.id}`,
            clause_type: cat,
            doc_a_clause: clauseA,
            doc_b_clause: clauseB,
            status: 'matched',
            change_type: changeType,
            similarity_score: Math.round(similarity * 100) / 100,
            difference_summary: diffSummary,
            old_text: clauseA.original_text,
            new_text: clauseB.original_text,
            detected_field_changes: fieldChanges,
          });
        }
      });
    }
  });

  // Cross-category semantic backup pass for remaining unmatched sections if similarity >= 0.35
  const remainingA = clausesA.filter((cA) => !usedAIds.has(cA.id));
  const remainingB = clausesB.filter((cB) => !usedBIds.has(cB.id));

  const crossCandidates: Array<{
    clauseA: SimplifiedClause;
    clauseB: SimplifiedClause;
    similarity: number;
  }> = [];

  remainingA.forEach((cA) => {
    remainingB.forEach((cB) => {
      const sim = calculateCosineSimilarity(
        cA.original_text + ' ' + cA.title,
        cB.original_text + ' ' + cB.title
      );
      if (sim >= 0.35) {
        crossCandidates.push({ clauseA: cA, clauseB: cB, similarity: sim });
      }
    });
  });

  crossCandidates.sort((x, y) => y.similarity - x.similarity);

  crossCandidates.forEach(({ clauseA, clauseB, similarity }) => {
    if (usedAIds.has(clauseA.id) || usedBIds.has(clauseB.id)) return;
    usedAIds.add(clauseA.id);
    usedBIds.add(clauseB.id);

    const effectiveType = clauseB.clause_type || clauseA.clause_type;
    const isExactMatch = normalizeForComparison(clauseA.original_text) === normalizeForComparison(clauseB.original_text);
    const changeType: DiffChangeType = isExactMatch ? 'unchanged' : 'modified';
    const fieldChanges = detectSectionFieldChanges(effectiveType, clauseA.original_text, clauseB.original_text, changeType);
    const diffSummary = buildDifferenceSummary(changeType, clauseB.title || clauseA.title, fieldChanges);

    alignedPairs.push({
      id: `pair_${clauseA.id}_${clauseB.id}`,
      clause_type: effectiveType,
      doc_a_clause: clauseA,
      doc_b_clause: clauseB,
      status: 'matched',
      change_type: changeType,
      similarity_score: Math.round(similarity * 100) / 100,
      difference_summary: diffSummary,
      old_text: clauseA.original_text,
      new_text: clauseB.original_text,
      detected_field_changes: fieldChanges,
    });
  });

  // Unmatched in A -> Removed in Circular B
  const aOnlyClauses = clausesA.filter((cA) => !usedAIds.has(cA.id));
  aOnlyClauses.forEach((cA) => {
    const fieldChanges = detectSectionFieldChanges(cA.clause_type, cA.original_text, '', 'removed');
    alignedPairs.push({
      id: `pair_removed_${cA.id}`,
      clause_type: cA.clause_type,
      doc_a_clause: cA,
      status: 'a_only',
      change_type: 'removed',
      similarity_score: 0,
      difference_summary: buildDifferenceSummary('removed', cA.title || cA.clause_type, fieldChanges),
      old_text: cA.original_text,
      detected_field_changes: fieldChanges,
    });
  });

  // Unmatched in B -> Added in Circular B
  const bOnlyClauses = clausesB.filter((cB) => !usedBIds.has(cB.id));
  bOnlyClauses.forEach((cB) => {
    const fieldChanges = detectSectionFieldChanges(cB.clause_type, '', cB.original_text, 'added');
    alignedPairs.push({
      id: `pair_added_${cB.id}`,
      clause_type: cB.clause_type,
      doc_b_clause: cB,
      status: 'b_only',
      change_type: 'added',
      similarity_score: 0,
      difference_summary: buildDifferenceSummary('added', cB.title || cB.clause_type, fieldChanges),
      new_text: cB.original_text,
      detected_field_changes: fieldChanges,
    });
  });

  const pairsNeedingDiff = alignedPairs.filter((p) => p.change_type === 'modified');

  return {
    alignedPairs,
    aOnlyClauses,
    bOnlyClauses,
    pairsNeedingDiff,
  };
}
