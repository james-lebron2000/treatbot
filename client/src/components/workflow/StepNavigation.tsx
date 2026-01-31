'use client';

import React from 'react';
import { Check, Upload, Brain, Search } from 'lucide-react';
import { useWorkflowStore, WorkflowStep } from '@/lib/stores/workflow';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

interface StepNavigationProps {
  currentStep: WorkflowStep;
  onStepClick?: (step: WorkflowStep) => void;
  canNavigateToStep?: (step: WorkflowStep) => boolean;
}

const steps = [
  {
    number: 1,
    title: '上传资料',
    description: '上传病历/报告或粘贴文本',
    icon: Upload,
    stage: 'upload',
  },
  {
    number: 2,
    title: '信息抽取',
    description: 'AI 抽取并生成结构化信息',
    icon: Brain,
    stage: 'extract',
  },
  {
    number: 3,
    title: '试验匹配',
    description: '匹配并输出可入组试验',
    icon: Search,
    stage: 'results',
  },
];

export function StepNavigation({ currentStep, onStepClick, canNavigateToStep }: StepNavigationProps) {
  const { step1Completed, step2Completed, step3Completed } = useWorkflowStore();

  const currentStepInfo = steps.find((step) => step.number === currentStep);
  const nextStepInfo = steps.find((step) => step.number === currentStep + 1);

  const getStepStatus = (stepNumber: number) => {
    if (stepNumber === 1) return step1Completed;
    if (stepNumber === 2) return step2Completed;
    if (stepNumber === 3) return step3Completed;
    return false;
  };

  const isStepAccessible = (stepNumber: number) => {
    if (!canNavigateToStep) return stepNumber <= currentStep || getStepStatus(stepNumber - 1);
    return canNavigateToStep(stepNumber as WorkflowStep);
  };

  return (
    <div className="w-full">
      <Card className="p-5 sm:p-6 bg-gradient-to-r from-gray-50 to-white border-2 shadow-lg">
        <div className="relative">
          <div className="absolute left-5 right-5 top-5 hidden h-0.5 rounded bg-gray-200 sm:block" />
          <div className="grid grid-cols-3 gap-3 sm:gap-6">
            {steps.map((step) => {
              const Icon = step.icon;
              const isAccessible = isStepAccessible(step.number);
              const isCompleted = getStepStatus(step.number);
              const isCurrent = step.number === currentStep;

              return (
                <div key={step.number} className="flex flex-col items-center gap-2 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      if (isAccessible && onStepClick) onStepClick(step.number as WorkflowStep);
                    }}
                    disabled={!isAccessible}
                    className={[
                      'relative z-10 flex items-center justify-center rounded-full font-bold transition-all duration-200 shadow-sm',
                      'h-10 w-10 text-sm sm:h-14 sm:w-14 sm:text-base',
                      isCompleted ? 'bg-green-500 text-white ring-4 ring-green-100' : '',
                      isCurrent && !isCompleted ? 'bg-blue-500 text-white ring-4 ring-blue-100' : '',
                      !isCurrent && !isCompleted ? 'bg-gray-200 text-gray-500' : '',
                      isAccessible ? 'hover:scale-105 hover:shadow-md' : 'opacity-60 cursor-not-allowed',
                    ].join(' ')}
                  >
                    {isCompleted && step.number < currentStep ? (
                      <Check className="h-5 w-5 sm:h-6 sm:w-6" />
                    ) : (
                      <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
                    )}
                  </button>

                  <div className="space-y-0.5">
                    <h3
                      className={[
                        'font-semibold',
                        'text-xs sm:text-sm',
                        isCurrent ? 'text-blue-600' : isCompleted ? 'text-green-600' : 'text-gray-500',
                      ].join(' ')}
                    >
                      {step.title}
                    </h3>
                    <p className="hidden text-xs leading-relaxed text-gray-500 sm:block">
                      {step.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom Navigation */}
        <div className="mt-8 pt-6 border-t border-gray-200">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-gray-400">当前步骤</div>
              <div className="text-base font-semibold text-gray-700">
                {currentStepInfo?.title ?? `步骤 ${currentStep}`}
              </div>
              <p className="text-sm text-gray-500 max-w-sm">
                {currentStepInfo?.description ?? '按步骤完成上传、抽取与匹配。'}
              </p>
            </div>

            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3">
              {currentStep > 1 && (
                <Button
                  variant="outline"
                  size="default"
                  onClick={() => onStepClick?.(Math.max(1, currentStep - 1) as WorkflowStep)}
                  className="px-6 font-medium"
                >
                  上一步
                </Button>
              )}

              {currentStep < 3 && (
                <Button
                  variant="primary"
                  size="default"
                  disabled={!getStepStatus(currentStep)}
                  onClick={() => onStepClick?.(Math.min(3, currentStep + 1) as WorkflowStep)}
                  className="px-8 font-semibold shadow-md hover:shadow-lg transition-shadow"
                >
                  {nextStepInfo ? `下一步：${nextStepInfo.title}` : '下一步'}
                </Button>
              )}

              {currentStep === 3 && (
                <Button
                  variant="primary"
                  size="default"
                  onClick={() => onStepClick?.(3)}
                  className="px-8 font-semibold shadow-md hover:shadow-lg transition-shadow"
                >
                  查看匹配结果
                </Button>
              )}
            </div>
          </div>

          {currentStep < 3 && !getStepStatus(currentStep) && (
            <p className="mt-4 text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
              完成当前步骤中的必需操作后即可继续。状态卡片变为绿色时即可进入下一步。
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
