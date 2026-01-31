/**
 * =============================================================================
 * 上传进度API
 * Upload Progress API
 * =============================================================================
 * Linus哲学：API客户端要像内核模块一样简洁可靠
 * Good taste: API client should be as concise and reliable as kernel modules
 * =============================================================================
 */

import { apiClient, unwrapResponse } from './api';
import type { JsonValue } from '@/types';

// =============================================================================
// 类型定义 / Type Definitions
// =============================================================================

export type UploadStatus =
  | 'idle'
  | 'uploading'
  | 'processing'
  | 'completed'
  | 'error'
  | 'cancelled';

export type ProcessingStage =
  | 'ocr'
  | 'parsing'
  | 'matching'
  | 'complete';

export interface UploadProgress {
  id: string;
  status: UploadStatus;
  progress: number;
  stage?: ProcessingStage;
  stageProgress?: number;
  message: string;
  fileName?: string;
  fileSize?: number;
  error?: string;
  retryCount?: number;
  startTime?: number;
  processingTime?: number;
  estimatedTime?: number;
  userId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUploadTaskRequest {
  uploadId: string;
  fileName?: string;
  fileSize?: number;
  patientId?: string;
  recordId?: string;
}

export interface UpdateProgressRequest {
  progress?: number;
  status?: UploadStatus;
  stage?: ProcessingStage;
  stageProgress?: number;
  message?: string;
  error?: string;
  estimatedTime?: number;
}

export interface StageProgressRequest {
  stageProgress: number;
  message?: string;
}

export interface CompleteUploadRequest {
  result?: JsonValue;
}

export interface FailUploadRequest {
  error: string;
  retryable?: boolean;
}

// =============================================================================
// API响应类型 / API Response Types
// =============================================================================

export interface UploadTaskResponse {
  upload: UploadProgress;
}

export interface UserUploadsResponse {
  uploads: UploadProgress[];
}

export interface AllUploadsResponse {
  uploads: UploadProgress[];
  statistics: {
    totalActive: number;
    byStatus: Record<string, number>;
    byStage: Record<string, number>;
    averageProcessingTime: number;
    timestamp: string;
  };
}

export interface ServiceStatusResponse {
  status: string;
  activeUploads: number;
  uptime: number;
  memoryUsage?: Record<string, number>;
  timestamp: string;
}

export interface ServiceStatistics {
  totalActive: number;
  byStatus: Record<string, number>;
  byStage: Record<string, number>;
  averageProcessingTime: number;
  timestamp: string;
}

// =============================================================================
// 上传进度API客户端 / Upload Progress API Client
// =============================================================================

export const uploadProgressApi = {
  /**
   * 创建上传进度任务 / Create upload progress task
   */
  async createTask(request: CreateUploadTaskRequest): Promise<UploadProgress> {
    try {
      const response = await apiClient.post<UploadProgress>(
        '/upload-progress',
        request
      );
      const { data } = unwrapResponse(response);

      // Defensive: ensure valid data
      if (!data || typeof data !== 'object') {
        throw new Error('上传进度服务返回异常');
      }

      return data;
    } catch (error: any) {
      if (error.name === 'ApiError') {
        throw error;
      }

      throw new Error(error.message || '创建上传任务失败');
    }
  },

  /**
   * 获取上传进度 / Get upload progress
   */
  async getProgress(uploadId: string): Promise<UploadProgress> {
    const response = await apiClient.get<UploadProgress>(
      `/upload-progress/${uploadId}`
    );
    const { data } = unwrapResponse(response);
    return data;
  },

  /**
   * 更新上传进度 / Update upload progress
   */
  async updateProgress(uploadId: string, updates: UpdateProgressRequest): Promise<UploadProgress> {
    const response = await apiClient.patch<UploadProgress>(
      `/upload-progress/${uploadId}`,
      updates
    );
    const { data } = unwrapResponse(response);
    return data;
  },

  /**
   * 开始处理阶段 / Start processing stage
   */
  async startStage(uploadId: string, stage: ProcessingStage, message?: string): Promise<UploadProgress> {
    try {
      const response = await apiClient.post<UploadProgress>(
        `/upload-progress/${uploadId}/stage`,
        { stage, message }
      );
      const { data } = unwrapResponse(response);

      // Defensive: ensure valid data
      if (!data || typeof data !== 'object') {
        throw new Error('上传进度服务返回异常');
      }

      return data;
    } catch (error: any) {
      if (error.name === 'ApiError') {
        throw error;
      }

      throw new Error(error.message || '启动处理阶段失败');
    }
  },

  /**
   * 更新阶段进度 / Update stage progress
   */
  async updateStageProgress(uploadId: string, stageProgress: number, message?: string): Promise<UploadProgress> {
    const response = await apiClient.patch<UploadProgress>(
      `/upload-progress/${uploadId}/stage`,
      { stageProgress, message }
    );
    const { data } = unwrapResponse(response);
    return data;
  },

  /**
   * 完成上传任务 / Complete upload task
   */
  async completeUpload(uploadId: string, result?: JsonValue): Promise<UploadProgress> {
    try {
      const response = await apiClient.post<UploadProgress>(
        `/upload-progress/${uploadId}/complete`,
        { result }
      );
      const { data } = unwrapResponse(response);

      // Defensive: ensure valid data
      if (!data || typeof data !== 'object') {
        throw new Error('上传进度服务返回异常');
      }

      return data;
    } catch (error: any) {
      if (error.name === 'ApiError') {
        throw error;
      }

      throw new Error(error.message || '完成上传任务失败');
    }
  },

  /**
   * 失败上传任务 / Fail upload task
   */
  async failUpload(uploadId: string, error: string, retryable = true): Promise<UploadProgress> {
    try {
      const response = await apiClient.post<UploadProgress>(
        `/upload-progress/${uploadId}/fail`,
        { error, retryable }
      );
      const { data } = unwrapResponse(response);

      // Defensive: ensure valid data
      if (!data || typeof data !== 'object') {
        throw new Error('上传进度服务返回异常');
      }

      return data;
    } catch (err: any) {
      if (err.name === 'ApiError') {
        throw err;
      }

      throw new Error(err.message || '标记上传失败状态失败');
    }
  },

  /**
   * 取消上传任务 / Cancel upload task
   */
  async cancelUpload(uploadId: string): Promise<UploadProgress> {
    const response = await apiClient.post<UploadProgress>(
      `/upload-progress/${uploadId}/cancel`
    );
    const { data } = unwrapResponse(response);
    return data;
  },

  /**
   * 获取用户的所有活跃上传 / Get all active uploads for user
   */
  async getUserActiveUploads(): Promise<UploadProgress[]> {
    const response = await apiClient.get<UserUploadsResponse>(
      '/upload-progress/user/active'
    );
    const { data } = unwrapResponse(response);
    return data.uploads;
  },

  /**
   * 获取所有上传任务(管理员) / Get all upload tasks (admin)
   */
  async getAllUploads(): Promise<AllUploadsResponse> {
    const response = await apiClient.get<AllUploadsResponse>(
      '/upload-progress/all'
    );
    const { data } = unwrapResponse(response);
    return data;
  },

  /**
   * 获取服务状态 / Get service status
   */
  async getServiceStatus(): Promise<ServiceStatusResponse> {
    const response = await apiClient.get<ServiceStatusResponse>(
      '/upload-progress/status'
    );
    const { data } = unwrapResponse(response);
    return data;
  },

  /**
   * 获取服务统计 / Get service statistics
   */
  async getServiceStatistics(): Promise<ServiceStatistics> {
    const response = await apiClient.get<ServiceStatistics>(
      '/upload-progress/statistics'
    );
    const { data } = unwrapResponse(response);
    return data;
  },

  /**
   * 清理上传任务 / Clean up upload task
   */
  async cleanupUpload(uploadId: string): Promise<void> {
    await apiClient.delete(`/upload-progress/${uploadId}`);
  },
};

// =============================================================================
// SSE客户端 / SSE Client
// =============================================================================

export interface SSEProgressCallback {
  onProgress?: (progress: UploadProgress) => void;
  onComplete?: (progress: UploadProgress) => void;
  onError?: (error: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

/**
 * 连接SSE获取实时进度 / Connect SSE for real-time progress
 */
export function connectSSE(
  uploadId: string,
  callbacks: SSEProgressCallback = {}
): EventSource {
  const eventSource = new EventSource(`/api/upload-progress/${uploadId}/stream`);

  eventSource.onopen = () => {
    console.log(`SSE connection opened for upload ${uploadId}`);
    callbacks.onOpen?.();
  };

  eventSource.onmessage = (event: MessageEvent<string>) => {
    try {
      const data = JSON.parse(event.data) as UploadProgress;
      callbacks.onProgress?.(data);
    } catch (error) {
      console.error('Failed to parse SSE message:', error);
    }
  };

  eventSource.addEventListener('complete', (event) => {
    try {
      const data = JSON.parse((event as MessageEvent<string>).data) as UploadProgress;
      callbacks.onComplete?.(data);
    } catch (error) {
      console.error('Failed to parse SSE complete event:', error);
    }
  });

  eventSource.addEventListener('error', (event) => {
    try {
      const rawData = (event as MessageEvent<string>)?.data;
      if (typeof rawData === 'string' && rawData.length > 0) {
        const data = JSON.parse(rawData) as { error?: string };
        callbacks.onError?.(data.error || 'Unknown error');
      } else {
        callbacks.onError?.('Unknown error');
      }
    } catch {
      callbacks.onError?.('Failed to parse SSE error event');
    }
  });

  eventSource.onerror = (error) => {
    console.error(`SSE connection error for upload ${uploadId}:`, error);
    callbacks.onError?.('SSE connection error');
    callbacks.onClose?.();
  };

  return eventSource;
}

/**
 * 断开SSE连接 / Disconnect SSE connection
 */
export function disconnectSSE(eventSource: EventSource | null): void {
  if (eventSource) {
    eventSource.close();
  }
}

// =============================================================================
// 工具函数 / Utility Functions
// =============================================================================

/**
 * 格式化文件大小 / Format file size
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 格式化时间 / Format time
 */
export function formatTime(seconds: number): string {
  if (seconds <= 0) return '';
  if (seconds < 60) return `${seconds}秒`;
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}

/**
 * 计算预估剩余时间 / Calculate estimated remaining time
 */
export function calculateEstimatedTime(
  progress: number,
  startTime: number,
  currentTime: number = Date.now()
): number {
  if (progress <= 0 || progress >= 100) return 0;

  const elapsed = (currentTime - startTime) / 1000;
  const rate = progress / elapsed;

  return Math.round((100 - progress) / rate);
}

/**
 * 获取处理阶段描述 / Get processing stage description
 */
export function getStageDescription(stage: ProcessingStage): string {
  const descriptions = {
    ocr: 'OCR文字识别',
    parsing: '医疗文本解析',
    matching: '临床试验匹配',
    complete: '处理完成'
  };
  return descriptions[stage] || '处理中';
}

/**
 * 获取状态颜色 / Get status color
 */
export function getStatusColor(status: UploadStatus): string {
  const colors = {
    idle: 'gray',
    uploading: 'blue',
    processing: 'purple',
    completed: 'green',
    error: 'red',
    cancelled: 'gray'
  };
  return colors[status] || 'gray';
}

/**
 * 生成上传ID / Generate upload ID
 */
export function generateUploadId(): string {
  return `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export default uploadProgressApi;
