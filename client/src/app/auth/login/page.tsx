'use client';

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { LoginFormSchema, type LoginFormData } from '@/lib/api/schemas';
import { useLogin } from '@/lib/hooks';
import { ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/stores/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/Card';
import { showToast } from '@/components/ui/Toast';

// ============================================================================
// 登录页面
// ============================================================================

export default function LoginPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();

  const { mutate: login, isPending } = useLogin();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(LoginFormSchema),
  });

  React.useEffect(() => {
    if (isAuthenticated) {
      router.push('/');
    }
  }, [isAuthenticated, router]);

  const onSubmit = (data: LoginFormData) => {
    login(data, {
      onSuccess: () => {
        showToast.success('登录成功');
        router.push('/');
      },
      onError: (error) => {
        if (error instanceof ApiError) {
          if (error.isAuthError) {
            showToast.error('邮箱或密码错误');
          } else if (error.isNetworkError) {
            showToast.error('网络连接失败，请检查网络后重试');
          } else {
            showToast.error(error.message || '登录失败');
          }
        } else {
          showToast.error('发生未知错误，请稍后重试');
        }
      },
    });
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 px-4 py-12">
      <div className="w-full max-w-md">
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
                欢迎回来
              </CardTitle>
              <CardDescription className="text-base text-gray-600">
                登录后继续使用临床试验智能匹配平台
              </CardDescription>
            </div>
          </CardHeader>

          {/* Form Section */}
          <CardContent className="px-6 pb-8 sm:px-8">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <Input
                {...register('email')}
                type="email"
                label="邮箱"
                placeholder="请输入邮箱"
                error={errors.email?.message}
                disabled={isPending}
                className="w-full"
              />

              <PasswordInput
                {...register('password')}
                label="密码"
                placeholder="请输入密码"
                error={errors.password?.message}
                disabled={isPending}
                className="w-full"
              />

              <Button
                type="submit"
                variant="primary"
                className="mt-6 w-full rounded-xl py-3 text-base font-semibold shadow-lg shadow-blue-200 transition-all hover:shadow-xl hover:shadow-blue-300"
                loading={isPending}
                disabled={isPending}
              >
                登录
              </Button>
            </form>

            <div className="mt-5 text-center text-sm">
              <Link
                href="/auth/phone"
                className="font-semibold text-blue-600 transition-colors hover:text-blue-700"
              >
                使用手机验证码登录
              </Link>
            </div>
          </CardContent>

          {/* Footer Section */}
          <CardFooter className="flex flex-col space-y-4 border-t border-gray-100 bg-gray-50 px-6 py-6 sm:px-8">
            <div className="text-center text-sm">
              <span className="text-gray-600">还没有账户？</span>
              <Link
                href="/auth/register"
                className="font-semibold text-blue-600 transition-colors hover:text-blue-700"
              >
                立即注册
              </Link>
            </div>

            <div className="text-center">
              <p className="text-xs text-gray-500">
                安全访问临床试验智能匹配平台
              </p>
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
