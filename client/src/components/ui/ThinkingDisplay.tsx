'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Brain, FileText, Loader2, Search, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

type SupportedStage = 'idle' | 'ocr' | 'parsing' | 'matching' | 'complete' | 'error';

interface ThinkingDisplayProps {
  isThinking?: boolean;
  stage?: SupportedStage;
  message?: string;
  progress?: number;
  className?: string;
}

const stageConfig: Record<SupportedStage, {
  icon: React.ElementType;
  color: string;
  bgColor: string;
  message: string;
}> = {
  idle: {
    icon: Loader2,
    color: 'text-slate-500',
    bgColor: 'bg-slate-50',
    message: '正在准备...'
  },
  ocr: {
    icon: FileText,
    color: 'text-blue-500',
    bgColor: 'bg-blue-50',
    message: '正在识别文档文字...',
  },
  parsing: {
    icon: Brain,
    color: 'text-purple-500',
    bgColor: 'bg-purple-50',
    message: '正在解析病历信息...',
  },
  matching: {
    icon: Search,
    color: 'text-green-500',
    bgColor: 'bg-green-50',
    message: '正在匹配临床试验...',
  },
  complete: {
    icon: Zap,
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-50',
    message: '处理完成',
  },
  error: {
    icon: AlertTriangle,
    color: 'text-red-500',
    bgColor: 'bg-red-50',
    message: '处理已中断'
  },
};

export function ThinkingDisplay({
  isThinking = false,
  stage = 'parsing',
  message,
  progress = 0,
  className,
}: ThinkingDisplayProps) {
  const [currentStage, setCurrentStage] = useState<SupportedStage>(stage);
  const [animatedText, setAnimatedText] = useState('');
  const [dots, setDots] = useState('');

  useEffect(() => {
    if (!stageConfig[stage]) {
      setCurrentStage('ocr');
    } else {
      setCurrentStage(stage);
    }
  }, [stage]);

  const config = stageConfig[currentStage] || stageConfig.ocr;
  const Icon = config.icon;
  const displayMessage = message || config.message;

  // Typing animation effect
  useEffect(() => {
    if (!isThinking) return;

    let i = 0;
    const typeText = () => {
      if (i < displayMessage.length) {
        setAnimatedText(displayMessage.slice(0, i + 1));
        i++;
        setTimeout(typeText, 50);
      }
    };

    setAnimatedText('');
    typeText();
  }, [displayMessage, isThinking]);

  // Dots animation effect
  useEffect(() => {
    if (!isThinking) return;

    const interval = setInterval(() => {
      setDots(prev => {
        if (prev === '...') return '';
        return prev + '.';
      });
    }, 500);

    return () => clearInterval(interval);
  }, [isThinking]);

  // Auto-advance stages for demo
  useEffect(() => {
    if (!isThinking) return;

    const stages: Array<keyof typeof stageConfig> = ['ocr', 'parsing', 'matching', 'complete'];
    const currentIndex = stages.indexOf(currentStage);

    if (currentIndex < stages.length - 1) {
      const timer = setTimeout(() => {
        setCurrentStage(stages[currentIndex + 1]);
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [currentStage, isThinking]);

  if (!isThinking) return null;

  return (
    <div className={cn(
      'flex flex-col items-center justify-center p-8 rounded-2xl border shadow-lg transition-all duration-500',
      config.bgColor,
      'backdrop-blur-sm',
      className
    )}>
      {/* Main thinking indicator */}
      <div className="relative mb-6">
        {/* Pulsing rings */}
        <div className="absolute inset-0 animate-ping">
          <div className={cn(
            'w-20 h-20 rounded-full opacity-20',
            config.color.replace('text', 'bg')
          )} />
        </div>
        <div className="absolute inset-2 animate-pulse">
          <div className={cn(
            'w-16 h-16 rounded-full opacity-30',
            config.color.replace('text', 'bg')
          )} />
        </div>

        {/* Main icon */}
        <div className={cn(
          'relative w-20 h-20 rounded-full flex items-center justify-center',
          'bg-white shadow-lg animate-bounce',
          'transition-all duration-500'
        )}>
          <Icon className={cn('w-8 h-8', config.color, 'animate-pulse')} />
        </div>

        {/* Floating particles */}
        <div className="absolute -inset-4">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className={cn(
                'absolute w-2 h-2 rounded-full opacity-60',
                config.color.replace('text', 'bg'),
                'animate-float'
              )}
              style={{
                left: `${20 + Math.cos(i * Math.PI / 4) * 40}px`,
                top: `${20 + Math.sin(i * Math.PI / 4) * 40}px`,
                animationDelay: `${i * 0.2}s`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Status message */}
      <div className="text-center mb-4">
        <h3 className={cn('text-lg font-semibold mb-2', config.color)}>
          AI 处理中
        </h3>
        <p className="text-gray-600 min-h-[1.5rem]">
          {animatedText}
          <span className="inline-block w-4 text-left">{dots}</span>
        </p>
      </div>

      {/* Progress bar */}
      {progress > 0 && (
        <div className="w-full max-w-sm">
          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                config.color.replace('text', 'bg'),
                'animate-shimmer'
              )}
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
          <p className="text-sm text-gray-500 mt-2 text-center">
            已完成 {Math.round(progress)}%
          </p>
        </div>
      )}

      {/* Stage indicators */}
      <div className="flex space-x-2 mt-4">
        {Object.keys(stageConfig).map((stageKey) => {
          const isActive = stageKey === currentStage;
          const isCompleted = Object.keys(stageConfig).indexOf(stageKey) <
                            Object.keys(stageConfig).indexOf(currentStage);

          return (
            <div
              key={stageKey}
              className={cn(
                'w-3 h-3 rounded-full transition-all duration-300',
                isActive ? config.color.replace('text', 'bg') :
                isCompleted ? 'bg-gray-400' : 'bg-gray-200',
                isActive && 'animate-pulse scale-125'
              )}
            />
          );
        })}
      </div>
    </div>
  );
}
