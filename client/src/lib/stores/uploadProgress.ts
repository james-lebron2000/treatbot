/**
 * =============================================================================
 * 上传进度状态管理
 * Upload Progress State Management
 * =============================================================================
 * Linus哲学：用最简单的数据结构表达最完整的状态
 * Good taste: Simple data structures express complete states
 * =============================================================================
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { JsonValue } from '@/types';

// =============================================================================
// 核心类型定义 / Core Type Definitions
// =============================================================================

export type UploadStatus =
  | 'idle'           // 空闲 / Idle
  | 'uploading'      // 上传中 / Uploading
  | 'processing'     // 处理中 / Processing
  | 'completed'      // 完成 / Completed
  | 'error'          // 错误 / Error
  | 'cancelled';     // 取消 / Cancelled

export type ProcessingStage =
  | 'ocr'           // OCR文本识别 / OCR Text Recognition
  | 'parsing'       // 医疗文本解析 / Medical Text Parsing
  | 'matching'      // 临床试验匹配 / Clinical Trial Matching
  | 'complete';     // 处理完成 / Processing Complete

export interface UploadProgress {
  status: UploadStatus;
  progress: number;           // 0-100 进度百分比 / Progress percentage
  message: string;            // 当前状态描述 / Current status description
  stage?: ProcessingStage;    // 处理阶段 / Processing stage
  stageProgress?: number;     // 阶段内进度 / Stage progress
  estimatedTime?: number;     // 预估剩余时间(秒) / Estimated remaining time (seconds)
  fileName?: string;          // 文件名 / File name
  fileSize?: number;          // 文件大小(字节) / File size (bytes)
  error?: string;             // 错误信息 / Error message
  retryCount?: number;        // 重试次数 / Retry count
  startTime?: number;         // 开始时间戳 / Start timestamp
  processingTime?: number;    // 已处理时间(秒) / Processing time (seconds)
}

export interface UploadTask {
  id: string;
  uploadProgress: UploadProgress;
  createdAt: number;
  updatedAt: number;
}

// =============================================================================
 // 状态存储接口 / State Store Interface
// =============================================================================

interface UploadProgressState {
  // 当前活跃任务 / Active tasks
  activeUploads: Record<string, UploadTask>;

  // 历史完成任务(保留最近50个) / Historical completed tasks (keep last 50)
  completedUploads: UploadTask[];

  // 全局设置 / Global settings
  settings: {
    enableNotifications: boolean;
    enableSound: boolean;
    autoRetry: boolean;
    maxRetryCount: number;
  };
}

interface UploadProgressActions {
  // 任务生命周期管理 / Task lifecycle management
  addUpload: (id: string, file: File, patientId?: string) => void;
  updateProgress: (id: string, updates: Partial<UploadProgress>) => void;
  completeUpload: (id: string, result?: JsonValue) => void;
  failUpload: (id: string, error: string) => void;
  cancelUpload: (id: string) => void;
  removeUpload: (id: string) => void;

  // 批量操作 / Batch operations
  clearCompleted: () => void;
  retryUpload: (id: string) => void;

  // 设置管理 / Settings management
  updateSettings: (settings: Partial<UploadProgressState['settings']>) => void;

  // 工具函数 / Utility functions
  getActiveUploads: () => UploadTask[];
  getUploadById: (id: string) => UploadTask | undefined;
  hasActiveUploads: () => boolean;
  getTotalProgress: () => number;
}

// =============================================================================
// 默认状态 / Default State
// =============================================================================

const defaultProgress: UploadProgress = {
  status: 'idle',
  progress: 0,
  message: 'Ready to upload',
  stage: undefined,
  stageProgress: 0,
  estimatedTime: undefined,
  retryCount: 0,
  startTime: undefined,
  processingTime: 0,
};

const defaultSettings = {
  enableNotifications: true,
  enableSound: false,
  autoRetry: true,
  maxRetryCount: 3,
};

// =============================================================================
// 辅助函数 / Helper Functions
// =============================================================================

/**
 * 生成上传任务ID / Generate upload task ID
 */
function generateUploadId(): string {
  return `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 格式化文件大小 / Format file size
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 计算预估剩余时间 / Calculate estimated remaining time
 */
function calculateEstimatedTime(
  progress: number,
  startTime: number,
  currentTime: number = Date.now()
): number {
  if (progress <= 0 || progress >= 100) return 0;

  const elapsed = (currentTime - startTime) / 1000; // 秒 / seconds
  const rate = progress / elapsed; // 进度/秒 / progress per second

  return Math.round((100 - progress) / rate); // 剩余秒数 / remaining seconds
}

/**
 * 获取阶段描述消息 / Get stage description message
 */
function getStageMessage(stage: ProcessingStage, progress: number): string {
  const messages = {
    ocr: [
      '正在识别文档中的文字...',
      'OCR识别进行中，请稍候...',
      '文字识别即将完成...'
    ],
    parsing: [
      '正在解析医疗文本内容...',
      '医疗数据提取中...',
      '结构化处理即将完成...'
    ],
    matching: [
      '正在匹配临床试验...',
      '试验匹配进行中...',
      '匹配结果整理中...'
    ],
    complete: [
      '处理完成！',
      '所有步骤已完成',
      '准备就绪'
    ]
  };

  const stageMessages = messages[stage];
  const index = Math.min(Math.floor(progress / 33), stageMessages.length - 1);
  return stageMessages[index];
}

// =============================================================================
// 状态存储创建 / State Store Creation
// =============================================================================

export const useUploadProgressStore = create<UploadProgressState & UploadProgressActions>()(
  subscribeWithSelector((set, get) => ({
    // =============================================================================
    // 状态 / State
    // =============================================================================
    activeUploads: {},
    completedUploads: [],
    settings: defaultSettings,

    // =============================================================================
    // 动作 / Actions
    // =============================================================================

    /**
     * 添加新的上传任务 / Add new upload task
     */
    addUpload: (id: string, file: File, patientId?: string) => {
      const now = Date.now();
      const task: UploadTask = {
        id,
        uploadProgress: {
          ...defaultProgress,
          status: 'uploading',
          progress: 0,
          message: `准备上传 ${file.name}...`,
          fileName: file.name,
          fileSize: file.size,
          startTime: now,
        },
        createdAt: now,
        updatedAt: now,
      };

      set((state) => ({
        activeUploads: { ...state.activeUploads, [id]: task },
      }));

      // 触发上传开始事件 / Trigger upload start event
      const shouldNotify = get().settings.enableNotifications;
      if (typeof window !== 'undefined' && shouldNotify) {
        window.dispatchEvent(new CustomEvent('upload:start', { detail: { task, patientId } }));
      }
    },

    /**
     * 更新上传进度 / Update upload progress
     */
    updateProgress: (id: string, updates: Partial<UploadProgress>) => {
      set((state) => {
        const task = state.activeUploads[id];
        if (!task) return state;

        const now = Date.now();
        const currentProgress = task.uploadProgress.progress;
        const newProgress = updates.progress ?? currentProgress;

        // 计算处理时间和预估时间 / Calculate processing time and estimated time
        let estimatedTime = updates.estimatedTime;
        let processingTime = updates.processingTime;

        if (task.uploadProgress.startTime) {
          processingTime = Math.round((now - task.uploadProgress.startTime) / 1000);

          if (newProgress > currentProgress && newProgress < 100) {
            estimatedTime = calculateEstimatedTime(
              newProgress,
              task.uploadProgress.startTime,
              now
            );
          }
        }

        // 生成阶段消息 / Generate stage message
        let message = updates.message ?? task.uploadProgress.message;
        if (updates.stage && !updates.message) {
          message = getStageMessage(updates.stage, updates.stageProgress || 0);
        }

        const updatedProgress: UploadProgress = {
          ...task.uploadProgress,
          ...updates,
          progress: newProgress,
          message,
          estimatedTime,
          processingTime,
        };

        const updatedTask: UploadTask = {
          ...task,
          uploadProgress: updatedProgress,
          updatedAt: now,
        };

        return {
          activeUploads: { ...state.activeUploads, [id]: updatedTask },
        };
      });
    },

    /**
     * 完成上传任务 / Complete upload task
     */
    completeUpload: (id: string, result?: JsonValue) => {
      set((state) => {
        const task = state.activeUploads[id];
        if (!task) return state;

        const completedTask: UploadTask = {
          ...task,
          uploadProgress: {
            ...task.uploadProgress,
            status: 'completed',
            progress: 100,
            message: '处理完成',
            stage: 'complete',
            stageProgress: 100,
            estimatedTime: 0,
          },
          updatedAt: Date.now(),
        };

        // 移动到完成列表 / Move to completed list
        const newCompleted = [...state.completedUploads, completedTask].slice(-50); // 保留最近50个 / Keep last 50

        // 从活跃列表移除 / Remove from active list
        const remainingActive = { ...state.activeUploads };
        delete remainingActive[id];

        return {
          activeUploads: remainingActive,
          completedUploads: newCompleted,
        };
      });

      // 触发完成事件 / Trigger completion event
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('upload:complete', { detail: { id, result } }));
      }
    },

    /**
     * 上传任务失败 / Upload task failed
     */
    failUpload: (id: string, error: string) => {
      set((state) => {
        const task = state.activeUploads[id];
        if (!task) return state;

        const failedTask: UploadTask = {
          ...task,
          uploadProgress: {
            ...task.uploadProgress,
            status: 'error',
            message: '处理失败',
            error,
            estimatedTime: 0,
          },
          updatedAt: Date.now(),
        };

        return {
          activeUploads: { ...state.activeUploads, [id]: failedTask },
        };
      });

      // 触发失败事件 / Trigger failure event
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('upload:error', { detail: { id, error } }));
      }
    },

    /**
     * 取消上传任务 / Cancel upload task
     */
    cancelUpload: (id: string) => {
      set((state) => {
        const task = state.activeUploads[id];
        if (!task) return state;

        const cancelledTask: UploadTask = {
          ...task,
          uploadProgress: {
            ...task.uploadProgress,
            status: 'cancelled',
            message: '已取消',
            estimatedTime: 0,
          },
          updatedAt: Date.now(),
        };

        return {
          activeUploads: { ...state.activeUploads, [id]: cancelledTask },
        };
      });
    },

    /**
     * 移除上传任务 / Remove upload task
     */
    removeUpload: (id: string) => {
      set((state) => {
        const remaining = { ...state.activeUploads };
        delete remaining[id];
        return {
          activeUploads: remaining,
        };
      });
    },

    /**
     * 清空已完成任务 / Clear completed tasks
     */
    clearCompleted: () => {
      set({ completedUploads: [] });
    },

    /**
     * 重试上传任务 / Retry upload task
     */
    retryUpload: (id: string) => {
      const state = get();
      const task = state.activeUploads[id];

      if (!task) return;

      // 检查重试次数 / Check retry count
      if ((task.uploadProgress.retryCount || 0) >= state.settings.maxRetryCount) {
        return;
      }

      // 重置状态 / Reset state
      get().updateProgress(id, {
        status: 'uploading',
        progress: 0,
        message: '正在重试...',
        error: undefined,
        retryCount: (task.uploadProgress.retryCount || 0) + 1,
        startTime: Date.now(),
        processingTime: 0,
        estimatedTime: undefined,
      });

      // 触发重试事件 / Trigger retry event
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('upload:retry', { detail: { id } }));
      }
    },

    /**
     * 更新设置 / Update settings
     */
    updateSettings: (settings: Partial<UploadProgressState['settings']>) => {
      set((state) => ({
        settings: { ...state.settings, ...settings },
      }));
    },

    // =============================================================================
    // 查询函数 / Query Functions
    // =============================================================================

    /**
     * 获取所有活跃上传 / Get all active uploads
     */
    getActiveUploads: () => {
      return Object.values(get().activeUploads);
    },

    /**
     * 根据ID获取上传任务 / Get upload task by ID
     */
    getUploadById: (id: string) => {
      return get().activeUploads[id];
    },

    /**
     * 检查是否有活跃上传 / Check if has active uploads
     */
    hasActiveUploads: () => {
      return Object.keys(get().activeUploads).length > 0;
    },

    /**
     * 获取总体进度 / Get total progress
     */
    getTotalProgress: () => {
      const activeUploads = get().getActiveUploads();
      if (activeUploads.length === 0) return 0;

      const totalProgress = activeUploads.reduce((sum, task) =>
        sum + task.uploadProgress.progress, 0
      );

      return Math.round(totalProgress / activeUploads.length);
    },
  }))
);

// =============================================================================
// 选择器 / Selectors
// =============================================================================

/**
 * 获取所有活跃上传(按时间排序) / Get all active uploads (sorted by time)
 */
export const useActiveUploads = () =>
  useUploadProgressStore((state) =>
    Object.values(state.activeUploads).sort((a, b) => b.createdAt - a.createdAt)
  );

/**
 * 获取上传任务 / Get upload task
 */
export const useUploadTask = (id: string) =>
  useUploadProgressStore((state) => state.activeUploads[id]);

/**
 * 获取总体进度 / Get total progress
 */
export const useTotalUploadProgress = () =>
  useUploadProgressStore((state) => {
    const activeUploads = Object.values(state.activeUploads);
    if (activeUploads.length === 0) return 0;

    const totalProgress = activeUploads.reduce((sum, task) =>
      sum + task.uploadProgress.progress, 0
    );

    return Math.round(totalProgress / activeUploads.length);
  });

/**
 * 是否有活跃上传 / Has active uploads
 */
export const useHasActiveUploads = () =>
  useUploadProgressStore((state) => Object.keys(state.activeUploads).length > 0);

// =============================================================================
// 工具函数导出 / Utility Functions Export
// =============================================================================

export {
  generateUploadId,
  formatFileSize,
  calculateEstimatedTime,
  getStageMessage,
  defaultProgress,
  defaultSettings,
};
