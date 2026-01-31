// =============================================================================
// 统一 API 层导出 - 新架构
// =============================================================================
// 设计原则：
//   1. 单一入口点，消除多文件混乱导入
//   2. 统一错误处理和类型验证
//   3. 替代旧的 api.ts、api/api.ts、medical.ts 等
// =============================================================================

// 核心客户端
export {
  apiClient,
  API_BASE_URL,
  unwrapResponse,
  get,
  post,
  put,
  patch,
  del,
  uploadFile,
  uploadFiles
} from './client';

// 错误处理
export { ApiError, fromAxiosError } from './errors';

// Axios 类型
export type { AxiosInstance, AxiosRequestConfig } from 'axios';

// Schema 定义 - 类型安全的基础
export * from './schemas';

// API 函数 - 按业务域组织
export * from './auth';

// TODO: 后续模块
// export * from './medical';
// export * from './patients';
// export * from './trials';

// 默认导出客户端实例
export { default as api } from './client';
