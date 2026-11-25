// GovScheme Diff - Core Schema Definitions & Taxonomy Types

export type DocumentCategory =
  | 'scheme circular'
  | 'government order'
  | 'official notification'
  | 'policy amendment'
  | 'scheme guidelines'
  | 'welfare & subsidy scheme'
  | 'education & scholarship'
  | 'agriculture & farmer support'
  | 'healthcare & insurance'
  | 'housing & infrastructure'
  | 'employment & skill development'
  | 'msme & business grant'
  | 'other';

export const DOCUMENT_CATEGORY_ENUM: DocumentCategory[] = [
  'scheme circular',
  'government order',
  'official notification',
  'policy amendment',
  'scheme guidelines',
  'welfare & subsidy scheme',
  'education & scholarship',
  'agriculture & farmer support',
  'healthcare & insurance',
  'housing & infrastructure',
  'employment & skill development',
  'msme & business grant',
  'other',
];

export function normalizeDocumentCategory(rawCategory: string): DocumentCategory {
  if (!rawCategory) return 'other';
  const lower = rawCategory.toLowerCase().trim();
  if (DOCUMENT_CATEGORY_ENUM.includes(lower as DocumentCategory)) {
    return lower as DocumentCategory;
  }
  if (lower.includes('amendment') || lower.includes('corrigendum') || lower.includes('addendum')) return 'policy amendment';
  if (lower.includes('government order') || lower.includes('office memorandum') || lower.includes('g.o')) return 'government order';
  if (lower.includes('notification') || lower.includes('gazette')) return 'official notification';
  if (lower.includes('guideline') || lower.includes('sop')) return 'scheme guidelines';
  if (lower.includes('scholar') || lower.includes('education') || lower.includes('student')) return 'education & scholarship';
  if (lower.includes('agri') || lower.includes('farmer') || lower.includes('kisan') || lower.includes('crop')) return 'agriculture & farmer support';
  if (lower.includes('health') || lower.includes('medical') || lower.includes('insurance') || lower.includes('arogya')) return 'healthcare & insurance';
  if (lower.includes('hous') || lower.includes('awas') || lower.includes('infrastructure')) return 'housing & infrastructure';
  if (lower.includes('employ') || lower.includes('skill') || lower.includes('rozgar') || lower.includes('apprentice')) return 'employment & skill development';
  if (lower.includes('msme') || lower.includes('business') || lower.includes('startup') || lower.includes('mudra')) return 'msme & business grant';
  if (lower.includes('welfare') || lower.includes('subsidy') || lower.includes('pension') || lower.includes('ration')) return 'welfare & subsidy scheme';
  if (lower.includes('circular') || lower.includes('scheme')) return 'scheme circular';
  return 'other';
}

export type ClauseType =
  | 'scheme overview & objective'
  | 'eligibility criteria'
  | 'benefits & financial assistance'
  | 'income & age limits'
  | 'required documents'
  | 'application process'
  | 'deadlines & validity'
  | 'exclusions & disqualifications'
  | 'amendment & supersession'
  | 'implementation & verification'
  | 'grievance & nodal authority'
  | 'other';

export const CLAUSE_TYPE_ENUM: ClauseType[] = [
  'scheme overview & objective',
  'eligibility criteria',
  'benefits & financial assistance',
  'income & age limits',
  'required documents',
  'application process',
  'deadlines & validity',
  'exclusions & disqualifications',
  'amendment & supersession',
  'implementation & verification',
  'grievance & nodal authority',
  'other',
];

export function normalizeClauseType(rawType: string): ClauseType {
  if (!rawType) return 'other';
  const lower = rawType.toLowerCase().trim();
  if (CLAUSE_TYPE_ENUM.includes(lower as ClauseType)) return lower as ClauseType;
  if (lower.includes('overview') || lower.includes('objective') || lower.includes('preamble') || lower.includes('introduction')) return 'scheme overview & objective';
  if (lower.includes('eligib') || lower.includes('beneficiar') || lower.includes('target group')) return 'eligibility criteria';
  if (lower.includes('benefit') || lower.includes('subsid') || lower.includes('grant') || lower.includes('assistance') || lower.includes('amount') || lower.includes('stipend') || lower.includes('pension')) return 'benefits & financial assistance';
  if (lower.includes('income') || lower.includes('age limit') || lower.includes('ceiling') || lower.includes('threshold')) return 'income & age limits';
  if (lower.includes('document') || lower.includes('enclosure') || lower.includes('certificate')) return 'required documents';
  if (lower.includes('apply') || lower.includes('application') || lower.includes('portal') || lower.includes('registration') || lower.includes('procedure')) return 'application process';
  if (lower.includes('deadline') || lower.includes('last date') || lower.includes('validity') || lower.includes('effective') || lower.includes('timeline') || lower.includes('schedule')) return 'deadlines & validity';
  if (lower.includes('exclus') || lower.includes('disqualif') || lower.includes('ineligib') || lower.includes('restriction')) return 'exclusions & disqualifications';
  if (lower.includes('amend') || lower.includes('supersed') || lower.includes('corrigend') || lower.includes('modif') || lower.includes('addend')) return 'amendment & supersession';
  if (lower.includes('implement') || lower.includes('verif') || lower.includes('audit') || lower.includes('disburse') || lower.includes('monitoring')) return 'implementation & verification';
  if (lower.includes('grievance') || lower.includes('nodal') || lower.includes('helpline') || lower.includes('appeal') || lower.includes('authority')) return 'grievance & nodal authority';
  return 'other';
}

export type RiskLevel = 'low' | 'watch_out' | 'high';

export function normalizeRiskLevel(rawRisk: string): RiskLevel {
  if (!rawRisk) return 'low';
  const lower = rawRisk.toLowerCase().trim();
  if (lower === 'high') return 'high';
  if (lower === 'watch_out' || lower === 'watch out' || lower === 'medium') return 'watch_out';
  return 'low';
}

export type CircularDocumentKind =
  | 'government_order'
  | 'scheme_circular'
  | 'notification'
  | 'amendment'
  | 'scheme_guidelines'
  | 'other';

export interface Guard1InputGate {
  is_valid_circular: boolean;
  document_kind?: CircularDocumentKind;
  category: DocumentCategory;
  confidence: number;
  rejection_reason?: string;
}

export interface SimplifiedClause {
  id: string;
  clause_number?: string | null;
  clause_type: ClauseType;
  title: string;
  original_text: string;
  page_number?: number;
  section_reference?: string;
  simple_explanation: string | null; // Plain language or null if error
  very_simple_explanation: string | null; // Ultra-simple plain language or null if error
  risk_level: RiskLevel;
  icon_name: string; // Lucide icon name for visual understanding
  one_line_consequence: string; // Color + Icon + Plain language takeaway
  needs_review?: boolean;
  meaning_error?: boolean;
  obligations?: string[];
  deadlines?: string[];
}

export interface InternalContradiction {
  id: string;
  clause_a_id: string;
  clause_b_id: string;
  clause_a_title: string;
  clause_b_title: string;
  clause_a_obligation: string;
  clause_b_obligation: string;
  description: string;
  explanation: string;
  risk_level: RiskLevel;
}

export interface ExecutionBlockAnalysis {
  present: boolean;
  missing_signatures: boolean;
  witness_attestation_missing: boolean;
  defect_description?: string;
}

export interface CircularPersistenceMeta {
  saved: boolean;
  deduplicated: boolean;
  circularId?: string;
  versionId?: string;
  versionNumber?: number;
  parentCircularId?: string | null;
  parentVersionId?: string | null;
  isAmendment?: boolean;
  pageCount?: number;
  sectionCount?: number;
  circularNumber?: string;
  reason?: string;
}

export interface ComparisonPersistenceMeta {
  saved: boolean;
  deduplicated: boolean;
  comparisonId?: string;
  reason?: string;
}

export interface DocumentAnalysisResult {
  guard1: Guard1InputGate;
  document_title: string;
  category: DocumentCategory;
  overall_risk_score: number; // 0-100 score
  summary_simple: string;
  summary_very_simple: string;
  clauses: SimplifiedClause[];
  contradictions: InternalContradiction[];
  conflicts?: InternalContradiction[];
  execution_block?: ExecutionBlockAnalysis;
  checklist: ChecklistArtifact;
  options_next_steps: NextStepsOption[];
  lawyer_briefing: LawyerBriefingArtifact;
  disclaimer: string;
  persistence?: CircularPersistenceMeta;
}

export interface ChecklistItem {
  id: string;
  category: 'deadline' | 'obligation' | 'notice_period' | 'stamp_duty' | 'warning';
  title: string;
  description: string;
  due_date_or_timeframe?: string;
  action_required: string;
  associated_clause_id?: string;
}

export interface ChecklistArtifact {
  title: string;
  items: ChecklistItem[];
  stamp_duty_required: boolean;
  stamp_duty_note?: string;
  disclaimer: string;
}

export interface NextStepsOption {
  id: string;
  title: string;
  description: string;
  benefit: string;
  tradeoff?: string;
}

export interface FlaggedIssue {
  clause_id: string;
  clause_title: string;
  concern: string;
  suggested_clause_edit?: string;
}

export interface LawyerBriefingArtifact {
  document_summary: string;
  flagged_issues: FlaggedIssue[];
  questions_to_ask_lawyer: string[];
  missing_protective_clauses: string[];
  recommended_next_steps: string[];
  disclaimer: string;
}

export type DiffChangeType = 'added' | 'removed' | 'modified' | 'unchanged';

export interface DetectedFieldChange {
  field:
    | 'eligibility'
    | 'income_limit'
    | 'age_limit'
    | 'benefit'
    | 'required_documents'
    | 'deadline'
    | 'other';
  label: string;
  old_value: string;
  new_value: string;
}

export interface AlignedClausePair {
  id: string;
  clause_type: ClauseType;
  doc_a_clause?: SimplifiedClause;
  doc_b_clause?: SimplifiedClause;
  status: 'matched' | 'a_only' | 'b_only';
  change_type?: DiffChangeType;
  similarity_score: number;
  difference_summary?: string;
  old_text?: string;
  new_text?: string;
  detected_field_changes?: DetectedFieldChange[];
  risk_delta?: 'a_safer' | 'b_safer' | 'equal' | 'both_risky';
}

export interface ComparisonResult {
  doc_a_title: string;
  doc_b_title: string;
  aligned_pairs: AlignedClausePair[];
  a_only_clauses: SimplifiedClause[];
  b_only_clauses: SimplifiedClause[];
  added_count?: number;
  removed_count?: number;
  modified_count?: number;
  unchanged_count?: number;
  key_differences_summary: string;
  winner_recommendation?: string;
  disclaimer: string;
  persistence?: ComparisonPersistenceMeta;
}

export interface SavedCircularVersionSummary {
  id: string;
  circularId: string;
  parentCircularId: string | null;
  parentVersionId: string | null;
  isAmendment: boolean;
  versionNumber: number;
  contentHash: string;
  title: string;
  circularNumber: string;
  issuingAuthority: string;
  category: string;
  documentKind: string;
  sourceType: 'upload' | 'paste' | 'camera' | 'api';
  sourceFilename: string;
  mimeType: string;
  pageCount: number;
  sectionCount: number;
  createdAt: string;
}

export interface SavedCircularSummary {
  id: string;
  circularKey: string;
  title: string;
  circularNumber: string;
  issuingAuthority: string;
  category: string;
  documentKind: string;
  sourceType: 'upload' | 'paste' | 'camera' | 'api';
  sourceFilename: string;
  mimeType: string;
  latestVersionNumber: number;
  latestVersionId: string | null;
  totalVersions: number;
  createdAt: string;
  updatedAt: string;
  versions: SavedCircularVersionSummary[];
}

export interface SavedCircularVersionDetail extends SavedCircularVersionSummary {
  extractedText: string;
  sections: SimplifiedClause[];
  analysisResult: DocumentAnalysisResult;
}

export interface SavedComparisonSummary {
  id: string;
  pairHash: string;
  docATitle: string;
  docBTitle: string;
  circularAId: string | null;
  circularBId: string | null;
  versionAId: string | null;
  versionBId: string | null;
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  unchangedCount: number;
  keyDifferencesSummary: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedComparisonDetail extends SavedComparisonSummary {
  alignedPairs: AlignedClausePair[];
  comparisonResult: ComparisonResult;
}

export interface QuotaTelemetry {
  totalRpm: number;
  usedRpm: number;
  totalTpm: number;
  usedTpm: number;
  resetSeconds: number;
  activeEngine: 'Primary Engine' | 'Backup Engine';
  isBackupAvailable: boolean;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  text: string;
  cited_clause_ids?: string[];
  timestamp: string;
  is_flagged_unsafe?: boolean;
  safety_reason?: string;
  quota?: QuotaTelemetry;
}

export interface ServerConfigStatus {
  isConfigured: boolean;
  demoMode: boolean;
  quota?: QuotaTelemetry;
}

export interface ActiveInputContext {
  uploadedFileName?: string;
  uploadedFileType?: string;
  uploadedFileSize?: string;
  pastedText?: string;
  extractedInputText?: string;
  capturedPhoto?: boolean;
  hasInput?: boolean;

  // Compare Contracts Section Context
  isComparisonMode?: boolean;
  docATitle?: string;
  docAText?: string;
  docBTitle?: string;
  docBText?: string;
  comparisonResult?: ComparisonResult | null;
}
