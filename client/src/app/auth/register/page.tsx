'use client';

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { RegisterFormSchema, type RegisterFormData } from '@/lib/api/schemas';
import { useRegister } from '@/lib/hooks';
import { ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/stores/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/Card';
import { showToast } from '@/components/ui/Toast';

// ============================================================================
// 注册页面
// ============================================================================

export default function RegisterPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();

  const { mutate: registerUser, isPending } = useRegister();

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<RegisterFormData>({
    resolver: zodResolver(RegisterFormSchema),
  });

  const watchedPassword = watch('password', '');

  React.useEffect(() => {
    if (isAuthenticated) {
      router.push('/');
    }
  }, [isAuthenticated, router]);

  const onSubmit = (data: RegisterFormData) => {
    const { confirmPassword, ...registrationData } = data;

    registerUser(registrationData, {
      onSuccess: () => {
        showToast.success('注册成功，欢迎加入');
        router.push('/');
      },
      onError: (error) => {
        if (error instanceof ApiError) {
          if (error.status === 409) {
            showToast.error('该邮箱已被注册');
          } else if (error.isNetworkError) {
            showToast.error('网络连接失败，请检查网络后重试');
          } else {
            showToast.error(error.message || '注册失败');
          }
        } else {
          showToast.error('发生未知错误，请稍后重试');
        }
      },
    });
  };

  const passwordChecks = {
    length: watchedPassword.length >= 8,
    uppercase: /[A-Z]/.test(watchedPassword),
    lowercase: /[a-z]/.test(watchedPassword),
    number: /\d/.test(watchedPassword),
  };

  const PasswordRequirement = ({ met, text }: { met: boolean; text: string }) => (
    <li className={`flex items-center space-x-2 ${met ? 'text-green-600' : 'text-gray-500'}`}>
      <span className={`text-xs font-bold ${met ? 'text-green-600' : 'text-gray-400'}`}>
        {met ? '✓' : '•'}
      </span>
      <span className="text-xs">{text}</span>
    </li>
  );

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 px-4 py-12">
      <div className="w-full max-w-lg">
        <Card className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
          {/* Header Section */}
          <CardHeader className="space-y-6 px-6 pb-6 pt-8 text-center sm:px-8">
            {/* Logo / Brand */}
            <div className="inline-flex justify-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg">
                <span className="text-xl font-bold text-white">AI</span>
              </div>
            </div>

            {/* Title */}
            <div className="space-y-2">
              <CardTitle className="text-3xl font-bold text-gray-900">
                创建账户
              </CardTitle>
              <CardDescription className="text-base text-gray-600">
                注册后开始使用临床试验智能匹配平台
              </CardDescription>
            </div>
          </CardHeader>

          {/* Form Section */}
          <CardContent className="px-6 pb-8 sm:px-8">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <Input
                {...register('name')}
                type="text"
                label="姓名"
                placeholder="请输入姓名"
                error={errors.name?.message}
                disabled={isPending}
                className="w-full"
              />

              <Input
                {...register('email')}
                type="email"
                label="邮箱"
                placeholder="请输入邮箱"
                error={errors.email?.message}
                disabled={isPending}
                className="w-full"
              />

              <div className="space-y-3">
                <PasswordInput
                  {...register('password')}
                  label="密码"
                  placeholder="请设置密码"
                  error={errors.password?.message}
                  disabled={isPending}
                  className="w-full"
                />

                {/* Password Requirements */}
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <p className="mb-2 text-xs font-semibold text-gray-700">密码要求：</p>
                  <ul className="space-y-1.5">
                    <PasswordRequirement
                      met={passwordChecks.length}
                      text="至少 8 个字符"
                    />
                    <PasswordRequirement
                      met={passwordChecks.uppercase}
                      text="至少 1 个大写字母（A-Z）"
                    />
                    <PasswordRequirement
                      met={passwordChecks.lowercase}
                      text="至少 1 个小写字母（a-z）"
                    />
                    <PasswordRequirement
                      met={passwordChecks.number}
                      text="至少 1 个数字（0-9）"
                    />
                  </ul>
                  <div className="mt-3 border-t border-gray-200 pt-3">
                    <p className="text-xs text-gray-500">
                      <strong>示例：</strong> Demo123!, Password1, Simple123
                    </p>
                  </div>
                </div>
              </div>

              <PasswordInput
                {...register('confirmPassword')}
                label="确认密码"
                placeholder="请再次输入密码"
                error={errors.confirmPassword?.message}
                disabled={isPending}
                className="w-full"
              />

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <label className="flex items-start gap-3 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    {...register('acceptComplianceSecurityAgreement')}
                    disabled={isPending}
                    className="mt-1"
                  />
                  <span>
                    我已阅读并同意{' '}
                    <Link href="/legal/compliance" className="font-semibold text-blue-600 hover:text-blue-700">
                      合规与安全协议
                    </Link>
                    ，并确认发送到第三方模型的数据不包含患者可识别个人信息（如姓名）。
                  </span>
                </label>
                {errors.acceptComplianceSecurityAgreement?.message ? (
                  <p className="mt-2 text-xs text-red-600">{errors.acceptComplianceSecurityAgreement.message}</p>
                ) : null}
              </div>

              <Button
                type="submit"
                variant="primary"
                className="mt-6 w-full rounded-xl py-3 text-base font-semibold shadow-lg shadow-blue-200 transition-all hover:shadow-xl hover:shadow-blue-300"
                loading={isPending}
                disabled={isPending}
              >
                注册
              </Button>
            </form>
          </CardContent>

          {/* Footer Section */}
          <CardFooter className="flex flex-col space-y-4 border-t border-gray-100 bg-gray-50 px-6 py-6 sm:px-8">
            <div className="text-center text-sm">
              <span className="text-gray-600">已有账户？</span>
              <Link
                href="/auth/login"
                className="font-semibold text-blue-600 transition-colors hover:text-blue-700"
              >
                立即登录
              </Link>
            </div>

            <div className="text-center">
              <p className="text-xs text-gray-500">
                注册即表示您同意我们的服务条款与隐私政策
              </p>
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
