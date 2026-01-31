// ============================================================================
// 认证相关 React Hooks
// ============================================================================
// 职责：
//   1. 将认证 API 封装为 React hooks
//   2. 使用 TanStack Query 管理异步状态
//   3. 统一的错误处理和 loading 状态
//   4. 自动更新 Zustand store
// ============================================================================
// 设计原则：
//   - 简洁：每个 hook 只做一件事
//   - 声明式：组件只需关心状态，不关心如何获取
//   - 类型安全：完整的 TypeScript 支持
// ============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/stores/auth';
import * as authApi from '@/lib/api/auth';
import type {
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RegisterResponse,
  UpdateProfileRequest,
  UpdateProfileResponse,
  ChangePasswordRequest,
  ChangePasswordResponse,
  RequestOtpRequest,
  RequestOtpResponse,
  VerifyOtpRequest,
  VerifyOtpResponse,
} from '@/lib/api/schemas';
import { ApiError } from '@/lib/api';

// ============================================================================
// 登录 Hook
// ============================================================================

/**
 * 登录 Hook
 *
 * 用法：
 * ```tsx
 * const { mutate: login, isPending, error } = useLogin();
 *
 * const handleSubmit = (data: LoginRequest) => {
 *   login(data, {
 *     onSuccess: () => router.push('/dashboard')
 *   });
 * };
 * ```
 */
export function useRequestOtp() {
  return useMutation<RequestOtpResponse, ApiError, RequestOtpRequest>({
    mutationFn: authApi.requestOtp,
  });
}

export function useVerifyOtp() {
  const { login: storeLogin } = useAuthStore();
  const queryClient = useQueryClient();

  return useMutation<VerifyOtpResponse, ApiError, VerifyOtpRequest>({
    mutationFn: authApi.verifyOtp,

    onSuccess: (response) => {
      storeLogin(response.token, response.user);
      queryClient.setQueryData(['user', 'current'], response.user);
    },

    onError: (error) => {
      if (error.isAuthError) {
        authApi.logout();
      }
    },
  });
}

export function useLogin() {
  const { login: storeLogin } = useAuthStore();
  const queryClient = useQueryClient();

  return useMutation<LoginResponse, ApiError, LoginRequest>({
    mutationFn: authApi.login,

    onSuccess: (response) => {
      // 1. 更新 Zustand store
      storeLogin(response.token, response.user);

      // 2. 缓存用户数据到 React Query
      queryClient.setQueryData(['user', 'current'], response.user);
    },

    onError: (error) => {
      // 自动清理无效 token（如果是认证错误）
      if (error.isAuthError) {
        authApi.logout();
      }
    },
  });
}

// ============================================================================
// 注册 Hook
// ============================================================================

/**
 * 注册 Hook
 *
 * 用法：
 * ```tsx
 * const { mutate: register, isPending, error } = useRegister();
 *
 * const handleSubmit = (data: RegisterRequest) => {
 *   register(data, {
 *     onSuccess: () => router.push('/dashboard')
 *   });
 * };
 * ```
 */
export function useRegister() {
  const { login: storeLogin } = useAuthStore();
  const queryClient = useQueryClient();

  return useMutation<RegisterResponse, ApiError, RegisterRequest>({
    mutationFn: authApi.register,

    onSuccess: (response) => {
      // 注册成功后自动登录
      storeLogin(response.token, response.user);
      queryClient.setQueryData(['user', 'current'], response.user);
    },
  });
}

// ============================================================================
// 登出 Hook
// ============================================================================

/**
 * 登出 Hook
 *
 * 用法：
 * ```tsx
 * const { mutate: logout } = useLogout();
 *
 * const handleLogout = () => {
 *   logout();
 * };
 * ```
 */
export function useLogout() {
  const { logout: storeLogout } = useAuthStore();
  const queryClient = useQueryClient();

  return useMutation<void, never, void>({
    mutationFn: async () => {
      authApi.logout();
    },

    onSuccess: () => {
      // 1. 清除 Zustand store
      storeLogout();

      // 2. 清除所有 React Query 缓存
      queryClient.clear();
    },
  });
}

// ============================================================================
// 获取当前用户 Hook
// ============================================================================

/**
 * 获取当前用户信息 Hook
 *
 * 用法：
 * ```tsx
 * const { data: user, isLoading, error } = useCurrentUser();
 *
 * if (isLoading) return <Spinner />;
 * if (error) return <Error />;
 *
 * return <div>Welcome, {user.name}</div>;
 * ```
 *
 * 特性：
 * - 自动缓存（5 分钟内不重复请求）
 * - 只在已登录状态下请求
 * - 失败时自动清理 token
 */
export function useCurrentUser() {
  const { isAuthenticated, logout: storeLogout } = useAuthStore();

  return useQuery({
    queryKey: ['user', 'current'],
    queryFn: authApi.getCurrentUser,

    // 只在已登录时启用
    enabled: isAuthenticated,

    // 缓存 5 分钟
    staleTime: 5 * 60 * 1000,

    // 认证错误时自动登出
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.isAuthError) {
        storeLogout();
        return false;
      }
      return failureCount < 3;
    },
  });
}

// ============================================================================
// 更新用户信息 Hook
// ============================================================================

/**
 * 更新用户信息 Hook
 *
 * 用法：
 * ```tsx
 * const { mutate: updateProfile, isPending } = useUpdateProfile();
 *
 * const handleSubmit = (data: UpdateProfileRequest) => {
 *   updateProfile(data, {
 *     onSuccess: () => toast.success('更新成功')
 *   });
 * };
 * ```
 */
export function useUpdateProfile() {
  const { updateUser } = useAuthStore();
  const queryClient = useQueryClient();

  return useMutation<UpdateProfileResponse, ApiError, UpdateProfileRequest>({
    mutationFn: authApi.updateProfile,

    onSuccess: (response) => {
      // 1. 更新 Zustand store
      updateUser(response.user);

      // 2. 更新 React Query 缓存
      queryClient.setQueryData(['user', 'current'], response.user);
    },
  });
}

// ============================================================================
// 修改密码 Hook
// ============================================================================

/**
 * 修改密码 Hook
 *
 * 用法：
 * ```tsx
 * const { mutate: changePassword, isPending, error } = useChangePassword();
 *
 * const handleSubmit = (data: ChangePasswordRequest) => {
 *   changePassword(data, {
 *     onSuccess: () => {
 *       toast.success('密码修改成功，请重新登录');
 *       logout();
 *     }
 *   });
 * };
 * ```
 */
export function useChangePassword() {
  return useMutation<ChangePasswordResponse, ApiError, ChangePasswordRequest>({
    mutationFn: authApi.changePassword,

    // 密码修改成功后，建议用户重新登录
    // （可选：自动登出）
  });
}

// ============================================================================
// 认证状态 Hook（便捷访问）
// ============================================================================

/**
 * 认证状态 Hook
 *
 * 用法：
 * ```tsx
 * const { isAuthenticated, user, isLoading } = useAuthState();
 *
 * if (isLoading) return <Spinner />;
 * if (!isAuthenticated) return <LoginPrompt />;
 *
 * return <Dashboard user={user} />;
 * ```
 */
export function useAuthState() {
  const { isAuthenticated, user: storeUser } = useAuthStore();
  const { data: queryUser, isLoading } = useCurrentUser();

  return {
    isAuthenticated,
    user: queryUser ?? storeUser,
    isLoading: isAuthenticated && isLoading,
  };
}

// ============================================================================
// 类型导出
// ============================================================================

export type {
  LoginRequest,
  RegisterRequest,
  UpdateProfileRequest,
  ChangePasswordRequest,
};
