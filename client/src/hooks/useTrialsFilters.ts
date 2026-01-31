'use client';

import { useCallback, useMemo, useState } from 'react';
import { TrialMatch } from '@/types';

export type PhaseFilterOption = 'all' | 'I' | 'II' | 'III' | 'IV';

export interface TrialFilterState {
  phase: PhaseFilterOption;
  institution: string;
  location: string;
  minScore: number;
  searchTerm: string;
}

const DEFAULT_STATE: TrialFilterState = {
  phase: 'all',
  institution: 'all',
  location: 'all',
  minScore: 0,
  searchTerm: '',
};

export function useTrialsFilters(initialState: Partial<TrialFilterState> = {}) {
  const [filters, setFilters] = useState<TrialFilterState>({
    ...DEFAULT_STATE,
    ...initialState,
  });

  const setPhase = useCallback(
    (phase: PhaseFilterOption) => setFilters((prev) => ({ ...prev, phase })),
    []
  );

  const setInstitution = useCallback(
    (institution: string) => setFilters((prev) => ({ ...prev, institution })),
    []
  );

  const setLocation = useCallback(
    (location: string) => setFilters((prev) => ({ ...prev, location })),
    []
  );

  const setMinScore = useCallback(
    (minScore: number) =>
      setFilters((prev) => ({ ...prev, minScore: Math.max(0, Math.min(100, minScore)) })),
    []
  );

  const setSearchTerm = useCallback(
    (term: string) => setFilters((prev) => ({ ...prev, searchTerm: term })),
    []
  );

  const resetFilters = useCallback(() => {
    setFilters({ ...DEFAULT_STATE });
  }, []);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.phase !== 'all') count += 1;
    if (filters.institution !== 'all') count += 1;
    if (filters.location !== 'all') count += 1;
    if (filters.minScore > 0) count += 1;
    if (filters.searchTerm.trim().length > 0) count += 1;
    return count;
  }, [filters]);

  const filterTrials = useCallback(
    (trials: TrialMatch[]) => {
      const normalizedSearch = filters.searchTerm.trim().toLowerCase();

      return trials.filter((trial) => {
        if (filters.phase !== 'all' && trial.phase && trial.phase !== filters.phase) {
          return false;
        }

        if (filters.institution !== 'all') {
          const institutionText = trial.institution?.toLowerCase() ?? '';
          if (!institutionText.includes(filters.institution.toLowerCase())) {
            return false;
          }
        }

        if (filters.location !== 'all') {
          const combinedLocation = `${trial.siteCity ?? ''} ${trial.siteCountry ?? ''}`.toLowerCase();
          if (!combinedLocation.includes(filters.location.toLowerCase())) {
            return false;
          }
        }

        if (filters.minScore > 0 && trial.matchScore < filters.minScore) {
          return false;
        }

        if (normalizedSearch.length > 0) {
          const searchable = [
            trial.title,
            trial.condition,
            trial.institution,
            trial.siteCity,
            trial.siteCountry,
            trial.nctId,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

          if (!searchable.includes(normalizedSearch)) {
            return false;
          }
        }

        return true;
      });
    },
    [filters]
  );

  return {
    filters,
    setPhase,
    setInstitution,
    setLocation,
    setMinScore,
    setSearchTerm,
    resetFilters,
    activeFilterCount,
    filterTrials,
  };
}
