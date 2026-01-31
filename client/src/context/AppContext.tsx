'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import type { ExtractedPatient, TrialMatch } from '@/types';

export type UploadedFileMeta = {
  uploadId: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
};

type LocalFileMeta = {
  name: string;
  size: number;
  type: string;
  lastModified: number;
};

type AppContextValue = {
  localFile: LocalFileMeta | null;
  setLocalFile: React.Dispatch<React.SetStateAction<LocalFileMeta | null>>;
  uploadedFileMeta: UploadedFileMeta | null;
  setUploadedFileMeta: React.Dispatch<React.SetStateAction<UploadedFileMeta | null>>;
  uploadProgress: number;
  setUploadProgress: React.Dispatch<React.SetStateAction<number>>;
  matchedTrials: TrialMatch[];
  setMatchedTrials: React.Dispatch<React.SetStateAction<TrialMatch[]>>;
  savedTrialIds: string[];
  isTrialSaved: (trialId: string) => boolean;
  toggleSavedTrial: (trialId: string) => void;
  clearSavedTrials: () => void;
  extractedPatient: ExtractedPatient | null;
  setExtractedPatient: React.Dispatch<React.SetStateAction<ExtractedPatient | null>>;
  resetFlow: () => void;
};

const AppContext = createContext<AppContextValue | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [localFile, setLocalFile] = useState<LocalFileMeta | null>(null);
  const [uploadedFileMeta, setUploadedFileMeta] = useState<UploadedFileMeta | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [matchedTrials, setMatchedTrials] = useState<TrialMatch[]>([]);
  const [savedTrialIds, setSavedTrialIds] = useState<string[]>([]);
  const [extractedPatient, setExtractedPatient] = useState<ExtractedPatient | null>(null);

  const isTrialSaved = useCallback(
    (trialId: string) => savedTrialIds.includes(trialId),
    [savedTrialIds]
  );

  const toggleSavedTrial = useCallback((trialId: string) => {
    setSavedTrialIds((prev) =>
      prev.includes(trialId)
        ? prev.filter((id) => id !== trialId)
        : [...prev, trialId]
    );
  }, []);

  const clearSavedTrials = useCallback(() => {
    setSavedTrialIds([]);
  }, []);

  const resetFlow = useCallback(() => {
    setLocalFile(null);
    setUploadedFileMeta(null);
    setUploadProgress(0);
    setMatchedTrials([]);
    setExtractedPatient(null);
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      localFile,
      setLocalFile,
      uploadedFileMeta,
      setUploadedFileMeta,
      uploadProgress,
      setUploadProgress,
      matchedTrials,
      setMatchedTrials,
      savedTrialIds,
      isTrialSaved,
      toggleSavedTrial,
      clearSavedTrials,
      extractedPatient,
      setExtractedPatient,
      resetFlow,
    }),
    [
      localFile,
      uploadedFileMeta,
      uploadProgress,
      matchedTrials,
      savedTrialIds,
      isTrialSaved,
      toggleSavedTrial,
      clearSavedTrials,
      extractedPatient,
      resetFlow,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}

