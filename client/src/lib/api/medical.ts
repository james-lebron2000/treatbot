import { apiClient, unwrapResponse, API_BASE_URL } from '@/lib/api';
import {
  ClinicalArchive,
  JsonValue,
  MatchProviderMetadata,
  MatchResponse,
  MedicalRecord,
  StructuredData,
  LegacyTrialMatch,
  MatchHistoryEntry,
  MatchBatchResponse,
  MatchBatchDetails
} from '@/types';

type FieldPromptType = 'string' | 'number' | 'boolean' | 'array';

export type FieldPromptConfig =
  | string
  | {
      key: string;
      prompt?: string;
      type?: FieldPromptType;
    };

export interface FieldExtractionEntry {
  key: string;
  value: JsonValue;
  rawValue: JsonValue;
  confidence?: string;
  evidence?: string;
  reasoning?: string;
  prompt?: string;
  model?: string;
  error?: string;
}

export interface FieldExtractionResponse {
  success: boolean;
  entries: Record<string, FieldExtractionEntry>;
  structuredData: Record<string, JsonValue>;
  metadata?: Record<string, JsonValue>;
  record?: { id: string; structuredData: Record<string, JsonValue> } | null;
  message?: string;
  clinicalArchive?: ClinicalArchive | null;
}

type ParseTextResponse = {
  recordId?: string;
  message?: string;
  structuredData?: StructuredData | Record<string, JsonValue> | null;
  clinicalArchive?: ClinicalArchive | null;
  [key: string]: JsonValue | StructuredData | ClinicalArchive | null | undefined;
};

export interface LLMIntegrationResponse {
  correctedText: string;
  structuredData: StructuredData | Record<string, JsonValue> | null;
  clinicalArchive?: ClinicalArchive | null;
  timeline?: string | null;
  metadata?: Record<string, JsonValue>;
  message?: string;
}

export type MatchGeoFilter = {
  mode?: 'national' | 'province' | 'city';
  provinces?: string[];
  cities?: string[];
};

export type MatchFilters = {
  geo?: MatchGeoFilter;
  statuses?: Array<'recruiting' | 'active' | 'completed' | 'suspended'>;
};

export interface UploadFilesResponse {
  message?: string;
  fileId?: string;
  extractedText?: string;
  text?: string;
  combinedText?: string;
  ocrMetadata?: Record<string, JsonValue>;
  results?: Array<Record<string, JsonValue>>;
  overallMetadata?: Record<string, JsonValue>;
}

const processMatchBatchRequest = async (recordId: string, data: { restart?: boolean; batchSize?: number } = {}): Promise<MatchBatchResponse> => {
  const response = await apiClient.post(`/medical/match/${recordId}/batch`, data);
  const { data: payload } = unwrapResponse<MatchBatchResponse>(response);
  return {
    batch: payload?.batch || { number: 0, total: 0, size: 0, processedTrials: 0, remainingTrials: 0, durationMs: 0, hasMore: false },
    matches: Array.isArray(payload?.matches) ? payload.matches : [],
    aggregatedMatches: Array.isArray(payload?.aggregatedMatches) ? payload.aggregatedMatches : [],
    metadata: (payload?.metadata as MatchProviderMetadata) || {}
  };
};

const getMatchStatusRequest = async (recordId: string): Promise<{ metadata: MatchProviderMetadata | null; matches: LegacyTrialMatch[]; session: { totalCandidates: number; completed: number; batchSize: number | null } | null }> => {
  const response = await apiClient.get(`/medical/match/${recordId}/status`);
  const { data: payload } = unwrapResponse<{ metadata?: MatchProviderMetadata | null; matches?: LegacyTrialMatch[]; session?: { totalCandidates: number; completed: number; batchSize: number | null } | null }>(response);
  return {
    metadata: (payload?.metadata as MatchProviderMetadata | null) || null,
    matches: Array.isArray(payload?.matches) ? payload?.matches : [],
    session: payload?.session || null
  };
};

const getStoredAuthToken = (): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = localStorage.getItem('auth-storage');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const token = parsed?.state?.token;
    return typeof token === 'string' ? token : null;
  } catch (error) {
    console.error('Failed to parse auth token for streaming request', error);
    return null;
  }
};

const resolveStreamBase = (): string => {
  const candidate = apiClient.defaults.baseURL || API_BASE_URL;
  if (/^https?:\/\//i.test(candidate)) {
    return candidate.replace(/\/$/, '');
  }
  if (typeof window !== 'undefined') {
    const prefix = candidate.startsWith('/') ? '' : '/';
    return `${window.location.origin}${prefix}${candidate}`.replace(/\/$/, '');
  }
  return candidate.replace(/\/$/, '');
};

const buildStreamUrl = (recordId: string, jobId: string, token: string | null): string => {
  const base = resolveStreamBase();
  const url = new URL(`${base}/medical/match/${recordId}/stream`);
  url.searchParams.set('jobId', jobId);
  if (token) {
    url.searchParams.set('token', token);
  }
  return url.toString();
};

type MatchInitialEvent = {
  jobId: string;
  status: string;
  metadata: MatchProviderMetadata | null;
  matches: LegacyTrialMatch[];
};

type MatchBatchEvent = {
  jobId: string;
  batch: MatchBatchDetails;
  matches: LegacyTrialMatch[];
  aggregatedMatches: LegacyTrialMatch[];
  metadata: MatchProviderMetadata;
};

type MatchCompleteEvent = {
  jobId: string;
  metadata: MatchProviderMetadata | null;
  aggregatedMatches?: LegacyTrialMatch[];
};

type MatchErrorEvent = {
  jobId: string;
  error: string;
};

type MatchCancelledEvent = {
  jobId: string;
  reason?: string;
};

export interface MatchStreamHandlers {
  onInitial?: (payload: MatchInitialEvent) => void;
  onBatch?: (payload: MatchBatchEvent) => void;
  onComplete?: (payload: MatchCompleteEvent) => void;
  onError?: (payload: MatchErrorEvent) => void;
  onCancelled?: (payload: MatchCancelledEvent) => void;
}

export interface MatchStreamSubscription {
  source: EventSource;
  close: () => void;
}

export const medicalApi = {
  startMatchJob: async (
    recordId: string,
    options: { batchSize?: number; restart?: boolean; filters?: MatchFilters } = {}
  ): Promise<{ jobId: string; status?: string; reused?: boolean; matches: LegacyTrialMatch[]; metadata: MatchProviderMetadata | null }> => {
    const response = await apiClient.post(`/medical/match/${recordId}/start`, {
      batchSize: options.batchSize,
      restart: options.restart,
      filters: options.filters
    });
    const { data: payload } = unwrapResponse<{ jobId: string; status?: string; reused?: boolean; matches: LegacyTrialMatch[]; metadata: MatchProviderMetadata | null }>(response);
    return {
      jobId: payload?.jobId,
      status: payload?.status,
      reused: payload?.reused ?? false,
      matches: Array.isArray(payload?.matches) ? payload.matches : [],
      metadata: (payload?.metadata as MatchProviderMetadata | null) || null
    };
  },

  streamMatchJob: (recordId: string, jobId: string, handlers: MatchStreamHandlers = {}): MatchStreamSubscription | null => {
    if (typeof window === 'undefined') {
      return null;
    }

    const token = getStoredAuthToken();
    const streamUrl = buildStreamUrl(recordId, jobId, token);
    const source = new EventSource(streamUrl);

    if (handlers.onInitial) {
      source.addEventListener('initial', (event) => {
        try {
          const payload: MatchInitialEvent = JSON.parse((event as MessageEvent).data);
          handlers.onInitial?.(payload);
        } catch (error) {
          console.error('Failed to parse initial match event', error);
        }
      });
    }

    if (handlers.onBatch) {
      source.addEventListener('batch', (event) => {
        try {
          const payload: MatchBatchEvent = JSON.parse((event as MessageEvent).data);
          handlers.onBatch?.(payload);
        } catch (error) {
          console.error('Failed to parse batch match event', error);
        }
      });
    }

    if (handlers.onComplete) {
      source.addEventListener('complete', (event) => {
        try {
          const payload: MatchCompleteEvent = JSON.parse((event as MessageEvent).data);
          handlers.onComplete?.(payload);
        } catch (error) {
          console.error('Failed to parse completion match event', error);
        }
      });
    }

    if (handlers.onError) {
      source.addEventListener('error', (event) => {
        try {
          const payload: MatchErrorEvent = JSON.parse((event as MessageEvent).data);
          handlers.onError?.(payload);
        } catch (parseError) {
          console.error('Failed to parse streaming error event', parseError);
          handlers.onError?.({ jobId, error: '流式匹配发生错误' });
        }
      });
    } else {
      source.addEventListener('error', () => {
        console.warn('流式匹配发生错误');
      });
    }

    if (handlers.onCancelled) {
      source.addEventListener('cancelled', (event) => {
        try {
          const payload: MatchCancelledEvent = JSON.parse((event as MessageEvent).data);
          handlers.onCancelled?.(payload);
        } catch (error) {
          console.error('Failed to parse cancelled match event', error);
        }
      });
    }

    return {
      source,
      close: () => source.close()
    };
  },

  // Upload files and extract text via OCR
  uploadFiles: async (formData: FormData): Promise<UploadFilesResponse> => {
    try {
      const response = await apiClient.post('/medical/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      const { data, message } = unwrapResponse<UploadFilesResponse>(response);

      // Defensive: ensure we have valid data
      if (!data || typeof data !== 'object') {
        throw new Error('OCR 服务返回异常');
      }

      return { ...data, message };
    } catch (error: any) {
      // Re-throw ApiError as-is (from interceptor)
      if (error.name === 'ApiError') {
        throw error;
      }

      // Wrap other errors with user-friendly message
      throw new Error(error.message || '文件上传失败，请稍后重试。');
    }
  },

  uploadMedicalFile: async (formData: FormData): Promise<UploadFilesResponse & { success: boolean }> => {
    const payload = await medicalApi.uploadFiles(formData);
    return {
      ...payload,
      success: true,
    };
  },

  // Create a draft medical record from OCR output
  createRecordFromOCR: async (data: {
    text: string;
    patientId?: string;
    fileId?: string;
    ocrMetadata?: Record<string, JsonValue>;
    results?: Array<Record<string, JsonValue>>;
    overallMetadata?: Record<string, JsonValue>;
  }): Promise<{ recordId: string }> => {
    const response = await apiClient.post('/medical/records/from-ocr', data);
    const { data: payload } = unwrapResponse<{ recordId: string }>(response);
    return payload;
  },

  // Parse extracted text into structured medical data
  parseText: async (data: {
    text: string;
    useLLM?: boolean;
    recordId?: string;
    patientId?: string;
    ocrMetadata?: Record<string, JsonValue>;
    results?: Array<Record<string, JsonValue>>;
    overallMetadata?: Record<string, JsonValue>;
  }): Promise<ParseTextResponse> => {
    try {
      const response = await apiClient.post('/medical/parse', data);
      const { data: payload, message } = unwrapResponse<ParseTextResponse>(response);

      // Defensive: ensure we have valid data
      if (!payload || typeof payload !== 'object') {
        throw new Error('解析服务返回异常');
      }

      return message ? { ...payload, message } : payload;
    } catch (error: any) {
      if (error.name === 'ApiError') {
        throw error;
      }

      throw new Error(error.message || '病历文本解析失败，请稍后重试。');
    }
  },

  // Match patient record to clinical trials
  matchTrials: async (data: { recordId?: string; record?: StructuredData | Record<string, JsonValue>; filters?: MatchFilters; batchSize?: number; restart?: boolean }): Promise<{ matches: LegacyTrialMatch[]; provider?: MatchProviderMetadata | null; jobId?: string; status?: string; reused?: boolean; message?: string }> => {
    try {
      if (data.recordId) {
        const started = await medicalApi.startMatchJob(data.recordId, {
          batchSize: data.batchSize,
          restart: data.restart,
          filters: data.filters
        });
        return {
          matches: Array.isArray(started.matches) ? started.matches : [],
          provider: started.metadata || null,
          jobId: started.jobId,
          status: started.status || 'running',
          reused: Boolean(started.reused),
          message: started.reused ? '匹配任务已在运行（实时更新）' : '匹配任务已启动（实时更新）'
        };
      }

      const response = await apiClient.post('/medical/match/llm', {
        record: data.record,
        filters: data.filters
      }, { timeout: 120000 });
      const { data: payload, message } = unwrapResponse<MatchResponse | undefined>(response);

      // Defensive: ensure valid response
      if (!payload || typeof payload !== 'object') {
        throw new Error('匹配服务返回异常');
      }

      const matches = Array.isArray(payload?.matches) ? payload.matches : [];
      return {
        matches,
        provider: payload?.provider || null,
        status: 'completed',
        reused: false,
        message
      };
    } catch (error: any) {
      if (error.name === 'ApiError') {
        throw error;
      }

      throw new Error(error.message || '临床试验匹配失败，请稍后重试。');
    }
  },

  matchTrialsEnhanced: async (data: { structuredData: ClinicalArchive | StructuredData; patientId?: string; jobId?: string; filters?: MatchFilters }): Promise<MatchResponse> => {
    const response = await apiClient.post('/medical/match/enhanced', data, { timeout: 120000 });
    const { data: payload } = unwrapResponse<MatchResponse>(response);
    return {
      matches: Array.isArray(payload?.matches) ? payload.matches : [],
      provider: payload?.provider
    };
  },

  getMatchHistory: async (
    recordId: string,
    options: { limit?: number; cursor?: string } = {}
  ): Promise<{ history: MatchHistoryEntry[]; latest: LegacyTrialMatch[]; metadata: MatchProviderMetadata | null; nextCursor: string | null; total: number }> => {
    const params = new URLSearchParams();
    if (typeof options.limit === 'number') params.set('limit', String(options.limit));
    if (options.cursor) params.set('cursor', options.cursor);
    const qs = params.toString();
    const response = await apiClient.get(`/medical/match/history/${recordId}${qs ? `?${qs}` : ''}`);
    const { data } = unwrapResponse<{ history?: MatchHistoryEntry[]; latest?: LegacyTrialMatch[]; metadata?: MatchProviderMetadata | null; nextCursor?: string | null; total?: number }>(response);
    return {
      history: data?.history || [],
      latest: data?.latest || [],
      metadata: (data?.metadata as MatchProviderMetadata | null) || null,
      nextCursor: typeof data?.nextCursor === 'string' ? data.nextCursor : null,
      total: typeof data?.total === 'number' ? data.total : (data?.history?.length || 0)
    };
  },

  restoreMatchHistory: async (recordId: string, historyId: string): Promise<{ matches: LegacyTrialMatch[]; metadata: MatchProviderMetadata | null }> => {
    const response = await apiClient.post(`/medical/match/history/${recordId}/restore`, { historyId });
    const { data } = unwrapResponse<{ matches?: LegacyTrialMatch[]; metadata?: MatchProviderMetadata | null }>(response);
    return {
      matches: data?.matches || [],
      metadata: (data?.metadata as MatchProviderMetadata | null) || null
    };
  },
  processMatchBatch: processMatchBatchRequest,
  getMatchStatus: getMatchStatusRequest,

  extractFieldsWithLLM: async (data: {
    text: string;
    fields?: FieldPromptConfig[];
    recordId?: string;
    patientId?: string;
  }): Promise<FieldExtractionResponse> => {
    try {
      const response = await apiClient.post('/medical/extract/fields', data, { timeout: 120000 });
      const { data: payload, message } = unwrapResponse<FieldExtractionResponse>(response);

      // Defensive: ensure valid response
      if (!payload || typeof payload !== 'object') {
        throw new Error('字段抽取服务返回异常');
      }

      return { ...payload, message };
    } catch (error: any) {
      if (error.name === 'ApiError') {
        throw error;
      }

      // Return safe fallback on error
      return {
        success: false,
        entries: {},
        structuredData: {},
        metadata: {},
        message: error.message || '字段抽取失败，请稍后重试。'
      };
    }
  },

  integrateMedicalRecord: async (data: { text: string; recordId?: string }): Promise<LLMIntegrationResponse> => {
    try {
      const response = await apiClient.post('/medical/integrate', data, { timeout: 120000 });
      const { data: payload, message } = unwrapResponse<LLMIntegrationResponse>(response);

      // Defensive: ensure valid response
      if (!payload || typeof payload !== 'object') {
        throw new Error('医疗记录整合服务返回异常');
      }

      return { ...payload, message };
    } catch (error: any) {
      if (error.name === 'ApiError') {
        throw error;
      }

      // Return safe fallback on error
      return {
        correctedText: data.text,
        structuredData: null,
        timeline: null,
        metadata: undefined,
        message: error.message || '医疗记录整合失败，请稍后重试。',
      };
    }
  },

  // Get all medical records for authenticated user
  getRecords: async (): Promise<MedicalRecord[]> => {
    const response = await apiClient.get('/medical/records');
    const { data } = unwrapResponse<{ records: MedicalRecord[] }>(response);
    return data?.records || [];
  },

  // Get a specific medical record
  getRecord: async (id: string): Promise<MedicalRecord> => {
    const response = await apiClient.get(`/medical/records/${id}`);
    const { data } = unwrapResponse<{ record?: MedicalRecord } | MedicalRecord>(response);
    if (data && typeof data === 'object' && 'record' in data) {
      return (data as { record: MedicalRecord }).record;
    }
    return data as MedicalRecord;
  },

  // Get formatted match report for a record (MVP)
  getMatchReport: async (id: string): Promise<Record<string, JsonValue>> => {
    const response = await apiClient.get(`/medical/records/${id}/report`);
    const { data } = unwrapResponse<{ report?: Record<string, JsonValue> } | { report: Record<string, JsonValue> }>(response);
    if (data && typeof data === 'object' && 'report' in data) {
      return (data as { report: Record<string, JsonValue> }).report;
    }
    // Defensive fallback
    return (data as any) || {};
  },

  // Update a medical record
  updateRecord: async (id: string, data: Partial<MedicalRecord>): Promise<MedicalRecord> => {
    const response = await apiClient.put(`/medical/records/${id}`, data);
    const { data: payload } = unwrapResponse<{ record?: MedicalRecord } | MedicalRecord>(response);
    if (payload && typeof payload === 'object' && 'record' in payload) {
      return (payload as { record: MedicalRecord }).record;
    }
    return payload as MedicalRecord;
  },

  // Delete a medical record
  deleteRecord: async (id: string): Promise<void> => {
    await apiClient.delete(`/medical/records/${id}`);
  },
};
