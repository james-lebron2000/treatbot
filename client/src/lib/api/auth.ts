// ============================================================================
// 认证 API - 统一实现
// ============================================================================
// 职责：
//   1. 提供类型安全的认证相关 API 调用
//   2. 使用 Zod schema 验证请求/响应
//   3. 统一的错误处理（通过 apiClient）
//   4. 单一数据源 - 替代旧的 lib/api.ts 和 lib/api/api.ts
// ============================================================================
// 设计原则：
//   - 消除特殊情况：所有 API 都走统一的 client
//   - 类型安全：请求/响应都有 Zod 验证
//   - 简洁：每个函数只做一件事
// ============================================================================

import { post, get, patch } from './client';
import { ApiError } from './errors';
import {
  LoginRequest,
  LoginResponse,
  LoginRequestSchema,
  LoginResponseSchema,
  RegisterRequest,
  RegisterResponse,
  RegisterRequestSchema,
  RegisterResponseSchema,
  GetCurrentUserResponse,
  GetCurrentUserResponseSchema,
  UpdateProfileRequest,
  UpdateProfileResponse,
  UpdateProfileRequestSchema,
  UpdateProfileResponseSchema,
  ChangePasswordRequest,
  ChangePasswordResponse,
  ChangePasswordRequestSchema,
  ChangePasswordResponseSchema,
  RequestOtpRequest,
  RequestOtpResponse,
  RequestOtpRequestSchema,
  RequestOtpResponseSchema,
  VerifyOtpRequest,
  VerifyOtpResponse,
  VerifyOtpRequestSchema,
  VerifyOtpResponseSchema,
} from './schemas';

// ============================================================================
// 认证 API
// ============================================================================

/**
 * 用户登录
 *
 * POST /api/auth/login
 *
 * @example
 * const { token, user } = await login({
 *   email: 'user@example.com',
 *   password: 'Password123'
 * });
 */
export async function requestOtp(data: RequestOtpRequest): Promise<RequestOtpResponse> {
  const validatedData = RequestOtpRequestSchema.parse(data);
  const response = await post<RequestOtpResponse>('/auth/otp/request', validatedData);
  if (!response || typeof response !== 'object') {
    throw new ApiError(0, '服务器返回异常', 'INVALID_RESPONSE');
  }
  return RequestOtpResponseSchema.parse(response);
}

export async function verifyOtp(data: VerifyOtpRequest): Promise<VerifyOtpResponse> {
  const validatedData = VerifyOtpRequestSchema.parse(data);
  const response = await post<VerifyOtpResponse>('/auth/otp/verify', validatedData);
  if (!response || typeof response !== 'object') {
    throw new ApiError(0, '服务器返回异常', 'INVALID_RESPONSE');
  }
  return VerifyOtpResponseSchema.parse(response);
}

export async function login(data: LoginRequest): Promise<LoginResponse> {
  // 1. 验证请求数据
  const validatedData = LoginRequestSchema.parse(data);

  // 2. 发送请求（apiClient 自动处理错误和解包）
  const response = await post<LoginResponse>('/auth/login', validatedData);

  // 3. 防御性检查：确保响应包含必要字段
  if (!response || typeof response !== 'object') {
    throw new ApiError(0, '服务器返回异常', 'INVALID_RESPONSE');
  }

  // 4. 验证响应数据
  return LoginResponseSchema.parse(response);
}

/**
 * 用户注册
 *
 * POST /api/auth/register
 *
 * @example
 * const { token, user } = await register({
 *   email: 'newuser@example.com',
 *   password: 'Password123',
 *   name: 'John Doe'
 * });
 */
export async function register(data: RegisterRequest): Promise<RegisterResponse> {
  const validatedData = RegisterRequestSchema.parse(data);
  const response = await post<RegisterResponse>('/auth/register', validatedData);

  // 防御性检查
  if (!response || typeof response !== 'object') {
    throw new ApiError(0, '服务器返回异常', 'INVALID_RESPONSE');
  }

  return RegisterResponseSchema.parse(response);
}

/**
 * 获取当前登录用户信息
 *
 * GET /api/auth/me
 *
 * 需要 Authorization header（apiClient 自动注入）
 *
 * @example
 * const user = await getCurrentUser();
 */
export async function getCurrentUser(): Promise<GetCurrentUserResponse> {
  const response = await get<GetCurrentUserResponse>('/auth/me');
  return GetCurrentUserResponseSchema.parse(response);
}

/**
 * 更新用户信息
 *
 * PATCH /api/auth/profile
 *
 * @example
 * const { user } = await updateProfile({
 *   name: 'Jane Doe'
 * });
 */
export async function updateProfile(
  data: UpdateProfileRequest
): Promise<UpdateProfileResponse> {
  const validatedData = UpdateProfileRequestSchema.parse(data);
  const response = await patch<UpdateProfileResponse>('/auth/profile', validatedData);
  return UpdateProfileResponseSchema.parse(response);
}

/**
 * 修改密码
 *
 * POST /api/auth/change-password
 *
 * @example
 * await changePassword({
 *   currentPassword: 'OldPassword123',
 *   newPassword: 'NewPassword456'
 * });
 */
export async function changePassword(
  data: ChangePasswordRequest
): Promise<ChangePasswordResponse> {
  const validatedData = ChangePasswordRequestSchema.parse(data);
  const response = await post<ChangePasswordResponse>('/auth/change-password', validatedData);
  return ChangePasswordResponseSchema.parse(response);
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 登出（清除本地 token）
 *
 * 注意：这是纯前端操作，不调用后端 API
 */
export function logout(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('auth-storage');
  }
}

/**
 * 检查是否已登录
 *
 * 注意：这只检查本地 token 是否存在，不验证 token 有效性
 */
export function isAuthenticated(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    const authData = localStorage.getItem('auth-storage');
    if (!authData) return false;

    const { token } = JSON.parse(authData).state;
    return !!token;
  } catch {
    return false;
  }
}

/**
 * 获取本地存储的 token
 */
export function getStoredToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const authData = localStorage.getItem('auth-storage');
    if (!authData) return null;

    const { token } = JSON.parse(authData).state;
    return token || null;
  } catch {
    return null;
  }
}
