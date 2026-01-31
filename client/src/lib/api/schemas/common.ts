// ============================================================================
// 通用 Schema 定义
// ============================================================================
// 职责：
//   1. 定义所有 API 共享的基础数据结构
//   2. 提供统一的响应格式验证
//   3. 消除重复定义，单一数据源
// ============================================================================

import { z } from 'zod';

// ----------------------------------------------------------------------------
// 用户相关 Schema
// ----------------------------------------------------------------------------

/**
 * 用户基础信息 Schema
 *
 * 用于所有返回用户信息的 API 响应
 */
export const UserSchema = z.object({
  id: z.string().min(1, '用户 ID 不能为空'),
  email: z.string().email('邮箱格式不正确'),
  phone: z.string().nullable().optional(),
  name: z.string().min(1, '用户名不能为空'),
  createdAt: z.string().datetime().optional(),
});

export type User = z.infer<typeof UserSchema>;

// ----------------------------------------------------------------------------
// API 响应包装 Schema
// ----------------------------------------------------------------------------

/**
 * 标准 API 成功响应格式
 *
 * 所有成功的 API 响应都应遵循 { success: true, data: T } 格式
 * 注意：apiClient 会自动解包，所以实际使用时只需要处理 data 部分
 */
export const ApiSuccessResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
    message: z.string().optional(),
  });

/**
 * 标准 API 错误响应格式
 */
export const ApiErrorResponseSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  code: z.string().optional(),
  details: z.unknown().optional(),
});

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

// ----------------------------------------------------------------------------
// 分页相关 Schema
// ----------------------------------------------------------------------------

/**
 * 分页请求参数
 */
export const PaginationParamsSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type PaginationParams = z.infer<typeof PaginationParamsSchema>;

/**
 * 分页响应元数据
 */
export const PaginationMetaSchema = z.object({
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  totalPages: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});

export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

/**
 * 分页响应包装
 */
export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    pagination: PaginationMetaSchema,
  });

// ----------------------------------------------------------------------------
// 日期时间 Schema
// ----------------------------------------------------------------------------

/**
 * ISO 8601 日期时间字符串
 */
export const DateTimeSchema = z.string().datetime({
  message: '日期格式不正确，需要 ISO 8601 格式',
});

/**
 * 日期范围
 */
export const DateRangeSchema = z.object({
  start: DateTimeSchema,
  end: DateTimeSchema,
}).refine(
  (data) => new Date(data.start) <= new Date(data.end),
  { message: '开始日期必须早于或等于结束日期' }
);

export type DateRange = z.infer<typeof DateRangeSchema>;

// ----------------------------------------------------------------------------
// 文件上传 Schema
// ----------------------------------------------------------------------------

/**
 * 文件元数据 Schema
 */
export const FileMetadataSchema = z.object({
  filename: z.string().min(1),
  size: z.number().int().positive(),
  mimeType: z.string(),
  uploadedAt: DateTimeSchema.optional(),
});

export type FileMetadata = z.infer<typeof FileMetadataSchema>;

// ----------------------------------------------------------------------------
// 通用验证规则
// ----------------------------------------------------------------------------

/**
 * 密码验证规则
 *
 * 要求：至少 8 位，包含大小写字母和数字
 */
export const PasswordSchema = z
  .string()
  .min(8, '密码至少需要 8 位')
  .regex(/[a-z]/, '密码必须包含小写字母')
  .regex(/[A-Z]/, '密码必须包含大写字母')
  .regex(/[0-9]/, '密码必须包含数字');

/**
 * 邮箱验证规则
 */
export const EmailSchema = z
  .string()
  .email('邮箱格式不正确')
  .toLowerCase()
  .trim();

/**
 * MongoDB ObjectId 验证
 */
export const ObjectIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, '无效的 ID 格式');

/**
 * 非空字符串
 */
export const NonEmptyStringSchema = z
  .string()
  .min(1, '不能为空')
  .trim();
