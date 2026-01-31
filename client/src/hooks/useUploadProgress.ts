/**
 * =============================================================================
 * 上传进度Hook
 * Upload Progress Hook
 * =============================================================================
 * Linus哲学：Hook要像内核中断处理一样高效
 * Good taste: Hooks should be as efficient as kernel interrupt handlers
 * =============================================================================
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useUploadProgressStore, type UploadTask } from '@/lib/stores/uploadProgress';
import {
  uploadProgressApi,
  connectSSE,
  disconnectSSE,
  type SSEProgressCallback,
  type ProcessingStage
} from '@/lib/api/uploadProgress';
import { showToast } from '@/components/ui/Toast';
import type { JsonValue } from '@/types';

// =============================================================================
// 类型定义 / Type Definitions
// =============================================================================

interface UseUploadProgressOptions {
  autoStart?: boolean;
  showNotifications?: boolean;
  onComplete?: (task: UploadTask) => void;
  onError?: (error: string) => void;
  onProgress?: (task: UploadTask) => void;
}

interface UseUploadProgressReturn {
  // 当前任务 / Current task
  task: UploadTask | null;
  progress: number;
  status: string;
  isActive: boolean;
  isCompleted: boolean;
  isError: boolean;
  error: string | null;

  // 控制函数 / Control functions
  startUpload: (uploadId: string, file: File, patientId?: string) => Promise<void>;
  updateProgress: (updates: Partial<UploadTask['uploadProgress']>) => Promise<void>;
  completeUpload: (result?: JsonValue) => Promise<void>;
  failUpload: (error: string) => Promise<void>;
  cancelUpload: () => Promise<void>;
  retryUpload: () => Promise<void>;
  resetUpload: () => void;

  // 状态函数 / Status functions
  startStage: (stage: ProcessingStage, message?: string) => Promise<void>;
  updateStageProgress: (stageProgress: number, message?: string) => Promise<void>;
}

// =============================================================================
// 主Hook / Main Hook
// =============================================================================

export function useUploadProgress(
  uploadId?: string,
  options: UseUploadProgressOptions = {}
): UseUploadProgressReturn {
  const {
    autoStart = false,
    showNotifications = true,
    onComplete,
    onError,
    onProgress
  } = options;

  // 状态管理 / State management
  const {
    activeUploads,
    addUpload,
    updateProgress: updateProgressStore,
    completeUpload: completeUploadStore,
    failUpload: failUploadStore,
    cancelUpload: cancelUploadStore,
    retryUpload: retryUploadStore,
    removeUpload
  } = useUploadProgressStore();

  const [task, setTask] = useState<UploadTask | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // 获取当前任务 / Get current task
  useEffect(() => {
    if (uploadId) {
      const currentTask = activeUploads[uploadId];
      setTask(currentTask || null);
    }
  }, [activeUploads, uploadId]);

  // 计算派生状态 / Calculate derived states
  const progress = task?.uploadProgress.progress || 0;
  const status = task?.uploadProgress.status || 'idle';
  const isActive = ['uploading', 'processing'].includes(status);
  const isCompleted = status === 'completed';
  const isError = status === 'error';
  const error = task?.uploadProgress.error || null;

  // =============================================================================
  // SSE连接管理 / SSE Connection Management
  // =============================================================================

  const connectToSSE = useCallback(async (id: string) => {
    if (isConnecting || eventSourceRef.current) return;

    setIsConnecting(true);

    try {
      const callbacks: SSEProgressCallback = {
        onOpen: () => {
          console.log(`SSE connected for upload ${id}`);
        },
        onProgress: (progressData) => {
          // 更新本地状态 / Update local state
          updateProgressStore(id, progressData);
          const updatedTask = useUploadProgressStore.getState().activeUploads[id];
          if (updatedTask) {
            onProgress?.(updatedTask);
          }
        },
        onComplete: () => {
          completeUploadStore(id);
          const updatedTask = useUploadProgressStore.getState().activeUploads[id];
          if (updatedTask) {
            onComplete?.(updatedTask);
          }

          if (showNotifications) {
            showToast.success('文件处理完成');
          }

          // 断开SSE连接 / Disconnect SSE
          disconnectSSE(eventSourceRef.current);
          eventSourceRef.current = null;
        },
        onError: (error) => {
          failUploadStore(id, error);
          onError?.(error);

          if (showNotifications) {
            showToast.error(`处理失败: ${error}`);
          }

          // 断开SSE连接 / Disconnect SSE
          disconnectSSE(eventSourceRef.current);
          eventSourceRef.current = null;
        },
        onClose: () => {
          console.log(`SSE disconnected for upload ${id}`);
          eventSourceRef.current = null;
          setIsConnecting(false);
        }
      };

      eventSourceRef.current = connectSSE(id, callbacks);

    } catch (error) {
      console.error('Failed to connect SSE:', error);
      setIsConnecting(false);
    }
  }, [isConnecting, updateProgressStore, completeUploadStore, failUploadStore, onComplete, onError, onProgress, showNotifications]);

  // =============================================================================
  // 上传控制函数 / Upload Control Functions
  // =============================================================================

  const startUpload = useCallback(async (id: string, file: File, patientId?: string) => {
    try {
      // 创建上传任务 / Create upload task
      addUpload(id, file, patientId);

      // 调用API创建任务 / Call API to create task
      await uploadProgressApi.createTask({
        uploadId: id,
        fileName: file.name,
        fileSize: file.size,
        patientId
      });

      // 连接SSE / Connect SSE
      await connectToSSE(id);

      if (showNotifications) {
        showToast.info('开始处理文件...');
      }

    } catch (error) {
      console.error('Failed to start upload:', error);
      failUploadStore(id, error instanceof Error ? error.message : '启动上传失败');

      if (showNotifications) {
        showToast.error('启动处理失败');
      }
    }
  }, [addUpload, connectToSSE, failUploadStore, showNotifications]);

  const updateUploadProgress = useCallback(async (updates: Partial<UploadTask['uploadProgress']>) => {
    if (!uploadId) return;

    try {
      // 更新本地状态 / Update local state
      updateProgressStore(uploadId, updates);

      // 调用API更新进度 / Call API to update progress
      await uploadProgressApi.updateProgress(uploadId, updates);
    } catch (error) {
      console.error('Failed to update progress:', error);
    }
  }, [uploadId, updateProgressStore]);

  const completeUpload = useCallback(async (result?: JsonValue) => {
    if (!uploadId) return;

    try {
      await uploadProgressApi.completeUpload(uploadId, result);
      completeUploadStore(uploadId);

      if (showNotifications) {
        showToast.success('处理完成');
      }
    } catch (error) {
      console.error('Failed to complete upload:', error);
      failUploadStore(uploadId, error instanceof Error ? error.message : '完成上传失败');
    }
  }, [uploadId, completeUploadStore, showNotifications, failUploadStore]);

  const failUpload = useCallback(async (error: string) => {
    if (!uploadId) return;

    try {
      await uploadProgressApi.failUpload(uploadId, error);
      failUploadStore(uploadId, error);

      if (showNotifications) {
        showToast.error(`处理失败: ${error}`);
      }
    } catch (apiError) {
      console.error('Failed to fail upload:', apiError);
    }
  }, [uploadId, failUploadStore, showNotifications]);

  const cancelUpload = useCallback(async () => {
    if (!uploadId) return;

    try {
      await uploadProgressApi.cancelUpload(uploadId);
      cancelUploadStore(uploadId);

      // 断开SSE连接 / Disconnect SSE
      disconnectSSE(eventSourceRef.current);
      eventSourceRef.current = null;

      if (showNotifications) {
        showToast.info('处理已取消');
      }
    } catch (error) {
      console.error('Failed to cancel upload:', error);
    }
  }, [uploadId, cancelUploadStore, showNotifications]);

  const retryUpload = useCallback(async () => {
    if (!uploadId || !task) return;

    try {
      // 重置状态 / Reset status
      retryUploadStore(uploadId);

      // 重新连接SSE / Reconnect SSE
      await connectToSSE(uploadId);

      if (showNotifications) {
        showToast.info('正在重试...');
      }
    } catch (error) {
      console.error('Failed to retry upload:', error);
      failUploadStore(uploadId, error instanceof Error ? error.message : '重试失败');
    }
  }, [uploadId, task, retryUploadStore, connectToSSE, showNotifications, failUploadStore]);

  const resetUpload = useCallback(() => {
    if (uploadId) {
      removeUpload(uploadId);
      disconnectSSE(eventSourceRef.current);
      eventSourceRef.current = null;
    }
  }, [uploadId, removeUpload]);

  // =============================================================================
  // 阶段管理函数 / Stage Management Functions
  // =============================================================================

  const startStage = useCallback(async (stage: ProcessingStage, message?: string) => {
    if (!uploadId) return;

    try {
      await uploadProgressApi.startStage(uploadId, stage, message);
    } catch (error) {
      console.error('Failed to start stage:', error);
    }
  }, [uploadId]);

  const updateStageProgress = useCallback(async (stageProgress: number, message?: string) => {
    if (!uploadId) return;

    try {
      await uploadProgressApi.updateStageProgress(uploadId, stageProgress, message);
    } catch (error) {
      console.error('Failed to update stage progress:', error);
    }
  }, [uploadId]);

  // =============================================================================
  // 生命周期管理 / Lifecycle Management
  // =============================================================================

  // 自动启动上传 / Auto start upload
  useEffect(() => {
    if (autoStart && uploadId && task && task.uploadProgress.status === 'idle') {
      // 这里可以添加自动启动逻辑 / Add auto start logic here
    }
  }, [autoStart, uploadId, task]);

  // 清理函数 / Cleanup function
  useEffect(() => {
    return () => {
      disconnectSSE(eventSourceRef.current);
    };
  }, []);

  // =============================================================================
  // 返回值 / Return Value
  // =============================================================================

  return {
    // 当前状态 / Current state
    task,
    progress,
    status,
    isActive,
    isCompleted,
    isError,
    error,

    // 控制函数 / Control functions
    startUpload,
    updateProgress: updateUploadProgress,
    completeUpload,
    failUpload,
    cancelUpload,
    retryUpload,
    resetUpload,

    // 状态函数 / Status functions
    startStage,
    updateStageProgress
  };
}

// =============================================================================
// 简化Hook / Simplified Hook
// =============================================================================

/**
 * 简化版上传进度Hook
 * Simplified upload progress hook
 */
export function useSimpleUploadProgress(uploadId?: string) {
  return useUploadProgress(uploadId, {
    showNotifications: true,
    autoStart: false
  });
}

/**
 * 静默版上传进度Hook（无通知）
 * Silent upload progress hook (no notifications)
 */
export function useSilentUploadProgress(uploadId?: string) {
  return useUploadProgress(uploadId, {
    showNotifications: false,
    autoStart: false
  });
}

export default useUploadProgress;
