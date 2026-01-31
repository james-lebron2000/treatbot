'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { useAuthStore } from '@/lib/stores/auth';
import { useRequestOtp, useVerifyOtp } from '@/lib/hooks/useAuth';
import { ApiError } from '@/lib/api';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/Card';
import { showToast } from '@/components/ui/Toast';

const RequestSchema = z.object({
  phone: z.string().trim().min(6, '请输入手机号'),
});

const VerifySchema = z.object({
  phone: z.string().trim().min(6, '请输入手机号'),
  code: z.string().trim().regex(/^\d{6}$/, '请输入 6 位验证码'),
});

type RequestForm = z.infer<typeof RequestSchema>;
type VerifyForm = z.infer<typeof VerifySchema>;

export default function PhoneLoginPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();

  const { mutate: requestOtp, isPending: requesting } = useRequestOtp();
  const { mutate: verifyOtp, isPending: verifying } = useVerifyOtp();

  const [requested, setRequested] = React.useState(false);
  const [countdown, setCountdown] = React.useState(0);

  const {
    register: registerRequest,
    handleSubmit: handleSubmitRequest,
    formState: { errors: requestErrors },
    getValues: getRequestValues,
    setValue: setRequestValue,
  } = useForm<RequestForm>({
    resolver: zodResolver(RequestSchema),
    defaultValues: { phone: '' },
  });

  const {
    register: registerVerify,
    handleSubmit: handleSubmitVerify,
    formState: { errors: verifyErrors },
    setValue: setVerifyValue,
    watch,
  } = useForm<VerifyForm>({
    resolver: zodResolver(VerifySchema),
    defaultValues: { phone: '', code: '' },
  });

  React.useEffect(() => {
    if (isAuthenticated) router.push('/');
  }, [isAuthenticated, router]);

  React.useEffect(() => {
    if (countdown <= 0) return;
    const t = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [countdown]);

  const onRequest = (data: RequestForm) => {
    requestOtp(data, {
      onSuccess: (resp) => {
        setRequested(true);
        setCountdown(typeof resp.ttlSeconds === 'number' ? resp.ttlSeconds : 60);
        setVerifyValue('phone', data.phone);
        showToast.success('验证码已发送');
      },
      onError: (error) => {
        if (error instanceof ApiError) {
          showToast.error(error.message || '发送失败');
        } else {
          showToast.error('发送失败');
        }
      },
    });
  };

  const onVerify = (data: VerifyForm) => {
    verifyOtp(data, {
      onSuccess: () => {
        showToast.success('登录成功');
        router.push('/');
      },
      onError: (error) => {
        if (error instanceof ApiError) {
          showToast.error(error.message || '验证码错误或已过期');
        } else {
          showToast.error('验证码错误或已过期');
        }
      },
    });
  };

  const resend = () => {
    const phone = getRequestValues('phone');
    requestOtp({ phone }, {
      onSuccess: (resp) => {
        setRequested(true);
        setCountdown(typeof resp.ttlSeconds === 'number' ? resp.ttlSeconds : 60);
        showToast.success('验证码已重新发送');
      },
      onError: (error) => {
        if (error instanceof ApiError) {
          showToast.error(error.message || '发送失败');
        } else {
          showToast.error('发送失败');
        }
      },
    });
  };

  const phoneValue = watch('phone');

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 px-4 py-12">
      <div className="w-full max-w-md">
        <Card className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
          <CardHeader className="space-y-6 px-6 pb-6 pt-8 text-center sm:px-8">
            <div className="inline-flex justify-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg">
                <span className="text-xl font-bold text-white">AI</span>
              </div>
            </div>
            <div className="space-y-2">
              <CardTitle className="text-3xl font-bold text-gray-900">手机验证码登录</CardTitle>
              <CardDescription className="text-base text-gray-600">用手机号获取验证码快速登录</CardDescription>
            </div>
          </CardHeader>

          <CardContent className="px-6 pb-8 sm:px-8">
            <form onSubmit={handleSubmitRequest(onRequest)} className="space-y-4">
              <Input
                {...registerRequest('phone')}
                label="手机号"
                placeholder="例如：13800138000 或 +8613800138000"
                error={requestErrors.phone?.message}
                disabled={requesting || verifying}
              />
              <Button type="submit" className="w-full" loading={requesting} disabled={requesting || verifying}>
                获取验证码
              </Button>
            </form>

            {requested && (
              <div className="mt-6 space-y-4">
                <form onSubmit={handleSubmitVerify(onVerify)} className="space-y-4">
                  <Input
                    {...registerVerify('phone')}
                    label="手机号"
                    placeholder="手机号"
                    value={phoneValue}
                    onChange={(e) => {
                      setVerifyValue('phone', e.target.value);
                      setRequestValue('phone', e.target.value);
                    }}
                    error={verifyErrors.phone?.message}
                    disabled={requesting || verifying}
                  />
                  <Input
                    {...registerVerify('code')}
                    label="验证码"
                    placeholder="6 位验证码"
                    error={verifyErrors.code?.message}
                    disabled={requesting || verifying}
                  />
                  <Button type="submit" className="w-full" loading={verifying} disabled={verifying || requesting}>
                    登录
                  </Button>
                </form>

                <div className="flex items-center justify-between text-sm">
                  <button
                    type="button"
                    className="text-blue-600 hover:text-blue-700 disabled:text-gray-400"
                    onClick={resend}
                    disabled={countdown > 0 || requesting || verifying}
                  >
                    {countdown > 0 ? `请等待 ${countdown}s` : '重新发送'}
                  </button>
                  <Link href="/auth/login" className="text-gray-600 hover:text-gray-800">
                    使用邮箱密码登录
                  </Link>
                </div>
              </div>
            )}
          </CardContent>

          <CardFooter className="flex flex-col space-y-4 border-t border-gray-100 bg-gray-50 px-6 py-6 sm:px-8">
            <div className="text-center text-sm">
              <span className="text-gray-600">没有账户？</span>
              <Link href="/auth/register" className="font-semibold text-blue-600 hover:text-blue-700">
                立即注册
              </Link>
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
