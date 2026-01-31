'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { pollExtraction, ExtractionStatusResponse } from '@/lib/api';
import { useAppContext } from '@/context/AppContext';

type UseExtractionResult = {
  status: ExtractionStatusResponse['status'];
  message?: string;
  patient: ExtractionStatusResponse['data'] | null;
  isLoading: boolean;
  isFetching: boolean;
  refetch: () => Promise<ExtractionStatusResponse | undefined>;
  timedOut: boolean;
  elapsedMs: number;
  continueInBackground: () => void;
  resetPolling: () => void;
  error: unknown;
};

const initialPollInterval = 1500;
const maxPollInterval = 6000;

export function useExtraction(uploadId?: string | null): UseExtractionResult {
  const { setExtractedPatient } = useAppContext();
  const [timedOut, setTimedOut] = useState(false);
  const [pollInterval, setPollInterval] = useState(initialPollInterval);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!uploadId) {
      startedAtRef.current = null;
      setElapsedMs(0);
      setTimedOut(false);
      return;
    }

    startedAtRef.current = Date.now();
    setElapsedMs(0);
    setTimedOut(false);
    setPollInterval(initialPollInterval);
  }, [uploadId]);

  useEffect(() => {
    if (!uploadId || timedOut) return;
    const timer = window.setInterval(() => {
      if (!startedAtRef.current) return;
      const elapsed = Date.now() - startedAtRef.current;
      setElapsedMs(elapsed);
      if (elapsed >= 60_000) {
        setTimedOut(true);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [uploadId, timedOut]);

  const query = useQuery<ExtractionStatusResponse>({
    queryKey: ['extraction', uploadId],
    queryFn: () => pollExtraction(uploadId as string),
    enabled: Boolean(uploadId) && !timedOut,
    retry: 2,
    refetchInterval: (query) => {
      const data = (query as { state: { data?: ExtractionStatusResponse } }).state
        .data;
      if (!uploadId || timedOut) {
        return false;
      }

      if (!data || data.status === 'queued' || data.status === 'processing') {
        return pollInterval;
      }

      return false;
    },
  });

  useEffect(() => {
    if (!query.data) return;

    if (query.data.status === 'processing') {
      setPollInterval((prev) => Math.min(maxPollInterval, Math.round(prev * 1.4)));
    }

    if (query.data.status === 'done' && query.data.data) {
      setExtractedPatient(query.data.data);
      setPollInterval(initialPollInterval);
    }
  }, [query.data, setExtractedPatient]);

  const continueInBackground = useCallback(() => {
    setTimedOut(true);
  }, []);

  const resetPolling = useCallback(() => {
    if (!uploadId) return;
    setTimedOut(false);
    setPollInterval(initialPollInterval);
    startedAtRef.current = Date.now();
    query.refetch();
  }, [uploadId, query]);

  const status = query.data?.status ?? 'queued';
  const message = query.data?.message;
  const patient = query.data?.data ?? null;

  return {
    status,
    message,
    patient,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    refetch: async () => {
      const result = await query.refetch();
      return result.data;
    },
    timedOut,
    elapsedMs,
    continueInBackground,
    resetPolling,
    error: query.error,
  };
}
