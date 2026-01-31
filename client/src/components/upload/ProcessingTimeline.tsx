'use client';

import React, { useMemo } from 'react';
import { CheckCircle2, Circle, Clock, Loader2 } from 'lucide-react';
import { useUploadProgressStore } from '@/lib/stores/uploadProgress';
import { cn } from '@/lib/utils';

type TimelineStage = {
  key: 'upload' | 'ocr' | 'parsing' | 'matching' | 'complete';
  label: string;
  description: string;
};

const STAGES: TimelineStage[] = [
  { key: 'upload', label: '上传文件', description: '等待文件上传完成' },
  { key: 'ocr', label: 'OCR 识别', description: '提取影像文字内容' },
  { key: 'parsing', label: '结构化解析', description: 'AI 挖掘结构化字段' },
  { key: 'matching', label: '临床试验匹配', description: '寻找合适的临床试验' },
  { key: 'complete', label: '全部完成', description: '结果已生成，可继续下一步' }
];

const stageOrder = STAGES.reduce<Record<string, number>>((acc, stage, index) => {
  acc[stage.key] = index;
  return acc;
}, {});

const formatSeconds = (seconds?: number | null): string => {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) {
    return '计算中';
  }

  const clamped = Math.max(0, Math.round(seconds));
  if (clamped < 60) {
    return `${Math.max(1, clamped)} 秒`;
  }

  const minutes = Math.floor(clamped / 60);
  const remaining = clamped % 60;

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;
    return `${hours} 小时${restMinutes ? ` ${restMinutes} 分` : ''}`;
  }

  return `${minutes} 分${remaining ? ` ${remaining} 秒` : ''}`;
};

export interface ProcessingTimelineProps {
  uploadId: string | null;
}

export function ProcessingTimeline({ uploadId }: ProcessingTimelineProps) {
  const task = useUploadProgressStore((state) => {
    if (!uploadId) return null;
    return state.activeUploads[uploadId] || state.completedUploads.find((item) => item.id === uploadId) || null;
  });

  const stageData = useMemo(() => {
    if (!task) {
      return {
        currentStage: null as TimelineStage['key'] | null,
        status: 'idle',
        estimatedTime: null as number | null,
        processingTime: null as number | null,
        message: ''
      };
    }

    const inferredStage =
      task.uploadProgress.stage ||
      (task.uploadProgress.status === 'uploading'
        ? 'upload'
        : task.uploadProgress.status === 'completed'
          ? 'complete'
          : null);

    return {
      currentStage: inferredStage,
      status: task.uploadProgress.status,
      estimatedTime: task.uploadProgress.estimatedTime ?? null,
      processingTime: task.uploadProgress.processingTime ?? null,
      message: task.uploadProgress.message || ''
    };
  }, [task]);

  if (!uploadId || !task) {
    return null;
  }

  const computeStageStatus = (stageKey: TimelineStage['key']) => {
    const currentStageIndex = stageData.currentStage !== null ? stageOrder[stageData.currentStage] ?? -1 : -1;
    const stageIndex = stageOrder[stageKey];

    if (stageData.status === 'completed') {
      return stageIndex <= currentStageIndex ? 'completed' : 'pending';
    }

    if (stageData.status === 'error') {
      if (stageIndex < currentStageIndex) return 'completed';
      if (stageIndex === currentStageIndex) return 'error';
      return 'pending';
    }

    if (stageIndex < currentStageIndex) {
      return 'completed';
    }

    if (stageIndex === currentStageIndex || (stageData.currentStage === null && stageKey === 'upload' && stageData.status === 'uploading')) {
      return 'active';
    }

    return 'pending';
  };

  return (
    <div className="mt-6 rounded-xl border border-blue-100 bg-white/60 p-4 shadow-inner">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-blue-900">
          <Clock className="h-4 w-4" />
          <span>处理进度</span>
        </div>
        {stageData.estimatedTime && stageData.estimatedTime > 0 && (
          <span className="text-xs text-blue-700">预计剩余 {formatSeconds(stageData.estimatedTime)}</span>
        )}
      </div>

      <div className="space-y-3">
        {STAGES.map((stage) => {
          const state = computeStageStatus(stage.key);
          return (
            <div
              key={stage.key}
              className={cn(
                'flex items-center justify-between rounded-lg border px-3 py-2 transition-colors',
                state === 'completed' && 'border-green-200 bg-green-50 text-green-700',
                state === 'active' && 'border-blue-200 bg-blue-50 text-blue-700',
                state === 'pending' && 'border-gray-200 bg-white text-gray-500',
                state === 'error' && 'border-red-200 bg-red-50 text-red-600'
              )}
            >
              <div className="flex items-center gap-3">
                {state === 'completed' ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : state === 'active' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : state === 'error' ? (
                  <AlertBadge />
                ) : (
                  <Circle className="h-4 w-4" />
                )}
                <div>
                  <div className="text-sm font-medium">{stage.label}</div>
                  <div className="text-xs opacity-80">{stage.description}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {stageData.message && (
        <div
          className={cn(
            'mt-4 rounded-lg px-3 py-2 text-xs',
            stageData.status === 'error'
              ? 'bg-red-100 text-red-800'
              : 'bg-blue-900/5 text-blue-900'
          )}
        >
          {stageData.message}
          {stageData.processingTime !== null && stageData.processingTime >= 0 && (
            <span className="ml-2 text-blue-700/70">
              已耗时 {formatSeconds(stageData.processingTime)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function AlertBadge() {
  return (
    <span className="flex h-4 w-4 items-center justify-center rounded-full border border-red-400 bg-red-100 text-[10px] font-bold text-red-600">
      !
    </span>
  );
}
