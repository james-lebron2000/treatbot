'use client';

import { useCallback, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { postMatch } from '@/lib/api';
import { useAppContext } from '@/context/AppContext';
import { ExtractedPatient, TrialMatch } from '@/types';

const patientCacheKey = (patient: ExtractedPatient) =>
  `match:${JSON.stringify(patient)}`;

export function useMatch(patient: ExtractedPatient | null) {
  const {
    setMatchedTrials,
    matchedTrials,
  } = useAppContext();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationKey: patient ? ['match', patientCacheKey(patient)] : ['match', 'empty'],
    mutationFn: async () => {
      if (!patient) {
        throw new Error('暂无可用于匹配的患者信息');
      }
      return postMatch(patient);
    },
    onSuccess: (trials: TrialMatch[]) => {
      setMatchedTrials(trials);
      if (patient) {
        queryClient.setQueryData(['match', patientCacheKey(patient)], trials);
      }
    },
  });

  const runMatch = useCallback(async () => {
    if (!patient) {
      return [] as TrialMatch[];
    }

    const cacheKey = ['match', patientCacheKey(patient)] as const;
    const cached = queryClient.getQueryData<TrialMatch[]>(cacheKey);
    if (cached && cached.length > 0) {
      setMatchedTrials(cached);
      return cached;
    }

    const result = await mutation.mutateAsync();
    return result;
  }, [mutation, patient, queryClient, setMatchedTrials]);

  return useMemo(
    () => ({
      runMatch,
      isMatching: mutation.isPending,
      matches: matchedTrials,
      error: mutation.error,
    }),
    [runMatch, mutation.isPending, matchedTrials, mutation.error]
  );
}
