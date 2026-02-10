// ============================================================================
// API 错误处理类
// ============================================================================
// 职责：
//   1. 统一所有 API 错误的表示形式
//   2. 提供语义化的错误类型判断（认证错误、网络错误等）
//   3. 消除特殊情况 - 所有错误都走同一个类
// ============================================================================

/**
 * 统一的 API 错误类
 *
 * 设计原则：
 * - 消除分支：所有 API 错误都是 ApiError，不需要 instanceof 判断多个类
 * - 语义化属性：通过 getter 提供清晰的错误类型判断
 * - 完整信息：保留 HTTP status、业务 code、详细信息，便于调试
 */
export class ApiError extends Error {
  constructor(
    public status: number,          // HTTP 状态码 (0 表示网络错误)
    message: string,                // 人类可读的错误信息
    public code?: string,           // 业务错误码 (如 'INVALID_TOKEN')
    public details?: unknown,       // 额外的错误详情 (验证错误等)
    public traceId?: string         // 服务端 traceId（用于线上定位）
  ) {
    super(message);
    this.name = 'ApiError';

    // 保持正确的原型链 (TypeScript 编译后需要)
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  // ------------------------------------------------------------------------
  // 语义化错误类型判断 - 消除调用方的 if/else 分支
  // ------------------------------------------------------------------------

  /** 是否为认证错误 (401) */
  get isAuthError(): boolean {
    return this.status === 401;
  }

  /** 是否为权限错误 (403) */
  get isForbiddenError(): boolean {
    return this.status === 403;
  }

  /** 是否为资源不存在 (404) */
  get isNotFoundError(): boolean {
    return this.status === 404;
  }

  /** 是否为客户端错误 (4xx) */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  /** 是否为服务器错误 (5xx) 或网络错误 (status=0) */
  get isServerError(): boolean {
    return this.status === 0 || this.status >= 500;
  }

  /** 是否为网络错误 (无法连接服务器) */
  get isNetworkError(): boolean {
    return this.status === 0;
  }

  /** 是否可以重试 (网络错误或 5xx 错误) */
  get isRetryable(): boolean {
    return this.isNetworkError || this.status >= 500;
  }

  // ------------------------------------------------------------------------
  // 调试辅助
  // ------------------------------------------------------------------------

  /**
   * 生成结构化的错误信息，便于日志记录
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      code: this.code,
      details: this.details,
      traceId: this.traceId,
    };
  }

  /**
   * 生成人类可读的完整错误描述
   */
  toString(): string {
    const parts = [`[${this.status}] ${this.message}`];
    if (this.code) parts.push(`(code: ${this.code})`);
    return parts.join(' ');
  }
}

// ============================================================================
// 工厂函数 - 从 axios error 创建 ApiError
// ============================================================================

/**
 * 从 axios 错误对象提取信息并创建 ApiError
 *
 * 消除特殊情况：
 * - 不管是网络错误、超时、还是 HTTP 错误，都返回同一个 ApiError
 * - 调用方不需要判断错误类型，直接使用 ApiError 的语义化属性
 */
export function fromAxiosError(error: unknown): ApiError {
  const err = error as {
    message?: string;
    response?: {
      status?: number;
      data?: unknown;
      headers?: Record<string, unknown>;
    };
  } | null | undefined;

  // 防御性处理：确保 error 存在
  if (!err) {
    return new ApiError(0, 'Unknown error occurred', 'UNKNOWN_ERROR');
  }

  // 网络错误或请求未发出
  if (!err.response) {
    return new ApiError(
      0,
      err.message || '网络连接失败，请检查网络设置',
      'NETWORK_ERROR'
    );
  }

  // HTTP 错误响应
  const status = typeof err.response.status === 'number' ? err.response.status : 0;
  const data = err.response.data;

  // 更defensive的消息提取
  let message = '请求失败';
  if (data) {
    if (typeof data === 'string') {
      message = data;
    } else if (typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      if (typeof obj.message === 'string') {
        message = obj.message;
      } else if (typeof obj.error === 'string') {
        message = obj.error;
      }
    }
  }

  // 如果都没有，使用error.message
  if (message === '请求失败' && err.message) {
    message = err.message;
  }

  const dataObj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  const code = dataObj && typeof dataObj.code === 'string' ? dataObj.code : undefined;
  const details = dataObj ? (dataObj.details ?? dataObj.errors) : undefined;
  const traceIdFromBody = dataObj && typeof dataObj.traceId === 'string' ? dataObj.traceId : undefined;
  const headers = err.response && typeof err.response.headers === 'object' && err.response.headers ? err.response.headers : null;
  const traceIdFromHeader =
    headers && typeof headers['x-request-id'] === 'string' ? (headers['x-request-id'] as string) : undefined;
  const traceId = traceIdFromBody || traceIdFromHeader;

  return new ApiError(status, message, code, details, traceId);
}
