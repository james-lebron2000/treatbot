import { extractTraceId } from '@/lib/utils';

type LogMeta = Record<string, unknown> | undefined;

export function logClientError(scope: string, error: unknown, meta?: LogMeta): string | null {
  const traceId = extractTraceId(error);
  console.error(`[${scope}]`, {
    traceId,
    error,
    ...(meta || {}),
  });
  return traceId;
}

export function logClientWarn(scope: string, errorOrMessage: unknown, meta?: LogMeta): string | null {
  const traceId = extractTraceId(errorOrMessage);
  console.warn(`[${scope}]`, {
    traceId,
    error: errorOrMessage,
    ...(meta || {}),
  });
  return traceId;
}

