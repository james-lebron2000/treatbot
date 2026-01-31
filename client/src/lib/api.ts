// =============================================================================
// 临时兼容层 - 重定向到新的 API 架构
// =============================================================================
// 这个文件用于向后兼容，将旧的导入重定向到新的 API 层
// 待所有文件迁移完成后可以删除此文件
// =============================================================================

import { z } from 'zod';
import type { AxiosResponse } from 'axios';
import {
  ExtractedPatient,
  ExtractedPatientSchema,
  TrialMatch,
  TrialMatchSchema,
} from '@/types';

// 从新的 API 层重新导出
export {
  apiClient,
  get,
  post,
  put,
  patch,
  del,
  uploadFile,
  uploadFiles,
} from './api/client';

export { ApiError, fromAxiosError } from './api/errors';

export type { AxiosInstance, AxiosRequestConfig } from 'axios';

// 默认导出
export { default } from './api/client';

// ============================================================================
// 旧的 unwrapResponse 函数（兼容层）
// ============================================================================

export type ApiSuccessEnvelope<T> = {
  success: true;
  message?: string;
  data: T;
  meta?: Record<string, unknown> | null;
  traceId?: string;
};

export type ApiFailureEnvelope = {
  success: false;
  message: string;
  code?: string;
  details?: unknown;
  traceId?: string;
};

export type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiFailureEnvelope;

export type UnwrappedResponse<T> = {
  data: T;
  message?: string;
  meta?: Record<string, unknown> | null;
  traceId?: string;
  success: boolean;
  raw: unknown;
};

export function unwrapResponse<T>(response: AxiosResponse<T>): UnwrappedResponse<T> {
  // 新的 apiClient 已经自动解包了，所以直接返回
  return {
    data: response.data,
    message: undefined,
    meta: null,
    traceId: undefined,
    success: true,
    raw: response,
  };
}

// ============================================================================
// 专用 API 函数（临时兼容）
// ============================================================================

const UploadResponseSchema = z.object({
  uploadId: z.string(),
  filename: z.string(),
  size: z.number(),
  mimeType: z.string().nullable().optional(),
});

export type UploadFileResponse = z.infer<typeof UploadResponseSchema>;

const ExtractionStatusSchema = z.object({
  status: z.enum(['queued', 'processing', 'done', 'error']),
  data: ExtractedPatientSchema.optional(),
  message: z.string().optional(),
});

export type ExtractionStatusResponse = z.infer<typeof ExtractionStatusSchema>;

const MatchResponseSchema = z.object({
  trials: z.array(TrialMatchSchema),
});

// 辅助函数
const withZod =
  <Schema extends z.ZodTypeAny>(schema: Schema) =>
  async <Value>(promise: Promise<Value>): Promise<z.infer<Schema>> => {
    const data = await promise;
    return schema.parse(data);
  };

const parseExtraction = withZod(ExtractionStatusSchema);
const parseMatch = withZod(MatchResponseSchema);

const DEFAULT_TIMEOUT_MS = 20_000;
export { DEFAULT_TIMEOUT_MS };

type ApiFetchOptions = RequestInit & {
  timeoutMs?: number;
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_BASE ||
  'http://localhost:5001/api';
export { API_BASE_URL };

const toAbsoluteUrl = (path: string): string => {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  if (!path.startsWith('/')) {
    return `${API_BASE_URL}/${path}`;
  }
  return `${API_BASE_URL}${path}`;
};

const isFormData = (value: unknown): value is FormData =>
  typeof FormData !== 'undefined' && value instanceof FormData;

const getAuthHeader = (): string | undefined => {
  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage.getItem('auth-storage');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.state?.token) {
          return `Bearer ${parsed.state.token}`;
        }
      }
    } catch (error) {
      console.warn('Failed to read auth token from storage', error);
    }
  }
  return undefined;
};

export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, headers: requestHeaders, signal, ...init } = options;
  const controller = new AbortController();
  const timeoutId =
    timeoutMs > 0 && !signal
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;

  const headers = new Headers(requestHeaders ?? {});
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  const body = init.body;
  if (body && !isFormData(body) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const authHeader = getAuthHeader();
  if (authHeader && !headers.has('Authorization')) {
    headers.set('Authorization', authHeader);
  }

  const url = toAbsoluteUrl(path);

  try {
    const response = await fetch(url, {
      ...init,
      headers,
      signal: signal ?? controller.signal,
    });

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    const isJsonResponse = response.headers
      .get('content-type')
      ?.includes('application/json');

    let parsedBody: unknown = undefined;
    if (response.status !== 204) {
      if (isJsonResponse) {
        try {
          parsedBody = await response.json();
        } catch {
          parsedBody = undefined;
        }
      } else {
        const text = await response.text();
        parsedBody = text;
      }
    }

    if (!response.ok) {
      const error = new Error(`请求失败（状态码 ${response.status}）`) as Error & {
        status?: number;
        code?: string;
        details?: unknown;
      };
      error.status = response.status;
      error.details = parsedBody;
      throw error;
    }

    return parsedBody as T;
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      const abortError = new Error('请求超时，请稍后重试') as Error & {
        status?: number;
        code?: string;
      };
      abortError.code = 'TIMEOUT';
      abortError.status = 408;
      throw abortError;
    }
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

// 专用 API 函数（临时兼容）
export async function pollExtraction(uploadId: string): Promise<ExtractionStatusResponse> {
  const search = new URLSearchParams({ uploadId });
  return parseExtraction(
    apiFetch(`/extract?${search.toString()}`, {
      method: 'GET',
      timeoutMs: DEFAULT_TIMEOUT_MS,
    })
  );
}

export async function postMatch(patient: ExtractedPatient): Promise<TrialMatch[]> {
  const response = await parseMatch(
    apiFetch('/match', {
      method: 'POST',
      body: JSON.stringify({ patient }),
      timeoutMs: DEFAULT_TIMEOUT_MS,
    })
  );

  return response.trials;
}
