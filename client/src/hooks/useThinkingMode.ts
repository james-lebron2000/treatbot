'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

export type ThinkingStage = 'idle' | 'ocr' | 'parsing' | 'matching' | 'complete' | 'error';

export interface ThinkingState {
  isThinking: boolean;
  stage: ThinkingStage;
  progress: number;
  message: string;
  estimatedTime?: number;
  elapsedTime: number;
  totalItems?: number;
  completedItems?: number;
}

export interface UseThinkingModeOptions {
  autoProgress?: boolean;
  stageTimings?: Partial<Record<ThinkingStage, number>>;
  onStageChange?: (stage: ThinkingStage) => void;
  onComplete?: () => void;
  onError?: (error: string) => void;
}

const defaultStageTimings: Record<ThinkingStage, number> = {
  idle: 0,
  ocr: 15000,      // 15 seconds
  parsing: 8000,   // 8 seconds
  matching: 12000, // 12 seconds
  complete: 0,
  error: 0,
};

const stageMessages: Record<ThinkingStage, string> = {
  idle: '已就绪',
  ocr: '正在识别文档文字...',
  parsing: '正在解析病历信息...',
  matching: '正在匹配临床试验...',
  complete: '处理完成',
  error: '处理过程中发生错误',
};

export function useThinkingMode({
  autoProgress = false,
  stageTimings = {},
  onStageChange,
  onComplete,
  onError,
}: UseThinkingModeOptions = {}) {
  const [state, setState] = useState<ThinkingState>({
    isThinking: false,
    stage: 'idle',
    progress: 0,
    message: stageMessages.idle,
    elapsedTime: 0,
  });

  const intervalRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const stageStartTime = useRef<number>(0);
  const timings = useMemo(
    () => ({ ...defaultStageTimings, ...stageTimings }),
    [stageTimings]
  );

  // Start thinking mode
  const startThinking = useCallback((initialStage: ThinkingStage = 'ocr') => {
    setState({
      isThinking: true,
      stage: initialStage,
      progress: 0,
      message: stageMessages[initialStage],
      estimatedTime: timings[initialStage],
      elapsedTime: 0,
    });
    stageStartTime.current = Date.now();
    onStageChange?.(initialStage);
  }, [onStageChange, timings]);

  // Stop thinking mode
  const stopThinking = useCallback(() => {
    setState(prev => ({
      ...prev,
      isThinking: false,
      stage: 'idle',
      progress: 0,
      message: stageMessages.idle,
      elapsedTime: 0,
    }));

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = undefined;
    }
  }, []);

  // Move to next stage
  const nextStage = useCallback(() => {
    setState(prev => {
      const stages: ThinkingStage[] = ['ocr', 'parsing', 'matching', 'complete'];
      const currentIndex = stages.indexOf(prev.stage);

      if (currentIndex === -1 || currentIndex === stages.length - 1) {
        return prev;
      }

      const nextStage = stages[currentIndex + 1];
      stageStartTime.current = Date.now();

      onStageChange?.(nextStage);

      if (nextStage === 'complete') {
        onComplete?.();
        setTimeout(() => stopThinking(), 2000); // Auto-stop after showing complete
      }

      return {
        ...prev,
        stage: nextStage,
        progress: 0,
        message: stageMessages[nextStage],
        estimatedTime: timings[nextStage],
        elapsedTime: 0,
      };
    });
  }, [onStageChange, onComplete, stopThinking, timings]);

  // Set specific stage
  const setStage = useCallback((stage: ThinkingStage, message?: string) => {
    setState(prev => ({
      ...prev,
      stage,
      progress: 0,
      message: message || stageMessages[stage],
      estimatedTime: timings[stage],
      elapsedTime: 0,
    }));
    stageStartTime.current = Date.now();
    onStageChange?.(stage);

    if (stage === 'complete') {
      onComplete?.();
      setTimeout(() => stopThinking(), 2000);
    } else if (stage === 'error') {
      onError?.(message || stageMessages[stage]);
    }
  }, [onStageChange, onComplete, onError, stopThinking, timings]);

  // Set progress manually
  const setProgress = useCallback((progress: number) => {
    setState(prev => ({
      ...prev,
      progress: Math.max(0, Math.min(100, progress)),
    }));
  }, []);

  const setMatchingProgress = useCallback((completed: number, total: number) => {
    const safeTotal = Math.max(1, total);
    const ratio = Math.max(0, Math.min(1, completed / safeTotal));
    setState(prev => ({
      ...prev,
      progress: Math.round(ratio * 100),
      completedItems: completed,
      totalItems: total,
    }));
  }, []);

  // Set custom message
  const setMessage = useCallback((message: string) => {
    setState(prev => ({
      ...prev,
      message,
    }));
  }, []);

  // Handle error state
  const setError = useCallback((errorMessage: string) => {
    setState(prev => ({
      ...prev,
      stage: 'error',
      message: errorMessage,
      isThinking: false,
    }));
    onError?.(errorMessage);
  }, [onError]);

  // Auto-progress through stages
  useEffect(() => {
    if (!state.isThinking || !autoProgress || state.stage === 'complete' || state.stage === 'error') {
      return;
    }

    const estimatedTime = state.estimatedTime || 0;
    if (estimatedTime <= 0) return;

    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - stageStartTime.current;
      const progress = Math.min(100, (elapsed / estimatedTime) * 100);

      setState(prev => ({
        ...prev,
        progress,
        elapsedTime: elapsed,
      }));

      if (progress >= 100) {
        nextStage();
      }
    }, 100);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [state.isThinking, state.stage, state.estimatedTime, autoProgress, nextStage]);

  // Simulate real processing with realistic timings
  const simulateProcess = useCallback(async (
    stages: Array<{ stage: ThinkingStage; duration?: number; message?: string }> = [
      { stage: 'ocr', duration: 3000 },
      { stage: 'parsing', duration: 2000 },
      { stage: 'matching', duration: 2500 },
      { stage: 'complete', duration: 1000 },
    ]
  ) => {
    if (state.isThinking) return;

    startThinking(stages[0].stage);

    for (let i = 0; i < stages.length; i++) {
      const { stage, duration = 2000, message } = stages[i];

      if (i > 0) {
        setStage(stage, message);
      }

      // Simulate progress within the stage
      const startTime = Date.now();
      const progressInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(100, (elapsed / duration) * 100);
        setProgress(progress);

        if (progress >= 100) {
          clearInterval(progressInterval);
        }
      }, 50);

      await new Promise(resolve => setTimeout(resolve, duration));
      clearInterval(progressInterval);
    }
  }, [state.isThinking, startThinking, setStage, setProgress]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return {
    ...state,
    startThinking,
    stopThinking,
    nextStage,
    setStage,
    setProgress,
    setMatchingProgress,
    setMessage,
    setError,
    simulateProcess,
  };
}
