import { create } from 'zustand';
import {
  JsonValue,
  MedicalRecord,
  StructuredData,
  LegacyTrialMatch,
  MatchProviderMetadata,
} from '@/types';

export type WorkflowStage = 'idle' | 'uploading' | 'ocr' | 'parsing' | 'matching' | 'completed';
export type WorkflowStep = 1 | 2 | 3;

interface WorkflowState {
  // Current workflow state
  stage: WorkflowStage;
  currentStep: WorkflowStep;
  progress: number;
  isProcessing: boolean;
  error: string | null;

  // Data from each stage
  uploadedFiles: File[];
  extractedText: string;
  structuredRecord: StructuredData | Record<string, JsonValue> | null;
  matchResults: LegacyTrialMatch[];

  // Current record being processed
  currentRecord: MedicalRecord | null;

  // Step completion status
  step1Completed: boolean;
  step2Completed: boolean;
  step3Completed: boolean;

  // Step data
  step1Data: {
    files: File[];
    manualText?: string;
    ocrResult: Record<string, JsonValue> | null;
    fileName?: string;
    fileSize?: number;
    uploadId?: string;
  } | null;
  step2Data: {
    extractedText: string;
    llmResult: {
      integrateResponse: Record<string, JsonValue> | null;
      extractResponse: Record<string, JsonValue> | null;
    } | null;
    structuredRecord: StructuredData | Record<string, JsonValue> | null;
  } | null;
  step3Data: {
    matchResults: LegacyTrialMatch[];
    provider: MatchProviderMetadata | null;
  } | null;

  // Actions
  setStage: (stage: WorkflowStage) => void;
  setCurrentStep: (step: WorkflowStep) => void;
  setProgress: (progress: number) => void;
  setProcessing: (processing: boolean) => void;
  setError: (error: string | null) => void;
  setUploadedFiles: (files: File[]) => void;
  setExtractedText: (text: string) => void;
  setStructuredRecord: (record: StructuredData | Record<string, JsonValue> | null) => void;
  setMatchResults: (results: LegacyTrialMatch[]) => void;
  setCurrentRecord: (record: MedicalRecord | null) => void;

  // Step data actions
  setStep1Data: (data: WorkflowState['step1Data']) => void;
  setStep2Data: (data: WorkflowState['step2Data']) => void;
  setStep3Data: (data: WorkflowState['step3Data']) => void;
  setStepCompleted: (step: WorkflowStep, completed: boolean) => void;

  // Workflow actions
  startWorkflow: () => void;
  completeWorkflow: () => void;
  resetWorkflow: () => void;
  nextStage: () => void;
  goToStep: (step: WorkflowStep) => void;
}

const workflowStages: WorkflowStage[] = ['idle', 'uploading', 'ocr', 'parsing', 'matching', 'completed'];

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  // Initial state
  stage: 'idle',
  currentStep: 1,
  progress: 0,
  isProcessing: false,
  error: null,
  uploadedFiles: [],
  extractedText: '',
  structuredRecord: null,
  matchResults: [],
  currentRecord: null,
  step1Completed: false,
  step2Completed: false,
  step3Completed: false,
  step1Data: null,
  step2Data: null,
  step3Data: null,

  // Setters
  setStage: (stage) => set({ stage }),
  setCurrentStep: (step) => set({ currentStep: step }),
  setProgress: (progress) => set({ progress }),
  setProcessing: (processing) => set({ isProcessing: processing }),
  setError: (error) => set({ error }),
  setUploadedFiles: (files) => set({ uploadedFiles: files }),
  setExtractedText: (text) => set({ extractedText: text }),
  setStructuredRecord: (record) => set({ structuredRecord: record }),
  setMatchResults: (results) => set({ matchResults: results }),
  setCurrentRecord: (record) => set({ currentRecord: record }),

  // Step data actions
  setStep1Data: (data) => set({ step1Data: data }),
  setStep2Data: (data) => set({ step2Data: data }),
  setStep3Data: (data) => set({ step3Data: data }),
  setStepCompleted: (step, completed) => {
    const updates: Partial<WorkflowState> = {};
    if (step === 1) updates.step1Completed = completed;
    if (step === 2) updates.step2Completed = completed;
    if (step === 3) updates.step3Completed = completed;
    set(updates);
  },

  // Workflow actions
  startWorkflow: () => {
    set({
      stage: 'uploading',
      currentStep: 1,
      progress: 0,
      isProcessing: true,
      error: null,
      extractedText: '',
      structuredRecord: null,
      matchResults: [],
    });
  },

  completeWorkflow: () => {
    set({
      stage: 'completed',
      progress: 100,
      isProcessing: false,
      error: null,
      step3Completed: true,
    });
  },

  resetWorkflow: () => {
    set({
      stage: 'idle',
      currentStep: 1,
      progress: 0,
      isProcessing: false,
      error: null,
      uploadedFiles: [],
      extractedText: '',
      structuredRecord: null,
      matchResults: [],
      step1Completed: false,
      step2Completed: false,
      step3Completed: false,
      step1Data: null,
      step2Data: null,
      step3Data: null,
    });
  },

  nextStage: () => {
    const currentStage = get().stage;
    const currentIndex = workflowStages.indexOf(currentStage);
    if (currentIndex < workflowStages.length - 1) {
      const nextStage = workflowStages[currentIndex + 1];
      set({ stage: nextStage });
    }
  },

  goToStep: (step) => {
    set({ currentStep: step });
    // Set appropriate stage based on step
    const stageMap: Record<WorkflowStep, WorkflowStage> = {
      1: 'idle',
      2: 'parsing',
      3: 'matching'
    };
    set({ stage: stageMap[step] });
  },
}));
