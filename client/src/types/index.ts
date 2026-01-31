import { z } from 'zod';

// ---------------------------------------------------------------------------
// Phase 3 AI Matching Types
// ---------------------------------------------------------------------------

export const ExtractedPatientSchema = z.object({
  age: z.number().int().nonnegative().nullable(),
  sex: z.enum(['male', 'female', 'other', 'unknown']).default('unknown'),
  cancerType: z.string().min(1).nullable(),
  stage: z.string().min(1).nullable(),
  biomarkers: z.array(z.string().min(1)).default([]),
  ecog: z.number().int().min(0).max(4).nullable(),
  labs: z.object({
    hb: z.number().nullable(),
    alt: z.number().nullable(),
    crea: z.number().nullable(),
  }),
  priorTherapies: z.array(z.string().min(1)).default([]),
  msi: z.enum(['MSI-H', 'MSS', 'MSI-L', 'unknown']).default('unknown'),
  tmb: z.number().nullable(),
  notes: z.string().nullable(),
});

export type ExtractedPatient = z.infer<typeof ExtractedPatientSchema>;

export const TrialMatchSchema = z.object({
  id: z.string(),
  title: z.string(),
  phase: z.string().nullable(),
  condition: z.string().nullable(),
  institution: z.string().nullable(),
  siteCity: z.string().nullable(),
  siteCountry: z.string().nullable(),
  matchScore: z.number().min(0).max(100),
  nctId: z.string().nullable(),
  url: z.string().url().nullable(),
  briefEligibility: z.array(z.string()),
});

export type TrialMatch = z.infer<typeof TrialMatchSchema>;

export const ApiErrorSchema = z.object({
  code: z.string().optional(),
  message: z.string(),
  details: z.unknown().optional(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

// ---------------------------------------------------------------------------
// User and Authentication Types
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt?: string;
}

export interface LoginData {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  password: string;
  name: string;
}

export interface AuthResponse {
  message: string;
  token: string;
  user: User;
}

// Medical Record Types
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface StructuredData {
  diagnosis?: string;
  stage?: string;
  mutations?: string[];
  age?: number;
  gender?: string;
  previousTreatments?: string[];
  biomarkers?: Record<string, JsonValue>;
  performanceStatus?: string;
  [key: string]: JsonValue | undefined;
}

export interface ClinicalArchive {
  patient_id: string;
  basic_info: {
    name: string;
    gender: string | null;
    age: number | null;
    date_of_birth: string;
    hospital_id: string;
    department: string;
    visit_date: string;
    ethnicity?: string;
    height_cm?: number | null;
    weight_kg?: number | null;
  };
  medical_history: {
    primary_diagnosis: string;
    onset_date: string;
    disease_course: string;
    previous_malignancies: string[];
    comorbidities: string[];
    metastasis_sites?: string[];
    infection_status: {
      HBV: string;
      HCV: string;
      HIV: string;
    };
  };
  treatment_history: Array<{
    date: string;
    therapy_type: 'surgery' | 'chemo' | 'immunotherapy' | 'targeted' | 'radiotherapy' | 'TKI' | 'other';
    drug_or_procedure: string;
    cycles_or_dose: string;
    response_evaluation: 'PR' | 'SD' | 'PD' | 'CR' | 'NA' | 'NE' | string;
    side_effects: string;
  }>;
  pathology: {
    date: string;
    specimen: string;
    histology: string;
    grade: string;
    stage: string;
    molecular_markers: {
      'PD-L1': string;
      MSI_status: string;
      TMB: string;
      others: Record<string, JsonValue>;
    };
  };
  imaging_findings: Array<{
    date: string;
    modality: 'CT' | 'MRI' | 'PET-CT' | 'US' | 'other' | string;
    lesions: Array<{
      location: string;
      size_mm: string | number;
      SUVmax: string | number;
      progression: 'increase' | 'decrease' | 'stable' | string;
    }>;
  }>;
  lab_results: {
    date: string;
    blood_counts: {
      WBC: string | number;
      Neutrophils: string | number;
      Platelets: string | number;
      Hemoglobin: string | number;
    };
    liver_function: {
      ALT: string | number;
      AST: string | number;
      TBIL: string | number;
      Albumin: string | number;
    };
    renal_function: {
      Creatinine: string | number;
      Urea: string | number;
    };
    tumor_markers: {
      AFP: string | number;
      CEA: string | number;
      CA199: string | number;
      'PIVKA-II': string | number;
      [marker: string]: JsonValue;
    };
  };
  ecog_score: string | number | null;
  current_status: {
    measurable_lesions: boolean | null;
    organ_function_ok: boolean | null;
    estimated_survival_months: string | number | null;
    symptoms: string[];
  };
  trial_eligibility: {
    inclusion_met: string[];
    exclusion_triggered: string[];
    overall_judgment: 'eligible' | 'not eligible' | 'uncertain';
  };
  _meta?: {
    fields?: Record<string, JsonValue>;
    sources?: JsonValue[];
  };
}

export interface LLMIntegrationData {
  correctedText?: string;
  fullStructuredData?: Record<string, JsonValue>;
  timeline?: string;
  metadata?: Record<string, JsonValue>;
  clinicalArchive?: ClinicalArchive | null;
}

export interface OCRMetadata {
  provider?: string;
  confidence?: number;
  processingTime?: number;
  apiRequestId?: string;
  templateType?: 'general' | 'medical' | 'mixed';
  pageCount?: number;
  processedAt?: string;
  totalCost?: number;
  errorMessage?: string;
  isMultipleFiles?: boolean;
  pages?: Array<{
    page: number;
    confidence: number;
    content: string;
  }>;
}

export interface MedicalRecord {
  _id: string;
  userId: string;
  patientId?: string;
  originalFileName?: string;
  extractedText?: string;
  structuredData?: StructuredData;
  clinicalArchive?: ClinicalArchive | null;
  llmIntegrationData?: LLMIntegrationData;
  multipleFiles?: {
    fileCount: number;
    fileDetails: Array<{
      fileName: string;
      fileId: string;
      confidence: number;
      pageCount: number;
    }>;
  };
  ocrMetadata?: OCRMetadata;
  uploadDate: string;
  matchResults?: LegacyTrialMatch[];
}

// Clinical Trial Types
export interface ContactInfo {
  name?: string;
  phone?: string;
  email?: string;
}

export type EligibilityResult = '满足' | '不满足' | '可能不满足' | '不确定';

export interface EligibilityCheck {
  criterion: string;
  patient_value: string;
  result: EligibilityResult;
}

export interface MatchSummary {
  inclusion_met: string[];
  exclusion_triggered: string[];
  uncertain: string[];
}

export interface MatchProviderMetadata {
  provider?: string;
  model?: string;
  error?: string;
  source?: string;
  totalTrials?: number;
  matchedTrials?: number;
  processingTime?: number;
  matchedAt?: string;
  note?: string;
  processingJobId?: string | number | null;
  restoredFrom?: string;
  algorithmVersion?: string;
  batchSize?: number;
  totalBatches?: number;
  completedBatches?: number;
  processedTrials?: number;
  remainingTrials?: number;
  lastBatchNumber?: number;
  lastBatchCompletedAt?: string;
  hasMore?: boolean;
  batchTimeline?: Array<Record<string, JsonValue>>;
  [key: string]: unknown;
}

export interface MatchBatchDetails {
  number: number;
  total: number;
  size: number;
  processedTrials: number;
  remainingTrials: number;
  durationMs: number;
  hasMore: boolean;
}

export interface MatchBatchResponse {
  batch: MatchBatchDetails;
  matches: LegacyTrialMatch[];
  aggregatedMatches: LegacyTrialMatch[];
  metadata: MatchProviderMetadata;
}

export interface MatchHistoryEntry {
  _id: string;
  createdAt: string;
  matches: LegacyTrialMatch[];
  metadata?: MatchProviderMetadata | Record<string, JsonValue> | null;
}

export interface ClinicalTrial {
  _id: string;
  trialId: string;
  title: string;
  location?: string;
  phase?: string;
  condition?: string;
  sponsor?: string;
  inclusionCriteria?: string[];
  exclusionCriteria?: string[];
  targetMutations?: string[];
  ageRange?: {
    min: number;
    max: number;
  };
  gender?: string;
  status?: 'recruiting' | 'active' | 'completed' | 'suspended';
  estimatedEnrollment?: number;
  contactInfo?: ContactInfo;
  structuredEligibility?: {
    inclusion?: Array<Record<string, JsonValue>>;
    exclusion?: Array<Record<string, JsonValue>>;
  };
  eligibilityLastSyncedAt?: string;
}

// Trial Matching Types
export interface LegacyTrialMatch {
  trial_id: string;
  trial_title: string;
  match_score: number;
  inclusion_checks: EligibilityCheck[];
  exclusion_checks: EligibilityCheck[];
  summary: MatchSummary;
  rank_reason?: string;
  trial_metadata?: Partial<ClinicalTrial> & Record<string, JsonValue>;
}

export interface MatchResponse {
  matches: LegacyTrialMatch[];
  provider?: MatchProviderMetadata;
}

// API Response Types
export interface ApiResponse<T = unknown> {
  message: string;
  data?: T;
}

export interface UploadResponse {
  message: string;
  recordId: string;
  extractedText: string;
  confidence?: number;
  processingTime?: number;
}

export interface ParseResponse {
  message: string;
  recordId: string;
  structuredData: StructuredData;
  llmIntegrationData?: LLMIntegrationData;
}

// Form Types
export interface UploadFormData {
  files?: FileList;
  manualText?: string;
  useLLM?: boolean;
}

export type EditRecordFormData = StructuredData;
