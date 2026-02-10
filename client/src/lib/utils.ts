import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { ApiError } from '@/lib/api';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(date));
}

export function formatDateTime(date: Date | string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}

export function extractErrorMessage(error: unknown, fallback: string): string {
  const traceId = extractTraceId(error);
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof (error as { response?: { data?: { message?: string } } }).response?.data?.message === 'string'
  ) {
    const base = (error as { response?: { data?: { message?: string } } }).response?.data?.message as string;
    return traceId ? `${base} (traceId: ${traceId})` : base;
  }

  if (error instanceof Error) {
    return traceId ? `${error.message} (traceId: ${traceId})` : error.message;
  }

  return traceId ? `${fallback} (traceId: ${traceId})` : fallback;
}

export function extractTraceId(error: unknown): string | null {
  if (error instanceof ApiError) {
    return typeof error.traceId === 'string' && error.traceId.trim() ? error.traceId : null;
  }

  if (error && typeof error === 'object') {
    const anyErr = error as Record<string, unknown>;
    const response = anyErr.response as Record<string, unknown> | undefined;
    const data = response?.data as Record<string, unknown> | undefined;
    if (data && typeof data.traceId === 'string' && data.traceId.trim()) {
      return data.traceId;
    }
    const headers = response?.headers as Record<string, unknown> | undefined;
    const rid = headers && typeof headers['x-request-id'] === 'string' ? (headers['x-request-id'] as string) : null;
    if (rid && rid.trim()) return rid;
  }

  return null;
}
