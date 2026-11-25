import crypto from 'crypto';
import mongoose from 'mongoose';
import {
  CircularModel,
  CircularVersionModel,
  ComparisonHistoryModel,
  CircularSourceType,
  ICircularSectionSnapshot,
} from '../models/CircularModels';
import {
  ComparisonResult,
  DocumentAnalysisResult,
  SimplifiedClause,
} from '../../../src/types/schemas';

export interface SaveCircularInput {
  extractedText: string;
  analysisResult: DocumentAnalysisResult;
  sourceType?: CircularSourceType;
  sourceFilename?: string;
  mimeType?: string;
  parentCircularId?: string;
  parentVersionId?: string;
  isAmendment?: boolean;
}

export interface PersistenceMetadata {
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

export interface ComparisonPersistenceMetadata {
  saved: boolean;
  deduplicated: boolean;
  comparisonId?: string;
  reason?: string;
}

function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

export function computeNormalizedContentHash(text: string): string {
  const normalized = (text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export function extractCircularNumber(text: string): string {
  const head = (text || '').slice(0, 1500);
  const patterns = [
    /\b(?:G\.?\s*O\.?|Government Order|Office Memorandum|O\.?\s*M\.?|Circular|Notification|Corrigendum|Order)\s*(?:Ms\.?|Rt\.?|No\.?)?\s*[:\-]?\s*([A-Z]{1,8}[A-Z0-9./-]{2,24}\d)/i,
    /\bNo\.?\s*([A-Z]{2,8}[-/]\d+(?:[-/]\d+)*)\b/i,
  ];
  for (const re of patterns) {
    const m = head.match(re);
    if (m && m[1]) {
      return m[1].trim().toUpperCase();
    }
  }
  return '';
}

export function extractIssuingAuthority(text: string): string {
  const lines = (text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^---\s*Page\s+\d+\s*---$/i.test(l))
    .slice(0, 10);

  for (const line of lines) {
    if (/^(GOVERNMENT OF|MINISTRY OF|DEPARTMENT OF|DIRECTORATE OF|COMMISSIONERATE)/i.test(line)) {
      return line.slice(0, 140);
    }
  }
  return '';
}

export function extractPageCount(text: string, sections: SimplifiedClause[] = []): number {
  let maxPage = 1;
  const pageMatches = (text || '').matchAll(/---\s*Page\s+(\d+)\s*---/gi);
  for (const match of pageMatches) {
    const p = Number(match[1]);
    if (Number.isFinite(p) && p > maxPage) maxPage = p;
  }
  for (const s of sections) {
    if (typeof s.page_number === 'number' && s.page_number > maxPage) {
      maxPage = s.page_number;
    }
  }
  return maxPage;
}

function buildSchemeLineageSlug(title: string, circularNumber: string): string {
  const cleanTitle = (title || 'government-scheme-circular')
    .toLowerCase()
    .replace(/\b(revised|amended|corrigendum|addendum|updated|circular|guidelines|order|notification|scheme|fy|20\d{2}(?:-\d{2,4})?)\b/gi, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (cleanTitle.length >= 6) {
    return cleanTitle.slice(0, 80);
  }
  if (circularNumber) {
    return circularNumber.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }
  return `circular-${Date.now()}`;
}

function toSectionSnapshots(clauses: SimplifiedClause[] = []): ICircularSectionSnapshot[] {
  return clauses.map((c, idx) => ({
    id: c.id || `clause_${idx + 1}`,
    clause_number: c.clause_number || String(idx + 1),
    clause_type: c.clause_type || 'other',
    title: c.title || `Section ${idx + 1}`,
    original_text: c.original_text || '',
    page_number: typeof c.page_number === 'number' && c.page_number > 0 ? c.page_number : 1,
    section_reference: c.section_reference || (c.clause_number ? `Section ${c.clause_number}` : `Section ${idx + 1}`),
    simple_explanation: c.simple_explanation ?? null,
    very_simple_explanation: c.very_simple_explanation ?? null,
    risk_level: c.risk_level || 'low',
    icon_name: c.icon_name || 'CheckCircle',
    one_line_consequence: c.one_line_consequence || '',
  }));
}

async function resolveParentCircular(input: SaveCircularInput, circularNumber: string, title: string) {
  if (input.parentCircularId) {
    if (!mongoose.Types.ObjectId.isValid(input.parentCircularId)) {
      throw new Error('Invalid parentCircularId format.');
    }
    const parent = await CircularModel.findById(input.parentCircularId);
    if (!parent) {
      throw new Error('Referenced parent circular was not found.');
    }
    return parent;
  }

  if (input.parentVersionId) {
    if (!mongoose.Types.ObjectId.isValid(input.parentVersionId)) {
      throw new Error('Invalid parentVersionId format.');
    }
    const pv = await CircularVersionModel.findById(input.parentVersionId);
    if (!pv) {
      throw new Error('Referenced parent version was not found.');
    }
    const parent = await CircularModel.findById(pv.circularId);
    if (parent) return parent;
  }

  // Automatic amendment linking by referenced base circular number inside amendment/corrigendum text
  const textHead = (input.extractedText || '').slice(0, 1500);
  const amendmentRefMatch = textHead.match(
    /(?:partial modification of|amendment to|amending|supersession of|read with)\s+(?:G\.?\s*O\.?|Government Order|Circular|Notification|Order)?\s*(?:No\.?)?\s*([A-Z]{1,8}[A-Z0-9./-]{2,24}\d)/i
  );
  if (amendmentRefMatch && amendmentRefMatch[1]) {
    const referencedNumber = amendmentRefMatch[1].trim().toUpperCase();
    const matchedByRef = await CircularModel.findOne({ circularNumber: referencedNumber });
    if (matchedByRef) return matchedByRef;

    const versionByRef = await CircularVersionModel.findOne({ circularNumber: referencedNumber });
    if (versionByRef) {
      const parent = await CircularModel.findById(versionByRef.circularId);
      if (parent) return parent;
    }
  }

  // Exact same circular number (updated text / revised copy)
  if (circularNumber) {
    const sameNumber = await CircularModel.findOne({ circularNumber });
    if (sameNumber) return sameNumber;
  }

  // Matching scheme lineage slug when title indicates revision/amendment
  const isLikelyRevision =
    input.isAmendment ||
    input.analysisResult.guard1?.document_kind === 'amendment' ||
    /\b(revised|amendment|corrigendum|addendum|updated|modified)\b/i.test(`${title} ${textHead.slice(0, 300)}`);

  if (isLikelyRevision) {
    const slug = buildSchemeLineageSlug(title, circularNumber);
    const sameSlug = await CircularModel.findOne({ circularKey: slug });
    if (sameSlug) return sameSlug;
  }

  return null;
}

export async function saveOrReuseCircularAnalysis(input: SaveCircularInput): Promise<PersistenceMetadata> {
  if (!isDatabaseConnected()) {
    return { saved: false, deduplicated: false, reason: 'Database not connected' };
  }

  const extractedText = (input.extractedText || '').trim();
  if (!extractedText) {
    return { saved: false, deduplicated: false, reason: 'Extracted text is empty' };
  }

  const contentHash = computeNormalizedContentHash(extractedText);

  // Deduplication check 1: identical normalized content returns existing version without creating duplicate
  const existingVersion = await CircularVersionModel.findOne({ contentHash }).lean();
  if (existingVersion) {
    return {
      saved: true,
      deduplicated: true,
      circularId: String(existingVersion.circularId),
      versionId: String(existingVersion._id),
      versionNumber: existingVersion.versionNumber,
      parentCircularId: existingVersion.parentCircularId ? String(existingVersion.parentCircularId) : null,
      parentVersionId: existingVersion.parentVersionId ? String(existingVersion.parentVersionId) : null,
      isAmendment: Boolean(existingVersion.isAmendment),
      pageCount: existingVersion.pageCount,
      sectionCount: Array.isArray(existingVersion.sections) ? existingVersion.sections.length : 0,
      circularNumber: existingVersion.circularNumber || '',
    };
  }

  const title = input.analysisResult.document_title || 'Government Scheme Circular';
  const circularNumber = extractCircularNumber(extractedText);
  const issuingAuthority = extractIssuingAuthority(extractedText);
  const sections = toSectionSnapshots(input.analysisResult.clauses || []);
  const pageCount = extractPageCount(extractedText, input.analysisResult.clauses || []);
  const documentKind = input.analysisResult.guard1?.document_kind || 'scheme_circular';
  const category = input.analysisResult.category || input.analysisResult.guard1?.category || 'other';
  const sourceType: CircularSourceType = input.sourceType || 'paste';
  const sourceFilename = input.sourceFilename || '';
  const mimeType = input.mimeType || '';

  const parentCircular = await resolveParentCircular(input, circularNumber, title);

  if (parentCircular) {
    const nextVersionNumber = (parentCircular.latestVersionNumber || 1) + 1;
    const explicitParentVerId =
      input.parentVersionId && mongoose.Types.ObjectId.isValid(input.parentVersionId)
        ? new mongoose.Types.ObjectId(input.parentVersionId)
        : parentCircular.latestVersionId || null;

    const isAmendment =
      typeof input.isAmendment === 'boolean'
        ? input.isAmendment
        : documentKind === 'amendment' || nextVersionNumber > 1;

    try {
      const createdVersion = await CircularVersionModel.create({
        circularId: parentCircular._id,
        parentCircularId: parentCircular._id,
        parentVersionId: explicitParentVerId,
        isAmendment,
        versionNumber: nextVersionNumber,
        contentHash,
        title,
        circularNumber: circularNumber || parentCircular.circularNumber || '',
        issuingAuthority: issuingAuthority || parentCircular.issuingAuthority || '',
        category,
        documentKind,
        sourceType,
        sourceFilename,
        mimeType,
        extractedText,
        pageCount,
        sections,
        analysisResult: input.analysisResult,
      });

      parentCircular.latestVersionNumber = nextVersionNumber;
      parentCircular.latestVersionId = createdVersion._id as mongoose.Types.ObjectId;
      parentCircular.totalVersions = nextVersionNumber;
      parentCircular.title = title;
      if (sourceFilename) parentCircular.sourceFilename = sourceFilename;
      if (mimeType) parentCircular.mimeType = mimeType;
      await parentCircular.save();

      return {
        saved: true,
        deduplicated: false,
        circularId: String(parentCircular._id),
        versionId: String(createdVersion._id),
        versionNumber: createdVersion.versionNumber,
        parentCircularId: String(parentCircular._id),
        parentVersionId: explicitParentVerId ? String(explicitParentVerId) : null,
        isAmendment,
        pageCount,
        sectionCount: sections.length,
        circularNumber: createdVersion.circularNumber || '',
      };
    } catch (err: any) {
      if (err?.code === 11000) {
        const raced = await CircularVersionModel.findOne({ contentHash }).lean();
        if (raced) {
          return {
            saved: true,
            deduplicated: true,
            circularId: String(raced.circularId),
            versionId: String(raced._id),
            versionNumber: raced.versionNumber,
            parentCircularId: raced.parentCircularId ? String(raced.parentCircularId) : null,
            parentVersionId: raced.parentVersionId ? String(raced.parentVersionId) : null,
            isAmendment: Boolean(raced.isAmendment),
            pageCount: raced.pageCount,
            sectionCount: Array.isArray(raced.sections) ? raced.sections.length : 0,
            circularNumber: raced.circularNumber || '',
          };
        }
      }
      throw err;
    }
  }

  // New base circular + Version 1
  const baseSlug = buildSchemeLineageSlug(title, circularNumber);
  const existingKeyConflict = await CircularModel.findOne({ circularKey: baseSlug }).lean();
  const uniqueCircularKey = existingKeyConflict ? `${baseSlug}-${contentHash.slice(0, 8)}` : baseSlug;
  const isAmendment = Boolean(input.isAmendment || documentKind === 'amendment');

  const createdCircular = await CircularModel.create({
    circularKey: uniqueCircularKey,
    title,
    circularNumber,
    issuingAuthority,
    category,
    documentKind,
    sourceType,
    sourceFilename,
    mimeType,
    latestVersionNumber: 1,
    latestVersionId: null,
    totalVersions: 1,
  });

  try {
    const createdVersion = await CircularVersionModel.create({
      circularId: createdCircular._id,
      parentCircularId: null,
      parentVersionId: null,
      isAmendment,
      versionNumber: 1,
      contentHash,
      title,
      circularNumber,
      issuingAuthority,
      category,
      documentKind,
      sourceType,
      sourceFilename,
      mimeType,
      extractedText,
      pageCount,
      sections,
      analysisResult: input.analysisResult,
    });

    createdCircular.latestVersionId = createdVersion._id as mongoose.Types.ObjectId;
    await createdCircular.save();

    return {
      saved: true,
      deduplicated: false,
      circularId: String(createdCircular._id),
      versionId: String(createdVersion._id),
      versionNumber: 1,
      parentCircularId: null,
      parentVersionId: null,
      isAmendment,
      pageCount,
      sectionCount: sections.length,
      circularNumber,
    };
  } catch (err: any) {
    await CircularModel.deleteOne({ _id: createdCircular._id }).catch(() => {});
    if (err?.code === 11000) {
      const raced = await CircularVersionModel.findOne({ contentHash }).lean();
      if (raced) {
        return {
          saved: true,
          deduplicated: true,
          circularId: String(raced.circularId),
          versionId: String(raced._id),
          versionNumber: raced.versionNumber,
          parentCircularId: raced.parentCircularId ? String(raced.parentCircularId) : null,
          parentVersionId: raced.parentVersionId ? String(raced.parentVersionId) : null,
          isAmendment: Boolean(raced.isAmendment),
          pageCount: raced.pageCount,
          sectionCount: Array.isArray(raced.sections) ? raced.sections.length : 0,
          circularNumber: raced.circularNumber || '',
        };
      }
    }
    throw err;
  }
}

async function resolveVersionLinkFromDoc(doc: DocumentAnalysisResult, explicitCircularId?: string, explicitVersionId?: string) {
  if (explicitVersionId && mongoose.Types.ObjectId.isValid(explicitVersionId)) {
    const v = await CircularVersionModel.findById(explicitVersionId).select('_id circularId').lean();
    if (v) return { circularId: v.circularId, versionId: v._id };
  }

  const persistenceMeta = (doc as any)?.persistence;
  if (persistenceMeta?.versionId && mongoose.Types.ObjectId.isValid(persistenceMeta.versionId)) {
    return {
      circularId: persistenceMeta.circularId && mongoose.Types.ObjectId.isValid(persistenceMeta.circularId)
        ? new mongoose.Types.ObjectId(persistenceMeta.circularId)
        : null,
      versionId: new mongoose.Types.ObjectId(persistenceMeta.versionId),
    };
  }

  // Try matching by reconstructed section text or title
  const rawJoined = (doc.clauses || []).map((c) => c.original_text || '').join('\n').trim();
  if (rawJoined) {
    const candidateHash = computeNormalizedContentHash(rawJoined);
    const v = await CircularVersionModel.findOne({ contentHash: candidateHash }).select('_id circularId').lean();
    if (v) return { circularId: v.circularId, versionId: v._id };
  }

  if (explicitCircularId && mongoose.Types.ObjectId.isValid(explicitCircularId)) {
    const c = await CircularModel.findById(explicitCircularId).select('_id latestVersionId').lean();
    if (c) return { circularId: c._id, versionId: c.latestVersionId || null };
  }

  return { circularId: null, versionId: null };
}

export async function saveOrReuseComparisonHistory(params: {
  docA: DocumentAnalysisResult;
  docB: DocumentAnalysisResult;
  comparisonResult: ComparisonResult;
  circularAId?: string;
  circularBId?: string;
  versionAId?: string;
  versionBId?: string;
}): Promise<ComparisonPersistenceMetadata> {
  if (!isDatabaseConnected()) {
    return { saved: false, deduplicated: false, reason: 'Database not connected' };
  }

  const linkA = await resolveVersionLinkFromDoc(params.docA, params.circularAId, params.versionAId);
  const linkB = await resolveVersionLinkFromDoc(params.docB, params.circularBId, params.versionBId);

  const signaturePayload = JSON.stringify({
    aTitle: params.comparisonResult.doc_a_title || params.docA.document_title,
    bTitle: params.comparisonResult.doc_b_title || params.docB.document_title,
    aVersion: linkA.versionId ? String(linkA.versionId) : null,
    bVersion: linkB.versionId ? String(linkB.versionId) : null,
    aClauses: (params.docA.clauses || []).map((c) => `${c.page_number || 1}:${c.section_reference || ''}:${c.original_text}`),
    bClauses: (params.docB.clauses || []).map((c) => `${c.page_number || 1}:${c.section_reference || ''}:${c.original_text}`),
  });
  const pairHash = crypto.createHash('sha256').update(signaturePayload).digest('hex');

  const existing = await ComparisonHistoryModel.findOne({ pairHash });
  if (existing) {
    return {
      saved: true,
      deduplicated: true,
      comparisonId: String(existing._id),
    };
  }

  const enrichedAlignedPairs = (params.comparisonResult.aligned_pairs || []).map((pair) => ({
    ...pair,
    doc_a_page: pair.doc_a_clause?.page_number ?? null,
    doc_a_section: pair.doc_a_clause?.section_reference ?? null,
    doc_b_page: pair.doc_b_clause?.page_number ?? null,
    doc_b_section: pair.doc_b_clause?.section_reference ?? null,
  }));

  try {
    const created = await ComparisonHistoryModel.create({
      pairHash,
      docATitle: params.comparisonResult.doc_a_title || params.docA.document_title || 'Circular A',
      docBTitle: params.comparisonResult.doc_b_title || params.docB.document_title || 'Circular B',
      circularAId: linkA.circularId,
      circularBId: linkB.circularId,
      versionAId: linkA.versionId,
      versionBId: linkB.versionId,
      addedCount: params.comparisonResult.added_count ?? (params.comparisonResult.b_only_clauses || []).length,
      removedCount: params.comparisonResult.removed_count ?? (params.comparisonResult.a_only_clauses || []).length,
      modifiedCount:
        params.comparisonResult.modified_count ??
        enrichedAlignedPairs.filter((p) => p.change_type === 'modified').length,
      unchangedCount:
        params.comparisonResult.unchanged_count ??
        enrichedAlignedPairs.filter((p) => p.change_type === 'unchanged').length,
      keyDifferencesSummary: params.comparisonResult.key_differences_summary || '',
      alignedPairs: enrichedAlignedPairs,
      comparisonResult: params.comparisonResult,
    });

    return {
      saved: true,
      deduplicated: false,
      comparisonId: String(created._id),
    };
  } catch (err: any) {
    if (err?.code === 11000) {
      const raced = await ComparisonHistoryModel.findOne({ pairHash }).lean();
      if (raced) {
        return {
          saved: true,
          deduplicated: true,
          comparisonId: String(raced._id),
        };
      }
    }
    throw err;
  }
}

export async function listCircularsWithHistory(limit: number = 30) {
  if (!isDatabaseConnected()) {
    throw new Error('DATABASE_DISCONNECTED');
  }

  const circulars = await CircularModel.find({})
    .sort({ updatedAt: -1 })
    .limit(Math.min(100, Math.max(1, limit)))
    .lean();

  if (circulars.length === 0) return [];

  const circularIds = circulars.map((c) => c._id);
  const versions = await CircularVersionModel.find({ circularId: { $in: circularIds } })
    .select('circularId parentCircularId parentVersionId isAmendment versionNumber contentHash title circularNumber issuingAuthority category documentKind sourceType sourceFilename mimeType pageCount sections.id sections.title sections.page_number sections.section_reference sections.clause_type createdAt')
    .sort({ versionNumber: 1 })
    .lean();

  const versionMap = new Map<string, any[]>();
  for (const v of versions) {
    const key = String(v.circularId);
    if (!versionMap.has(key)) versionMap.set(key, []);
    versionMap.get(key)!.push({
      id: String(v._id),
      circularId: key,
      parentCircularId: v.parentCircularId ? String(v.parentCircularId) : null,
      parentVersionId: v.parentVersionId ? String(v.parentVersionId) : null,
      isAmendment: Boolean(v.isAmendment),
      versionNumber: v.versionNumber,
      contentHash: v.contentHash,
      title: v.title,
      circularNumber: v.circularNumber,
      issuingAuthority: v.issuingAuthority,
      category: v.category,
      documentKind: v.documentKind,
      sourceType: v.sourceType,
      sourceFilename: v.sourceFilename,
      mimeType: v.mimeType,
      pageCount: v.pageCount,
      sectionCount: Array.isArray(v.sections) ? v.sections.length : 0,
      createdAt: v.createdAt,
    });
  }

  return circulars.map((c) => ({
    id: String(c._id),
    circularKey: c.circularKey,
    title: c.title,
    circularNumber: c.circularNumber,
    issuingAuthority: c.issuingAuthority,
    category: c.category,
    documentKind: c.documentKind,
    sourceType: c.sourceType,
    sourceFilename: c.sourceFilename,
    mimeType: c.mimeType,
    latestVersionNumber: c.latestVersionNumber,
    latestVersionId: c.latestVersionId ? String(c.latestVersionId) : null,
    totalVersions: c.totalVersions,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    versions: versionMap.get(String(c._id)) || [],
  }));
}

export async function getCircularByIdWithVersions(circularId: string) {
  if (!isDatabaseConnected()) {
    throw new Error('DATABASE_DISCONNECTED');
  }
  if (!mongoose.Types.ObjectId.isValid(circularId)) {
    return null;
  }

  const circular = await CircularModel.findById(circularId).lean();
  if (!circular) return null;

  const versions = await CircularVersionModel.find({ circularId: circular._id })
    .sort({ versionNumber: 1 })
    .lean();

  return {
    id: String(circular._id),
    circularKey: circular.circularKey,
    title: circular.title,
    circularNumber: circular.circularNumber,
    issuingAuthority: circular.issuingAuthority,
    category: circular.category,
    documentKind: circular.documentKind,
    sourceType: circular.sourceType,
    sourceFilename: circular.sourceFilename,
    mimeType: circular.mimeType,
    latestVersionNumber: circular.latestVersionNumber,
    latestVersionId: circular.latestVersionId ? String(circular.latestVersionId) : null,
    totalVersions: circular.totalVersions,
    createdAt: circular.createdAt,
    updatedAt: circular.updatedAt,
    versions: versions.map((v) => ({
      id: String(v._id),
      circularId: String(v.circularId),
      parentCircularId: v.parentCircularId ? String(v.parentCircularId) : null,
      parentVersionId: v.parentVersionId ? String(v.parentVersionId) : null,
      isAmendment: Boolean(v.isAmendment),
      versionNumber: v.versionNumber,
      contentHash: v.contentHash,
      title: v.title,
      circularNumber: v.circularNumber,
      issuingAuthority: v.issuingAuthority,
      category: v.category,
      documentKind: v.documentKind,
      sourceType: v.sourceType,
      sourceFilename: v.sourceFilename,
      mimeType: v.mimeType,
      extractedText: v.extractedText,
      pageCount: v.pageCount,
      sections: v.sections,
      analysisResult: v.analysisResult,
      createdAt: v.createdAt,
    })),
  };
}

export async function getCircularVersionById(versionId: string) {
  if (!isDatabaseConnected()) {
    throw new Error('DATABASE_DISCONNECTED');
  }
  if (!mongoose.Types.ObjectId.isValid(versionId)) {
    return null;
  }

  const v = await CircularVersionModel.findById(versionId).lean();
  if (!v) return null;

  return {
    id: String(v._id),
    circularId: String(v.circularId),
    parentCircularId: v.parentCircularId ? String(v.parentCircularId) : null,
    parentVersionId: v.parentVersionId ? String(v.parentVersionId) : null,
    isAmendment: Boolean(v.isAmendment),
    versionNumber: v.versionNumber,
    contentHash: v.contentHash,
    title: v.title,
    circularNumber: v.circularNumber,
    issuingAuthority: v.issuingAuthority,
    category: v.category,
    documentKind: v.documentKind,
    sourceType: v.sourceType,
    sourceFilename: v.sourceFilename,
    mimeType: v.mimeType,
    extractedText: v.extractedText,
    pageCount: v.pageCount,
    sections: v.sections,
    analysisResult: v.analysisResult,
    createdAt: v.createdAt,
  };
}

export async function listComparisonHistory(limit: number = 30) {
  if (!isDatabaseConnected()) {
    throw new Error('DATABASE_DISCONNECTED');
  }

  const rows = await ComparisonHistoryModel.find({})
    .select('pairHash docATitle docBTitle circularAId circularBId versionAId versionBId addedCount removedCount modifiedCount unchangedCount keyDifferencesSummary createdAt updatedAt')
    .sort({ updatedAt: -1 })
    .limit(Math.min(100, Math.max(1, limit)))
    .lean();

  return rows.map((r) => ({
    id: String(r._id),
    pairHash: r.pairHash,
    docATitle: r.docATitle,
    docBTitle: r.docBTitle,
    circularAId: r.circularAId ? String(r.circularAId) : null,
    circularBId: r.circularBId ? String(r.circularBId) : null,
    versionAId: r.versionAId ? String(r.versionAId) : null,
    versionBId: r.versionBId ? String(r.versionBId) : null,
    addedCount: r.addedCount,
    removedCount: r.removedCount,
    modifiedCount: r.modifiedCount,
    unchangedCount: r.unchangedCount,
    keyDifferencesSummary: r.keyDifferencesSummary,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export async function getComparisonHistoryById(comparisonId: string) {
  if (!isDatabaseConnected()) {
    throw new Error('DATABASE_DISCONNECTED');
  }
  if (!mongoose.Types.ObjectId.isValid(comparisonId)) {
    return null;
  }

  const r = await ComparisonHistoryModel.findById(comparisonId).lean();
  if (!r) return null;

  return {
    id: String(r._id),
    pairHash: r.pairHash,
    docATitle: r.docATitle,
    docBTitle: r.docBTitle,
    circularAId: r.circularAId ? String(r.circularAId) : null,
    circularBId: r.circularBId ? String(r.circularBId) : null,
    versionAId: r.versionAId ? String(r.versionAId) : null,
    versionBId: r.versionBId ? String(r.versionBId) : null,
    addedCount: r.addedCount,
    removedCount: r.removedCount,
    modifiedCount: r.modifiedCount,
    unchangedCount: r.unchangedCount,
    keyDifferencesSummary: r.keyDifferencesSummary,
    alignedPairs: r.alignedPairs,
    comparisonResult: r.comparisonResult,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
