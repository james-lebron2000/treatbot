'use client';

import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAppContext } from '@/context/AppContext';
import { TrialMatch } from '@/types';

export function useSavedTrials() {
  const {
    savedTrialIds,
    toggleSavedTrial,
    isTrialSaved,
    clearSavedTrials,
    matchedTrials,
  } = useAppContext();
  const queryClient = useQueryClient();

  const savedTrials = useMemo(() => {
    const trialsMap = new Map<string, TrialMatch>();

    matchedTrials.forEach((trial) => {
      trialsMap.set(trial.id, trial);
    });

    const cachedQueries = queryClient.getQueriesData<TrialMatch[]>({
      queryKey: ['match'],
    });

    cachedQueries.forEach(([, data]) => {
      data?.forEach((trial) => trialsMap.set(trial.id, trial));
    });

    return savedTrialIds
      .map((id) => trialsMap.get(id))
      .filter((trial): trial is TrialMatch => Boolean(trial));
  }, [savedTrialIds, matchedTrials, queryClient]);

  return {
    savedTrialIds,
    savedTrials,
    isTrialSaved,
    toggleSavedTrial,
    clearSavedTrials,
  };
}
