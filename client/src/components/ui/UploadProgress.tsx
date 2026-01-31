/**
 * =============================================================================
 * 上传进度条组件
 * Upload Progress Component
 * =============================================================================
 * Linus哲学：组件只做一件事，做到极致简洁
 * Good taste: Component does one thing,做到极致简洁
 * =============================================================================
 */

'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText,
  Upload,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  RotateCcw,
  X
} from 'lucide-react';
import {
  useUploadProgressStore,
  useUploadTask,
  useActiveUploads,
  type UploadTask,
  type ProcessingStage,
  formatFileSize
} from '@/lib/stores/uploadProgress';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';

// =============================================================================
// 类型定义 / Type Definitions
// =============================================================================

interface UploadProgressProps {
  taskId: string;
  className?: string;
  onComplete?: (task: UploadTask) => void;
  onError?: (error: string) => void;
  compact?: boolean;
}

interface ProcessingStageIconProps {
  stage: ProcessingStage;
  progress: number;
  className?: string;
}

interface ProgressBarProps {
  progress: number;
  status: 'idle' | 'uploading' | 'processing' | 'completed' | 'error' | 'cancelled';
  stageProgress?: number;
  className?: string;
}

// =============================================================================
// 阶段图标组件 / Stage Icon Component
// =============================================================================

const ProcessingStageIcon: React.FC<ProcessingStageIconProps> = ({ stage, progress, className }) => {
  const iconVariants = {
    ocr: {
      icon: FileText,
      colors: 'text-blue-600 bg-blue-100',
      pulse: 'animate-pulse-blue'
    },
    parsing: {
      icon: Upload,
      colors: 'text-green-600 bg-green-100',
      pulse: 'animate-pulse-green'
    },
    matching: {
      icon: CheckCircle,
      colors: 'text-purple-600 bg-purple-100',
      pulse: 'animate-pulse-purple'
    },
    complete: {
      icon: CheckCircle,
      colors: 'text-green-600 bg-green-100',
      pulse: ''
    },
  };

  const { icon: Icon, colors, pulse } = iconVariants[stage] || iconVariants.complete;

  return (
    <div className={cn(
      "relative w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300",
      colors,
      className,
      pulse
    )}>
      <Icon className="w-5 h-5" />
      {progress > 0 && progress < 100 && (
        <div className="absolute inset-0 rounded-full border-2 border-current opacity-30 animate-spin"
             style={{ animationDuration: '2s' }} />
      )}
    </div>
  );
};

// =============================================================================
// 进度条组件 / Progress Bar Component
// =============================================================================

const ProgressBar: React.FC<ProgressBarProps> = ({ progress, status, stageProgress, className }) => {
  const getStatusColor = () => {
    switch (status) {
      case 'completed': return 'bg-gradient-to-r from-green-500 to-emerald-500';
      case 'error': return 'bg-gradient-to-r from-red-500 to-pink-500';
      case 'uploading': return 'bg-gradient-to-r from-blue-500 to-cyan-500';
      case 'processing': return 'bg-gradient-to-r from-purple-500 to-indigo-500';
      default: return 'bg-gradient-to-r from-gray-400 to-gray-500';
    }
  };

  return (
    <div className={cn("w-full space-y-2", className)}>
      {/* 主进度条 / Main progress bar */}
      <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
        <motion.div
          className={cn("h-full rounded-full transition-all duration-500", getStatusColor())}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(progress, 100)}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>

      {/* 阶段进度条 / Stage progress bar */}
      {stageProgress !== undefined && status === 'processing' && (
        <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-blue-400 to-purple-400 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(stageProgress, 100)}%` }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          />
        </div>
      )}
    </div>
  );
};

// =============================================================================
// 上传进度项组件 / Upload Progress Item Component
// =============================================================================

const UploadProgressItem: React.FC<{ task: UploadTask; compact?: boolean; onRemove?: () => void }> = ({
  task,
  compact = false,
  onRemove
}) => {
  const { uploadProgress } = task;
  const { retryUpload } = useUploadProgressStore();

  const getStatusIcon = () => {
    switch (uploadProgress.status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'error':
        return <XCircle className="w-5 h-5 text-red-600" />;
      case 'cancelled':
        return <X className="w-5 h-5 text-gray-600" />;
      case 'uploading':
        return <Upload className="w-5 h-5 text-blue-600 animate-pulse" />;
      case 'processing':
        return <Clock className="w-5 h-5 text-purple-600 animate-spin" />;
      default:
        return <AlertCircle className="w-5 h-5 text-gray-600" />;
    }
  };

  const formatTime = (seconds: number) => {
    if (seconds <= 0) return '';
    if (seconds < 60) return `${seconds}秒`;
    return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
  };

  if (compact) {
    return (
      <div className="flex items-center space-x-3 p-3 bg-white rounded-lg border border-gray-200 shadow-sm">
        {uploadProgress.stage && (
          <ProcessingStageIcon
            stage={uploadProgress.stage}
            progress={uploadProgress.stageProgress || 0}
            className="w-8 h-8"
          />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-gray-900 truncate">
              {uploadProgress.fileName}
            </span>
            <span className="text-xs text-gray-500">
              {uploadProgress.progress}%
            </span>
          </div>
          <ProgressBar
            progress={uploadProgress.progress}
            status={uploadProgress.status}
            stageProgress={uploadProgress.stageProgress}
            className="h-1.5"
          />
        </div>

        <div className="flex items-center space-x-2">
          {getStatusIcon()}
          {uploadProgress.status === 'error' && (uploadProgress.retryCount ?? 0) < 3 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => retryUpload(task.id)}
              className="p-1"
            >
              <RotateCcw className="w-4 h-4" />
            </Button>
          )}
          {onRemove && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemove}
              className="p-1 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
      className="p-4 bg-white rounded-xl border border-gray-200 shadow-lg hover:shadow-xl transition-shadow"
    >
      <div className="flex items-start space-x-4">
        {/* 阶段图标 / Stage Icon */}
        {uploadProgress.stage && (
          <ProcessingStageIcon
            stage={uploadProgress.stage}
            progress={uploadProgress.stageProgress || 0}
          />
        )}

        <div className="flex-1 space-y-3">
          {/* 文件信息 / File Information */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <FileText className="w-4 h-4 text-gray-500" />
              <div>
                <h4 className="text-sm font-semibold text-gray-900">
                  {uploadProgress.fileName}
                </h4>
                {uploadProgress.fileSize && (
                  <p className="text-xs text-gray-500">
                    {formatFileSize(uploadProgress.fileSize)}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center space-x-2">
              {getStatusIcon()}
              {onRemove && uploadProgress.status !== 'processing' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onRemove}
                  className="p-1 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>

          {/* 进度条 / Progress Bar */}
          <ProgressBar
            progress={uploadProgress.progress}
            status={uploadProgress.status}
            stageProgress={uploadProgress.stageProgress}
          />

          {/* 状态信息 / Status Information */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-600">
              {uploadProgress.message}
            </span>

            <div className="flex items-center space-x-4">
              {((uploadProgress.estimatedTime ?? 0) > 0) && uploadProgress.status === 'processing' && (
                <span className="text-blue-600 font-medium">
                  预计剩余: {formatTime(uploadProgress.estimatedTime ?? 0)}
                </span>
              )}

              {(uploadProgress.processingTime ?? 0) > 0 && (
                <span className="text-gray-500">
                  已用时: {formatTime(uploadProgress.processingTime ?? 0)}
                </span>
              )}

              <span className="font-semibold text-gray-900">
                {uploadProgress.progress}%
              </span>
            </div>
          </div>

          {/* 错误信息和重试 / Error info and retry */}
          {uploadProgress.status === 'error' && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 text-red-600" />
                  <span className="text-sm text-red-800">
                    {uploadProgress.error || '处理失败'}
                  </span>
                </div>

                {(uploadProgress.retryCount ?? 0) < 3 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => retryUpload(task.id)}
                    className="flex items-center space-x-1"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>重试</span>
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* 阶段详情 / Stage Details */}
          {uploadProgress.stage && uploadProgress.status === 'processing' && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-blue-800">
                  当前阶段: {getStageText(uploadProgress.stage)}
                </span>
                {uploadProgress.stageProgress !== undefined && (
                  <span className="text-sm text-blue-600">
                    {uploadProgress.stageProgress}%
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

// =============================================================================
// 辅助函数 / Helper Functions
// =============================================================================

function getStageText(stage: ProcessingStage): string {
  const stageTexts = {
    ocr: 'OCR文本识别',
    parsing: '医疗文本解析',
    matching: '临床试验匹配',
    complete: '处理完成',
  };
  return stageTexts[stage] || '处理中';
}

// =============================================================================
// 主组件 / Main Component
// =============================================================================

export const UploadProgress: React.FC<UploadProgressProps> = ({
  taskId,
  className,
  onComplete,
  onError,
  compact = false,
}) => {
  const task = useUploadTask(taskId);
  const { removeUpload } = useUploadProgressStore();

  // 处理完成和错误回调 / Handle completion and error callbacks
  useEffect(() => {
    if (!task) return;

    if (task.uploadProgress.status === 'completed' && onComplete) {
      onComplete(task);
    }

    if (task.uploadProgress.status === 'error' && onError) {
      onError(task.uploadProgress.error || 'Unknown error');
    }
  }, [task, onComplete, onError]);

  if (!task) {
    return null;
  }

  const handleRemove = () => {
    removeUpload(taskId);
  };

  return (
    <div className={cn(className)}>
      <UploadProgressItem
        task={task}
        compact={compact}
        onRemove={handleRemove}
      />
    </div>
  );
};

// =============================================================================
// 全局进度面板组件 / Global Progress Panel Component
// =============================================================================

interface GlobalUploadProgressProps {
  className?: string;
  maxVisible?: number;
  onAllComplete?: () => void;
}

export const GlobalUploadProgress: React.FC<GlobalUploadProgressProps> = ({
  className,
  maxVisible = 3,
  onAllComplete,
}) => {
  const activeUploads = useActiveUploads();
  const { clearCompleted } = useUploadProgressStore();

  // 检查是否所有任务都完成 / Check if all tasks are completed
  const allCompleted = activeUploads.every(task =>
    task.uploadProgress.status === 'completed' ||
    task.uploadProgress.status === 'error' ||
    task.uploadProgress.status === 'cancelled'
  );

  useEffect(() => {
    if (allCompleted && activeUploads.length > 0 && onAllComplete) {
      onAllComplete();
    }
  }, [allCompleted, activeUploads.length, onAllComplete]);

  if (activeUploads.length === 0) {
    return null;
  }

  const visibleUploads = activeUploads.slice(0, maxVisible);
  const remainingCount = Math.max(0, activeUploads.length - maxVisible);

  return (
    <Card className={cn("shadow-xl border-gray-200", className)}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">
            上传进度 ({activeUploads.length})
          </h3>
          {allCompleted && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearCompleted}
              className="text-gray-500 hover:text-gray-700"
            >
              清除完成项
            </Button>
          )}
        </div>

        <div className="space-y-3">
          <AnimatePresence>
            {visibleUploads.map((task) => (
              <UploadProgressItem
                key={task.id}
                task={task}
                compact={true}
              />
            ))}
          </AnimatePresence>

          {remainingCount > 0 && (
            <div className="text-center py-2 text-sm text-gray-500">
              还有 {remainingCount} 个任务在处理中...
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default UploadProgress;
