import mongoose, { Document, Schema } from 'mongoose';

export type CircularSourceType = 'upload' | 'paste' | 'camera' | 'api';

export interface ICircular extends Document {
  circularKey: string;
  title: string;
  circularNumber: string;
  issuingAuthority: string;
  category: string;
  documentKind: string;
  sourceType: CircularSourceType;
  sourceFilename: string;
  mimeType: string;
  latestVersionNumber: number;
  latestVersionId: mongoose.Types.ObjectId | null;
  totalVersions: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICircularSectionSnapshot {
  id: string;
  clause_number?: string;
  clause_type: string;
  title: string;
  original_text: string;
  page_number?: number;
  section_reference?: string;
  simple_explanation?: string | null;
  very_simple_explanation?: string | null;
  risk_level: string;
  icon_name: string;
  one_line_consequence: string;
}

export interface ICircularVersion extends Document {
  circularId: mongoose.Types.ObjectId;
  parentCircularId: mongoose.Types.ObjectId | null;
  parentVersionId: mongoose.Types.ObjectId | null;
  isAmendment: boolean;
  versionNumber: number;
  contentHash: string;
  title: string;
  circularNumber: string;
  issuingAuthority: string;
  category: string;
  documentKind: string;
  sourceType: CircularSourceType;
  sourceFilename: string;
  mimeType: string;
  extractedText: string;
  pageCount: number;
  sections: ICircularSectionSnapshot[];
  analysisResult: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface IComparisonHistory extends Document {
  pairHash: string;
  docATitle: string;
  docBTitle: string;
  circularAId: mongoose.Types.ObjectId | null;
  circularBId: mongoose.Types.ObjectId | null;
  versionAId: mongoose.Types.ObjectId | null;
  versionBId: mongoose.Types.ObjectId | null;
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  unchangedCount: number;
  keyDifferencesSummary: string;
  alignedPairs: Record<string, any>[];
  comparisonResult: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const CircularSchema = new Schema<ICircular>(
  {
    circularKey: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true, trim: true },
    circularNumber: { type: String, default: '', index: true },
    issuingAuthority: { type: String, default: '' },
    category: { type: String, required: true, index: true },
    documentKind: { type: String, default: 'scheme_circular' },
    sourceType: { type: String, enum: ['upload', 'paste', 'camera', 'api'], default: 'paste' },
    sourceFilename: { type: String, default: '' },
    mimeType: { type: String, default: '' },
    latestVersionNumber: { type: Number, default: 1, min: 1 },
    latestVersionId: { type: Schema.Types.ObjectId, ref: 'CircularVersion', default: null },
    totalVersions: { type: Number, default: 1, min: 1 },
  },
  {
    collection: 'circulars',
    timestamps: true,
  }
);

const CircularSectionSchema = new Schema<ICircularSectionSnapshot>(
  {
    id: { type: String, required: true },
    clause_number: { type: String, default: '' },
    clause_type: { type: String, required: true },
    title: { type: String, required: true },
    original_text: { type: String, required: true },
    page_number: { type: Number, default: 1 },
    section_reference: { type: String, default: '' },
    simple_explanation: { type: String, default: null },
    very_simple_explanation: { type: String, default: null },
    risk_level: { type: String, default: 'low' },
    icon_name: { type: String, default: 'CheckCircle' },
    one_line_consequence: { type: String, default: '' },
  },
  { _id: false }
);

const CircularVersionSchema = new Schema<ICircularVersion>(
  {
    circularId: { type: Schema.Types.ObjectId, ref: 'Circular', required: true, index: true },
    parentCircularId: { type: Schema.Types.ObjectId, ref: 'Circular', default: null, index: true },
    parentVersionId: { type: Schema.Types.ObjectId, ref: 'CircularVersion', default: null },
    isAmendment: { type: Boolean, default: false },
    versionNumber: { type: Number, required: true, min: 1 },
    contentHash: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true, trim: true },
    circularNumber: { type: String, default: '' },
    issuingAuthority: { type: String, default: '' },
    category: { type: String, required: true },
    documentKind: { type: String, default: 'scheme_circular' },
    sourceType: { type: String, enum: ['upload', 'paste', 'camera', 'api'], default: 'paste' },
    sourceFilename: { type: String, default: '' },
    mimeType: { type: String, default: '' },
    extractedText: { type: String, required: true },
    pageCount: { type: Number, default: 1, min: 1 },
    sections: { type: [CircularSectionSchema], default: [] },
    analysisResult: { type: Schema.Types.Mixed, required: true },
  },
  {
    collection: 'circular_versions',
    timestamps: true,
  }
);

CircularVersionSchema.index({ circularId: 1, versionNumber: 1 }, { unique: true });

const ComparisonHistorySchema = new Schema<IComparisonHistory>(
  {
    pairHash: { type: String, required: true, unique: true, index: true },
    docATitle: { type: String, required: true },
    docBTitle: { type: String, required: true },
    circularAId: { type: Schema.Types.ObjectId, ref: 'Circular', default: null },
    circularBId: { type: Schema.Types.ObjectId, ref: 'Circular', default: null },
    versionAId: { type: Schema.Types.ObjectId, ref: 'CircularVersion', default: null },
    versionBId: { type: Schema.Types.ObjectId, ref: 'CircularVersion', default: null },
    addedCount: { type: Number, default: 0 },
    removedCount: { type: Number, default: 0 },
    modifiedCount: { type: Number, default: 0 },
    unchangedCount: { type: Number, default: 0 },
    keyDifferencesSummary: { type: String, default: '' },
    alignedPairs: { type: Schema.Types.Mixed, default: [] },
    comparisonResult: { type: Schema.Types.Mixed, required: true },
  },
  {
    collection: 'comparison_history',
    timestamps: true,
  }
);

export const CircularModel =
  (mongoose.models.Circular as mongoose.Model<ICircular>) ||
  mongoose.model<ICircular>('Circular', CircularSchema);

export const CircularVersionModel =
  (mongoose.models.CircularVersion as mongoose.Model<ICircularVersion>) ||
  mongoose.model<ICircularVersion>('CircularVersion', CircularVersionSchema);

export const ComparisonHistoryModel =
  (mongoose.models.ComparisonHistory as mongoose.Model<IComparisonHistory>) ||
  mongoose.model<IComparisonHistory>('ComparisonHistory', ComparisonHistorySchema);
