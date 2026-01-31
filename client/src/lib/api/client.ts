// ============================================================================
// 统一 API 客户端
// ============================================================================
// 职责：
//   1. 提供单一的 HTTP 客户端实例，消除 axios/fetch 双轨制
//   2. 自动注入认证 token (从 localStorage 读取)
//   3. 自动解包服务端响应 (success + data 结构)
//   4. 统一错误处理 (转换为 ApiError)
//   5. 支持请求/响应日志 (开发环境)
// ============================================================================

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { ApiError, fromAxiosError } from './errors';

// ----------------------------------------------------------------------------
// 环境配置
// ----------------------------------------------------------------------------

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5001/api';
const API_TIMEOUT = 30000; // 30 秒超时
const IS_DEV = process.env.NODE_ENV === 'development';

// ----------------------------------------------------------------------------
// 创建 axios 实例
// ----------------------------------------------------------------------------

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ============================================================================
// 请求拦截器 - 自动注入认证 token
// ============================================================================

apiClient.interceptors.request.use(
  (config) => {
    // 开发环境：打印请求日志
    if (IS_DEV) {
      console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`, {
        params: config.params,
        data: config.data,
      });
    }

    // 仅在浏览器环境执行 (避免 SSR 错误)
    if (typeof window === 'undefined') {
      return config;
    }

    // 从 localStorage 读取 auth token
    try {
      const authData = localStorage.getItem('auth-storage');
      if (authData) {
        const { token } = JSON.parse(authData).state;
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
      }
    } catch (error) {
      // 静默失败 - token 解析失败不应阻塞请求
      if (IS_DEV) {
        console.warn('[API] Failed to parse auth token:', error);
      }
    }

    return config;
  },
  (error) => {
    // 请求配置错误 (几乎不会发生)
    return Promise.reject(fromAxiosError(error));
  }
);

// ============================================================================
// 响应拦截器 - 自动解包 + 错误处理
// ============================================================================

apiClient.interceptors.response.use(
  (response: AxiosResponse) => {
    // 开发环境：打印响应日志
    if (IS_DEV) {
      console.log(`[API] ✓ ${response.config.url}`, response.data);
    }

    // 自动解包 { success: true, data: {...} } 结构
    // 消除调用方的 response.data.data 重复访问
    if (response.data?.success && response.data?.data !== undefined) {
      return { ...response, data: response.data.data };
    }

    // 其他格式直接返回 (如文件流、纯文本等)
    return response;
  },
  (error) => {
    // 开发环境：打印错误日志
    if (IS_DEV) {
      console.error(`[API] ✗ ${error.config?.url}`, {
        status: error.response?.status,
        message: error.response?.data?.message || error.message,
      });
    }

    // 转换为统一的 ApiError
    const apiError = fromAxiosError(error);

    // 特殊处理：401 自动清除本地 token (可选)
    if (apiError.isAuthError && typeof window !== 'undefined') {
      localStorage.removeItem('auth-storage');

      // 可选：自动跳转到登录页
      // window.location.href = '/auth/login';
    }

    return Promise.reject(apiError);
  }
);

// ============================================================================
// 类型安全的辅助函数
// ============================================================================

/**
 * 解包响应数据 (兼容旧代码)
 *
 * 注意：拦截器已自动解包 { success, data } 结构
 * 这个函数主要用于类型提取和向后兼容
 */
export function unwrapResponse<T = any>(response: AxiosResponse): { data: T; message?: string } {
  // 如果响应已经被拦截器解包，直接使用
  return {
    data: response.data as T,
    message: response.data?.message,
  };
}

/**
 * GET 请求辅助函数
 *
 * 用法：
 *   const user = await get<User>('/users/me');
 */
export async function get<T = any>(
  url: string,
  config?: AxiosRequestConfig
): Promise<T> {
  const response = await apiClient.get<T>(url, config);
  return response.data;
}

/**
 * POST 请求辅助函数
 *
 * 用法：
 *   const result = await post<LoginResponse>('/auth/login', { email, password });
 */
export async function post<T = any>(
  url: string,
  data?: any,
  config?: AxiosRequestConfig
): Promise<T> {
  const response = await apiClient.post<T>(url, data, config);
  return response.data;
}

/**
 * PUT 请求辅助函数
 */
export async function put<T = any>(
  url: string,
  data?: any,
  config?: AxiosRequestConfig
): Promise<T> {
  const response = await apiClient.put<T>(url, data, config);
  return response.data;
}

/**
 * PATCH 请求辅助函数
 */
export async function patch<T = any>(
  url: string,
  data?: any,
  config?: AxiosRequestConfig
): Promise<T> {
  const response = await apiClient.patch<T>(url, data, config);
  return response.data;
}

/**
 * DELETE 请求辅助函数
 */
export async function del<T = any>(
  url: string,
  config?: AxiosRequestConfig
): Promise<T> {
  const response = await apiClient.delete<T>(url, config);
  return response.data;
}

// ============================================================================
// 文件上传辅助函数
// ============================================================================

/**
 * 上传单个文件
 *
 * 用法：
 *   const result = await uploadFile('/medical/upload', file, {
 *     onUploadProgress: (percent) => console.log(percent)
 *   });
 */
export async function uploadFile<T = any>(
  url: string,
  file: File,
  options?: {
    onUploadProgress?: (percent: number) => void;
    additionalData?: Record<string, any>;
  }
): Promise<T> {
  const formData = new FormData();
  formData.append('file', file);

  // 添加额外字段
  if (options?.additionalData) {
    Object.entries(options.additionalData).forEach(([key, value]) => {
      formData.append(key, typeof value === 'string' ? value : JSON.stringify(value));
    });
  }

  const response = await apiClient.post<T>(url, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    onUploadProgress: (progressEvent) => {
      if (options?.onUploadProgress && progressEvent.total) {
        const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        options.onUploadProgress(percent);
      }
    },
  });

  return response.data;
}

/**
 * 上传多个文件
 */
export async function uploadFiles<T = any>(
  url: string,
  files: File[],
  options?: {
    onUploadProgress?: (percent: number) => void;
    additionalData?: Record<string, any>;
  }
): Promise<T> {
  const formData = new FormData();

  files.forEach((file) => {
    formData.append('files', file);
  });

  if (options?.additionalData) {
    Object.entries(options.additionalData).forEach(([key, value]) => {
      formData.append(key, typeof value === 'string' ? value : JSON.stringify(value));
    });
  }

  const response = await apiClient.post<T>(url, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    onUploadProgress: (progressEvent) => {
      if (options?.onUploadProgress && progressEvent.total) {
        const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        options.onUploadProgress(percent);
      }
    },
  });

  return response.data;
}

// ============================================================================
// 导出默认客户端
// ============================================================================

export default apiClient;
