'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/stores/auth';
import { useLogout } from '@/lib/hooks';
import { useEffect, useState } from 'react';

// ============================================================================
// 导航项配置 / Navigation Items Configuration
// ============================================================================
// 采用新的患者中心化工作流 (Patient-Centric Workflow):
//   /patients → 患者列表
//   /patients/[id]/upload → 上传医疗文档
//   /patients/[id]/extract → OCR 提取
//   /patients/[id]/structured → 结构化数据
//   /patients/[id]/results → 匹配结果
//
// 已移除旧的简化工作流 (Deprecated Simplified Workflow):
//   /dashboard, /upload, /results (使用 AppContext,已废弃)
// ============================================================================

const navigationItems = [
  { name: '首页', href: '/' },
  { name: '患者', href: '/patients' },
];

export default function Navigation() {
  const pathname = usePathname();
  const { isAuthenticated, user } = useAuthStore();
  const { mutate: logout } = useLogout();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isAuthRoute = pathname.startsWith('/auth');

  const handleLogout = () => {
    logout();
  };

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Auth pages use a full-screen layout; hide the global nav to avoid cramped/overlapping UI on mobile.
  if (isAuthRoute) {
    return null;
  }

  return (
    <motion.nav
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' as const }}
      className="sticky top-0 z-50 border-b border-sky-100/60 bg-white/80 backdrop-blur"
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="inline-flex">
          <span className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-sky-400 text-white shadow-md shadow-blue-200/60">
              <span className="text-sm font-semibold">AI</span>
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-wide text-sky-600">临床试验</span>
              <span className="text-xs text-gray-500">智能匹配平台</span>
            </span>
          </span>
        </Link>

        <div className="hidden items-center gap-2 rounded-full border border-sky-100/70 bg-white/40 px-2 py-1 text-sm text-gray-600 shadow-sm backdrop-blur md:flex">
          {navigationItems.map((item) => {
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-full px-4 py-1.5 transition-colors',
                  isActive
                    ? 'bg-sky-100 text-sky-700 shadow-sm'
                    : 'hover:bg-sky-50 hover:text-sky-600'
                )}
              >
                <span>{item.name}</span>
              </Link>
            );
          })}
        </div>

        <div className="hidden items-center gap-3 sm:flex">
          {isAuthenticated ? (
            <>
              {user && (
                <span className="text-sm text-gray-600">
                  {user.name}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleLogout}
                className="rounded-full border-sky-200 text-sky-600 hover:bg-sky-50"
              >
                <span>退出登录</span>
              </Button>
            </>
          ) : (
            <>
              <Link href="/auth/login">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full border-sky-200 text-sky-600 hover:bg-sky-50"
                >
                  <span>登录</span>
                </Button>
              </Link>
              <Link href="/auth/register">
                <Button
                  variant="primary"
                  size="sm"
                  className="rounded-full px-6 py-2 text-sm font-semibold shadow-lg shadow-blue-200/70 hover:shadow-blue-300/60"
                >
                  <span>注册</span>
                </Button>
              </Link>
            </>
          )}
        </div>

        <div className="flex sm:hidden">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full border-sky-200 text-sky-600"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-expanded={mobileMenuOpen}
            aria-label="打开导航菜单"
          >
            <span className="flex items-center gap-2">
              <Menu className="h-4 w-4" />
              菜单
            </span>
          </Button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="border-t border-sky-100/60 bg-white/90 backdrop-blur sm:hidden">
          <div className="mx-auto w-full max-w-6xl px-4 py-3">
            <div className="flex flex-col gap-2">
              {navigationItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'rounded-xl px-4 py-2 text-sm',
                      isActive ? 'bg-sky-100 text-sky-700' : 'text-gray-700 hover:bg-sky-50'
                    )}
                  >
                    {item.name}
                  </Link>
                );
              })}

              <div className="mt-2 flex items-center gap-2">
                {isAuthenticated ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleLogout}
                      className="w-full rounded-xl border-sky-200 text-sky-600 hover:bg-sky-50"
                    >
                      退出登录
                    </Button>
                  </>
                ) : (
                  <>
                    <Link href="/auth/login" className="w-full">
                      <Button variant="outline" size="sm" className="w-full rounded-xl border-sky-200 text-sky-600 hover:bg-sky-50">
                        登录
                      </Button>
                    </Link>
                    <Link href="/auth/register" className="w-full">
                      <Button variant="primary" size="sm" className="w-full rounded-xl">
                        注册
                      </Button>
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </motion.nav>
  );
}
