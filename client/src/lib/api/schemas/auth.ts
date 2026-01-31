// ============================================================================
// 认证相关 Schema 定义
// ============================================================================
// 职责：
//   1. 定义登录、注册、密码重置等认证 API 的请求/响应格式
//   2. 提供严格的输入验证，防止无效数据进入系统
//   3. 类型安全的 API 调用
// ============================================================================

import { z } from 'zod';
import { UserSchema, EmailSchema, PasswordSchema } from './common';

// ----------------------------------------------------------------------------
// 登录 API
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// 手机验证码登录（OTP）
// ----------------------------------------------------------------------------

export const PhoneSchema = z.string().trim().min(6, '请输入手机号');

export const RequestOtpRequestSchema = z.object({
  phone: PhoneSchema,
});
export type RequestOtpRequest = z.infer<typeof RequestOtpRequestSchema>;

export const RequestOtpResponseSchema = z.object({
  phone: z.string(),
  ttlSeconds: z.number().int().positive().optional(),
  message: z.string().optional(),
});
export type RequestOtpResponse = z.infer<typeof RequestOtpResponseSchema>;

export const VerifyOtpRequestSchema = z.object({
  phone: PhoneSchema,
  code: z.string().trim().regex(/^\d{6}$/, '请输入 6 位验证码'),
});
export type VerifyOtpRequest = z.infer<typeof VerifyOtpRequestSchema>;

export const VerifyOtpResponseSchema = z.object({
  token: z.string().min(1),
  user: UserSchema,
  message: z.string().optional(),
});
export type VerifyOtpResponse = z.infer<typeof VerifyOtpResponseSchema>;


/**
 * 登录请求 Schema
 *
 * POST /api/auth/login
 *
 * 注意：登录时不强制密码策略（因为是已存在的密码）
 */
export const LoginRequestSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, '密码不能为空'),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

// 与现有 loginSchema 兼容的类型（来自 lib/schemas.ts）
export const LoginFormSchema = z.object({
  email: z.string().email('请输入有效的邮箱地址'),
  password: z.string().min(6, '密码至少需要 6 位'),
});

export type LoginFormData = z.infer<typeof LoginFormSchema>;

/**
 * 登录响应 Schema
 */
export const LoginResponseSchema = z.object({
  token: z.string().min(1, 'Token 不能为空'),
  user: UserSchema,
  message: z.string().optional(),
});

export type LoginResponse = z.infer<typeof LoginResponseSchema>;

// ----------------------------------------------------------------------------
// 注册 API
// ----------------------------------------------------------------------------

/**
 * 注册请求 Schema
 *
 * POST /api/auth/register
 */
export const RegisterRequestSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  name: z.string().min(2, '姓名至少需要 2 个字符').trim(),
  acceptComplianceSecurityAgreement: z.boolean().refine((value) => value === true, {
    message: '必须同意合规与安全协议'
  }),
});

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

// 与现有 registerSchema 兼容的表单类型（包含 confirmPassword）
export const RegisterFormSchema = z.object({
  name: z.string().min(2, '姓名至少需要 2 个字符'),
  email: z.string().email('请输入有效的邮箱地址'),
  password: z.string()
    .min(8, '密码至少需要 8 位')
    .regex(/[A-Z]/, '密码必须包含至少 1 个大写字母（A-Z）')
    .regex(/[a-z]/, '密码必须包含至少 1 个小写字母（a-z）')
    .regex(/[0-9]/, '密码必须包含至少 1 个数字（0-9）'),
  confirmPassword: z.string(),
  acceptComplianceSecurityAgreement: z.boolean(),
}).superRefine((data, ctx) => {
  if (data.password !== data.confirmPassword) {
    ctx.addIssue({
      path: ['confirmPassword'],
      code: z.ZodIssueCode.custom,
      message: '两次输入的密码不一致',
    });
  }
  if (!data.acceptComplianceSecurityAgreement) {
    ctx.addIssue({
      path: ['acceptComplianceSecurityAgreement'],
      code: z.ZodIssueCode.custom,
      message: '必须同意合规与安全协议才能注册'
    });
  }
});

export type RegisterFormData = z.infer<typeof RegisterFormSchema>;

/**
 * 注册响应 Schema
 */
export const RegisterResponseSchema = z.object({
  token: z.string().min(1, 'Token 不能为空'),
  user: UserSchema,
  message: z.string().optional(),
});

export type RegisterResponse = z.infer<typeof RegisterResponseSchema>;

// ----------------------------------------------------------------------------
// 密码重置 API (预留，后端暂未实现)
// ----------------------------------------------------------------------------

/**
 * 请求密码重置邮件 Schema
 *
 * POST /api/auth/forgot-password
 */
export const ForgotPasswordRequestSchema = z.object({
  email: EmailSchema,
});

export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

/**
 * 重置密码 Schema
 *
 * POST /api/auth/reset-password
 */
export const ResetPasswordRequestSchema = z.object({
  token: z.string().min(1, '重置令牌不能为空'),
  password: PasswordSchema,
});

export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;

// ----------------------------------------------------------------------------
// Token 验证 API
// ----------------------------------------------------------------------------

/**
 * 验证 Token 响应 Schema
 *
 * GET /api/auth/verify
 */
export const VerifyTokenResponseSchema = z.object({
  valid: z.boolean(),
  user: UserSchema.optional(),
});

export type VerifyTokenResponse = z.infer<typeof VerifyTokenResponseSchema>;

// ----------------------------------------------------------------------------
// 获取当前用户信息 API
// ----------------------------------------------------------------------------

/**
 * 获取当前用户响应 Schema
 *
 * GET /api/auth/me
 */
export const GetCurrentUserResponseSchema = UserSchema;

export type GetCurrentUserResponse = z.infer<typeof GetCurrentUserResponseSchema>;

// ----------------------------------------------------------------------------
// 更新用户信息 API
// ----------------------------------------------------------------------------

/**
 * 更新用户信息请求 Schema
 *
 * PATCH /api/auth/profile
 */
export const UpdateProfileRequestSchema = z.object({
  name: z.string().min(2, '姓名至少需要 2 个字符').trim().optional(),
  email: EmailSchema.optional(),
}).refine(
  (data) => data.name !== undefined || data.email !== undefined,
  { message: '至少需要提供一个字段进行更新' }
);

export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;

/**
 * 更新用户信息响应 Schema
 */
export const UpdateProfileResponseSchema = z.object({
  message: z.string(),
  user: UserSchema,
});

export type UpdateProfileResponse = z.infer<typeof UpdateProfileResponseSchema>;

// ----------------------------------------------------------------------------
// 修改密码 API
// ----------------------------------------------------------------------------

/**
 * 修改密码请求 Schema
 *
 * POST /api/auth/change-password
 */
export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1, '当前密码不能为空'),
  newPassword: PasswordSchema,
}).refine(
  (data) => data.currentPassword !== data.newPassword,
  { message: '新密码不能与当前密码相同', path: ['newPassword'] }
);

export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

/**
 * 修改密码响应 Schema
 */
export const ChangePasswordResponseSchema = z.object({
  message: z.string(),
});

export type ChangePasswordResponse = z.infer<typeof ChangePasswordResponseSchema>;
