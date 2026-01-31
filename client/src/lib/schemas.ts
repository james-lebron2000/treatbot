import { z } from 'zod';

// Auth schemas
export const loginSchema = z.object({
  email: z.string().email('请输入有效的邮箱地址'),
  password: z.string().min(6, '密码至少需要 6 位'),
});

const passwordPolicy = z.string()
  .min(8, '密码至少需要 8 位')
  .regex(/[A-Z]/, '密码必须包含至少 1 个大写字母（A-Z）')
  .regex(/[a-z]/, '密码必须包含至少 1 个小写字母（a-z）')
  .regex(/[0-9]/, '密码必须包含至少 1 个数字（0-9）');

export const registerSchema = z.object({
  name: z.string().min(2, '姓名至少需要 2 个字符'),
  email: z.string().email('请输入有效的邮箱地址'),
  password: passwordPolicy,
  confirmPassword: z.string(),
}).superRefine((data, ctx) => {
  if (data.password !== data.confirmPassword) {
    ctx.addIssue({
      path: ['confirmPassword'],
      code: z.ZodIssueCode.custom,
      message: '两次输入的密码不一致',
    });
  }
});

// Phone verification schema (for future implementation)
export const phoneVerificationSchema = z.object({
  phone: z.string().min(10, '请输入有效的手机号'),
  code: z.string().length(6, '验证码应为 6 位数字'),
});

// Patient schemas
export const patientSchema = z.object({
  name: z.string().min(2, '姓名至少需要 2 个字符'),
  gender: z.enum(['male', 'female', 'other']).optional(),
  contactInfo: z.object({
    email: z.string().email().or(z.literal('')).optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
  }).optional(),
});

// Medical record schemas
export const structuredDataSchema = z.object({
  diagnosis: z.string().optional(),
  stage: z.string().optional(),
  mutations: z.array(z.string()).optional(),
  age: z.number().optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
  previousTreatments: z.array(z.string()).optional(),
  biomarkers: z.record(z.string(), z.unknown()).optional(),
  performanceStatus: z.string().optional(),
});

export const uploadFormSchema = z.object({
  files: z.unknown().optional(),
  manualText: z.string().optional(),
  useLLM: z.boolean().default(true),
}).refine((data) => data.files || data.manualText, {
  message: '请上传文件或手动输入文本',
  path: ["files"],
});

// Export types from schemas
export type LoginFormData = z.infer<typeof loginSchema>;
export type RegisterFormData = z.infer<typeof registerSchema>;
export type PhoneVerificationData = z.infer<typeof phoneVerificationSchema>;
export type PatientFormData = z.infer<typeof patientSchema>;
export type StructuredDataFormData = z.infer<typeof structuredDataSchema>;
export type UploadFormData = z.infer<typeof uploadFormSchema>;
