import { extractErrorMessage, extractTraceId } from '@/lib/utils';

type LogMeta = Record<string, unknown> | undefined;

type LoggedError = {
  traceId: string | null;
  message: string;
};

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

export function logClientErrorWithMessage(
  scope: string,
  error: unknown,
  fallbackMessage: string,
  meta?: LogMeta
): LoggedError {
  const traceId = logClientError(scope, error, meta);
  const message = extractErrorMessage(error, fallbackMessage);
  return { traceId, message };
}
