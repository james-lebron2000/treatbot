'use client';

import React from 'react';
import { ThinkingDisplay } from './ThinkingDisplay';
import { ProcessingSteps } from './ProcessingSteps';
import { ProgressRing } from './ProgressRing';
import { useThinkingMode } from '@/hooks/useThinkingMode';
import { cn } from '@/lib/utils';

const STAGE_LABELS: Record<string, string> = {
  idle: '就绪',
  ocr: '文字识别',
  parsing: '病历解析',
  matching: '试验匹配',
  complete: '完成',
  error: '错误',
};

interface ThinkingModeProps {
  variant?: 'full' | 'minimal' | 'steps-only' | 'ring-only';
  showSteps?: boolean;
  showProgress?: boolean;
  autoProgress?: boolean;
  onComplete?: () => void;
  className?: string;
}

export function ThinkingMode({
  variant = 'full',
  showSteps = true,
  showProgress = true,
  autoProgress = false,
  onComplete,
  className,
}: ThinkingModeProps) {
  const thinking = useThinkingMode({
    autoProgress,
    onComplete,
    stageTimings: {
      ocr: 4000,
      parsing: 3000,
      matching: 3000,
    },
  });

  const renderMinimal = () => (
    <div className={cn('flex items-center space-x-4 p-4 bg-white rounded-lg shadow-sm', className)}>
      <ProgressRing
        progress={thinking.progress}
        size={60}
        strokeWidth={4}
        animate={thinking.isThinking}
        showPercentage={false}
      />
      <div className="flex-1">
        <p className="font-medium text-gray-800">{thinking.message}</p>
        {showProgress && (
          <div className="mt-1 w-full bg-gray-200 rounded-full h-1">
            <div
              className="bg-blue-500 h-1 rounded-full transition-all duration-300 animate-shimmer"
              style={{ width: `${thinking.progress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );

  const renderRingOnly = () => (
    <div className={cn('flex justify-center', className)}>
      <ProgressRing
        progress={thinking.progress}
        size={120}
        strokeWidth={8}
        animate={thinking.isThinking}
        color="#3b82f6"
      >
        <div className="text-center">
          <div className="text-sm font-medium text-gray-700 mb-1">
            {STAGE_LABELS[thinking.stage] ?? thinking.stage.toUpperCase()}
          </div>
          <div className="text-xs text-gray-500">
            {thinking.message.split('...')[0]}
          </div>
        </div>
      </ProgressRing>
    </div>
  );

  const renderStepsOnly = () => (
    <ProcessingSteps
      currentStep={thinking.stage}
      className={className}
    />
  );

  const renderFull = () => (
    <div className={cn('space-y-8', className)}>
      {/* Main thinking display */}
      <div className="flex justify-center">
        <ThinkingDisplay
          isThinking={thinking.isThinking}
          stage={thinking.stage}
          message={thinking.message}
          progress={thinking.progress}
        />
      </div>

      {/* Processing steps */}
      {showSteps && (
        <ProcessingSteps
          currentStep={thinking.stage}
        />
      )}

      {/* Additional progress visualization */}
      {showProgress && thinking.isThinking && (
        <div className="flex justify-center space-x-8">
          <ProgressRing
            progress={thinking.progress}
            size={100}
            animate={true}
            color="#3b82f6"
          />
          <ProgressRing
            progress={thinking.elapsedTime / (thinking.estimatedTime || 1000) * 100}
            size={100}
            animate={true}
            color="#8b5cf6"
          >
            <div className="text-center">
              <div className="text-xs font-medium text-purple-600">耗时</div>
              <div className="text-xs text-gray-500">
                {Math.round(thinking.elapsedTime / 1000)}秒
              </div>
            </div>
          </ProgressRing>
        </div>
      )}
    </div>
  );

  // Render based on variant
  switch (variant) {
    case 'minimal':
      return renderMinimal();
    case 'ring-only':
      return renderRingOnly();
    case 'steps-only':
      return renderStepsOnly();
    case 'full':
    default:
      return renderFull();
  }
}

// Export a demo component for testing
export function ThinkingModeDemo() {
  const [isActive, setIsActive] = React.useState(false);

  const thinking = useThinkingMode({
    onComplete: () => {
      setIsActive(false);
      console.log('Thinking process completed!');
    },
    onError: (error) => {
      console.error('Thinking process error:', error);
      setIsActive(false);
    },
  });

  const handleStartDemo = async () => {
    setIsActive(true);
    await thinking.simulateProcess();
  };

  const handleStop = () => {
    thinking.stopThinking();
    setIsActive(false);
  };

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex justify-center space-x-4">
        <button
          onClick={handleStartDemo}
          disabled={isActive}
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          开始演示
        </button>
        <button
          onClick={handleStop}
          disabled={!isActive}
          className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          停止
        </button>
      </div>

      {/* Thinking visualization */}
      {isActive && (
        <ThinkingMode
          variant="full"
          showSteps={true}
          showProgress={true}
        />
      )}
    </div>
  );
}
