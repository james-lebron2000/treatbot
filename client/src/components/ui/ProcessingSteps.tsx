'use client';

import React from 'react';
import { Check, FileText, Brain, Search, Zap, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

type IconComponent = React.ComponentType<React.SVGProps<SVGSVGElement>>;

interface ProcessingStep {
  id: string;
  label: string;
  description: string;
  icon: IconComponent;
  status: 'pending' | 'active' | 'completed' | 'error';
  duration?: string;
}

interface ProcessingStepsProps {
  steps?: ProcessingStep[];
  currentStep?: string;
  className?: string;
}

const defaultSteps: ProcessingStep[] = [
  {
    id: 'upload',
    label: '文档上传',
    description: '接收医疗资料',
    icon: FileText,
    status: 'completed',
    duration: '2秒',
  },
  {
    id: 'ocr',
    label: '文字识别',
    description: '使用 OCR 提取文档文字',
    icon: FileText,
    status: 'completed',
    duration: '15秒',
  },
  {
    id: 'parsing',
    label: '病历解析',
    description: 'AI 解析结构化病历信息',
    icon: Brain,
    status: 'active',
    duration: '8秒',
  },
  {
    id: 'matching',
    label: '试验匹配',
    description: '匹配合适的临床试验',
    icon: Search,
    status: 'pending',
    duration: '12秒',
  },
  {
    id: 'results',
    label: '结果展示',
    description: '展示匹配结果',
    icon: Zap,
    status: 'pending',
    duration: '3秒',
  },
];

export function ProcessingSteps({
  steps = defaultSteps,
  currentStep,
  className,
}: ProcessingStepsProps) {
  const getStatusColor = (status: ProcessingStep['status']) => {
    switch (status) {
      case 'completed':
        return 'text-green-600 bg-green-50 border-green-200';
      case 'active':
        return 'text-blue-600 bg-blue-50 border-blue-200';
      case 'error':
        return 'text-red-600 bg-red-50 border-red-200';
      default:
        return 'text-gray-400 bg-gray-50 border-gray-200';
    }
  };

  const getConnectorColor = (step: ProcessingStep, index: number) => {
    if (index === steps.length - 1) return '';

    const nextStep = steps[index + 1];
    if (step.status === 'completed' && (nextStep.status === 'completed' || nextStep.status === 'active')) {
      return 'bg-green-400';
    } else if (step.status === 'active') {
      return 'bg-blue-400';
    }
    return 'bg-gray-300';
  };

  return (
    <div className={cn('w-full max-w-4xl mx-auto p-6', className)}>
      <h3 className="text-lg font-semibold text-gray-800 mb-6 text-center">
        处理流程
      </h3>

      <div className="relative">
        {/* Progress line */}
        <div className="absolute top-8 left-8 right-8 h-0.5 bg-gray-300 hidden md:block" />

        {/* Steps */}
        <div className="flex flex-col md:flex-row md:justify-between space-y-4 md:space-y-0">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const isActive = step.status === 'active' || step.id === currentStep;
            const isCompleted = step.status === 'completed';
            const isError = step.status === 'error';

            return (
              <div key={step.id} className="relative flex-1">
                {/* Step indicator */}
                <div className="flex flex-col items-center">
                  <div
                    className={cn(
                      'relative w-16 h-16 rounded-full border-2 flex items-center justify-center',
                      'transition-all duration-500 z-10 bg-white',
                      getStatusColor(step.status),
                      isActive && 'animate-pulse shadow-lg scale-110',
                      isCompleted && 'shadow-md'
                    )}
                  >
                    {isCompleted ? (
                      <Check aria-hidden className="w-6 h-6 text-green-600" />
                    ) : isError ? (
                      <div className="w-3 h-3 bg-red-600 rounded-full animate-pulse" />
                    ) : isActive ? (
                      <div className="relative">
                        <Icon aria-hidden className="w-6 h-6 animate-breathe" />
                        <div className="absolute inset-0 rounded-full animate-ping bg-current opacity-20" />
                      </div>
                    ) : (
                      <Icon aria-hidden className="w-6 h-6" />
                    )}

                    {/* Active indicator rings */}
                    {isActive && (
                      <>
                        <div className="absolute inset-0 rounded-full border-2 border-blue-300 animate-ping" />
                        <div className="absolute -inset-1 rounded-full border border-blue-200 animate-pulse" />
                      </>
                    )}
                  </div>

                  {/* Step info */}
                  <div className="mt-3 text-center max-w-[120px]">
                    <h4 className={cn(
                      'font-medium text-sm transition-colors',
                      isActive ? 'text-blue-700' :
                      isCompleted ? 'text-green-700' :
                      isError ? 'text-red-700' : 'text-gray-500'
                    )}>
                      {step.label}
                    </h4>
                    <p className={cn(
                      'text-xs mt-1 transition-colors',
                      isActive ? 'text-blue-600' :
                      isCompleted ? 'text-green-600' :
                      isError ? 'text-red-600' : 'text-gray-400'
                    )}>
                      {step.description}
                    </p>

                    {/* Duration indicator */}
                    {step.duration && (
                      <div className="flex items-center justify-center mt-2">
                        <Clock aria-hidden className="w-3 h-3 mr-1 text-gray-400" />
                        <span className="text-xs text-gray-500">{step.duration}</span>
                      </div>
                    )}

                    {/* Active step animation */}
                    {isActive && (
                      <div className="mt-2">
                        <div className="flex justify-center space-x-1">
                          {[...Array(3)].map((_, i) => (
                            <div
                              key={i}
                              className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce"
                              style={{ animationDelay: `${i * 0.2}s` }}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Connector line (desktop only) */}
                {index < steps.length - 1 && (
                  <div className="hidden md:block absolute top-8 -right-2 w-4 h-0.5 z-0">
                    <div className={cn(
                      'w-full h-full transition-colors duration-500',
                      getConnectorColor(step, index)
                    )} />
                  </div>
                )}

                {/* Mobile connector */}
                {index < steps.length - 1 && (
                  <div className="md:hidden absolute left-8 top-16 w-0.5 h-8 bg-gray-300" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Overall progress */}
      <div className="mt-8">
        <div className="flex justify-between text-sm text-gray-600 mb-2">
          <span>总体进度</span>
          <span>
            {steps.filter(s => s.status === 'completed').length} / {steps.length} 步
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-500 animate-shimmer"
            style={{
              width: `${(steps.filter(s => s.status === 'completed').length / steps.length) * 100}%`
            }}
          />
        </div>
      </div>
    </div>
  );
}
