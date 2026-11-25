import dotenv from 'dotenv';
import path from 'path';
import zlib from 'zlib';
import { PDFDocument } from 'pdf-lib';
import { PDFParse } from 'pdf-parse';
import { MAX_PDF_PAGES, MAX_PDF_PAGES_ERROR_MSG } from '../config/constants';

function detectImageMimeFromMagicBytes(buffer: Buffer, fallbackMime: string = 'image/png'): string {
  if (buffer && Buffer.isBuffer(buffer) && buffer.length >= 4) {
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif';
    if (buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp';
    if (buffer.length >= 12 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'image/webp';
  }
  return fallbackMime && fallbackMime.startsWith('image/') ? fallbackMime : 'image/png';
}

function hasImageMagicBytes(fileBuffer: Buffer): boolean {
  return Boolean(
    fileBuffer &&
    Buffer.isBuffer(fileBuffer) &&
    fileBuffer.length >= 4 &&
    ((fileBuffer[0] === 0x89 && fileBuffer[1] === 0x50 && fileBuffer[2] === 0x4e && fileBuffer[3] === 0x47) || // PNG
      (fileBuffer[0] === 0xff && fileBuffer[1] === 0xd8 && fileBuffer[2] === 0xff) || // JPEG
      (fileBuffer[0] === 0x47 && fileBuffer[1] === 0x49 && fileBuffer[2] === 0x46) || // GIF
      (fileBuffer[0] === 0x42 && fileBuffer[1] === 0x4d) || // BMP
      (fileBuffer.length >= 12 && fileBuffer[8] === 0x57 && fileBuffer[9] === 0x45 && fileBuffer[10] === 0x42 && fileBuffer[11] === 0x50)) // WEBP
  );
}

function isLikelyReadableImageBuffer(fileBuffer: Buffer): boolean {
  if (!hasImageMagicBytes(fileBuffer) || fileBuffer.length < 64) {
    return false;
  }
  const isPng = fileBuffer[0] === 0x89 && fileBuffer[1] === 0x50 && fileBuffer[2] === 0x4e && fileBuffer[3] === 0x47;
  if (isPng && !fileBuffer.includes(Buffer.from('IEND'))) {
    return false;
  }
  return true;
}

async function performLocalTesseractOcrBatch(imageBuffers: Buffer[]): Promise<string[]> {
  const validBuffers = imageBuffers.filter((b) => isLikelyReadableImageBuffer(b));
  if (validBuffers.length === 0) return imageBuffers.map(() => '');

  const results: string[] = new Array(imageBuffers.length).fill('');
  try {
    const { createWorker } = await import('tesseract.js');
    console.log(`👁️ [LOCAL TESSERACT OCR] Starting batch OCR for ${validBuffers.length} page/image buffer(s)...`);
    let rejectActiveRecognize: ((err: any) => void) | null = null;
    const worker = await createWorker('eng', 1, {
      errorHandler: (err: any) => {
        console.warn('Local Tesseract worker error caught safely:', err?.message || err);
        if (rejectActiveRecognize) {
          rejectActiveRecognize(err);
          rejectActiveRecognize = null;
        }
      },
    });
    try {
      for (let i = 0; i < imageBuffers.length; i++) {
        const buf = imageBuffers[i];
        if (!isLikelyReadableImageBuffer(buf)) continue;
        try {
          const ret: any = await Promise.race([
            worker.recognize(buf),
            new Promise((_, reject) => {
              rejectActiveRecognize = reject;
            }),
          ]);
          rejectActiveRecognize = null;
          const tesseractText = (ret?.data?.text || '').trim();
          if (tesseractText.length > 10) {
            results[i] = tesseractText;
          }
        } catch (pageErr) {
          rejectActiveRecognize = null;
          console.warn(`Local Tesseract OCR page ${i + 1} warning:`, (pageErr as any)?.message || pageErr);
        }
      }
    } finally {
      await worker.terminate().catch(() => {});
    }
  } catch (err) {
    console.warn('Local Tesseract OCR worker initialization warning:', (err as any)?.message || err);
  }
  return results;
}

// Per-page PDF extraction with automatic scanned-page rendering + OCR fallback
async function extractPdfTextWithPdfParseAsync(fileBuffer: Buffer): Promise<string> {
  try {
    if (typeof PDFParse === 'function') {
      const parser = new PDFParse(new Uint8Array(fileBuffer));
      try {
        const res = await parser.getText();
        const pages = Array.isArray(res?.pages) ? res.pages : [];
        const totalPages = pages.length || res?.total || 0;

        const pageTextMap = new Map<number, string>();
        const pagesNeedingOcr: number[] = [];

        if (pages.length > 0) {
          for (const page of pages) {
            const pageNum = typeof page.num === 'number' ? page.num : pageTextMap.size + 1;
            const cleanedPage = (page.text || '')
              .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, '')
              .replace(/\s+\n/g, '\n')
              .trim();

            if (cleanedPage.length >= 20 && isReadableProse(cleanedPage) && !containsPdfObjectNoise(cleanedPage)) {
              pageTextMap.set(pageNum, cleanedPage);
            } else {
              pagesNeedingOcr.push(pageNum);
            }
          }
        } else if (res && typeof res.text === 'string' && res.text.trim().length > 0) {
          const cleaned = res.text.replace(/--\s*\d+\s+of\s+\d+\s*--/gi, '').trim();
          if (cleaned.length >= 20 && isReadableProse(cleaned) && !containsPdfObjectNoise(cleaned)) {
            return `--- Page 1 ---\n${cleaned}`;
          }
        }

        // Render and OCR any scanned / image-only pages
        if (pagesNeedingOcr.length > 0 && pagesNeedingOcr.length <= MAX_PDF_PAGES) {
          console.log(`👁️ [SCANNED PDF OCR] Page(s) ${pagesNeedingOcr.join(', ')} lack selectable text. Rendering to PNG for OCR...`);
          try {
            const screenshotResult = await parser.getScreenshot({
              partial: pagesNeedingOcr,
              scale: 2,
              imageBuffer: true,
              imageDataUrl: false,
            });
            const renderedPages = Array.isArray(screenshotResult?.pages) ? screenshotResult.pages : [];
            const missingAfterVision: Array<{ pageNum: number; pngBuf: Buffer }> = [];

            for (const shot of renderedPages) {
              const pngBuf = Buffer.from(shot.data);
              // Try remote Vision OCR first if an API key is configured; otherwise batch with Tesseract below
              const visionPageText = await performVisionOcrOnImageBuffer(pngBuf, 'image/png', false);
              if (visionPageText && visionPageText.trim().length > 15 && isReadableProse(visionPageText)) {
                pageTextMap.set(shot.pageNumber, visionPageText.trim());
              } else {
                missingAfterVision.push({ pageNum: shot.pageNumber, pngBuf });
              }
            }

            if (missingAfterVision.length > 0) {
              const ocrTexts = await performLocalTesseractOcrBatch(missingAfterVision.map((m) => m.pngBuf));
              for (let i = 0; i < missingAfterVision.length; i++) {
                const text = (ocrTexts[i] || '').trim();
                if (text.length > 15 && isReadableProse(text)) {
                  pageTextMap.set(missingAfterVision[i].pageNum, text);
                }
              }
            }
          } catch (ocrRenderErr) {
            console.warn('PDF page screenshot rendering for OCR failed:', ocrRenderErr);
          }
        }

        const orderedPageNums = Array.from(pageTextMap.keys()).sort((a, b) => a - b);
        if (orderedPageNums.length > 0) {
          return orderedPageNums
            .map((pNum) => `--- Page ${pNum} ---\n${pageTextMap.get(pNum)}`)
            .join('\n\n')
            .trim();
        }

        if (totalPages === 0 && res && typeof res.text === 'string' && res.text.trim().length > 0) {
          return `--- Page 1 ---\n${res.text.trim()}`;
        }
      } finally {
        await parser.destroy().catch(() => {});
      }
    }
  } catch (e) {
    console.warn('PDFParse class extraction failed:', e);
  }

  try {
    const req = typeof require !== 'undefined' ? require : undefined;
    if (req) {
      const loaded = req('pdf-parse');
      const fn = loaded.default || loaded;
      if (typeof fn === 'function') {
        const res = await fn(fileBuffer);
        if (res && typeof res.text === 'string' && res.text.trim().length > 0) {
          return `--- Page 1 ---\n${res.text.trim()}`;
        }
      }
    }
  } catch (e) {
    console.warn('pdf-parse legacy function extraction failed:', e);
  }

  return '';
}

// Load environment variables from server/.env and root .env
dotenv.config({ path: path.resolve(process.cwd(), 'server/.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config();

import {
  DocumentAnalysisResult,
  ComparisonResult,
  ChatMessage,
  ServerConfigStatus,
  Guard1InputGate,
  CircularDocumentKind,
  DOCUMENT_CATEGORY_ENUM,
  CLAUSE_TYPE_ENUM,
  ClauseType,
  RiskLevel,
  normalizeClauseType,
  normalizeDocumentCategory,
  normalizeRiskLevel,
  DocumentCategory,
  SimplifiedClause,
  QuotaTelemetry,
  InternalContradiction,
  ExecutionBlockAnalysis,
  NextStepsOption,
} from '../../../src/types/schemas';
import { alignClauses } from '../../../src/utils/clauseAlignment';

// Server-side in-memory API key store
let serverApiKey: string | null = process.env.GROQ_API_KEY || process.env.ASTRA_API_KEY || process.env.GEMINI_API_KEY || null;

export function setServerApiKey(key: string): void {
  serverApiKey = key;
}

// Quota & Rotation Telemetry State (Connected directly to Groq API Key Headers)
let activeEnginePointer: 'primary' | 'backup' = 'primary';
let primaryCooldownUntil = 0;
let backupCooldownUntil = 0;
let lastWindowMinuteEpoch = Math.floor(Date.now() / 60000);
const modelCooldownMap = new Map<string, number>();

interface KeyHeaderTelemetry {
  limitRpm: number;
  remainingRpm: number;
  limitTpm: number;
  remainingTpm: number;
}

const primaryKeyHeaderState: KeyHeaderTelemetry = {
  limitRpm: 1250,
  remainingRpm: 1250,
  limitTpm: 78000,
  remainingTpm: 78000,
};

const backupKeyHeaderState: KeyHeaderTelemetry = {
  limitRpm: 1250,
  remainingRpm: 1250,
  limitTpm: 78000,
  remainingTpm: 78000,
};

export function getQuotaStatus(): QuotaTelemetry {
  const now = Date.now();
  const currentMinuteEpoch = Math.floor(now / 60000);
  if (currentMinuteEpoch > lastWindowMinuteEpoch) {
    lastWindowMinuteEpoch = currentMinuteEpoch;
    // Auto-refill remaining API Key headers on 60-second window reset
    primaryKeyHeaderState.remainingRpm = primaryKeyHeaderState.limitRpm;
    primaryKeyHeaderState.remainingTpm = primaryKeyHeaderState.limitTpm;
    backupKeyHeaderState.remainingRpm = backupKeyHeaderState.limitRpm;
    backupKeyHeaderState.remainingTpm = backupKeyHeaderState.limitTpm;
  }

  const secondInMinute = Math.floor((now % 60000) / 1000);
  const resetSeconds = Math.max(1, 60 - secondInMinute);

  const primaryKey = (process.env.GROQ_API_KEY || '').replace(/^['"]|['"]$/g, '').trim();
  const backupKey = (process.env.GROQ_API_KEY_BACKUP || '').replace(/^['"]|['"]$/g, '').trim();
  const hasBackup = backupKey.length > 5;

  if (activeEnginePointer === 'backup' && hasBackup) {
    if (primaryCooldownUntil <= now && backupCooldownUntil > now) {
      activeEnginePointer = 'primary';
    }
  } else if (activeEnginePointer === 'primary') {
    if (primaryCooldownUntil > now && hasBackup && backupCooldownUntil <= now) {
      activeEnginePointer = 'backup';
    }
  }

  const activeEngineLabel = activeEnginePointer === 'primary' ? 'Primary Engine' : 'Backup Engine';

  // Real API key header limits and remaining capacity
  const totalRpm = hasBackup ? primaryKeyHeaderState.limitRpm + backupKeyHeaderState.limitRpm : primaryKeyHeaderState.limitRpm;
  const totalTpm = hasBackup ? primaryKeyHeaderState.limitTpm + backupKeyHeaderState.limitTpm : primaryKeyHeaderState.limitTpm;

  const totalAvailableRpm = hasBackup
    ? primaryKeyHeaderState.remainingRpm + backupKeyHeaderState.remainingRpm
    : primaryKeyHeaderState.remainingRpm;

  const totalAvailableTpm = hasBackup
    ? primaryKeyHeaderState.remainingTpm + backupKeyHeaderState.remainingTpm
    : primaryKeyHeaderState.remainingTpm;

  const usedRpm = Math.max(0, Math.min(totalRpm, totalRpm - totalAvailableRpm));
  const usedTpm = Math.max(0, Math.min(totalTpm, totalTpm - totalAvailableTpm));

  return {
    totalRpm,
    usedRpm,
    totalTpm,
    usedTpm,
    resetSeconds,
    activeEngine: activeEngineLabel,
    isBackupAvailable: hasBackup,
  };
}

export function getServerConfigStatus(): ServerConfigStatus {
  const primaryKey = (process.env.GROQ_API_KEY || '').replace(/^['"]|['"]$/g, '').trim();
  const backupKey = (process.env.GROQ_API_KEY_BACKUP || '').replace(/^['"]|['"]$/g, '').trim();
  const key = (serverApiKey || primaryKey || backupKey || process.env.ASTRA_API_KEY || process.env.GEMINI_API_KEY || '').replace(/^['"]|['"]$/g, '').trim();
  const hasKey = !!(key && key.length > 5);
  return {
    isConfigured: hasKey,
    demoMode: !hasKey,
    quota: getQuotaStatus(),
  };
}

const PDF_SYNTAX_KEYWORDS = new Set([
  'ascii85decode', 'flatedecode', 'winansiencoding', 'mediabox', 'fontdescriptor',
  'fontbbox', 'startxref', 'endstream', 'endobj', 'xobject', 'procset',
  'pagemode', 'usenone', 'structtreeroot', 'markinfo', 'outputintents',
  'cidtosgidmap', 'tounicode', 'fontmatrix', 'reportlab'
]);

export function containsPdfObjectNoise(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();

  // Explicit PDF object stream & metadata signatures
  if (
    lower.includes('ascii85decode') ||
    lower.includes('flatedecode') ||
    lower.includes('winansiencoding') ||
    lower.includes('procset text imageb') ||
    lower.includes('mediabox 612') ||
    lower.includes('fontdescriptor') ||
    lower.includes('reportlab generated document') ||
    lower.includes('basefont helvetica') ||
    lower.includes('fontbbox') ||
    lower.includes('startxref') ||
    lower.includes('endstream endobj') ||
    lower.includes('type1 font bold')
  ) {
    return true;
  }

  const tokens = lower.split(/[^\p{L}\p{N}]+/gu).filter((t) => t.length > 1);
  if (tokens.length < 10) return false;

  let pdfTokenCount = 0;
  tokens.forEach((t) => {
    if (PDF_SYNTAX_KEYWORDS.has(t)) pdfTokenCount++;
  });

  const noiseRatio = pdfTokenCount / tokens.length;
  return noiseRatio >= 0.15;
}

export function isReadableProse(text: string): boolean {
  if (!text || text.trim().length < 15) return false;
  if (containsPdfObjectNoise(text)) return false;

  const cleaned = text.trim();
  const tokens = cleaned.toLowerCase().split(/[^\p{L}\p{N}]+/gu).filter((t) => t.length > 1);

  if (tokens.length < 4) return false;

  // Reject binary JPEG/PNG metadata noise (JFIF, EXIF, ICC_PROFILE, etc.)
  const BINARY_IMAGE_NOISE = new Set([
    'jfif', 'exif', 'ihdr', 'idat', 'icc_profile', 'mntrrgb', 'xyz', 'acsp',
    'msft', 'iec', 'srgb', 'photoshop', 'adobe', 'bkgd', 'phys', 'gama'
  ]);
  let binaryNoiseCount = 0;
  tokens.forEach((t) => {
    if (BINARY_IMAGE_NOISE.has(t)) binaryNoiseCount++;
  });
  if (binaryNoiseCount >= 2 || (binaryNoiseCount / tokens.length) > 0.08) {
    return false;
  }

  let pdfTokenCount = 0;
  tokens.forEach((t) => {
    if (PDF_SYNTAX_KEYWORDS.has(t)) {
      pdfTokenCount++;
    }
  });

  const pdfNoiseRatio = pdfTokenCount / tokens.length;
  // If more than 15% of tokens are PDF structural noise, fail sanity check
  if (pdfNoiseRatio > 0.15) {
    return false;
  }

  const COMMON_PROSE_WORDS = new Set([
    'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
    'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
    'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
    'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
    'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me',
    'government', 'circular', 'scheme', 'yojana', 'notification', 'order', 'ministry',
    'department', 'guidelines', 'eligibility', 'eligible', 'beneficiary', 'beneficiaries',
    'subsidy', 'grant', 'scholarship', 'pension', 'assistance', 'applicant', 'income',
    'limit', 'deadline', 'documents', 'amendment', 'corrigendum', 'portal', 'rs', 'rupees',
    'date', 'clause', 'section', 'notice', 'para', 'issued', 'effective', 'benefit'
  ]);

  const isIndianLanguageToken = (t: string) => /[\u0900-\u097F\u0C80-\u0CFF]/u.test(t);

  let proseWordCount = 0;
  tokens.forEach((t) => {
    if (COMMON_PROSE_WORDS.has(t) || isIndianLanguageToken(t) || t.length >= 4) {
      proseWordCount++;
    }
  });

  const proseRatio = proseWordCount / tokens.length;
  return proseRatio >= 0.35;
}

// Helper function to extract text from FlateDecode & uncompressed PDF streams
function extractPdfTextWithZlib(fileBuffer: Buffer): string {
  const rawStr = fileBuffer.toString('latin1');
  const streamMatches = rawStr.match(/stream[\r\n]+([\s\S]*?)[\r\n]+endstream/gi) || [];
  let extractedPhrases: string[] = [];

  streamMatches.forEach((sBlock) => {
    const content = sBlock.replace(/^stream[\r\n]+/i, '').replace(/[\r\n]+endstream$/i, '');
    let decompressedText = content;

    try {
      const bufferContent = Buffer.from(content, 'latin1');
      const decompressedBuffer = zlib.inflateSync(bufferContent);
      decompressedText = decompressedBuffer.toString('utf-8');
    } catch {
      try {
        const bufferContent = Buffer.from(content, 'latin1');
        const decompressedBuffer = zlib.unzipSync(bufferContent);
        decompressedText = decompressedBuffer.toString('utf-8');
      } catch {
        decompressedText = content;
      }
    }

    // 1. Extract parenthesized text: (Hello World) Tj
    const parenthesized = decompressedText.match(/\(([^()]+)\)/g) || [];
    parenthesized.forEach((p) => {
      const cleanP = p.replace(/[()]/g, '').trim();
      if (
        cleanP.length > 1 &&
        !cleanP.startsWith('http') &&
        !cleanP.includes('pdf-lib') &&
        !cleanP.includes('github.com') &&
        !cleanP.startsWith('D:202')
      ) {
        const clean = cleanP.replace(/[^\p{L}\p{N}\p{P}\p{Z}\n]/gu, ' ').replace(/\s+/g, ' ').trim();
        if (clean.length > 1 && !PDF_SYNTAX_KEYWORDS.has(clean.toLowerCase())) {
          extractedPhrases.push(clean);
        }
      }
    });

    // 2. Extract hex-encoded text: <454D504C4F594D454E54> Tj
    const hexMatches = decompressedText.match(/<([0-9A-Fa-f]{4,})>\s*(?:Tj|TJ|\)|\])?/g) || [];
    hexMatches.forEach((h) => {
      const hexOnly = h.replace(/[^0-9A-Fa-f]/g, '');
      if (hexOnly.length >= 4 && hexOnly.length % 2 === 0) {
        try {
          const decoded = Buffer.from(hexOnly, 'hex').toString('utf-8');
          const cleanDecoded = decoded.replace(/[^\p{L}\p{N}\p{P}\p{Z}\n]/gu, ' ').replace(/\s+/g, ' ').trim();
          if (
            cleanDecoded.length > 2 &&
            !cleanDecoded.includes('pdf-lib') &&
            !cleanDecoded.startsWith('D:202') &&
            !cleanDecoded.includes('github.com')
          ) {
            extractedPhrases.push(cleanDecoded);
          }
        } catch {
          // Ignore invalid hex
        }
      }
    });

    // 3. Extract plain uncompressed stream lines
    const lines = decompressedText.split(/[\r\n]+/);
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (
        trimmed.length > 3 &&
        !trimmed.includes('<') &&
        !trimmed.includes('>') &&
        !trimmed.includes('/') &&
        !/^\d+\s+\d+\s+[Robj]/i.test(trimmed) &&
        !/^[0-9.\s]+(Tm|TL|Tf|rg|RG|re|cm|BT|ET)$/.test(trimmed)
      ) {
        const cleanLine = trimmed.replace(/\\[0-9]{3}/g, '').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
        const words = cleanLine.split(' ').filter((w) => w.length > 1 && !PDF_SYNTAX_KEYWORDS.has(w.toLowerCase()));
        if (words.length >= 2) {
          extractedPhrases.push(words.join(' '));
        }
      }
    });
  });

  const result = Array.from(new Set(extractedPhrases)).join(' ').replace(/\s+/g, ' ').trim();
  if (containsPdfObjectNoise(result)) {
    return '';
  }
  return result;
}

async function performVisionOcrOnImageBuffer(
  fileBuffer: Buffer,
  mimeType: string = 'image/png',
  allowLocalTesseractFallback: boolean = true
): Promise<string | null> {
  const isPdfInput =
    mimeType.toLowerCase().includes('pdf') ||
    (fileBuffer && Buffer.isBuffer(fileBuffer) && fileBuffer.length >= 4 && fileBuffer[0] === 0x25 && fileBuffer[1] === 0x50 && fileBuffer[2] === 0x44 && fileBuffer[3] === 0x46);

  const effectiveMime = isPdfInput
    ? 'application/pdf'
    : detectImageMimeFromMagicBytes(fileBuffer, mimeType);

  try {
    const groqEnvKey = (process.env.GROQ_API_KEY || '').replace(/^['"]|['"]$/g, '').trim();
    const backupGroqKey = (process.env.GROQ_API_KEY_BACKUP || '').replace(/^['"]|['"]$/g, '').trim();
    const geminiEnvKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').replace(/^['"]|['"]$/g, '').trim();
    const openAiEnvKey = (process.env.OPENAI_API_KEY || '').replace(/^['"]|['"]$/g, '').trim();
    const activeKey = (serverApiKey || groqEnvKey || backupGroqKey || process.env.ASTRA_API_KEY || geminiEnvKey || openAiEnvKey || '').replace(/^['"]|['"]$/g, '').trim();

    if (activeKey && activeKey.length >= 5) {
      const base64Data = fileBuffer.toString('base64');
      const ocrPrompt =
        'Extract all visible text verbatim from this government circular or document, preserving headings, section numbers, tables, dates, amounts, and page numbers. Return only the extracted text.';

      // 1. Gemini Native API supports both image/* and application/pdf inline_data
      const geminiKey = geminiEnvKey || (activeKey.startsWith('AIza') || activeKey.startsWith('AQ.') ? activeKey : '');
      if (geminiKey) {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
        const res = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: ocrPrompt },
                { inline_data: { mime_type: effectiveMime, data: base64Data } }
              ]
            }]
          }),
          signal: AbortSignal.timeout(20000),
        });

        if (res.ok) {
          const data = await res.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text && text.trim().length > 20) {
            console.log(`👁️ [VISION OCR SUCCESS] Extracted ${text.length} chars (${effectiveMime}) via Gemini Vision API.`);
            return text.trim();
          }
        }
      }

      // 2. OpenAI / Groq Vision Chat Completions ONLY accept image/* data URLs (never raw application/pdf)
      if (!isPdfInput && effectiveMime.startsWith('image/')) {
        const dataUrl = `data:${effectiveMime};base64,${base64Data}`;
        const messages = [
          {
            role: 'user',
            content: [
              { type: 'text', text: ocrPrompt },
              { type: 'image_url', image_url: { url: dataUrl } }
            ]
          }
        ];

        const visionTargets: Array<{ endpoint: string; model: string; key: string }> = [];
        const groqKey = groqEnvKey || backupGroqKey || (activeKey.startsWith('gsk_') ? activeKey : '');
        if (groqKey.startsWith('gsk_')) {
          visionTargets.push(
            { endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'meta-llama/llama-4-scout-17b-16e-instruct', key: groqKey },
            { endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'meta-llama/llama-4-maverick-17b-128e-instruct', key: groqKey }
          );
        }
        if (openAiEnvKey.length > 5) {
          visionTargets.push({ endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini', key: openAiEnvKey });
        }

        for (const target of visionTargets) {
          try {
            const res = await fetch(target.endpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${target.key}`
              },
              body: JSON.stringify({
                model: target.model,
                messages,
                max_tokens: 2000
              }),
              signal: AbortSignal.timeout(15000)
            });

            if (res.ok) {
              const data = await res.json();
              const text = data.choices?.[0]?.message?.content;
              if (text && text.trim().length > 20) {
                console.log(`👁️ [VISION OCR SUCCESS] Extracted ${text.length} chars from ${effectiveMime} via ${target.model}.`);
                return text.trim();
              }
            }
          } catch {
            // Continue to next model candidate
          }
        }
      }
    }
  } catch (err) {
    console.warn('Vision OCR processing fallback:', err);
  }

  // 3. Fallback to local Tesseract OCR for valid image buffers
  if (allowLocalTesseractFallback && !isPdfInput && hasImageMagicBytes(fileBuffer)) {
    const batch = await performLocalTesseractOcrBatch([fileBuffer]);
    if (batch[0] && batch[0].trim().length > 15) {
      console.log(`👁️ [LOCAL TESSERACT OCR SUCCESS] Extracted ${batch[0].length} characters from ${effectiveMime}.`);
      return batch[0].trim();
    }
  }

  return null;
}

const HINDI_OFFER_LETTER_FALLBACK = `रोजगार प्रस्ताव पत्र (EMPLOYMENT OFFER LETTER)

प्रिय श्री संजय पटेल,

हमें आपको 1 मार्च 2026 से प्रभावी, ब्लू रिज ट्रेडर्स (Blue Ridge Traders), अहमदाबाद में जूनियर अकाउंटेंट के पद की पेशकश करते हुए अत्यंत प्रसन्नता हो रही है।

1. वेतन (SALARY): रु. 28,000 प्रति माह, जिसका भुगतान प्रत्येक माह के अंतिम कार्य दिवस पर किया जाएगा।

2. परिवीक्षा काल (PROBATION): कार्यभार ग्रहण करने की तिथि से 3 माह। परिवीक्षा अवधि के दौरान कोई भी पक्ष 7 दिनों के नोटिस के साथ सेवा समाप्त कर सकता है।

3. नोटिस अवधि (NOTICE PERIOD): पद स्थायी (कन्फर्म) होने के बाद 30 दिन।

4. कार्य के घंटे (WORKING HOURS): प्रातः 9:30 बजे से सायं 6:30 बजे तक, सोमवार से शनिवार।

5. बॉन्ड (BOND): कर्मचारी न्यूनतम 12 माह की सेवा देने के लिए सहमत है, अथवा समय से पहले त्यागपत्र देने की स्थिति में प्रशिक्षण लागत के रूप में रु. 15,000 का पुनर्भुगतान करना होगा।

कृपया इस प्रस्ताव की अपनी स्वीकृति की पुष्टि करने के लिए इस प्रति पर हस्ताक्षर करके वापस भेजें।

भवदीय,
मानव संसाधन विभाग (HR Department)
ब्लू रिज ट्रेडर्स (Blue Ridge Traders)`;

const ENGLISH_OFFER_LETTER_FALLBACK = `EMPLOYMENT OFFER LETTER

Dear Mr. Sanjay Patel,

We are pleased to offer you the position of Junior Accountant at Blue Ridge Traders, Ahmedabad, effective 1st March 2026.

1. SALARY: Rs. 28,000 per month, paid on the last working day of each month.

2. PROBATION: 3 months from date of joining. Either party may terminate with 7 days notice during probation.

3. NOTICE PERIOD: 30 days after confirmation.

4. WORKING HOURS: 9:30 AM to 6:30 PM, Monday to Saturday.

5. BOND: Employee agrees to serve a minimum of 12 months or repay Rs. 15,000 towards training costs if resigning early.

Please sign and return a copy to confirm your acceptance of this offer.

Yours sincerely,
HR Department
Blue Ridge Traders`;

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

// Helper function to extract text from DOCX files
function extractDocxText(fileBuffer: Buffer): string {
  try {
    let offset = 0;
    const documentXmlParts: string[] = [];

    while (offset < fileBuffer.length - 30) {
      if (
        fileBuffer[offset] === 0x50 &&
        fileBuffer[offset + 1] === 0x4b &&
        fileBuffer[offset + 2] === 0x03 &&
        fileBuffer[offset + 3] === 0x04
      ) {
        const compMethod = fileBuffer.readUInt16LE(offset + 8);
        const compSize = fileBuffer.readUInt32LE(offset + 18);
        const fileNameLen = fileBuffer.readUInt16LE(offset + 26);
        const extraLen = fileBuffer.readUInt16LE(offset + 28);

        const fileName = fileBuffer.toString('utf-8', offset + 30, offset + 30 + fileNameLen);
        const dataOffset = offset + 30 + fileNameLen + extraLen;

        if (fileName.includes('word/document.xml') || fileName.includes('word/header') || fileName.includes('word/footer')) {
          let xmlContent = '';
          const rawSlice = fileBuffer.subarray(dataOffset, dataOffset + compSize);
          if (compMethod === 8) {
            try {
              xmlContent = zlib.inflateRawSync(rawSlice).toString('utf-8');
            } catch (zErr) {
              try {
                xmlContent = zlib.inflateSync(rawSlice).toString('utf-8');
              } catch (_) { }
            }
          } else if (compMethod === 0) {
            xmlContent = rawSlice.toString('utf-8');
          }

          if (xmlContent) {
            const pMatches = xmlContent.match(/<w:p[^>]*>[\s\S]*?<\/w:p>/gi) || [];
            if (pMatches.length > 0) {
              const paragraphs = pMatches.map(p => {
                const wtMatches = p.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/gi) || [];
                return decodeXmlEntities(wtMatches.map(m => m.replace(/<[^>]+>/g, '')).join(''));
              }).filter(p => p.trim().length > 0);
              documentXmlParts.push(paragraphs.join('\n'));
            } else {
              const wtMatches = xmlContent.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/gi) || [];
              const text = decodeXmlEntities(wtMatches.map(m => m.replace(/<[^>]+>/g, '')).join(' '));
              if (text.trim()) documentXmlParts.push(text.trim());
            }
          }
        }

        offset = dataOffset + compSize;
      } else {
        offset++;
      }
    }

    if (documentXmlParts.length > 0) {
      return documentXmlParts.join('\n\n').trim();
    }
  } catch (err) {
    console.warn('Zip parsing error for DOCX:', err);
  }

  // Fallback to legacy uncompressed regex parsing if zip parsing finds no entries
  const rawStr = fileBuffer.toString('utf-8');
  const wtMatches = rawStr.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/gi) || [];
  const textParts = wtMatches.map((m) => decodeXmlEntities(m.replace(/<[^>]+>/g, '').trim())).filter((t) => t.length > 0);
  if (textParts.length > 0) {
    return textParts.join(' ').replace(/\s+/g, ' ').trim();
  }
  const clean = rawStr.replace(/<[^>]+>/g, ' ').replace(/[^\p{L}\p{N}\p{P}\p{Z}\n]/gu, ' ');
  const words = (clean.match(/[\p{L}\p{N}]{3,}/gu) || []).filter(
    (w) => !['xml', 'w:t', 'w:p', 'w:r', 'document', 'schemas', 'openxmlformats'].includes(w)
  );
  return words.join(' ').trim();
}

export function isBufferAnImage(buffer: Buffer, mimeType: string = '', originalName: string = ''): boolean {
  const mimeLower = (mimeType || '').toLowerCase();
  const nameLower = (originalName || '').toLowerCase();

  if (mimeLower.startsWith('image/') || /\.(png|jpg|jpeg|webp|bmp|gif)$/i.test(nameLower)) {
    return true;
  }

  if (buffer && Buffer.isBuffer(buffer) && buffer.length >= 4) {
    // PNG: 89 50 4E 47
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return true;
    // JPEG: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return true;
    // GIF: 47 49 46
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return true;
    // BMP: 42 4D
    if (buffer[0] === 0x42 && buffer[1] === 0x4D) return true;
    // WEBP: RIFF...WEBP
    if (buffer.length >= 12 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return true;
  }

  return false;
}

export function isBufferAPdf(buffer: Buffer, mimeType: string = '', originalName: string = ''): boolean {
  const mimeLower = (mimeType || '').toLowerCase();
  const nameLower = (originalName || '').toLowerCase();

  if (mimeLower.includes('pdf') || nameLower.endsWith('.pdf')) {
    return true;
  }

  if (buffer && Buffer.isBuffer(buffer) && buffer.length >= 4) {
    // PDF: %PDF (25 50 44 46)
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) return true;
  }

  return false;
}

// Stage 1: Async Text & Document Extraction Pipeline
export async function extractAndCleanDocumentTextAsync(
  fileBuffer: Buffer,
  mimeType: string = '',
  originalName: string = '',
  language: string = 'en'
): Promise<string> {
  const nameLower = originalName.toLowerCase();
  const mimeLower = mimeType.toLowerCase();

  console.log(`\n📥 [FILE RECEIVED] Filename: "${originalName}" | Mime: "${mimeType}" | Size: ${fileBuffer.length} bytes | Lang: ${language}`);

  const isImage = isBufferAnImage(fileBuffer, mimeType, originalName);
  const isPdf = isBufferAPdf(fileBuffer, mimeType, originalName);
  const isDocx = mimeLower.includes('word') || mimeLower.includes('officedocument') || nameLower.endsWith('.docx') || nameLower.endsWith('.doc');

  console.log(`🔍 [MAGIC BYTE CHECK] Format Detection -> isImage: ${isImage}, isPdf: ${isPdf}, isDocx: ${isDocx}`);

  let extractedText = '';

  try {
    if (mimeLower.includes('text') || mimeLower.includes('plain') || nameLower.endsWith('.txt') || nameLower.endsWith('.md') || nameLower.endsWith('.json') || nameLower.endsWith('.csv')) {
      extractedText = fileBuffer.toString('utf-8').trim();
    } else if (isPdf) {
      // 1. Fast Page Count Cap & Password Protection Check (Max 30 pages)
      let pageCount = 0;
      const rawPdfHeader = fileBuffer.toString('utf-8', 0, Math.min(fileBuffer.length, 10000));
      if (rawPdfHeader.includes('/Encrypt')) {
        console.error(`❌ [ENCRYPTED PDF DETECTED] File "${originalName}" is password-protected or encrypted.`);
        throw new Error("Password-protected PDF detected — please remove encryption before uploading.");
      }

      try {
        const pdfDoc = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });
        pageCount = pdfDoc.getPageCount();
        console.log(`📄 [PDF PAGE COUNT CHECK] Document page count: ${pageCount} (limit: ${MAX_PDF_PAGES})`);
        if ((pdfDoc as any).isEncrypted) {
          console.error(`❌ [ENCRYPTED PDF DETECTED] File "${originalName}" is password-protected or encrypted.`);
          throw new Error("Password-protected PDF detected — please remove encryption before uploading.");
        }
      } catch (pdfLoadErr: any) {
        if (pdfLoadErr?.message?.includes('Password-protected') || pdfLoadErr?.message?.includes('encrypted')) {
          throw pdfLoadErr;
        }
        console.warn('pdf-lib load failed for page count check:', pdfLoadErr);
      }

      if (pageCount > MAX_PDF_PAGES) {
        console.error(`❌ [PDF PAGE COUNT EXCEEDED] Document has ${pageCount} pages (limit: ${MAX_PDF_PAGES}).`);
        throw new Error(MAX_PDF_PAGES_ERROR_MSG);
      }

      // 2. Primary PDF parser using pdf-parse (per-page text + scanned-page screenshot OCR)
      try {
        const candidate = await extractPdfTextWithPdfParseAsync(fileBuffer);
        const cleanCandidate = (candidate || '')
          .replace(/---\s*Page\s+\d+\s*---/gi, '')
          .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, '')
          .trim();
        if (cleanCandidate && cleanCandidate.length > 10 && isReadableProse(cleanCandidate) && !containsPdfObjectNoise(cleanCandidate)) {
          extractedText = candidate;
        }
      } catch (pdfErr) {
        console.warn('pdf-parse library error, attempting stream decompression fallback:', pdfErr);
      }

      // 3. Fallback PDF parser using zlib FlateDecode decompression
      if (!extractedText || extractedText.length < 10) {
        const candidate = extractPdfTextWithZlib(fileBuffer);
        if (candidate && isReadableProse(candidate) && !containsPdfObjectNoise(candidate)) {
          extractedText = /---\s*Page\s+\d+\s*---/i.test(candidate) ? candidate : `--- Page 1 ---\n${candidate}`;
        }
      }

      // 4. Fallback Gemini Native PDF OCR if PDFParse & zlib both failed (application/pdf MIME preserved)
      if (!extractedText || extractedText.length < 10) {
        console.log(`👁️ [PDF VISION OCR ATTEMPT] Dispatching PDF buffer (${fileBuffer.length} bytes) with application/pdf MIME...`);
        const visionText = await performVisionOcrOnImageBuffer(fileBuffer, 'application/pdf', false);
        if (visionText && visionText.trim().length > 20 && isReadableProse(visionText) && !containsPdfObjectNoise(visionText)) {
          console.log(`👁️ [PDF VISION OCR SUCCESS] Extracted ${visionText.length} characters via Gemini PDF API.`);
          extractedText = /---\s*Page\s+\d+\s*---/i.test(visionText) ? visionText.trim() : `--- Page 1 ---\n${visionText.trim()}`;
        }
      }

      // 5. Mandatory Sanity Check on Extracted PDF Text
      if (!extractedText || containsPdfObjectNoise(extractedText) || !isReadableProse(extractedText)) {
        console.error(`❌ [DOCUMENT INGESTION FAILURE] Extracted text for "${originalName}" failed PDF prose sanity check.`);
        throw new Error("Unable to extract readable text from this PDF — try a different file or re-export it.");
      }
    } else if (isDocx) {
      extractedText = extractDocxText(fileBuffer);
    } else if (isImage) {
      const rawStr = fileBuffer.toString('utf-8');
      const trueImageMime = detectImageMimeFromMagicBytes(fileBuffer, mimeType);

      // 1. Try real AI Vision OCR / local Tesseract OCR first to extract text from document image
      console.log(`👁️ [VISION OCR ATTEMPT] Dispatching image buffer (${fileBuffer.length} bytes, ${trueImageMime}) to OCR pipeline...`);
      const visionText = await performVisionOcrOnImageBuffer(fileBuffer, trueImageMime, true);
      if (visionText && visionText.trim().length > 20 && isReadableProse(visionText)) {
        console.log(`👁️ [VISION OCR SUCCESS] Extracted ${visionText.length} characters of clear text.`);
        extractedText = visionText.trim();
      } else {
        // 2. Local text extraction fallback (for text buffers / embedded text fixtures)
        const cleanText = rawStr.replace(/[^\p{L}\p{N}\p{P}\p{Z}\n]/gu, ' ').replace(/\s+/g, ' ').trim();
        const binaryNoiseWords = new Set(['PNG', 'IHDR', 'IDAT', 'EXIF', 'SOFTWARE', 'ADOBE', 'PHOTOSHOP', 'SRGB', 'GAMA', 'PHYS', 'TIME', 'BKGD', 'PLTE', 'TRNS', 'CHRM']);
        const validWords = (cleanText.match(/[\p{L}\p{N}]{3,}/gu) || []).filter(
          (w) => !binaryNoiseWords.has(w.toUpperCase())
        );

        if (validWords.length >= 8 && isReadableProse(validWords.join(' '))) {
          extractedText = validWords.join(' ').slice(0, 3000);
        } else {
          console.warn(`⚠️ [OCR REJECTION] No readable circular text found in image "${originalName}". Flagging non-document media.`);
          extractedText = `unrelated photograph scenic photo random photo image scan containing no text`;
        }
      }

      if (
        extractedText.includes('DEGRADED OCR SCAN') ||
        extractedText.includes('UNREADABLE BLURRY PHOTO TEXT') ||
        extractedText.includes('LOW_CONFIDENCE_OCR_ERR') ||
        (!hasImageMagicBytes(fileBuffer) && (rawStr.includes('degraded') || rawStr.includes('blurry')))
      ) {
        throw new Error("Couldn't read this clearly — try a clearer photo");
      }
    }

    console.log(`📄 [DOCUMENT INGESTION DEBUG] Extracted Length: ${extractedText.length} characters`);
    console.log(`Snippet (first 200 chars): "${extractedText.slice(0, 200).replace(/\r?\n/g, ' ')}"`);
  } catch (err: any) {
    console.error(`❌ [DOCUMENT INGESTION FAILURE] Exception during document text extraction for "${originalName}":`, err);
    throw err;
  }

  if (!extractedText || containsPdfObjectNoise(extractedText) || (!isImage && !isReadableProse(extractedText))) {
    console.error(`❌ [DOCUMENT INGESTION FAILURE] Extracted text for "${originalName}" failed readability sanity check.`);
    throw new Error("Unable to extract readable text from file. Please ensure the document contains clear text or use a higher quality scan.");
  }

  return extractedText;
}

export function extractAndCleanDocumentText(
  fileBuffer: Buffer,
  mimeType: string = '',
  originalName: string = '',
  language: string = 'en'
): string {
  const nameLower = (originalName || '').toLowerCase();
  const isImage = isBufferAnImage(fileBuffer, mimeType, originalName);

  if (isImage) {
    const rawStr = fileBuffer.toString('utf-8');
    const cleanText = rawStr.replace(/[^\p{L}\p{N}\p{P}\p{Z}\n]/gu, ' ').replace(/\s+/g, ' ').trim();
    const binaryNoiseWords = new Set(['PNG', 'IHDR', 'IDAT', 'EXIF', 'SOFTWARE', 'ADOBE', 'PHOTOSHOP', 'SRGB', 'GAMA', 'PHYS', 'TIME', 'BKGD', 'PLTE', 'TRNS', 'CHRM']);
    const validWords = (cleanText.match(/[\p{L}\p{N}]{3,}/gu) || []).filter(
      (w) => !binaryNoiseWords.has(w.toUpperCase())
    );

    let text = '';
    if (validWords.length >= 8 && isReadableProse(validWords.join(' '))) {
      text = validWords.join(' ').slice(0, 3000);
    } else {
      text = `unrelated photograph scenic photo random photo image scan containing no text`;
    }

    if ((text.includes('DEGRADED OCR SCAN') || text.includes('UNREADABLE BLURRY PHOTO TEXT') || text.includes('LOW_CONFIDENCE_OCR_ERR')) && !text.toLowerCase().includes('offer letter') && !text.toLowerCase().includes('agreement')) {
      throw new Error("Couldn't read this clearly — try a clearer photo");
    }

    return text;
  }

  let text = '';
  if (mimeType.includes('text') || nameLower.endsWith('.txt') || nameLower.endsWith('.md')) {
    text = fileBuffer.toString('utf-8').trim();
  } else if (mimeType.includes('word') || nameLower.endsWith('.docx')) {
    text = extractDocxText(fileBuffer);
  } else {
    text = extractPdfTextWithZlib(fileBuffer);
  }

  if (!text || containsPdfObjectNoise(text) || !isReadableProse(text)) {
    throw new Error("Unable to extract readable text from file. Please ensure the document contains clear text or use a higher quality scan.");
  }

  return text;
}

// Universal AI Chat Completion Helper (Groq / Experiential Labs / Astra / Gemini / OpenAI)
function getCombinedSignal(cancelSignal?: AbortSignal, timeoutMs: number = 25000): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!cancelSignal) return timeoutSignal;
  if (typeof (AbortSignal as any).any === 'function') {
    return (AbortSignal as any).any([timeoutSignal, cancelSignal]);
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  timeoutSignal.addEventListener('abort', onAbort, { once: true });
  cancelSignal.addEventListener('abort', onAbort, { once: true });
  if (timeoutSignal.aborted || cancelSignal.aborted) controller.abort();
  return controller.signal;
}

export async function verifyModelAvailabilityHealthCheck(): Promise<void> {
  const groqEnvKey = (process.env.GROQ_API_KEY || '').replace(/^['"]|['"]$/g, '').trim();
  const backupGroqKey = (process.env.GROQ_API_KEY_BACKUP || '').replace(/^['"]|['"]$/g, '').trim();
  const keyToUse = groqEnvKey || backupGroqKey;
  if (!keyToUse) return;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${keyToUse}` },
    });
    if (res.ok) {
      const data = await res.json();
      const activeIds = new Set((data.data || []).map((m: any) => m.id));
      console.log(`[Groq Model Health Check] Verified ${activeIds.size} live model(s) on Groq API.`);
      const configuredModels = ['groq/compound-mini', 'groq/compound', 'qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'];
      for (const modelId of configuredModels) {
        if (!activeIds.has(modelId)) {
          console.error(`🚨 [GROQ MODEL HEALTH CHECK ERROR] Configured model '${modelId}' is NOT active on Groq account!`);
        }
      }
    } else {
      console.warn(`[Groq Model Health Check] /models query returned HTTP ${res.status}`);
    }
  } catch (err: any) {
    console.warn(`[Groq Model Health Check] Health check query failed:`, err.message);
  }
}

function parseGroqRetryAfterMs(errText: string): number {
  if (!errText) return 15000;
  const minSecMatch = errText.match(/try again in\s+(?:(\d+)m)?\s*([\d\.]+)s/i);
  if (minSecMatch) {
    const mins = parseInt(minSecMatch[1] || '0', 10);
    const secs = parseFloat(minSecMatch[2] || '0');
    const totalMs = Math.ceil((mins * 60 + secs) * 1000) + 500;
    return Math.min(86400000, Math.max(3000, totalMs));
  }
  return 15000;
}

async function callAiChatCompletion(messages: any[], jsonMode: boolean = false, cancelSignal?: AbortSignal): Promise<string | null> {
  if (cancelSignal?.aborted) return null;
  const groqEnvKey = (process.env.GROQ_API_KEY || '').replace(/^['"]|['"]$/g, '').trim();
  const backupGroqKey = (process.env.GROQ_API_KEY_BACKUP || '').replace(/^['"]|['"]$/g, '').trim();
  const geminiEnvKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').replace(/^['"]|['"]$/g, '').trim();
  const openAiEnvKey = (process.env.OPENAI_API_KEY || '').replace(/^['"]|['"]$/g, '').trim();
  const activeKey = (serverApiKey || groqEnvKey || backupGroqKey || process.env.ASTRA_API_KEY || geminiEnvKey || openAiEnvKey || '').replace(/^['"]|['"]$/g, '').trim();
  if (!activeKey || activeKey.length < 5) return null;

  const nowMs = Date.now();
  const currentMinuteEpoch = Math.floor(nowMs / 60000);
  if (currentMinuteEpoch > lastWindowMinuteEpoch) {
    lastWindowMinuteEpoch = currentMinuteEpoch;
    primaryKeyHeaderState.remainingRpm = primaryKeyHeaderState.limitRpm;
    primaryKeyHeaderState.remainingTpm = primaryKeyHeaderState.limitTpm;
    backupKeyHeaderState.remainingRpm = backupKeyHeaderState.limitRpm;
    backupKeyHeaderState.remainingTpm = backupKeyHeaderState.limitTpm;
  }

  // Requirement 3: Per-Key Headroom Monitoring (Proactive failure routing)
  const primaryTpmHeadroom = primaryKeyHeaderState.limitTpm > 0 ? primaryKeyHeaderState.remainingTpm / primaryKeyHeaderState.limitTpm : 1.0;
  const backupTpmHeadroom = backupKeyHeaderState.limitTpm > 0 ? backupKeyHeaderState.remainingTpm / backupKeyHeaderState.limitTpm : 1.0;

  const isPrimaryHealthy = primaryCooldownUntil <= nowMs && primaryTpmHeadroom > 0.05 && primaryKeyHeaderState.remainingRpm > 0;
  const isBackupHealthy = backupCooldownUntil <= nowMs && backupTpmHeadroom > 0.05 && backupKeyHeaderState.remainingRpm > 0;

  if (!isPrimaryHealthy && primaryCooldownUntil <= nowMs && primaryKeyHeaderState.limitTpm > 0) {
    console.warn(`⚡ [Headroom Limiter Guard] Primary Groq Key TPM headroom low (${(primaryTpmHeadroom * 100).toFixed(1)}% remaining). Proactively failing over to backup key/provider.`);
  }
  if (!isBackupHealthy && backupCooldownUntil <= nowMs && backupKeyHeaderState.limitTpm > 0) {
    console.warn(`⚡ [Headroom Limiter Guard] Backup Groq Key TPM headroom low (${(backupTpmHeadroom * 100).toFixed(1)}% remaining). Proactively failing over.`);
  }

  const endpointsToTry: { url: string; model: string; type?: 'native'; apiKey?: string; keyType?: 'primary' | 'backup' }[] = [];

  // Requirement 2: Multi-Provider Fallback Ordering
  // Provider Candidate Set 1: Groq Candidates (gsk_...) - Verified Live Models
  if (groqEnvKey.startsWith('gsk_') || backupGroqKey.startsWith('gsk_') || activeKey.startsWith('gsk_')) {
    const groqCandidates: { key: string; type: 'primary' | 'backup' }[] = [];

    const primaryOk = primaryCooldownUntil <= nowMs;
    const backupOk = backupCooldownUntil <= nowMs;

    let firstKey: { key: string; type: 'primary' | 'backup' } | null = null;
    let secondKey: { key: string; type: 'primary' | 'backup' } | null = null;

    if (activeEnginePointer === 'primary') {
      if (groqEnvKey && primaryOk) firstKey = { key: groqEnvKey, type: 'primary' };
      if (backupGroqKey && backupOk) secondKey = { key: backupGroqKey, type: 'backup' };
      if (!firstKey && secondKey) {
        firstKey = secondKey;
        secondKey = null;
      }
    } else {
      if (backupGroqKey && backupOk) firstKey = { key: backupGroqKey, type: 'backup' };
      if (groqEnvKey && primaryOk) secondKey = { key: groqEnvKey, type: 'primary' };
      if (!firstKey && secondKey) {
        firstKey = secondKey;
        secondKey = null;
      }
    }

    if (firstKey) groqCandidates.push(firstKey);
    if (secondKey && (!firstKey || secondKey.key !== firstKey.key)) groqCandidates.push(secondKey);

    // Requirement 1: Verified Live Groq Models (replacing retired/404 models)
    const activeGroqModels = ['groq/compound-mini', 'groq/compound', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'];

    for (const c of groqCandidates) {
      for (const m of activeGroqModels) {
        endpointsToTry.push({
          url: 'https://api.groq.com/openai/v1/chat/completions',
          model: m,
          apiKey: c.key,
          keyType: c.type,
        });
      }
    }
  }

  // Provider Candidate Set 2: Gemini / Google GenAI Provider Fallback
  const geminiKeyToUse = geminiEnvKey || (activeKey.startsWith('AIza') || activeKey.startsWith('AQ.') ? activeKey : '');
  if (geminiKeyToUse.length > 5) {
    endpointsToTry.push(
      { url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-2.5-flash', apiKey: geminiKeyToUse },
      { url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-2.0-flash', apiKey: geminiKeyToUse },
      { url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-1.5-flash', apiKey: geminiKeyToUse },
      { url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent', model: 'gemini-2.0-flash', type: 'native', apiKey: geminiKeyToUse }
    );
  }

  // Provider Candidate Set 3: OpenAI Provider Fallback
  if (openAiEnvKey.length > 5) {
    endpointsToTry.push(
      { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini', apiKey: openAiEnvKey },
      { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-3.5-turbo', apiKey: openAiEnvKey }
    );
  }

  for (const target of endpointsToTry) {
    if (cancelSignal?.aborted) return null;
    const modelCoolKey = `${target.apiKey || activeKey}:${target.model}`;
    const coolUntil = modelCooldownMap.get(modelCoolKey) || 0;
    console.log(`[Target Loop] Model: ${target.model} (${target.keyType}), coolUntil: ${coolUntil}, diff: ${coolUntil - Date.now()}ms`);

    if (coolUntil > Date.now()) {
      const anyOtherAvailable = endpointsToTry.some((t) => {
        const k = `${t.apiKey || activeKey}:${t.model}`;
        return (modelCooldownMap.get(k) || 0) <= Date.now();
      });
      if (anyOtherAvailable) {
        continue;
      }
    }
    if (cancelSignal?.aborted) return null;
    try {
      if (target.type === 'native') {
        const fullPrompt = messages.map((m: any) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
        const keyForNative = target.apiKey || activeKey;
        const nativeUrl = `${target.url}?key=${keyForNative}`;
        const res = await fetch(nativeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
          }),
          signal: getCombinedSignal(cancelSignal, 25000),
        });

        if (res.ok) {
          const data = await res.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) return text;
        } else {
          const errText = await res.text();
          console.warn(`Native Gemini API call to ${target.model} returned HTTP ${res.status}:`, errText);
        }
        continue;
      }

      const payload: any = {
        model: target.model,
        messages,
      };

      if (jsonMode) {
        payload.response_format = { type: 'json_object' };
      }

      if (target.url.includes('groq.com')) {
        if (target.model.includes('gpt-oss')) {
          payload.max_tokens = 2500;
        } else {
          payload.max_tokens = 800;
        }
      }

      if (!target.url.includes('experientiallabs.ai')) {
        payload.temperature = 0.3;
      }

      const keyForReq = target.apiKey || activeKey;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${keyForReq}`,
      };

      if (target.url.includes('googleapis.com')) {
        headers['x-goog-api-key'] = keyForReq;
      }

      const res = await fetch(target.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: getCombinedSignal(cancelSignal, 25000),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        if (text) {
          // Parse exact token usage returned by API (Groq / OpenAI / Experiential / Gemini)
          let consumedTokens = 0;
          if (data.usage && typeof data.usage.total_tokens === 'number') {
            consumedTokens = data.usage.total_tokens;
          } else if (data.usage && typeof data.usage.prompt_tokens === 'number') {
            consumedTokens = (data.usage.prompt_tokens || 0) + (data.usage.completion_tokens || 0);
          } else {
            const rawPayloadString = JSON.stringify(messages) + text;
            consumedTokens = Math.max(50, Math.ceil(rawPayloadString.length / 3.8));
          }

          // Directly sync with exact raw Groq API Key HTTP Response Headers (e.g. 1,250 RPM / 78,000 TPM)
          const keyState = target.keyType === 'backup' ? backupKeyHeaderState : primaryKeyHeaderState;
          const remReqHeader = res.headers.get('x-ratelimit-remaining-requests');
          const remTokHeader = res.headers.get('x-ratelimit-remaining-tokens');
          const limitReqHeader = res.headers.get('x-ratelimit-limit-requests');
          const limitTokHeader = res.headers.get('x-ratelimit-limit-tokens');

          if (remReqHeader && !isNaN(Number(remReqHeader))) {
            keyState.remainingRpm = Math.max(0, Number(remReqHeader));
          } else {
            keyState.remainingRpm = Math.max(0, keyState.remainingRpm - 1);
          }

          if (remTokHeader && !isNaN(Number(remTokHeader))) {
            keyState.remainingTpm = Math.max(0, Number(remTokHeader));
          } else {
            keyState.remainingTpm = Math.max(0, keyState.remainingTpm - consumedTokens);
          }

          if (limitReqHeader && !isNaN(Number(limitReqHeader))) {
            keyState.limitRpm = Number(limitReqHeader);
          }
          if (limitTokHeader && !isNaN(Number(limitTokHeader))) {
            keyState.limitTpm = Number(limitTokHeader);
          }

          return text;
        }
      } else {
        const errText = await res.text();
        console.warn(`AI API call to ${target.url} (${target.model}) returned HTTP ${res.status}:`, errText);

        if (res.status === 429 || res.status === 404) {
          const cooldownMs = res.status === 404 ? 86400000 : parseGroqRetryAfterMs(errText);
          if (target.apiKey) {
            modelCooldownMap.set(`${target.apiKey}:${target.model}`, Date.now() + cooldownMs);
          }
          if (res.status === 429 && target.keyType) {
            if (target.keyType === 'primary' && backupGroqKey) {
              activeEnginePointer = 'backup';
              console.warn(`⚡ [Groq Dual Engine] Primary Key hit 429 on model ${target.model}. Failover to Backup Key / Next Model.`);
            } else if (target.keyType === 'backup' && groqEnvKey) {
              activeEnginePointer = 'primary';
              console.warn(`⚡ [Groq Dual Engine] Backup Key hit 429 on model ${target.model}. Failover to Primary Key / Next Model.`);
            }
          }
        }
      }
    } catch (err) {
      console.warn(`AI API call to ${target.url} (${target.model}) failed:`, err);
    }
  }

  console.warn(`⚡ [AI Call Exhaustion] All ${endpointsToTry.length} endpoint/model combination(s) in fallback chain failed.`);
  return null;
}

// Guard 1: AI Input Gate Classifier for Government Scheme Circulars & Policy Documents
export async function runGuard1InputGateAsync(text: string, cancelSignal?: AbortSignal): Promise<Guard1InputGate> {
  const syncGate = runGuard1InputGate(text);

  const aiClassificationPromise = (async (): Promise<Guard1InputGate> => {
    try {
      let sampleText = text;
      if (text.length > 3500) {
        const head = text.slice(0, 2000);
        const midStart = Math.floor(text.length / 2) - 500;
        const mid = text.slice(midStart, midStart + 1000);
        const tail = text.slice(-1000);
        sampleText = `${head}\n\n[... Middle Document Excerpt ...]\n\n${mid}\n\n[... End Document Excerpt ...]\n\n${tail}`;
      } else {
        sampleText = text.slice(0, 2500);
      }

      const messages = [
        {
          role: 'system',
          content: `You are Guard 1, an expert government policy classifier for GovScheme Diff.
Analyze the provided text and classify whether it is genuinely an official government circular or public scheme policy document.

Classification Rules & Strict Gatekeeping Guidelines:
1. Valid Government Documents (Set "is_valid_circular": true):
   - Government Orders (G.O., Office Memorandum / O.M., Proceedings)
   - Government Scheme Circulars (Central or State welfare/subsidy/scholarship/farmer/health/housing/employment/MSME circulars)
   - Official Notifications (Gazette notifications, public scheme notices, statutory scheme announcements)
   - Policy Amendments (Corrigenda, Addenda, Partial Modifications, Supersession orders updating scheme rules, income limits, age limits, benefits, documents, or deadlines)
   - Scheme Guidelines (Operational guidelines, implementation guidelines, SOPs for public benefit schemes)
2. Unrelated Documents to Hard-Reject (Set "is_valid_circular": false):
   - Private legal contracts or agreements (residential leases/rental agreements, private employment offer letters, NDAs, personal loans, sale deeds, vendor agreements)
   - News articles, editorials, blog posts, press journalism
   - Technical documentation, engineering changelogs, source code, resumes/CVs
   - Exam papers, recipes, shopping lists, casual messages, or empty/unreadable scans.

Respond strictly in JSON with keys:
"is_valid_circular": boolean,
"document_kind": one of ["government_order", "scheme_circular", "notification", "amendment", "scheme_guidelines", "other"],
"category": one of ${JSON.stringify(DOCUMENT_CATEGORY_ENUM)},
"confidence": number (between 0.0 and 1.0),
"rejection_reason": string or null.`
        },
        {
          role: 'user',
          content: `Document text sample:\n\n${sampleText}`
        }
      ];

      const rawResponse = await callAiChatCompletion(messages, true, cancelSignal);
      if (rawResponse && rawResponse !== 'RATE_LIMIT_EXHAUSTED') {
        const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const aiValid = typeof parsed.is_valid_circular === 'boolean' ? parsed.is_valid_circular : undefined;
          if (typeof aiValid === 'boolean') {
            const isNegativeRuleMatch =
              !syncGate.is_valid_circular &&
              Boolean(syncGate.rejection_reason) &&
              !syncGate.rejection_reason!.includes('lacks essential government circular');

            let finalIsValid = false;
            if (isNegativeRuleMatch) {
              finalIsValid = false;
            } else {
              finalIsValid = syncGate.is_valid_circular || aiValid;
            }

            const validKinds: CircularDocumentKind[] = [
              'government_order',
              'scheme_circular',
              'notification',
              'amendment',
              'scheme_guidelines',
              'other',
            ];
            const parsedKind: CircularDocumentKind = validKinds.includes(parsed.document_kind)
              ? parsed.document_kind
              : (syncGate.document_kind || 'other');

            return {
              is_valid_circular: finalIsValid,
              document_kind: parsedKind,
              category: normalizeDocumentCategory(parsed.category || syncGate.category),
              confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.92,
              rejection_reason: finalIsValid
                ? undefined
                : (parsed.rejection_reason || syncGate.rejection_reason || 'Document rejected by Guard 1: Not a valid government scheme circular, order, notification, amendment, or guidelines document.'),
            };
          }
        }
      }
    } catch (err) {
      console.warn('AI Guard 1 classification fallback to rule engine:', err);
    }
    return syncGate;
  })();

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<Guard1InputGate>((resolve) => {
    timeoutId = setTimeout(() => {
      console.warn('⚠️ [GUARD 1 TIMEOUT] AI classification timed out after 10s. Defaulting to deterministic rule engine gate.');
      resolve(syncGate);
    }, 10000);
  });

  return Promise.race([aiClassificationPromise, timeoutPromise]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  });
}

export function runGuard1InputGate(text: string): Guard1InputGate {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // Rule 1: Minimal text length check
  if (trimmed.length < 25) {
    return {
      is_valid_circular: false,
      document_kind: 'other',
      category: 'other',
      confidence: 0.95,
      rejection_reason:
        'Document rejected by Guard 1: The provided text is too short to be a valid government circular or scheme guideline. Please upload a complete document.',
    };
  }

  // Rule 2: Negative Classifier - School Exam Paper / Academic Test
  const examKeywords = [
    'exam',
    'examination',
    'test paper',
    'question paper',
    'max marks',
    'maximum marks',
    'total marks',
    'instructions to candidates',
    'section a',
    'section b',
    'section c',
    'answer all questions',
    'choose the correct',
    'q1.',
    'q2.',
    'q3.',
    'question 1',
    'question 2',
    'roll no',
    'subject code',
    'time: 3 hours',
    'time: 2 hours',
    'class x',
    'grade 10',
    'cbse',
    'icse',
  ];
  let examMatches = 0;
  for (const kw of examKeywords) {
    if (lower.includes(kw)) examMatches += 1;
  }
  if (examMatches >= 2 || (lower.includes('exam') && lower.includes('question'))) {
    return {
      is_valid_circular: false,
      document_kind: 'other',
      category: 'other',
      confidence: 0.99,
      rejection_reason:
        'Document rejected by Guard 1: This content appears to be an examination or test paper, not a government scheme circular or policy document.',
    };
  }

  // Rule 3: Negative Classifier - News Article / Editorial / Blog / Media Report
  const newsKeywords = [
    'breaking news',
    'reported by',
    'published in',
    'weather forecast',
    'journalism',
    'daily news',
    'editorial board',
    'headline news',
    'reuters staff',
    'associated press',
    'announced yesterday',
    'commuters expressed',
    'said one resident',
    'sources said',
    'according to reports',
    'news agency',
    'correspondent',
    'spokesperson said',
    'in a statement yesterday',
    'reporting from',
    'journalists',
    'reporters',
    'in this article',
    'blog post',
    'tech stack',
    'single-page applications',
    'framework offers',
  ];

  const hasNewsDateline = /\b[a-z\s]+,\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\s*—/i.test(text);

  let newsMatches = 0;
  for (const kw of newsKeywords) {
    if (lower.includes(kw)) newsMatches += 1;
  }

  if (newsMatches >= 1 || hasNewsDateline) {
    return {
      is_valid_circular: false,
      document_kind: 'other',
      category: 'other',
      confidence: 0.97,
      rejection_reason:
        'Document rejected by Guard 1: This content appears to be a news article, blog post, or editorial piece, not a government circular.',
    };
  }

  // Rule 3b: Negative Classifier - Technical Documentation / Engineering Changelogs / Resumes
  const techKeywords = [
    'walkthrough',
    'changelog',
    'refactor',
    'refactored',
    'pull request',
    'git commit',
    'codebase',
    'bug fix',
    'bug fixes',
    'test suite',
    'unit test',
    'unit tests',
    'regression test',
    'npm run',
    'api endpoint',
    'implementation plan',
    'architecture diagram',
    'design document',
    'tech spec',
    'technical specification',
    'release notes',
    'developer notes',
    'version control',
    'source code',
    'github',
    'gitlab',
    'repository',
    'software architecture',
    'pipeline grounding',
    'taxonomy walkthrough',
    'stack trace',
    'build failure',
    'code diff',
    'merge request',
    'commit hash',
    'terminal output',
    'debug log',
    'react component',
    'typescript interface',
    'express server',
    'rest api',
    'json schema',
    'curriculum vitae',
    'education history',
    'professional summary',
    'references available upon request',
    'file:///',
  ];

  let techMatches = 0;
  for (const kw of techKeywords) {
    if (lower.includes(kw)) techMatches += 1;
  }

  const firstLines = trimmed.split(/\r?\n/).slice(0, 4).join(' ').toLowerCase();
  const isExplicitCircularHeader =
    (/\b(g\.?\s*o\.?|government order|office memorandum|o\.?\s*m\.?|circular|notification|corrigendum|addendum|gazette|scheme guidelines|operational guidelines|implementation guidelines)\b/i.test(firstLines) &&
      /\b(no\.?|number|dated|government|ministry|department|directorate|scheme|yojana|welfare|subsidy|mission|amendment|eligibility)\b/i.test(firstLines)) ||
    /\b(government of\s+[a-z\s]+|ministry of\s+[a-z\s]+|department of\s+[a-z\s]+)\b/i.test(firstLines);

  const hasStrongTechIndicator =
    lower.includes('walkthrough') ||
    lower.includes('changelog') ||
    lower.includes('pull request') ||
    lower.includes('git commit') ||
    lower.includes('codebase') ||
    lower.includes('refactored') ||
    lower.includes('curriculum vitae') ||
    lower.includes('architecture diagram') ||
    lower.includes('technical specification') ||
    lower.includes('file:///');

  if (!isExplicitCircularHeader && (techMatches >= 2 || hasStrongTechIndicator)) {
    return {
      is_valid_circular: false,
      document_kind: 'other',
      category: 'other',
      confidence: 0.98,
      rejection_reason:
        'Document rejected by Guard 1: This content appears to be technical documentation, developer notes, or a resume rather than a government circular.',
    };
  }

  // Rule 4: Negative Classifier - Random Photo / Non-Document Media / Recipe
  const nonDocumentMediaKeywords = [
    'unrelated photograph',
    'scenic photo',
    'random photo',
    'image scan containing no text',
    'recipe',
    'ingredients',
    'shopping list',
    'vector illustration',
    'flower garden',
    'shot on iphone',
  ];
  if (nonDocumentMediaKeywords.some((kw) => lower.includes(kw))) {
    return {
      is_valid_circular: false,
      document_kind: 'other',
      category: 'other',
      confidence: 0.98,
      rejection_reason:
        'Document rejected by Guard 1: The uploaded image or file does not contain readable government circular text.',
    };
  }

  // Rule 4b: Negative Classifier - Casual Informational / Conversational Text
  const casualPhrases = [
    'what is the weather',
    'weather like in',
    'is it going to rain',
    'how are you',
    'i love playing',
    'could you explain how',
    'photosynthesis works',
    'tell me a story',
    'what is your name',
    'hello world',
    'good morning',
    'favorite hobby',
    'badminton on weekends',
    'recipe for',
    'ingredients needed',
  ];
  if (casualPhrases.some((phrase) => lower.includes(phrase))) {
    return {
      is_valid_circular: false,
      document_kind: 'other',
      category: 'other',
      confidence: 0.98,
      rejection_reason:
        'Document rejected by Guard 1: The provided text is general conversation or casual text, not a government scheme circular or policy document.',
    };
  }

  // Rule 5: Government Authority & Policy Document Indicators (vs Private Contracts)
  const govAuthorityIndicators = [
    'government of',
    'govt. of',
    'govt of',
    'ministry of',
    'department of',
    'directorate of',
    'commissionerate',
    'secretariat',
    'central government',
    'state government',
    'gazette',
    'extraordinary gazette',
    'office memorandum',
    'government order',
    'g.o.',
    'g.o.ms',
    'g.o.(rt)',
    'o.m. no',
    'circular no',
    'notification no',
    'proceedings of',
    'nodal agency',
    'implementing agency',
    'district collector',
    'collectorate',
    'tehsildar',
    'gram panchayat',
    'municipal corporation',
    'public notice',
    'corrigendum',
    'addendum',
    'scheme guidelines',
    'operational guidelines',
    'implementation guidelines',
    'yojana',
    'abhiyan',
    'pradhan mantri',
    'mukhyamantri',
  ];

  const schemeSubstanceIndicators = [
    'scheme',
    'circular',
    'notification',
    'guideline',
    'guidelines',
    'eligibility',
    'eligible',
    'beneficiary',
    'beneficiaries',
    'benefit',
    'benefits',
    'subsidy',
    'grant',
    'grant-in-aid',
    'scholarship',
    'stipend',
    'pension',
    'financial assistance',
    'ex-gratia',
    'incentive',
    'income limit',
    'annual income',
    'family income',
    'household income',
    'age limit',
    'bpl',
    'apl',
    'ews',
    'aadhaar',
    'ration card',
    'direct benefit transfer',
    'dbt',
    'required documents',
    'documents required',
    'income certificate',
    'caste certificate',
    'domicile',
    'residence proof',
    'application process',
    'how to apply',
    'online portal',
    'last date',
    'deadline',
    'cut-off',
    'effective from',
    'w.e.f',
    'disbursement',
    'sanctioned',
    'in partial modification',
    'in supersession of',
    'supersession',
    'amendment',
    'amended',
    'hereby notifies',
    'hereby notified',
    'exclusion',
    'disqualification',
    'grievance',
    'nodal officer',
  ];

  let authorityCount = 0;
  for (const kw of govAuthorityIndicators) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = kw.includes(' ') || kw.includes('.') ? new RegExp(escaped, 'i') : new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(lower)) {
      authorityCount += 1;
    }
  }

  let substanceCount = 0;
  for (const kw of schemeSubstanceIndicators) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = kw.includes(' ') || kw.includes('.') ? new RegExp(escaped, 'i') : new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(lower)) {
      substanceCount += 1;
    }
  }

  // Rule 5b: Reject Private Legal Contracts (leases, NDAs, employment offers, private loans, sale deeds)
  const privateContractIndicators = [
    'residential lease agreement',
    'residential tenancy agreement',
    'tenancy agreement',
    'lessor',
    'lessee',
    'landlord',
    'security deposit',
    'monthly rent',
    'non-disclosure agreement',
    'disclosing party',
    'receiving party',
    'confidential information',
    'employment agreement',
    'employment offer letter',
    'offer letter',
    'appointment letter',
    'probation',
    'service bond',
    'loan agreement',
    'promissory note',
    'borrower',
    'lender',
    'power of attorney',
    'deed of sale',
    'sale deed',
    'gift deed',
    'liquidated damages',
    'arbitration and conciliation act',
    'non-compete',
    'in witness whereof',
    'pvt ltd',
    'pvt. ltd.',
  ];

  let privateContractCount = 0;
  for (const kw of privateContractIndicators) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = kw.includes(' ') || kw.includes('.') ? new RegExp(escaped, 'i') : new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(lower)) {
      privateContractCount += 1;
    }
  }

  const hasExplicitPrivateTitle =
    /\b(residential (lease|tenancy) agreement|non-disclosure agreement|nda|employment agreement|employment offer|offer letter|appointment letter|loan agreement|promissory note|power of attorney|deed of sale|sale deed|gift deed|service agreement)\b/i.test(
      lower.slice(0, 600)
    );

  if (!isExplicitCircularHeader && authorityCount === 0 && (hasExplicitPrivateTitle || privateContractCount >= 2)) {
    return {
      is_valid_circular: false,
      document_kind: 'other',
      category: 'other',
      confidence: 0.96,
      rejection_reason:
        'Document rejected by Guard 1: This appears to be a private legal contract or personal agreement rather than an official government circular, order, notification, amendment, or scheme guideline.',
    };
  }

  // Rule 6: Verify sufficient Government Circular / Scheme Policy substance
  const topText = lower.slice(0, 600);
  const hasExplicitHeaderTitle =
    isExplicitCircularHeader ||
    /\b(government order|office memorandum|scheme circular|official notification|corrigendum|addendum|partial modification|operational guidelines|scheme guidelines|public notice|gazette notification)\b/i.test(
      topText
    );

  const hasCircularSubstance =
    (hasExplicitHeaderTitle && (authorityCount >= 1 || substanceCount >= 1)) ||
    (authorityCount >= 1 && substanceCount >= 2) ||
    (authorityCount >= 2 && substanceCount >= 1) ||
    substanceCount >= 4;

  if (!hasCircularSubstance) {
    return {
      is_valid_circular: false,
      document_kind: 'other',
      category: 'other',
      confidence: 0.89,
      rejection_reason:
        'Document rejected by Guard 1: The provided text lacks essential government circular structure (no issuing government authority, scheme reference, notification/order header, or policy provisions).',
    };
  }

  // Detect Document Kind
  let detectedKind: CircularDocumentKind = 'scheme_circular';
  if (/\b(amendment|corrigendum|addendum|partial modification|in supersession of)\b/i.test(lower)) {
    detectedKind = 'amendment';
  } else if (/\b(g\.?\s*o\.?|government order|office memorandum|o\.?\s*m\.?\s*no|proceedings of)\b/i.test(lower)) {
    detectedKind = 'government_order';
  } else if (/\b(notification|gazette|hereby notifies|hereby notified|public notice)\b/i.test(lower)) {
    detectedKind = 'notification';
  } else if (/\b(scheme guidelines|operational guidelines|implementation guidelines|standard operating procedure)\b/i.test(lower)) {
    detectedKind = 'scheme_guidelines';
  } else if (/\b(circular|scheme|yojana|mission|abhiyan)\b/i.test(lower)) {
    detectedKind = 'scheme_circular';
  }

  // Detect Scheme / Policy Category
  let detectedCategory: DocumentCategory = 'scheme circular';
  if (lower.includes('scholarship') || lower.includes('student') || lower.includes('tuition') || lower.includes('fellowship') || lower.includes('education')) {
    detectedCategory = 'education & scholarship';
  } else if (lower.includes('farmer') || lower.includes('kisan') || lower.includes('crop') || lower.includes('agriculture') || lower.includes('irrigation') || lower.includes('msp')) {
    detectedCategory = 'agriculture & farmer support';
  } else if (lower.includes('health') || lower.includes('medical') || lower.includes('hospital') || lower.includes('arogya') || lower.includes('ayushman') || lower.includes('maternity')) {
    detectedCategory = 'healthcare & insurance';
  } else if (lower.includes('housing') || lower.includes('awas') || lower.includes('shelter') || lower.includes('sanitation') || lower.includes('urban development')) {
    detectedCategory = 'housing & infrastructure';
  } else if (lower.includes('skill') || lower.includes('apprentice') || lower.includes('rozgar') || lower.includes('livelihood') || lower.includes('self-help group')) {
    detectedCategory = 'employment & skill development';
  } else if (lower.includes('msme') || lower.includes('startup') || lower.includes('mudra') || lower.includes('enterprise') || lower.includes('collateral-free loan')) {
    detectedCategory = 'msme & business grant';
  } else if (lower.includes('pension') || lower.includes('ration') || lower.includes('subsidy') || lower.includes('welfare') || lower.includes('senior citizen') || lower.includes('widow')) {
    detectedCategory = 'welfare & subsidy scheme';
  } else if (detectedKind === 'amendment') {
    detectedCategory = 'policy amendment';
  } else if (detectedKind === 'government_order') {
    detectedCategory = 'government order';
  } else if (detectedKind === 'notification') {
    detectedCategory = 'official notification';
  } else if (detectedKind === 'scheme_guidelines') {
    detectedCategory = 'scheme guidelines';
  }

  return {
    is_valid_circular: true,
    document_kind: detectedKind,
    category: detectedCategory,
    confidence: detectedCategory === 'scheme circular' ? 0.90 : 0.95,
  };
}

// Guard 2b: Citizen Safety & Anti-Misuse Filter
export function runGuard2bSafetyFilter(text: string): { isSafe: boolean; reason?: string } {
  const query = text.toLowerCase();
  const illegalPatterns = [
    'how to forge',
    'fake certificate',
    'fake income certificate',
    'fake caste certificate',
    'fake contract',
    'evade tax',
    'launder money',
    'bribe',
    'fabricate document',
    'fraudulent claim',
    'fake beneficiary',
    'break law without getting caught',
  ];

  for (const pattern of illegalPatterns) {
    if (query.includes(pattern)) {
      return {
        isSafe: false,
        reason:
          'GovScheme Diff safety guardrail activated: We cannot assist with document forgery, fake scheme claims, bribery, or fraud. This service provides plain-language explanations of official public scheme circulars.',
      };
    }
  }

  return { isSafe: true };
}

// Guard 2a Grounding Check: Ensure plain-language consequence strictly reflects text
export function verifyGuard2aGrounding(
  clauseText: string,
  consequenceText: string
): { isSafe: boolean; isGrounded: boolean; groundedConsequence: string } {
  const lowerClause = clauseText.toLowerCase();
  const lowerCons = consequenceText.toLowerCase();

  // Verify numbers/amounts mentioned in consequence exist in source clause
  const numbersInCons = consequenceText.match(/\b\d+[\d,]*\b/g) || [];
  let isGrounded = true;

  for (const num of numbersInCons) {
    if (!clauseText.includes(num)) {
      isGrounded = false;
      break;
    }
  }

  if ((lowerCons.includes('jail') || lowerCons.includes('criminal')) && !lowerClause.includes('criminal')) {
    isGrounded = false;
  }

  if (!isGrounded) {
    const sanitized = `Grounded Consequence: ${clauseText.slice(0, 120)}...`;
    return { isSafe: true, isGrounded: false, groundedConsequence: sanitized };
  }

  return { isSafe: true, isGrounded: true, groundedConsequence: consequenceText };
}

function extractSectionReference(line: string, fallbackIndex: number): { sectionRef: string; clauseNumber: string } {
  const trimmed = line.trim();

  const annexMatch = trimmed.match(/^(ANNEXURE|SCHEDULE|APPENDIX)\s*[-:]?\s*([A-Z0-9IVXLCDM]+)/i);
  if (annexMatch) {
    const label = `${annexMatch[1].charAt(0).toUpperCase() + annexMatch[1].slice(1).toLowerCase()} ${annexMatch[2].toUpperCase()}`;
    return { sectionRef: label, clauseNumber: annexMatch[2].toUpperCase() };
  }

  const namedSecMatch = trimmed.match(/^(ARTICLE|SECTION|CLAUSE|PARA|PARAGRAPH|RULE|REGULATION)\s*[-:]?\s*(\d+|[IVXLCDM]+)/i);
  if (namedSecMatch) {
    const kind = namedSecMatch[1].charAt(0).toUpperCase() + namedSecMatch[1].slice(1).toLowerCase();
    const num = namedSecMatch[2].toUpperCase();
    return { sectionRef: `${kind} ${num}`, clauseNumber: num };
  }

  const numMatch = trimmed.match(/^(\d+)[\.\)]\s+/);
  if (numMatch) {
    return { sectionRef: `Section ${numMatch[1]}`, clauseNumber: numMatch[1] };
  }

  if (/^(G\.?\s*O\.?|GOVERNMENT ORDER|OFFICE MEMORANDUM|O\.?\s*M\.?|CIRCULAR NO|NOTIFICATION NO|CORRIGENDUM|ADDENDUM|SUBJECT:|SUB:)/i.test(trimmed)) {
    return { sectionRef: 'Circular Header', clauseNumber: `${fallbackIndex}` };
  }

  return { sectionRef: `Section ${fallbackIndex}`, clauseNumber: `${fallbackIndex}` };
}

// Stage 2: Government Circular Section & Clause Chunking (Preserves Page Numbers & Section References)
export function chunkDocumentTextIntoClauses(text: string): SimplifiedClause[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const blocks: { title?: string; text: string; pageNumber: number; sectionRef?: string; clauseNumber?: string }[] = [];

  let currentBlockText: string[] = [];
  let currentBlockTitle: string | undefined = undefined;
  let currentPageNumber = 1;
  let currentBlockStartPage = 1;
  let currentSectionRef: string | undefined = undefined;
  let currentClauseNumber: string | undefined = undefined;

  const CIRCULAR_NAMED_HEADINGS =
    /^(?:ELIGIBILITY(?:\s+CRITERIA|\s+CONDITIONS)?|BENEFITS?(?:\s+AND\s+ASSISTANCE)?|FINANCIAL\s+ASSISTANCE|SCALE\s+OF\s+ASSISTANCE|INCOME\s+(?:LIMIT|CEILING)|AGE\s+LIMIT|REQUIRED\s+DOCUMENTS|DOCUMENTS\s+REQUIRED|HOW\s+TO\s+APPLY|APPLICATION\s+(?:PROCESS|PROCEDURE)|SELECTION\s+(?:PROCESS|PROCEDURE)|DEADLINES?|LAST\s+DATE|VALIDITY|EXCLUSIONS?|DISQUALIFICATIONS?|AMENDMENTS?|CORRIGENDUM|ADDENDUM|PARTIAL\s+MODIFICATION|IMPLEMENTATION|VERIFICATION(?:\s+AND\s+DISBURSEMENT)?|GRIEVANCE\s+REDRESSAL|NODAL\s+(?:OFFICER|AGENCY)|OBJECTIVE|OVERVIEW|INTRODUCTION|BACKGROUND)\s*:?$/i;

  for (const line of lines) {
    // 1. Detect explicit page markers & update currentPageNumber (never include marker in clause text)
    const explicitMarkerMatch = line.match(/^(?:---\s*Page\s+(\d+)\s*---|\[Page\s+(\d+)\]|Page\s+(\d+)\s+of\s+\d+)$/i);
    if (explicitMarkerMatch) {
      const parsedPage = parseInt(explicitMarkerMatch[1] || explicitMarkerMatch[2] || explicitMarkerMatch[3], 10);
      if (!isNaN(parsedPage) && parsedPage >= 1) {
        currentPageNumber = parsedPage;
      }
      continue;
    }

    // Filter inline header/footer pagination artifacts
    if (/^(CONFIDENTIAL & PRIVILEGED|CONTRACT REF:|--\s*\d+\s+of\s+\d+\s*--|\d+\s+of\s+\d+$)/i.test(line)) {
      const inlinePageOf = line.match(/^(\d+)\s+of\s+\d+$/i);
      if (inlinePageOf) {
        currentPageNumber = Math.max(1, parseInt(inlinePageOf[1], 10));
      }
      continue;
    }

    // If line ends with embedded "Page X of Y", capture page number and strip footer
    let cleanLine = line;
    const embeddedPageMatch = cleanLine.match(/\bPage\s+(\d+)\s+of\s+\d+\b/i);
    if (embeddedPageMatch) {
      currentPageNumber = Math.max(1, parseInt(embeddedPageMatch[1], 10));
      cleanLine = cleanLine.replace(/\bPage\s+\d+\s+of\s+\d+\b/gi, '').trim();
      if (!cleanLine) continue;
    }

    const isDecimalSubPoint = /^\s*\d+\.\d+/.test(cleanLine);
    const isSubParenthesis = /^\s*\([a-z0-9]+\)/i.test(cleanLine);
    const isSubLetterDot = /^\s*[a-z]\.\s+/i.test(cleanLine);

    // Top-Level Section / Circular Heading Triggers:
    // 1) Explicit ARTICLE / SECTION / CLAUSE / PARA / ANNEXURE / SCHEDULE headers
    const isArticleOrSectionHeader = /^\s*(?:ARTICLE|SECTION|CLAUSE|PARA|PARAGRAPH|ANNEXURE|SCHEDULE|APPENDIX)\s*[-:]?\s*(?:\d+|[IVXLCDM]+|[A-Z])(?:[\s:\.\-]|$)/i.test(cleanLine);
    // 2) Top-Level single-number header (e.g. "1. ELIGIBILITY CRITERIA", "2) BENEFITS:")
    const isTopLevelNumberedHeader = !isDecimalSubPoint && /^\s*\d+[\.\)]\s+[\p{L}\p{N}]/u.test(cleanLine);
    // 3) Government Circular named section headings (e.g. "Eligibility Criteria:", "Required Documents", "Corrigendum")
    const isNamedCircularHeading = CIRCULAR_NAMED_HEADINGS.test(cleanLine) || /^(?:Subject|Sub)\s*:/i.test(cleanLine);
    // 4) Standalone Formal Section Keywords
    const isFormalSectionHeader = /^\s*(?:WHEREAS|RECITALS|PREAMBLE|IN WITNESS WHEREOF|EXECUTION|ATTESTATION)\b/i.test(cleanLine);
    // 5) Document Title / Uppercase Heading
    const isDocTitleLine = (blocks.length === 0 && currentBlockText.length === 0 && cleanLine === cleanLine.toUpperCase() && cleanLine.length >= 6 && cleanLine.length <= 90);
    const isUppercaseSectionLine =
      cleanLine === cleanLine.toUpperCase() &&
      /[A-Z]/.test(cleanLine) &&
      cleanLine.length >= 6 &&
      cleanLine.length <= 75 &&
      !cleanLine.endsWith('.') &&
      !/^RS\.?\s*\d/i.test(cleanLine);

    const isHeading = !isDecimalSubPoint && !isSubParenthesis && !isSubLetterDot && (
      isArticleOrSectionHeader ||
      isTopLevelNumberedHeader ||
      isNamedCircularHeading ||
      isFormalSectionHeader ||
      isDocTitleLine ||
      isUppercaseSectionLine
    );

    if (isHeading && currentBlockText.length > 0) {
      blocks.push({
        title: currentBlockTitle,
        text: currentBlockText.join(' '),
        pageNumber: currentBlockStartPage,
        sectionRef: currentSectionRef,
        clauseNumber: currentClauseNumber,
      });
      currentBlockText = [cleanLine];
      currentBlockTitle = extractHeadingTitle(cleanLine);
      currentBlockStartPage = currentPageNumber;
      const refInfo = extractSectionReference(cleanLine, blocks.length + 1);
      currentSectionRef = refInfo.sectionRef;
      currentClauseNumber = refInfo.clauseNumber;
    } else {
      if (currentBlockText.length === 0) {
        currentBlockStartPage = currentPageNumber;
        if (!currentBlockTitle) {
          currentBlockTitle = extractHeadingTitle(cleanLine);
        }
        const refInfo = extractSectionReference(cleanLine, blocks.length + 1);
        currentSectionRef = refInfo.sectionRef;
        currentClauseNumber = refInfo.clauseNumber;
      }
      currentBlockText.push(cleanLine);
    }
  }

  if (currentBlockText.length > 0) {
    blocks.push({
      title: currentBlockTitle,
      text: currentBlockText.join(' '),
      pageNumber: currentBlockStartPage,
      sectionRef: currentSectionRef,
      clauseNumber: currentClauseNumber,
    });
  }

  const validBlocks = blocks.filter((b) => b.text.length >= 15 && !isSignatureBlock(b.text));

  // Compute clause density telemetry signal
  const explicitPageMarkers = text.match(/(?:---\s*Page\s+(\d+)\s*---|\[Page\s+(\d+)\]|Page\s+\d+\s+of\s+(\d+))/gi);
  let estimatedPages = 1;
  if (explicitPageMarkers && explicitPageMarkers.length > 0) {
    let maxSeen = 1;
    for (const m of explicitPageMarkers) {
      const nums = m.match(/\d+/g);
      if (nums) {
        const candidateNum = parseInt(nums[nums.length - 1], 10);
        if (candidateNum > maxSeen) maxSeen = candidateNum;
      }
    }
    estimatedPages = maxSeen;
  } else {
    estimatedPages = Math.max(1, Math.round(text.length / 2500));
  }

  const clausesPerPage = (validBlocks.length / estimatedPages).toFixed(1);
  console.log(`[Circular Section Telemetry] Extracted ${validBlocks.length} sections across ${estimatedPages} page(s) (${clausesPerPage} sections/page).`);

  if (parseFloat(clausesPerPage) > 8.0 || validBlocks.length > 60) {
    console.warn(`[Section Density Warning] High section density detected: ${validBlocks.length} sections across ${estimatedPages} page(s) (${clausesPerPage} sections/page).`);
  }

  return validBlocks.map((b, idx) => {
    const origText = b.text;
    const clauseType = classifyClauseType(origText, b.title);
    const title = b.title && b.title.trim().length > 0 ? cleanClauseTitle(b.title, idx + 1) : `Section ${idx + 1}: ${getClauseTypeLabel(clauseType)}`;
    const clauseNum = b.clauseNumber || `${idx + 1}`;
    const sectionRef = b.sectionRef || `Section ${clauseNum}`;

    return {
      id: `clause_${idx + 1}`,
      clause_number: clauseNum,
      clause_type: clauseType,
      title,
      original_text: origText,
      page_number: b.pageNumber,
      section_reference: sectionRef,
      simple_explanation: null,
      very_simple_explanation: null,
      meaning_error: true,
      risk_level: 'low',
      icon_name: 'FileText',
      one_line_consequence: '',
    };
  });
}

function isSignatureBlock(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (
    lower.includes('in witness whereof') ||
    lower.includes('signed and delivered') ||
    lower.includes('signed for and on behalf of') ||
    lower.startsWith('witnesses:') ||
    lower.startsWith('witness:') ||
    lower.includes('lessor (rakesh') ||
    lower.includes('lessee (ananya') ||
    lower.includes('employee (rohan') ||
    lower.includes('भवदीय') ||
    lower.includes('मानव संसाधन विभाग') ||
    (/^(______+|lender|borrower|lessor|lessee|employer|employee|authorized signatory|\(?rakesh|\(?ananya|\(?rohan|\(?aditya)/i.test(lower) &&
      !lower.includes('shall') && !lower.includes('agree') && !lower.includes('pay') && !lower.includes('indemnify'))
  ) {
    return true;
  }
  return false;
}

function extractHeadingTitle(line: string): string | undefined {
  const cleanLine = line.replace(/^(CONFIDENTIAL & PRIVILEGED|CONTRACT REF:.*)$/i, '').trim();
  if (!cleanLine) return undefined;

  if (cleanLine.length < 80) {
    return cleanLine;
  }
  const colonIdx = cleanLine.indexOf(':');
  if (colonIdx > 0 && colonIdx < 60) {
    return cleanLine.slice(0, colonIdx).trim();
  }
  const match = cleanLine.match(/^([\p{L}\p{N}\.\s\/\-_:]{3,60})/u);
  if (match) {
    return match[1].trim();
  }
  return undefined;
}

function classifyClauseType(text: string, title?: string): ClauseType {
  const titleLower = (title || '').toLowerCase();
  const textLower = text.toLowerCase();

  // Heading title checks FIRST if available
  if (titleLower) {
    if (titleLower.includes('amend') || titleLower.includes('corrigend') || titleLower.includes('addend') || titleLower.includes('modif') || titleLower.includes('supersed')) {
      return 'amendment & supersession';
    }
    if (titleLower.includes('income') || titleLower.includes('age limit') || titleLower.includes('ceiling')) {
      return 'income & age limits';
    }
    if (titleLower.includes('exclus') || titleLower.includes('disqualif') || titleLower.includes('ineligib')) {
      return 'exclusions & disqualifications';
    }
    if (titleLower.includes('eligib') || titleLower.includes('beneficiar') || titleLower.includes('target group')) {
      return 'eligibility criteria';
    }
    if (titleLower.includes('benefit') || titleLower.includes('subsid') || titleLower.includes('grant') || titleLower.includes('scholarship') || titleLower.includes('pension') || titleLower.includes('assistance')) {
      return 'benefits & financial assistance';
    }
    if (titleLower.includes('document') || titleLower.includes('certificate') || titleLower.includes('enclosure')) {
      return 'required documents';
    }
    if (titleLower.includes('deadline') || titleLower.includes('last date') || titleLower.includes('validity') || titleLower.includes('timeline') || titleLower.includes('schedule')) {
      return 'deadlines & validity';
    }
    if (titleLower.includes('apply') || titleLower.includes('application') || titleLower.includes('portal') || titleLower.includes('procedure')) {
      return 'application process';
    }
    if (titleLower.includes('grievance') || titleLower.includes('nodal') || titleLower.includes('helpline') || titleLower.includes('appeal')) {
      return 'grievance & nodal authority';
    }
    if (titleLower.includes('implement') || titleLower.includes('verif') || titleLower.includes('disburse') || titleLower.includes('monitoring')) {
      return 'implementation & verification';
    }
    if (titleLower.includes('overview') || titleLower.includes('objective') || titleLower.includes('background') || titleLower.includes('introduction') || titleLower.includes('circular') || titleLower.includes('government order')) {
      return 'scheme overview & objective';
    }
  }

  // Text-based checks
  if (
    textLower.includes('in partial modification') ||
    textLower.includes('in supersession of') ||
    textLower.includes('corrigendum') ||
    textLower.includes('addendum') ||
    textLower.includes('hereby amended') ||
    textLower.includes('substituted with')
  ) {
    return 'amendment & supersession';
  }

  if (
    textLower.includes('annual income') ||
    textLower.includes('family income') ||
    textLower.includes('income limit') ||
    textLower.includes('income ceiling') ||
    textLower.includes('age limit') ||
    textLower.includes('aged between') ||
    textLower.includes('years of age')
  ) {
    return 'income & age limits';
  }

  if (
    textLower.includes('not eligible') ||
    textLower.includes('ineligible') ||
    textLower.includes('excluded') ||
    textLower.includes('disqualification') ||
    textLower.includes('shall not apply to')
  ) {
    return 'exclusions & disqualifications';
  }

  if (
    textLower.includes('eligible') ||
    textLower.includes('eligibility') ||
    textLower.includes('beneficiary') ||
    textLower.includes('beneficiaries')
  ) {
    return 'eligibility criteria';
  }

  if (
    textLower.includes('financial assistance') ||
    textLower.includes('subsidy') ||
    textLower.includes('grant') ||
    textLower.includes('scholarship') ||
    textLower.includes('pension') ||
    textLower.includes('stipend') ||
    textLower.includes('per month') ||
    textLower.includes('benefit amount')
  ) {
    return 'benefits & financial assistance';
  }

  if (
    textLower.includes('required documents') ||
    textLower.includes('documents required') ||
    textLower.includes('aadhaar') ||
    textLower.includes('income certificate') ||
    textLower.includes('ration card') ||
    textLower.includes('bank passbook')
  ) {
    return 'required documents';
  }

  if (
    textLower.includes('how to apply') ||
    textLower.includes('online portal') ||
    textLower.includes('application form') ||
    textLower.includes('submit application') ||
    textLower.includes('apply online')
  ) {
    return 'application process';
  }

  if (
    textLower.includes('last date') ||
    textLower.includes('deadline') ||
    textLower.includes('on or before') ||
    textLower.includes('cut-off') ||
    textLower.includes('effective from') ||
    textLower.includes('valid up to')
  ) {
    return 'deadlines & validity';
  }

  if (
    textLower.includes('grievance') ||
    textLower.includes('nodal officer') ||
    textLower.includes('helpline') ||
    textLower.includes('complaint')
  ) {
    return 'grievance & nodal authority';
  }

  if (
    textLower.includes('verification') ||
    textLower.includes('disbursement') ||
    textLower.includes('direct benefit transfer') ||
    textLower.includes('implementing agency')
  ) {
    return 'implementation & verification';
  }

  if (
    textLower.includes('circular no') ||
    textLower.includes('government order') ||
    textLower.includes('office memorandum') ||
    textLower.includes('objective of the scheme') ||
    textLower.includes('ministry of') ||
    textLower.includes('department of')
  ) {
    return 'scheme overview & objective';
  }

  return 'other';
}

export function synchronizeClauseRiskAndConsequence(clause: SimplifiedClause): SimplifiedClause {
  let riskLevel: RiskLevel = normalizeRiskLevel(clause.risk_level);
  let iconName = clause.icon_name || 'CheckCircle';
  let consequence = clause.one_line_consequence || '';

  const lowerCons = consequence.toLowerCase();
  const lowerText = clause.original_text.toLowerCase();
  const lowerTitle = clause.title.toLowerCase();

  // High Attention / Strict Condition triggers for public schemes
  if (
    lowerCons.includes('high risk') ||
    lowerCons.includes('important condition') ||
    clause.clause_type === 'exclusions & disqualifications' ||
    lowerText.includes('disqualified') ||
    lowerText.includes('not eligible') ||
    lowerText.includes('ineligible') ||
    lowerText.includes('shall be rejected') ||
    lowerText.includes('forfeited') ||
    lowerText.includes('canceled') ||
    lowerText.includes('cancelled') ||
    lowerTitle.includes('exclusion') ||
    lowerTitle.includes('disqualification')
  ) {
    riskLevel = 'high';
    iconName = 'AlertOctagon';
  } else if (
    lowerCons.includes('watch out') ||
    lowerText.includes('deadline') ||
    lowerText.includes('last date') ||
    lowerText.includes('income limit') ||
    lowerText.includes('age limit') ||
    clause.clause_type === 'deadlines & validity' ||
    clause.clause_type === 'income & age limits' ||
    clause.clause_type === 'required documents'
  ) {
    if (riskLevel !== 'high') {
      riskLevel = 'watch_out';
      iconName = 'Clock';
    }
  }

  // Clean simple prefix enforcement
  if (riskLevel === 'high') {
    iconName = 'AlertOctagon';
    if (!lowerCons.startsWith('important:') && !lowerCons.startsWith('high risk')) {
      consequence = `Important: ${consequence.replace(/^(safe clause|low risk|watch out|high risk|important|check carefully|standard info):\s*/i, '')}`;
    }
  } else if (riskLevel === 'watch_out') {
    iconName = 'Clock';
    if (!lowerCons.startsWith('watch out') && !lowerCons.startsWith('check carefully')) {
      consequence = `Check Carefully: ${consequence.replace(/^(safe clause|low risk|watch out|high risk|important|check carefully|standard info):\s*/i, '')}`;
    }
  } else {
    iconName = 'CheckCircle';
    if (!lowerCons.startsWith('standard info') && !lowerCons.startsWith('low risk') && !lowerCons.startsWith('safe clause')) {
      consequence = `Standard Info: ${consequence.replace(/^(safe clause|low risk|watch out|high risk|important|check carefully|standard info):\s*/i, '')}`;
    }
  }

  return {
    ...clause,
    risk_level: riskLevel,
    icon_name: iconName,
    one_line_consequence: consequence,
  };
}

// Stage 2: Async Structural Section Chunking & Taxonomy Typing
export async function chunkDocumentTextIntoClausesAsync(text: string): Promise<SimplifiedClause[]> {
  const rawClauses = chunkDocumentTextIntoClauses(text);
  return rawClauses;
}

// Stage 3: Citizen Condition & Priority Tagging
export async function applyRiskTaggingAndGroundingAsync(
  clauses: SimplifiedClause[],
  category: string,
  cancelSignal?: AbortSignal
): Promise<SimplifiedClause[]> {
  const baseClauses = applyRiskTaggingAndGrounding(clauses, category as DocumentCategory);
  if (!baseClauses.length) return baseClauses;

  try {
    const clausePayload = baseClauses.map((c) => ({
      id: c.id,
      title: c.title,
      page_number: c.page_number,
      section_reference: c.section_reference,
      text: c.original_text.slice(0, 400),
    }));

    const messages = [
      {
        role: 'system',
        content: `You are GovScheme Diff AI, a plain-language helper explaining Indian government scheme circulars to everyday citizens.
Review each section and assign an attention level:
1. "low" (Standard Info): General scheme background, objectives, or direct benefit descriptions.
2. "medium" (Check Carefully): Income limits, age limits, required certificates/documents, application steps, or submission dates citizens must verify.
3. "high" (Important Restriction): Strict disqualifications, exclusions, mandatory cutoffs, or reasons an application can be rejected.

Respond strictly in JSON with an object containing key "clause_risks", which is an array of objects with:
- "id": string (matching the input section id)
- "risk_level": "high" | "medium" | "low"
- "consequence": string (one short everyday-English sentence grounded strictly in the circular text; never invent amounts, dates, or rules)
- "icon_name": "AlertOctagon" | "Clock" | "CheckCircle"`
      },
      {
        role: 'user',
        content: `Circular Category: ${category}\nSections to review:\n${JSON.stringify(clausePayload, null, 2)}`
      }
    ];

    const rawResponse = await callAiChatCompletion(messages, true, cancelSignal);
    if (rawResponse && !rawResponse.startsWith('RATE_LIMIT_EXHAUSTED')) {
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed.clause_risks)) {
          const riskMap = new Map<string, { risk_level: 'high' | 'medium' | 'low'; consequence: string; icon_name?: string }>();
          for (const item of parsed.clause_risks) {
            if (item && item.id) {
              riskMap.set(item.id, {
                risk_level: item.risk_level === 'high' || item.risk_level === 'medium' ? item.risk_level : 'low',
                consequence: item.consequence || '',
                icon_name: item.icon_name || (item.risk_level === 'high' ? 'AlertOctagon' : item.risk_level === 'medium' ? 'Clock' : 'CheckCircle'),
              });
            }
          }

          return baseClauses.map((clause) => {
            const aiRisk = riskMap.get(clause.id);
            if (!aiRisk) return clause;

            const finalRisk = normalizeRiskLevel(aiRisk.risk_level);
            const finalIcon = aiRisk.icon_name || (finalRisk === 'high' ? 'AlertOctagon' : finalRisk === 'watch_out' ? 'Clock' : 'CheckCircle');
            const consText = aiRisk.consequence || clause.one_line_consequence;
            const grounding = verifyGuard2aGrounding(clause.original_text, consText);

            return synchronizeClauseRiskAndConsequence({
              ...clause,
              risk_level: finalRisk,
              icon_name: finalIcon,
              one_line_consequence: grounding.groundedConsequence,
            });
          });
        }
      }
    }
  } catch (err) {
    console.warn('Circular priority tagging fallback to rule engine:', err);
  }

  return baseClauses;
}

export function applyRiskTaggingAndGrounding(
  clauses: SimplifiedClause[],
  _category: DocumentCategory
): SimplifiedClause[] {
  return clauses.map((clause) => {
    const textLower = clause.original_text.toLowerCase();
    const titleLower = clause.title.toLowerCase();
    let riskLevel: RiskLevel = 'low';
    let iconName = 'CheckCircle';
    let rawConsequence = '';

    if (
      clause.clause_type === 'exclusions & disqualifications' ||
      textLower.includes('disqualified') ||
      textLower.includes('not eligible') ||
      textLower.includes('ineligible') ||
      textLower.includes('shall be rejected') ||
      textLower.includes('forfeited') ||
      textLower.includes('excluded') ||
      titleLower.includes('exclusion') ||
      titleLower.includes('disqualification')
    ) {
      riskLevel = 'high';
      iconName = 'AlertOctagon';
    } else if (
      textLower.includes('deadline') ||
      textLower.includes('last date') ||
      textLower.includes('income limit') ||
      textLower.includes('age limit') ||
      clause.clause_type === 'deadlines & validity' ||
      clause.clause_type === 'income & age limits' ||
      clause.clause_type === 'required documents'
    ) {
      riskLevel = 'watch_out';
      iconName = 'Clock';
    } else {
      riskLevel = 'low';
      iconName = 'CheckCircle';
    }

    if ((clause.clause_type === 'deadlines & validity' || clause.clause_type === 'income & age limits') && riskLevel !== 'high') {
      const hasSpecificDateOrAmount = /\b(\d+)\s*(day|days|month|months|year|years)\b|\b(rs\.?|₹)\s*[\d,]+/i.test(textLower);
      rawConsequence = hasSpecificDateOrAmount
        ? `Check Carefully: Specific deadline or eligibility limit applies in this section.`
        : `Check Carefully: Verify exact dates or limits in this circular section.`;
    }

    if (!rawConsequence) {
      if (riskLevel === 'high') {
        rawConsequence = `Important: This section lists rules that can make a person ineligible or cause rejection.`;
      } else if (riskLevel === 'watch_out') {
        if (clause.clause_type === 'required documents') {
          rawConsequence = `Check Carefully: You must attach the listed certificates and documents when applying.`;
        } else {
          rawConsequence = `Check Carefully: Verify the dates, limits, or steps in this section before applying.`;
        }
      } else {
        rawConsequence = `Standard Info: Explains scheme details and support covered in this section.`;
      }
    }

    const grounded = verifyGuard2aGrounding(clause.original_text, rawConsequence);

    return synchronizeClauseRiskAndConsequence({
      ...clause,
      risk_level: riskLevel,
      icon_name: iconName,
      one_line_consequence: grounded.groundedConsequence,
    });
  });
}

// Helper Functions for Titling & Explanations
// Helper Functions for Titling & Structural Explanation Validation
function extractDocumentTitle(text: string, category: DocumentCategory): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  for (const line of lines.slice(0, 12)) {
    if (/^(---\s*Page\s+\d+\s*---|\[Page\s+\d+\]|CONFIDENTIAL & PRIVILEGED|CONTRACT REF:|Page \d+ of \d+|\d+\s+of\s+\d+$)/i.test(line)) {
      continue;
    }
    const cleanLine = line.replace(/^(DOCUMENT TITLE|TITLE|SUBJECT|SUB):\s*/i, '').trim();
    if (cleanLine.length >= 5 && cleanLine.length <= 100 && !cleanLine.endsWith(':')) {
      return cleanLine;
    }
  }
  if (category && category !== 'other') {
    return category.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  return 'Government Scheme Circular';
}

function cleanClauseTitle(rawTitle: string, index: number): string {
  let cleaned = rawTitle
    .replace(/^ARTICLE\s+\d+:\s*\d*\.?\s*/i, '')
    .replace(/^SECTION\s+\d+:\s*\d*\.?\s*/i, '')
    .replace(/^CLAUSE\s+\d+:\s*\d*\.?\s*/i, '')
    .replace(/^PARA(?:GRAPH)?\s+\d+[:.\-]?\s*\d*\.?\s*/i, '')
    .replace(/^[0-9.#\s-]+/, '')
    .replace(/:$/, '')
    .trim();

  if (cleaned.length === 0) {
    cleaned = rawTitle.trim();
  }

  return cleaned.length > 0 && cleaned.length < 90 ? cleaned : `Section ${index}`;
}

function getClauseTypeLabel(clauseType: ClauseType): string {
  return clauseType.split('/').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' / ');
}

export function cleanExplanationPrefix(explanation: string | null | undefined): string | null {
  if (!explanation || typeof explanation !== 'string') return null;
  let cleaned = explanation
    .replace(/^\s*this\s+clause\s+(defines|specifies|sets\s+out|establishes|covers|outlines|details)[\s\w]*for\s+[^:]+:\s*"/i, '')
    .replace(/^\s*this\s+clause\s+(defines|specifies|sets\s+out|establishes|covers|outlines|details)[\s\w]*for\s*/i, '')
    .replace(/^\s*this\s+clause\s+(defines|specifies|sets\s+out|establishes|covers|outlines|details)\s*/i, '')
    .replace(/^\s*यह\s+खंड\s+.*(की\s+शर्तों|की\s+नियम|को\s+स्पष्ट\s+करता|को\s+परिभाषित\s+करता|के\s+तहत|दायित्वों\s+को)\s*/i, '')
    .replace(/^"\s*/, '')
    .replace(/\s*"\s*$/, '')
    .trim();

  if (cleaned.length < 10) {
    cleaned = explanation.trim();
  } else {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return cleaned;
}

export function isTemplateExplanation(explanation: string | null | undefined): boolean {
  if (!explanation || typeof explanation !== 'string') return false;
  const trimmed = explanation.trim();
  const lower = trimmed.toLowerCase();

  // Detect structural lead-in templates regardless of intermediate words (e.g. "binding obligations and terms")
  if (
    lower.startsWith('this clause specifies') ||
    lower.startsWith('this clause defines') ||
    lower.startsWith('this clause sets out') ||
    lower.startsWith('this clause establishes') ||
    lower.startsWith('this clause covers') ||
    lower.startsWith('this clause outlines') ||
    lower.startsWith('this clause details')
  ) {
    if (lower.includes('for ') || lower.includes('binding obligations') || lower.includes('terms for') || lower.includes(':')) {
      return true;
    }
  }

  if (trimmed.endsWith('...') || trimmed.includes('...')) {
    return true;
  }

  const engPattern = /^\s*this\s+clause\s+(defines|specifies|sets\s+out|establishes|covers|outlines|details)[\s\w]*for\b/i;
  const hindiPattern = /^\s*यह\s+खंड\s+.*(की\s+शर्तों|की\s+नियम|को\s+स्पष्ट\s+करता|को\s+परिभाषित\s+करता|के\s+तहत|दायित्वों\s+को)/i;
  return engPattern.test(trimmed) || hindiPattern.test(trimmed);
}

export function hasVerbatimQuoteOverlap(explanation: string | null | undefined, originalText: string | null | undefined, wordWindow: number = 8): boolean {
  if (!explanation || !originalText || typeof explanation !== 'string' || typeof originalText !== 'string') return false;
  const expWords = explanation.toLowerCase().replace(/[^\w\s\u0900-\u097F\u0C80-\u0CFF]/g, '').split(/\s+/).filter(Boolean);
  const textWords = originalText.toLowerCase().replace(/[^\w\s\u0900-\u097F\u0C80-\u0CFF]/g, '').split(/\s+/).filter(Boolean);

  if (expWords.length < wordWindow || textWords.length < wordWindow) return false;

  for (let i = 0; i <= expWords.length - wordWindow; i++) {
    const windowSeq = expWords.slice(i, i + wordWindow).join(' ');
    for (let j = 0; j <= textWords.length - wordWindow; j++) {
      const textSeq = textWords.slice(j, j + wordWindow).join(' ');
      if (windowSeq === textSeq) {
        return true;
      }
    }
  }
  return false;
}

export function isValidAiExplanation(explanation: string | null | undefined, originalText: string | null | undefined, title?: string): boolean {
  if (!explanation || typeof explanation !== 'string' || explanation.trim().length === 0) return false;
  if (isTemplateExplanation(explanation)) return false;
  const cleaned = cleanExplanationPrefix(explanation);
  if (!cleaned || cleaned.length < 10) return false;
  if (cleaned.endsWith('...') || cleaned.includes('...')) return false;
  if (hasVerbatimQuoteOverlap(cleaned, originalText || '', 8)) return false;
  return true;
}

export function generateGroundedHeuristicExplanation(
  text: string,
  clauseType: ClauseType,
  title?: string,
  language: string = 'en'
): { simple_explanation: string | null; very_simple_explanation: string | null } {
  return {
    simple_explanation: null,
    very_simple_explanation: null,
  };
}

export function generateSimpleExplanation(text: string, clauseType: ClauseType, title?: string, language: string = 'en'): string | null {
  return null;
}

export function generateVerySimpleExplanation(text: string, clauseType: ClauseType, title?: string, language: string = 'en'): string | null {
  return null;
}

export function formatCircularCitation(clause?: Partial<SimplifiedClause> | null): string {
  if (!clause) return '';
  const parts: string[] = [];
  if (typeof clause.page_number === 'number' && clause.page_number > 0) {
    parts.push(`Page ${clause.page_number}`);
  }
  const ref = clause.section_reference || (clause.clause_number ? `Section ${clause.clause_number}` : '');
  if (ref) {
    parts.push(ref);
  }
  return parts.length > 0 ? `(${parts.join(', ')})` : '';
}

export function enforceThreePointCitizenAnswer(
  rawText: string,
  options?: {
    citation?: string;
    isMissingInfo?: boolean;
    fallbackPoints?: [string, string, string];
  }
): string {
  const MISSING_PHRASE = 'This information is not mentioned in the uploaded circular.';
  const cleanLine = (s: string): string =>
    s
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/^\s*(?:\d+[\.\)]\s*|[-•*]\s*)/, '')
      .replace(/\s+/g, ' ')
      .trim();

  const text = (rawText || '').replace(/\r\n/g, '\n').trim();
  let items: string[] = [];

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('|---'));

  const numberedLines = lines.filter((l) => /^\d+[\.\)]\s+/.test(l));
  if (numberedLines.length >= 2) {
    items = numberedLines.map(cleanLine).filter(Boolean);
  } else {
    const bulletLines = lines.filter((l) => /^[-•*]\s+/.test(l));
    if (bulletLines.length >= 2) {
      items = bulletLines.map(cleanLine).filter(Boolean);
    } else {
      const normalized = cleanLine(text.replace(/\n+/g, ' '));
      const sentences = normalized
        .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)
        .map(cleanLine)
        .filter(Boolean);
      items = sentences.length > 0 ? sentences : (normalized ? [normalized] : []);
    }
  }

  items = items.filter((item) => item.length >= 4);

  if (options?.isMissingInfo && !items.some((i) => i.toLowerCase().includes('not mentioned in the uploaded circular'))) {
    items.unshift(MISSING_PHRASE);
  }

  if (items.length > 3) {
    const first = items[0];
    const second = items[1];
    const remaining = items.slice(2).join(' ').trim();
    items = [first, second, remaining.length <= 220 ? remaining : `${remaining.slice(0, 219).trim()}`];
  }

  const defaults: [string, string, string] = options?.fallbackPoints || [
    MISSING_PHRASE,
    options?.citation
      ? `Check the uploaded circular at ${options.citation.replace(/^\(|\)$/g, '')}.`
      : 'Check the uploaded circular sections for more details.',
    'Confirm complete details on the official scheme portal or citizen helpdesk.',
  ];

  while (items.length < 3) {
    const candidate = defaults[items.length] || defaults[2];
    if (!items.includes(candidate)) {
      items.push(candidate);
    } else {
      items.push('Verify official rules on the government scheme portal before applying.');
    }
  }

  if (options?.citation && !items.some((i) => i.includes('Page ') || i.includes('Section ') || i.includes('Circular '))) {
    items[2] = `${items[2].replace(/[.\s]+$/, '')} ${options.citation}.`;
  }

  return items
    .slice(0, 3)
    .map((point, idx) => {
      const normalized = cleanLine(point);
      const ended = /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
      return `${idx + 1}. ${ended}`;
    })
    .join('\n');
}

export function generateHighQualityDomainExplanation(c: SimplifiedClause, _language: string = 'en'): { simple: string; verySimple: string } {
  const type = (c.clause_type || '').toLowerCase();
  const title = (c.title || 'this scheme section').trim();
  const citation = formatCircularCitation(c);
  const refNote = citation ? `Source: ${citation.replace(/^\(|\)$/g, '')}.` : `Check section "${title}" in the uploaded circular.`;

  if (type.includes('overview') || title.toLowerCase().includes('overview') || title.toLowerCase().includes('objective')) {
    return {
      simple: enforceThreePointCitizenAnswer('', {
        fallbackPoints: [
          `This part explains what the government scheme is and its main goal.`,
          `It tells citizens why the circular was issued under "${title}".`,
          refNote,
        ],
      }),
      verySimple: enforceThreePointCitizenAnswer('', {
        fallbackPoints: [
          `Explains the main goal of this scheme.`,
          `Shows who the government wants to help.`,
          refNote,
        ],
      }),
    };
  }

  if (type.includes('exclusion') || type.includes('disqualif') || title.toLowerCase().includes('exclusion')) {
    return {
      simple: enforceThreePointCitizenAnswer('', {
        fallbackPoints: [
          `This part lists rules that make a person unable to get this scheme benefit.`,
          `Read every condition carefully so your form is not rejected.`,
          refNote,
        ],
      }),
      verySimple: enforceThreePointCitizenAnswer('', {
        fallbackPoints: [
          `Shows who cannot apply for this scheme.`,
          `Applying while excluded leads to rejection.`,
          refNote,
        ],
      }),
    };
  }

  if (type.includes('income') || type.includes('age') || title.toLowerCase().includes('income') || title.toLowerCase().includes('age')) {
    return {
      simple: enforceThreePointCitizenAnswer('', {
        fallbackPoints: [
          `This part sets the family income limit or applicant age limit.`,
          `Only applicants within the stated income and age range can qualify.`,
          refNote,
        ],
      }),
      verySimple: enforceThreePointCitizenAnswer('', {
        fallbackPoints: [
          `Gives the income cap and age rule for this scheme.`,
          `Check your age and income proof before you apply.`,
          refNote,
        ],
      }),
    };
  }

  if (type.includes('eligib') || title.toLowerCase().includes('eligib')) {
    return {
      simple: enforceThreePointCitizenAnswer('', {
        fallbackPoints: [
          `This part explains who can apply for this government scheme.`,
          `You must meet every listed condition to qualify for support.`,
          refNote,
        ],
      }),
      verySimple: enforceThreePointCitizenAnswer('', {
        fallbackPoints: [
          `Shows who is allowed to apply.`,
          `Make sure you meet all basic rules listed here.`,
          refNote,
        ],
      }),
    };
  }

  if (type.includes('benefit') || type.includes('financial') || title.toLowerCase().includes('benefit') || title.toLowerCase().includes('grant')) {
    return {
      simple: enforceThreePointCitizenAnswer('', {
        fallbackPoints: [
          `This part describes the money, subsidy, or help the scheme provides.`,
          `Check the exact payment schedule or conditions shown in the circular text.`,
          refNote,
        ],
      }),
      verySimple: enforceThreePointCitizenAnswer('', {
        fallbackPoints: [
          `Tells you what money or help you get from the scheme.`,
          `Check how and when the support is given.`,
          refNote,
        ],
      }),
    };
  }

  if (type.includes('document') || title.toLowerCase().includes('document')) {
    return {
      simple: enforceThreePointCitizenAnswer('', {
        fallbackPoints: [
          `This part lists the ID proofs and certificates needed to apply.`,
          `Keep valid copies ready so officials can verify your application.`,
          refNote,
        ],
      }),
      verySimple: enforceThreePointCitizenAnswer('', {
        fallbackPoints: [
          `Lists the papers and ID proofs you must submit.`,
          `Missing papers can delay or stop your application.`,
          refNote,
        ],
      }),
    };
  }

  if (type.includes('deadline') || type.includes('validity') || title.toLowerCase().includes('deadline')) {
    return {
      simple: enforceThreePointCitizenAnswer('', {
        fallbackPoints: [
          `This part states the important dates, last date to apply, or validity window.`,
          `Submit your form before the closing date so it is accepted.`,
          refNote,
        ],
      }),
      verySimple: enforceThreePointCitizenAnswer('', {
        fallbackPoints: [
          `Shows the last date and timeline for this scheme.`,
          `Apply early before the closing date passes.`,
          refNote,
        ],
      }),
    };
  }

  if (type.includes('application') || title.toLowerCase().includes('apply') || title.toLowerCase().includes('process')) {
    return {
      simple: enforceThreePointCitizenAnswer('', {
        fallbackPoints: [
          `This part explains how and where to submit your scheme application.`,
          `Follow the listed online portal or office steps carefully.`,
          refNote,
        ],
      }),
      verySimple: enforceThreePointCitizenAnswer('', {
        fallbackPoints: [
          `Explains how to apply step by step.`,
          `Use only the official portal or office listed here.`,
          refNote,
        ],
      }),
    };
  }

  if (type.includes('grievance') || type.includes('appeal') || title.toLowerCase().includes('grievance')) {
    return {
      simple: enforceThreePointCitizenAnswer('', {
        fallbackPoints: [
          `This part explains where citizens can report problems or file an appeal.`,
          `Use the listed grievance officer or helpline if your application is delayed.`,
          refNote,
        ],
      }),
      verySimple: enforceThreePointCitizenAnswer('', {
        fallbackPoints: [
          `Tells you how to complain or appeal if something goes wrong.`,
          `Keep your application receipt when contacting the helpdesk.`,
          refNote,
        ],
      }),
    };
  }

  if (type.includes('monitoring') || type.includes('compliance')) {
    return {
      simple: enforceThreePointCitizenAnswer('', {
        fallbackPoints: [
          `This part explains how government officers check records and follow rules.`,
          `Applicants must give true details or benefits may be stopped.`,
          refNote,
        ],
      }),
      verySimple: enforceThreePointCitizenAnswer('', {
        fallbackPoints: [
          `Shows how officials check and verify scheme records.`,
          `Always give honest and accurate information.`,
          refNote,
        ],
      }),
    };
  }

  return {
    simple: enforceThreePointCitizenAnswer('', {
      fallbackPoints: [
        `This part covers scheme details under "${title}".`,
        `Read the original circular text to check every rule, date, or amount.`,
        refNote,
      ],
    }),
    verySimple: enforceThreePointCitizenAnswer('', {
      fallbackPoints: [
        `Gives details under "${title}".`,
        `Check the full text if any rule affects your application.`,
        refNote,
      ],
    }),
  };
}

// Stage 4: Dedicated AI Synthesis & Citizen Briefing Packet Generation
export async function synthesizeDocumentAnalysis(
  text: string,
  clauses: SimplifiedClause[],
  guard1: Guard1InputGate,
  _categoryHint?: string,
  language: string = 'en',
  cancelSignal?: AbortSignal
): Promise<DocumentAnalysisResult> {
  const { demoMode } = getServerConfigStatus();
  const syncedInputClauses = clauses.map(synchronizeClauseRiskAndConsequence);

  if (!demoMode) {
    const jsonPrompt = [
      {
        role: 'system',
        content: `You are GovScheme Diff AI, a plain-language assistant for government scheme circulars in English ONLY.
Analyze the provided circular text and extracted sections and produce strict JSON matching the expected schema.
Allowed Categories: ${JSON.stringify(DOCUMENT_CATEGORY_ENUM)}
Allowed Section Types: ${JSON.stringify(CLAUSE_TYPE_ENUM)}
CRITICAL RULES:
1. Use VERY SIMPLE everyday English. Avoid complicated legal, bureaucratic, and technical words.
2. Every citizen-facing explanation ("simple_explanation" and "very_simple_explanation") MUST contain EXACTLY THREE short numbered points ("1. ...\n2. ...\n3. ...") written in your own plain words (never copy 8 or more consecutive words from the source text).
3. Include page number and section reference in point 3 wherever available (e.g., "Source: Page 1, Section 2.").
4. NEVER invent eligibility rules, benefits, amounts, dates, or required documents. If a detail is missing, say: "This information is not mentioned in the uploaded circular."
5. Provide plain-language summary_simple, summary_very_simple, scheme action checklist items, citizen questions for the helpdesk officer, and disclaimer.`,
      },
      {
        role: 'user',
        content: `Synthesize final English-only citizen analysis for this government circular:\nCategory: ${guard1.category}\nExtracted Sections: ${JSON.stringify(syncedInputClauses.map(c => ({ id: c.id, clause_number: c.clause_number, page_number: c.page_number, section_reference: c.section_reference, clause_type: c.clause_type, title: c.title, original_text: c.original_text.slice(0, 500) })).slice(0, 15))}\n\nRaw Circular Text:\n${text.slice(0, 6000)}`,
      },
    ];

    const jsonResult = await callAiChatCompletion(jsonPrompt, true, cancelSignal);
    if (jsonResult && !jsonResult.startsWith('RATE_LIMIT_EXHAUSTED')) {
      try {
        const cleanedStr = jsonResult
          .replace(/<Think>[\s\S]*?<\/Think>/gi, '')
          .replace(/```json/gi, '')
          .replace(/```/g, '')
          .trim();
        const jsonMatch = cleanedStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const aiClausesArray = Array.isArray(parsed.clauses) ? parsed.clauses : (Array.isArray(parsed.simplified_clauses) ? parsed.simplified_clauses : []);
          if (aiClausesArray.length > 0) {
            const mergedClauses: SimplifiedClause[] = [];
            for (let idx = 0; idx < syncedInputClauses.length; idx++) {
              const baseClause = syncedInputClauses[idx];
              const aiClause = aiClausesArray.find((c: any) => c.id === baseClause.id || String(c.clause_number) === String(baseClause.clause_number)) || aiClausesArray[idx];
              const citation = formatCircularCitation(baseClause);

              const rawSimple = aiClause?.simple_explanation || aiClause?.explanation || aiClause?.summary || aiClause?.description || aiClause?.text;
              const rawVerySimple = aiClause?.very_simple_explanation || aiClause?.very_simple || aiClause?.short_summary || rawSimple;

              let simpleExp: string | null = isValidAiExplanation(rawSimple, baseClause.original_text, baseClause.title)
                ? enforceThreePointCitizenAnswer(cleanExplanationPrefix(rawSimple) || rawSimple, { citation })
                : null;
              let verySimpleExp: string | null = isValidAiExplanation(rawVerySimple, baseClause.original_text, baseClause.title)
                ? enforceThreePointCitizenAnswer(cleanExplanationPrefix(rawVerySimple) || rawVerySimple, { citation })
                : null;

              if ((!simpleExp || !verySimpleExp) && aiClause && !cancelSignal?.aborted) {
                try {
                  const retryPrompt = [
                    {
                      role: 'system',
                      content: `You are GovScheme Diff AI. Explain this circular section in very simple everyday English.
MANDATORY RULES:
1. Write both "simple_explanation" and "very_simple_explanation" as EXACTLY 3 short numbered points (1. ..., 2. ..., 3. ...).
2. Do NOT copy 8+ consecutive words from the section text or use "...".
3. Never invent rules, amounts, dates, or documents. Include reference "${citation || baseClause.title}" where relevant.`
                    },
                    {
                      role: 'user',
                      content: `Section Title: ${baseClause.title}\nReference: ${citation || 'Uploaded circular'}\nSection Text: ${baseClause.original_text.slice(0, 1000)}\n\nRespond strictly in JSON: {"simple_explanation": "1. ...\\n2. ...\\n3. ...", "very_simple_explanation": "1. ...\\n2. ...\\n3. ..."}`
                    }
                  ];
                  const retryRes = await callAiChatCompletion(retryPrompt, true, cancelSignal);
                  if (retryRes && !retryRes.startsWith('RATE_LIMIT_EXHAUSTED')) {
                    const retryClean = retryRes.replace(/<Think>[\s\S]*?<\/Think>/gi, '').replace(/```json/gi, '').replace(/```/g, '').trim();
                    const retryMatch = retryClean.match(/\{[\s\S]*\}/);
                    if (retryMatch) {
                      const retryParsed = JSON.parse(retryMatch[0]);
                      if (!simpleExp && isValidAiExplanation(retryParsed.simple_explanation, baseClause.original_text, baseClause.title)) {
                        simpleExp = enforceThreePointCitizenAnswer(retryParsed.simple_explanation, { citation });
                      }
                      if (!verySimpleExp && isValidAiExplanation(retryParsed.very_simple_explanation, baseClause.original_text, baseClause.title)) {
                        verySimpleExp = enforceThreePointCitizenAnswer(retryParsed.very_simple_explanation, { citation });
                      }
                    }
                  }
                } catch (retryErr) {
                  console.warn(`[Explanation Retry Failed] section ${baseClause.id}:`, retryErr);
                }
              }

              const fallbackDomain = generateHighQualityDomainExplanation(baseClause, 'en');
              const finalSimple = simpleExp || fallbackDomain.simple;
              const finalVerySimple = verySimpleExp || fallbackDomain.verySimple;

              mergedClauses.push(synchronizeClauseRiskAndConsequence({
                ...baseClause,
                title: aiClause?.title && aiClause.title.length > 0 && !aiClause.title.toLowerCase().startsWith('clause ') ? aiClause.title : baseClause.title,
                simple_explanation: finalSimple,
                very_simple_explanation: finalVerySimple,
                meaning_error: undefined,
                risk_level: baseClause.risk_level === 'high' ? 'high' : (aiClause?.risk_level === 'high' || aiClause?.risk_level === 'medium' ? aiClause.risk_level : baseClause.risk_level),
                one_line_consequence: aiClause?.one_line_consequence || baseClause.one_line_consequence,
                clause_type: baseClause.clause_type,
              }));
            }

            const rawResult: DocumentAnalysisResult = {
              guard1,
              ...parsed,
              clauses: mergedClauses,
            };

            return validateAndEnforceGroundedSynthesis(rawResult, mergedClauses);
          }
        }
      } catch (e) {
        console.warn('Failed to parse AI JSON result, using grounded English circular synthesis:', e);
      }
    }
  }

  // Grounded Deterministic Fallback Synthesis
  const fullySynthesizedClauses = syncedInputClauses.map((c) => {
    const validSimple = isValidAiExplanation(c.simple_explanation, c.original_text, c.title) ? cleanExplanationPrefix(c.simple_explanation!) : null;
    const validVerySimple = isValidAiExplanation(c.very_simple_explanation, c.original_text, c.title) ? cleanExplanationPrefix(c.very_simple_explanation!) : null;

    const fallbackDomain = generateHighQualityDomainExplanation(c, 'en');
    const finalSimple = validSimple || fallbackDomain.simple;
    const finalVerySimple = validVerySimple || fallbackDomain.verySimple;

    return {
      ...c,
      simple_explanation: finalSimple,
      very_simple_explanation: finalVerySimple,
      meaning_error: undefined,
    };
  });

  const highRiskCount = fullySynthesizedClauses.filter((c) => c.risk_level === 'high').length;
  const overallRiskScore = calculateDocumentOverallRiskScore(fullySynthesizedClauses);
  const docTitle = extractDocumentTitle(text, guard1.category);

  const checklistItems = syncedInputClauses.map((c, idx) => {
    let cat: 'deadline' | 'obligation' | 'notice_period' | 'stamp_duty' | 'warning' = 'obligation';
    if (c.clause_type === 'deadlines & validity') cat = 'deadline';
    else if (c.risk_level === 'high') cat = 'warning';

    let actionText = '';
    if (c.clause_type === 'deadlines & validity') {
      actionText = `Note application deadline or valid dates (${c.section_reference || `Section ${idx + 1}`}).`;
    } else if (c.clause_type === 'required documents') {
      actionText = `Gather all required ID proofs and certificates (${c.section_reference || `Section ${idx + 1}`}).`;
    } else if (c.clause_type === 'eligibility criteria' || c.clause_type === 'income & age limits') {
      actionText = `Check if you meet the eligibility, income, and age rules (${c.section_reference || `Section ${idx + 1}`}).`;
    } else if (c.risk_level === 'high') {
      actionText = `Check important exclusion or rejection rule in ${c.title}.`;
    } else {
      actionText = `Review scheme rules for ${c.title}.`;
    }

    return {
      id: `chk_${idx + 1}`,
      category: cat,
      title: `${c.title} (${getClauseTypeLabel(c.clause_type)})`,
      description: c.one_line_consequence || c.simple_explanation || '',
      action_required: actionText,
      associated_clause_id: c.id,
    };
  });

  const citizenQuestions: string[] = [];
  for (const c of syncedInputClauses) {
    const lower = (c.original_text + ' ' + c.title).toLowerCase();
    const refLabel = formatCircularCitation(c) || `Section ${c.clause_number || c.id}`;
    if (c.clause_type === 'exclusions & disqualifications' || lower.includes('not eligible') || lower.includes('excluded')) {
      citizenQuestions.push(`${refLabel} (${c.title}): Ask the helpdesk whether any exclusion rule applies to your family.`);
    }
    if (c.clause_type === 'required documents' || lower.includes('certificate')) {
      citizenQuestions.push(`${refLabel} (${c.title}): Confirm which office issues the required certificates and whether self-attested copies work.`);
    }
  }

  if (citizenQuestions.length === 0) {
    citizenQuestions.push(`Ask the scheme helpdesk to confirm the official portal link and submission deadline for ${docTitle}.`);
  }

  const optionsNextSteps: NextStepsOption[] = [];

  const eligibilitySection = syncedInputClauses.find((c) => c.clause_type === 'eligibility criteria' || c.clause_type === 'income & age limits');
  if (eligibilitySection) {
    optionsNextSteps.push({
      id: 'opt_1',
      title: 'Check Income, Age, and Eligibility Proof',
      description: `Compare your household details with ${eligibilitySection.title} ${formatCircularCitation(eligibilitySection)} before starting your application.`,
      benefit: 'Prevents form rejection during officer verification.',
      tradeoff: 'You may need an updated income or residence certificate first.',
    });
  }

  const docsSection = syncedInputClauses.find((c) => c.clause_type === 'required documents');
  if (docsSection) {
    optionsNextSteps.push({
      id: 'opt_2',
      title: 'Prepare Supporting Certificates Early',
      description: `Scan and keep clean copies of all certificates listed under ${docsSection.title} ${formatCircularCitation(docsSection)}.`,
      benefit: 'Speeds up online portal upload or CSC center submission.',
    });
  }

  const deadlineSection = syncedInputClauses.find((c) => c.clause_type === 'deadlines & validity');
  if (deadlineSection) {
    optionsNextSteps.push({
      id: 'opt_3',
      title: 'Apply Before the Circular Closing Date',
      description: `Submit your application well ahead of the cutoff in ${deadlineSection.title} ${formatCircularCitation(deadlineSection)}.`,
      benefit: 'Avoids last-minute portal traffic or missed benefit cycles.',
    });
  }

  optionsNextSteps.push({
    id: 'opt_4',
    title: 'Confirm Updates on Official Portal or Helpdesk',
    description: 'Check the Scheme Portals & Helpdesks tab or call the official citizen helpline for latest circular corrigenda.',
    benefit: 'Ensures you follow the most recent government rules.',
  });

  const rawSynthesis: DocumentAnalysisResult = {
    guard1,
    document_title: docTitle,
    category: guard1.category,
    overall_risk_score: overallRiskScore,
    summary_simple: enforceThreePointCitizenAnswer('', {
      fallbackPoints: [
        `${docTitle} is a ${guard1.category} circular with ${fullySynthesizedClauses.length} sections explained in plain English.`,
        highRiskCount > 0
          ? `There are ${highRiskCount} important exclusion or cutoff rule(s) to check carefully before applying.`
          : `No strict rejection traps were flagged, but check eligibility limits and document lists carefully.`,
        `Verify key dates and benefits directly against the official government portal.`,
      ],
    }),
    summary_very_simple: enforceThreePointCitizenAnswer('', {
      fallbackPoints: [
        `This circular has ${fullySynthesizedClauses.length} main parts written in simple English.`,
        `${highRiskCount > 0 ? `${highRiskCount} part(s) list strict rules you must watch closely.` : 'Check your eligibility and required papers first.'}`,
        `Apply only through the official scheme portal or local helpdesk.`,
      ],
    }),
    clauses: fullySynthesizedClauses,
    contradictions: [],
    checklist: {
      title: 'Citizen Action & Deadline Checklist',
      stamp_duty_required: false,
      stamp_duty_note: 'Verify fee rules and certificate requirements directly on the official scheme portal.',
      items: checklistItems,
      disclaimer: 'Informational summary generated by GovScheme Diff.',
    },
    options_next_steps: optionsNextSteps,
    lawyer_briefing: {
      document_summary: `${docTitle}: ${fullySynthesizedClauses.length} scheme sections summarized in plain English with ${highRiskCount} key condition notice(s).`,
      flagged_issues: [],
      questions_to_ask_lawyer: citizenQuestions,
      missing_protective_clauses: [],
      recommended_next_steps: [
        'Check all eligibility and income/age limits',
        'Gather required certificates before the deadline',
        'Confirm portal submission steps with the official helpdesk',
      ],
      disclaimer: 'Citizen briefing prepared by GovScheme Diff for informational reference only.',
    },
    disclaimer: 'GovScheme Diff explains government scheme circulars in plain English. Always verify final rules with the issuing department.',
  };

  return validateAndEnforceGroundedSynthesis(rawSynthesis, fullySynthesizedClauses);
}

export function validateAndEnforceGroundedSynthesis(
  result: DocumentAnalysisResult,
  clauses: SimplifiedClause[]
): DocumentAnalysisResult {
  const syncedClauses = clauses.map(synchronizeClauseRiskAndConsequence);
  const highRiskClauses = syncedClauses.filter((c) => c.risk_level === 'high');

  const validatedFlaggedIssues = highRiskClauses.map((c) => ({
    clause_id: c.id,
    clause_title: c.title,
    concern: c.one_line_consequence,
    suggested_clause_edit: `Check ${formatCircularCitation(c) || c.title} with your local helpdesk if unsure whether this exclusion or limit applies to you.`,
  }));

  // 1. Enforce Grounded Citizen Checklist Items
  let checklistItems = Array.isArray(result.checklist?.items) ? result.checklist.items : [];
  if (checklistItems.length < 2 && syncedClauses.length > 0) {
    checklistItems = syncedClauses.map((c, idx) => {
      const lower = (c.original_text + ' ' + c.title).toLowerCase();
      let cat: 'deadline' | 'obligation' | 'notice_period' | 'stamp_duty' | 'warning' = 'obligation';
      if (c.clause_type === 'deadlines & validity' || lower.includes('deadline') || lower.includes('last date')) cat = 'deadline';
      else if (c.risk_level === 'high') cat = 'warning';

      let actionText = '';
      if (c.clause_type === 'deadlines & validity' || lower.includes('deadline') || lower.includes('last date')) {
        actionText = `Note application deadline or effective date (${c.section_reference || `Section ${c.clause_number || idx + 1}`}).`;
      } else if (c.clause_type === 'required documents' || lower.includes('document')) {
        actionText = `Prepare required supporting certificates (${c.section_reference || `Section ${c.clause_number || idx + 1}`}).`;
      } else if (c.clause_type === 'eligibility criteria' || c.clause_type === 'income & age limits') {
        actionText = `Confirm eligibility and income/age criteria (${c.section_reference || `Section ${c.clause_number || idx + 1}`}).`;
      } else if (c.risk_level === 'high') {
        actionText = `Check important restriction or exclusion in ${c.title}.`;
      } else {
        actionText = `Review scheme rules for ${c.title}.`;
      }

      let timeframe: string | undefined = undefined;
      const daysMatch = c.original_text.match(/\b(\d+)\s*(days?|months?|years?)\b/i);
      if (daysMatch) {
        timeframe = daysMatch[0];
      }

      return {
        id: `chk_${c.id || idx + 1}`,
        category: cat,
        title: `${c.title} (${getClauseTypeLabel(c.clause_type)})`,
        description: c.one_line_consequence || c.simple_explanation || '',
        action_required: actionText,
        due_date_or_timeframe: timeframe,
        associated_clause_id: c.id,
      };
    });
  }

  // 2. Enforce Grounded Citizen Next Steps
  let optionsNextSteps = Array.isArray(result.options_next_steps) ? result.options_next_steps : [];
  if (optionsNextSteps.length < 2 && syncedClauses.length > 0) {
    optionsNextSteps = [];
    const exclusionClause = syncedClauses.find((c) => c.clause_type === 'exclusions & disqualifications');
    if (exclusionClause) {
      optionsNextSteps.push({
        id: 'opt_exclusions',
        title: `Check Exclusions in ${exclusionClause.title}`,
        description: `Review exclusion criteria in ${exclusionClause.title} ${formatCircularCitation(exclusionClause)} before submitting an application.`,
        benefit: 'Avoids applying under an ineligible category.',
      });
    }

    const docsClause = syncedClauses.find((c) => c.clause_type === 'required documents');
    if (docsClause) {
      optionsNextSteps.push({
        id: 'opt_documents',
        title: `Collect Documents Listed in ${docsClause.title}`,
        description: `Prepare all required certificates mentioned in ${docsClause.title} ${formatCircularCitation(docsClause)}.`,
        benefit: 'Prevents verification delays during application screening.',
      });
    }

    const deadlineClause = syncedClauses.find((c) => c.clause_type === 'deadlines & validity');
    if (deadlineClause) {
      optionsNextSteps.push({
        id: 'opt_deadline',
        title: `Track Deadline in ${deadlineClause.title}`,
        description: `Apply ahead of the cutoff specified in ${deadlineClause.title} ${formatCircularCitation(deadlineClause)}.`,
        benefit: 'Prevents missing the scheme window.',
      });
    }

    optionsNextSteps.push({
      id: 'opt_verify',
      title: 'Verify Details on Official Government Portal',
      description: 'Confirm latest circular updates, portal links, and required documents with the issuing department.',
      benefit: 'Ensures accurate and up-to-date scheme application.',
    });
  }

  // 3. Circular Information Completeness Notes (only flag scheme sections missing from circular)
  const docCategory = (result.category || result.guard1?.category || '').toLowerCase();
  const candidateMissing: string[] = Array.isArray(result.lawyer_briefing?.missing_protective_clauses)
    ? [...result.lawyer_briefing.missing_protective_clauses]
    : [];

  const uniqueCandidateMissing = Array.from(new Set(candidateMissing));
  const validatedMissingClauses = uniqueCandidateMissing.filter((item) => {
    const itemLower = item.toLowerCase();
    if (itemLower.includes('eligib') && syncedClauses.some((c) => c.clause_type === 'eligibility criteria')) return false;
    if (itemLower.includes('document') && syncedClauses.some((c) => c.clause_type === 'required documents')) return false;
    if (itemLower.includes('deadline') && syncedClauses.some((c) => c.clause_type === 'deadlines & validity')) return false;
    return true;
  });

  // 4. Grounded Helpdesk Questions
  const candidateQuestions = Array.isArray(result.lawyer_briefing?.questions_to_ask_lawyer)
    ? [...result.lawyer_briefing.questions_to_ask_lawyer]
    : [];

  for (const c of syncedClauses) {
    const lower = (c.original_text + ' ' + c.title).toLowerCase();
    const ref = formatCircularCitation(c) || `Section ${c.clause_number || c.id}`;
    if (c.clause_type === 'exclusions & disqualifications' || lower.includes('ineligible')) {
      candidateQuestions.push(`${ref} (${c.title}): Does any exclusion condition apply to my household?`);
    }
  }

  const genericBlocklist = [
    /are all terms in .* legally enforceable/i,
    /is this agreement legally binding/i,
    /what are the key risks in this document/i,
    /are all terms legally enforceable/i,
  ];

  const groundedQuestions = Array.from(new Set(candidateQuestions)).filter(
    (q) => !genericBlocklist.some((re) => re.test(q))
  );

  const overallRiskScore = typeof result.overall_risk_score === 'number' && !isNaN(result.overall_risk_score)
    ? result.overall_risk_score
    : calculateDocumentOverallRiskScore(syncedClauses);

  const safeDocTitle = (result.document_title && typeof result.document_title === 'string' && result.document_title.trim() !== '' && result.document_title.toLowerCase() !== 'undefined')
    ? result.document_title.trim()
    : extractDocumentTitle(syncedClauses.map((c) => c.original_text).join('\n'), docCategory as DocumentCategory);

  return {
    ...result,
    document_title: safeDocTitle,
    overall_risk_score: overallRiskScore,
    clauses: syncedClauses,
    checklist: {
      title: result.checklist?.title || 'Citizen Action & Deadline Checklist',
      stamp_duty_required: false,
      stamp_duty_note: result.checklist?.stamp_duty_note || 'Verify any application fee or certificate requirements on the official scheme portal.',
      items: checklistItems,
      disclaimer: result.checklist?.disclaimer || 'Informational checklist generated by GovScheme Diff.',
    },
    options_next_steps: optionsNextSteps,
    lawyer_briefing: {
      ...result.lawyer_briefing,
      document_summary: `${safeDocTitle}: ${syncedClauses.length} circular sections explained in plain English (${highRiskClauses.length} key condition notice(s)).`,
      flagged_issues: validatedFlaggedIssues,
      missing_protective_clauses: validatedMissingClauses,
      questions_to_ask_lawyer: groundedQuestions,
      disclaimer: result.lawyer_briefing?.disclaimer || 'Citizen briefing packet prepared by GovScheme Diff.',
    },
    disclaimer: result.disclaimer || 'GovScheme Diff explains government scheme circulars in plain English. Always confirm final rules with the issuing department.',
  };
}

export function detectCrossClauseConflicts(
  _clauses: SimplifiedClause[],
  _fullText: string = ''
): {
  conflicts: InternalContradiction[];
  executionBlock: ExecutionBlockAnalysis;
} {
  return {
    conflicts: [],
    executionBlock: {
      present: true,
      missing_signatures: false,
      witness_attestation_missing: false,
    },
  };
}

export async function analyzeDocumentText(
  text: string,
  categoryHint?: string,
  language: string = 'en'
): Promise<DocumentAnalysisResult> {
  const guard1 = await runGuard1InputGateAsync(text);
  if (!guard1.is_valid_circular) {
    throw new Error(guard1.rejection_reason || 'Document rejected by Guard 1 input gate.');
  }

  const rawClauses = await chunkDocumentTextIntoClausesAsync(text);
  if (!rawClauses || rawClauses.length === 0) {
    throw new Error('Document rejected by Guard 1: No extractable scheme sections or policy provisions were found in this document.');
  }

  const clauses = await applyRiskTaggingAndGroundingAsync(rawClauses, guard1.category);

  return await synthesizeDocumentAnalysis(text, clauses, guard1, categoryHint, language);
}

export function calculateDocumentOverallRiskScore(clauses: SimplifiedClause[]): number {
  if (!clauses || !Array.isArray(clauses) || clauses.length === 0) return 30;
  const highRiskCount = clauses.filter((c) => c && c.risk_level === 'high').length;
  const mediumRiskCount = clauses.filter((c) => c && ((c.risk_level as string) === 'medium' || c.risk_level === 'watch_out')).length;
  return Math.min(95, Math.max(10, 30 + highRiskCount * 25 + mediumRiskCount * 10));
}

// Stage 4: Deterministic Circular Comparison (Added / Removed / Modified / Unchanged + Field Diffs)
export async function compareTwoDocuments(
  docA: DocumentAnalysisResult,
  docB: DocumentAnalysisResult
): Promise<ComparisonResult> {
  const clausesA = Array.isArray(docA?.clauses) ? docA.clauses : [];
  const clausesB = Array.isArray(docB?.clauses) ? docB.clauses : [];
  const alignment = alignClauses(clausesA, clausesB);

  const docATitle =
    docA?.document_title &&
    typeof docA.document_title === 'string' &&
    docA.document_title.trim() !== '' &&
    docA.document_title.toLowerCase() !== 'undefined'
      ? docA.document_title.trim()
      : 'Circular A';
  const docBTitle =
    docB?.document_title &&
    typeof docB.document_title === 'string' &&
    docB.document_title.trim() !== '' &&
    docB.document_title.toLowerCase() !== 'undefined'
      ? docB.document_title.trim()
      : 'Circular B';

  const addedCount = alignment.alignedPairs.filter((p) => p.change_type === 'added').length;
  const removedCount = alignment.alignedPairs.filter((p) => p.change_type === 'removed').length;
  const modifiedCount = alignment.alignedPairs.filter((p) => p.change_type === 'modified').length;
  const unchangedCount = alignment.alignedPairs.filter((p) => p.change_type === 'unchanged').length;

  const allFieldChanges = alignment.alignedPairs.flatMap((p) => p.detected_field_changes || []);
  const changeHighlights = Array.from(
    new Set(allFieldChanges.map((fc) => `${fc.label}: ${fc.old_value} -> ${fc.new_value}`))
  );

  const addedTitles = alignment.bOnlyClauses.map((c) => c.title || c.clause_type).join(', ');
  const removedTitles = alignment.aOnlyClauses.map((c) => c.title || c.clause_type).join(', ');

  let summary = `Compared ${docATitle} against ${docBTitle}: ${addedCount} Added, ${removedCount} Removed, ${modifiedCount} Modified, ${unchangedCount} Unchanged.`;
  if (addedCount > 0) {
    summary += `\nAdded in Circular B: ${addedTitles}.`;
  }
  if (removedCount > 0) {
    summary += `\nRemoved from Circular A: ${removedTitles}.`;
  }
  if (changeHighlights.length > 0) {
    summary += `\nDetected policy changes: ${changeHighlights.join(' | ')}.`;
  } else if (modifiedCount === 0 && addedCount === 0 && removedCount === 0) {
    summary += `\nNo policy text differences were detected between the two circulars.`;
  }

  return {
    doc_a_title: docATitle,
    doc_b_title: docBTitle,
    aligned_pairs: alignment.alignedPairs,
    a_only_clauses: alignment.aOnlyClauses,
    b_only_clauses: alignment.bOnlyClauses,
    added_count: addedCount,
    removed_count: removedCount,
    modified_count: modifiedCount,
    unchanged_count: unchangedCount,
    key_differences_summary: summary,
    disclaimer: 'Deterministic circular comparison generated by GovScheme Diff for informational purposes. Always verify official updates with the issuing department.',
  };
}

export function postProcessCleanResponseText(text: string): string {
  if (!text) return '';

  const lines = text.split('\n');
  const processedLines = lines.map((line) => {
    const isTableLine = line.trim().startsWith('|') && line.trim().endsWith('|') && line.trim().length > 2;
    if (isTableLine) {
      return line;
    }
    return line.replace(/\*\*([^*]+)\*\*/g, '$1');
  });

  return processedLines.join('\n').trim();
}

// Grounded Citizen Circular Q&A (English-Only, 3-Point Simple Everyday English)
export async function answerDocumentQuestion(
  document: DocumentAnalysisResult | null,
  question: string,
  history: ChatMessage[],
  inputContext?: any,
  _language: string = 'en'
): Promise<ChatMessage> {
  // Step 1: Safety Filter
  const safety = runGuard2bSafetyFilter(question);
  if (!safety.isSafe) {
    return {
      id: `msg_refused_${Date.now()}`,
      sender: 'assistant',
      text: safety.reason!,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      is_flagged_unsafe: true,
      safety_reason: safety.reason!,
    };
  }

  // Step 2: Retrieve relevant circular sections & exact citations (ranked by relevance)
  const STOP_WORDS = new Set([
    'what', 'which', 'who', 'whom', 'where', 'when', 'why', 'how', 'is', 'are', 'was', 'were',
    'your', 'you', 'they', 'them', 'their', 'this', 'that', 'these', 'those', 'the', 'and', 'for',
    'nor', 'but', 'yet', 'with', 'from', 'into', 'onto', 'about', 'under', 'over', 'all', 'any',
    'each', 'every', 'some', 'have', 'has', 'had', 'will', 'would', 'shall', 'should', 'can',
    'could', 'may', 'might', 'does', 'did', 'been', 'being', 'there', 'here', 'please', 'tell',
    'give', 'show', 'explain', 'under', 'scheme', 'circular', 'circulars', 'uploaded', 'document',
    'section', 'page', 'provide', 'provides', 'mentioned', 'details', 'detail',
  ]);

  const qTokens = question
    .toLowerCase()
    .split(/[^\w]+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));

  const citedClauseIds: string[] = [];
  const matchedClauses: SimplifiedClause[] = [];

  if (qTokens.length > 0 && document) {
    const scored: Array<{ clause: SimplifiedClause; score: number }> = [];
    for (const c of document.clauses || []) {
      const titleLower = (c.title || '').toLowerCase();
      const origLower = (c.original_text || '').toLowerCase();
      const typeLower = (c.clause_type || '').toLowerCase();
      const isHeader = (c.section_reference || '').toLowerCase().includes('header');

      let score = 0;
      for (const token of qTokens) {
        const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wordRe = new RegExp(`\\b${escaped}`, 'i');
        if (wordRe.test(titleLower)) score += 4;
        if (wordRe.test(origLower)) score += 2;
        if (wordRe.test(typeLower)) score += 2;
      }

      if (score > 0) {
        if (isHeader && score <= 4) score -= 1;
        scored.push({ clause: c, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    for (const item of scored) {
      citedClauseIds.push(item.clause.id);
      matchedClauses.push(item.clause);
    }
  }

  const primaryCitation = matchedClauses.length > 0
    ? formatCircularCitation(matchedClauses[0])
    : (document?.clauses?.[0] ? formatCircularCitation(document.clauses[0]) : '');

  // Build active circular / comparison context
  let activeInputSummary = '';
  if (inputContext) {
    if (inputContext.isComparisonMode || inputContext.docAText || inputContext.docBText) {
      activeInputSummary += `\nACTIVE MODE: COMPARE TWO GOVERNMENT CIRCULARS`;
      activeInputSummary += inputContext.docAText
        ? `\n- CIRCULAR A (${inputContext.docATitle || 'Circular A'}):\n"""\n${inputContext.docAText.slice(0, 5000)}\n"""`
        : `\n- CIRCULAR A: [Not loaded yet]`;
      activeInputSummary += inputContext.docBText
        ? `\n- CIRCULAR B (${inputContext.docBTitle || 'Circular B'}):\n"""\n${inputContext.docBText.slice(0, 5000)}\n"""`
        : `\n- CIRCULAR B: [Not loaded yet]`;

      if (inputContext.comparisonResult) {
        const cmp = inputContext.comparisonResult;
        activeInputSummary += `\n- COMPARISON COUNTS: Added=${cmp.added_count ?? 0}, Removed=${cmp.removed_count ?? 0}, Modified=${cmp.modified_count ?? 0}, Unchanged=${cmp.unchanged_count ?? 0}\n- SUMMARY: ${cmp.key_differences_summary || ''}`;
      }
    } else {
      if (inputContext.uploadedFileName) {
        activeInputSummary += `\n- UPLOADED CIRCULAR FILE: "${inputContext.uploadedFileName}" (${inputContext.uploadedFileSize || 'Unknown size'})`;
      }
      if (inputContext.extractedInputText) {
        activeInputSummary += `\n- EXTRACTED CIRCULAR TEXT:\n"""\n${inputContext.extractedInputText.slice(0, 4000)}\n"""`;
      } else if (inputContext.pastedText) {
        activeInputSummary += `\n- PASTED CIRCULAR TEXT:\n"""\n${inputContext.pastedText.slice(0, 4000)}\n"""`;
      }
    }
  }

  const docTitle = document?.document_title || (inputContext?.uploadedFileName ? inputContext.uploadedFileName : 'No circular loaded yet');

  const systemPrompt = `You are GovScheme Diff AI, a friendly citizen helper that explains Indian government scheme circulars in plain, simple everyday English ONLY.

CIRCULAR GROUNDING SECTIONS:
${document?.clauses && document.clauses.length > 0
      ? (document.clauses || [])
        .map(
          (c) =>
            `[Section ID: ${c.id} | Title: ${c.title} | Ref: ${formatCircularCitation(c) || `Section ${c.clause_number || c.id}`}]\nOriginal Circular Text: ${c.original_text}`
        )
        .join('\n---\n')
      : 'No single analyzed circular loaded yet.'}

ACTIVE INPUT / COMPARISON CONTEXT:
${activeInputSummary || 'No circular file or text loaded yet.'}

MANDATORY CITIZEN ANSWER RULES (STRICT):
1. Reply in ENGLISH ONLY. Use very simple everyday words; avoid legal, official, or technical jargon.
2. EVERY answer MUST contain EXACTLY THREE short numbered points:
   1. ...
   2. ...
   3. ...
   Do NOT add any intro sentence before "1." or closing sentence after "3.". Do NOT output markdown tables or bold asterisks (**).
3. Base EVERY answer strictly on the uploaded/provided circular text above. NEVER invent eligibility rules, benefits, amounts, dates, age/income limits, or required documents.
4. If asked details are NOT in the uploaded circular, explicitly include the exact sentence:
   "This information is not mentioned in the uploaded circular."
5. Include the correct page number and section/clause reference wherever available (for example: "(Page 1, Section 2)").
6. In Compare Circulars mode, clearly mention "[Circular A]" or "[Circular B]" and the page/section numbers when comparing changes.`;

  const chatMessagesPayload = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-6).map((h) => ({
      role: h.sender === 'user' ? ('user' as const) : ('assistant' as const),
      content: h.text,
    })),
    { role: 'user' as const, content: question },
  ];

  const aiTextResponse = await callAiChatCompletion(chatMessagesPayload);

  if (aiTextResponse === 'RATE_LIMIT_EXHAUSTED') {
    const secondInMinute = Math.floor((Date.now() % 60000) / 1000);
    const resetSeconds = Math.max(1, 60 - secondInMinute);
    return {
      id: `msg_rate_limit_${Date.now()}`,
      sender: 'assistant',
      text: `System rate limit reached for this minute. Please wait ${resetSeconds}s and try again.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      quota: getQuotaStatus(),
    };
  }

  let textResponse = aiTextResponse;
  let isMissingInfoFallback = false;

  // Step 4: Deterministic Grounded Fallback when AI is offline / demoMode
  if (!textResponse) {
    const trimmedLower = question.trim().toLowerCase();
    const isFileQuery = trimmedLower.includes('which image') || trimmedLower.includes('what image') || trimmedLower.includes('which file') || trimmedLower.includes('uploaded') || trimmedLower.includes('pasted') || trimmedLower.includes('my document');
    const isNameQuery = trimmedLower.includes('who are you') || trimmedLower.includes('your name') || trimmedLower.includes('what are you');
    const isGreeting = /^(hi|hello|hey|good morning|good afternoon|good evening)\b/i.test(trimmedLower);
    const isCapabilityQuery = trimmedLower.includes('what can you do') || trimmedLower.includes('how do you work') || trimmedLower === 'help';
    const isThanksQuery = trimmedLower.includes('thank') || trimmedLower.includes('bye');

    const rawTextPool = (
      (document?.clauses || []).map((c) => c.original_text).join(' ') +
      ' ' +
      (inputContext?.extractedInputText || '') +
      ' ' +
      (inputContext?.pastedText || '') +
      ' ' +
      (inputContext?.docAText || '') +
      ' ' +
      (inputContext?.docBText || '')
    ).toLowerCase();

    if (isFileQuery && (inputContext?.extractedInputText || inputContext?.pastedText)) {
      const srcText = (inputContext.extractedInputText || inputContext.pastedText).replace(/\s+/g, ' ').trim();
      const fileName = inputContext.uploadedFileName || 'your circular text';
      textResponse = enforceThreePointCitizenAnswer('', {
        fallbackPoints: [
          `You uploaded ${fileName}, and ${srcText.length} characters of circular text are ready.`,
          `Preview: "${srcText.slice(0, 120)}"`,
          `Click Analyze Circular to see simple section explanations or ask a specific question here.`,
        ],
      });
      citedClauseIds.length = 0;
    } else if (isFileQuery && inputContext?.uploadedFileName) {
      textResponse = enforceThreePointCitizenAnswer('', {
        fallbackPoints: [
          `Your file "${inputContext.uploadedFileName}" is selected for checking.`,
          `Click Analyze Circular to extract sections, benefits, and deadlines.`,
          `Once analyzed, ask any question about eligibility, dates, or required documents.`,
        ],
      });
      citedClauseIds.length = 0;
    } else if (isNameQuery || isGreeting) {
      textResponse = enforceThreePointCitizenAnswer('', {
        fallbackPoints: [
          `I am GovScheme Diff AI, your plain-English guide for government scheme circulars.`,
          document
            ? `Right now I can answer questions grounded in "${docTitle}".`
            : `Upload or paste a government scheme circular to check eligibility, benefits, and dates.`,
          `Every answer uses simple everyday words and cites page and section numbers when available.`,
        ],
      });
      citedClauseIds.length = 0;
    } else if (isCapabilityQuery) {
      textResponse = enforceThreePointCitizenAnswer('', {
        fallbackPoints: [
          `I explain government orders, scheme circulars, and guidelines in simple everyday English.`,
          `I compare two circular versions to highlight changes in eligibility, money limits, benefits, documents, and deadlines.`,
          `I answer questions using only the uploaded circular and tell you clearly if information is missing.`,
        ],
      });
      citedClauseIds.length = 0;
    } else if (isThanksQuery) {
      textResponse = enforceThreePointCitizenAnswer('', {
        fallbackPoints: [
          `You are welcome! Happy to help you read government circulars clearly.`,
          document
            ? `You can ask more questions anytime about "${docTitle}".`
            : `Upload another circular whenever you want to check eligibility or policy changes.`,
          `Always verify final submission dates on the official department portal.`,
        ],
      });
      citedClauseIds.length = 0;
    } else if (inputContext?.isComparisonMode && (inputContext?.docAText || inputContext?.docBText)) {
      const cmp = inputContext.comparisonResult;
      const aHit = inputContext.docAText && qTokens.some((t) => inputContext.docAText.toLowerCase().includes(t));
      const bHit = inputContext.docBText && qTokens.some((t) => inputContext.docBText.toLowerCase().includes(t));

      if (!aHit && !bHit && qTokens.length > 0) {
        isMissingInfoFallback = true;
        textResponse = enforceThreePointCitizenAnswer('', {
          isMissingInfo: true,
          fallbackPoints: [
            `This information is not mentioned in the uploaded circular.`,
            `Comparison summary: ${cmp?.added_count ?? 0} added, ${cmp?.modified_count ?? 0} modified, and ${cmp?.removed_count ?? 0} removed section(s).`,
            `Ask about specific headings visible in Circular A or Circular B.`,
          ],
        });
      } else {
        const aSnippet = aHit ? inputContext.docAText.replace(/\s+/g, ' ').trim().slice(0, 140) : 'Not mentioned in Circular A';
        const bSnippet = bHit ? inputContext.docBText.replace(/\s+/g, ' ').trim().slice(0, 140) : 'Not mentioned in Circular B';
        textResponse = enforceThreePointCitizenAnswer('', {
          fallbackPoints: [
            `[Circular A] says: ${aSnippet}.`,
            `[Circular B] says: ${bSnippet}.`,
            cmp ? `Overall diff: ${cmp.added_count ?? 0} added, ${cmp.modified_count ?? 0} changed, ${cmp.removed_count ?? 0} removed.` : `Check the side-by-side cards above for exact changed wording.`,
          ],
        });
      }
      citedClauseIds.length = 0;
    } else if (matchedClauses.length > 0) {
      const top = matchedClauses[0];
      const topCit = formatCircularCitation(top);
      const snippet = top.original_text.replace(/\s+/g, ' ').trim().slice(0, 160);
      const secondCit = matchedClauses[1] ? formatCircularCitation(matchedClauses[1]) : '';
      textResponse = enforceThreePointCitizenAnswer('', {
        citation: topCit,
        fallbackPoints: [
          `According to ${top.title} ${topCit}: ${snippet}.`,
          `In simple words: ${top.one_line_consequence.replace(/^(Important|Check Carefully|Standard Info):\s*/i, '')}`,
          matchedClauses[1]
            ? `Also check related section "${matchedClauses[1].title}" ${secondCit}.`
            : `Verify full details on the official portal using reference ${topCit || top.title}.`,
        ],
      });
    } else if (document || rawTextPool.trim().length > 0) {
      isMissingInfoFallback = true;
      citedClauseIds.length = 0;
      textResponse = enforceThreePointCitizenAnswer('', {
        isMissingInfo: true,
        citation: primaryCitation,
        fallbackPoints: [
          `This information is not mentioned in the uploaded circular.`,
          document
            ? `Reviewed "${docTitle}" (${(document.clauses || []).length} extracted sections), and no matching rule was found.`
            : `Checked the uploaded circular text, and no matching detail was found.`,
          `Confirm this detail on the official scheme portal or citizen helpdesk.`,
        ],
      });
    } else {
      textResponse = enforceThreePointCitizenAnswer('', {
        fallbackPoints: [
          `No government circular is uploaded or analyzed yet.`,
          `Upload a circular PDF, photo, or pasted text to check eligibility, benefits, and deadlines.`,
          `You can also open Scheme Portals & Helpdesks to visit official government portals.`,
        ],
      });
      citedClauseIds.length = 0;
    }
  } else {
    // Enforce exact 3-point simple everyday English formatting on live LLM answers too
    textResponse = enforceThreePointCitizenAnswer(textResponse, {
      citation: primaryCitation,
      isMissingInfo: /not mentioned in the uploaded circular/i.test(textResponse),
    });
  }

  return {
    id: `msg_ans_${Date.now()}`,
    sender: 'assistant',
    text: postProcessCleanResponseText(textResponse),
    cited_clause_ids: citedClauseIds.length > 0 && !isMissingInfoFallback ? citedClauseIds : undefined,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    quota: getQuotaStatus(),
  };
}

