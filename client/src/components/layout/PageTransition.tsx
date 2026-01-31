/**
 * =============================================================================
 * 页面切换过渡组件
 * Page Transition Component
 * =============================================================================
 * Linus哲学：优雅的过渡让用户体验如丝般顺滑
 * Good taste: Elegant transitions make UX silky smooth
 * =============================================================================
 */

'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Transition, TargetAndTransition } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

// =============================================================================
// 类型定义 / Type Definitions
// =============================================================================

interface PageTransitionProps {
  children: React.ReactNode;
  className?: string;
  duration?: number;
  type?: 'slide' | 'fade' | 'scale' | 'flip';
  direction?: 'up' | 'down' | 'left' | 'right';
  easing?: Transition['ease'];
  enableGestures?: boolean;
  preserveScroll?: boolean;
}

type TransitionFactory = (direction: string, duration: number, easing: Transition['ease']) => TransitionConfig;

interface TransitionConfig {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  transition: Transition;
}

// =============================================================================
// 过渡配置 / Transition Configurations
// =============================================================================

const transitionConfigs: Record<'slide' | 'fade' | 'scale' | 'flip', TransitionFactory> = {
  slide: (direction, duration, easing) => {
    const directions: Record<string, TargetAndTransition> = {
      up: { y: 100, opacity: 0 },
      down: { y: -100, opacity: 0 },
      left: { x: 100, opacity: 0 },
      right: { x: -100, opacity: 0 },
    };

    const initial = directions[direction] ?? directions.right;

    return {
      initial,
      animate: { x: 0, y: 0, opacity: 1 },
      exit: { ...initial },
      transition: {
        duration,
        ease: easing,
        type: "tween",
      },
    };
  },

  fade: (_direction, duration, easing) => ({
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: {
      duration,
      ease: easing,
    },
  }),

  scale: (_direction, duration, easing) => ({
    initial: { opacity: 0, scale: 0.8 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 1.1 },
    transition: {
      duration,
      ease: easing,
      type: "spring",
      stiffness: 100,
      damping: 15,
    },
  }),

  flip: (_direction, duration, easing) => ({
    initial: { opacity: 0, rotateY: 90 },
    animate: { opacity: 1, rotateY: 0 },
    exit: { opacity: 0, rotateY: -90 },
    transition: {
      duration,
      ease: easing,
    },
  }),
};

const DEFAULT_EASING: Transition['ease'] = [0.42, 0, 0.58, 1];

// =============================================================================
// 加载状态组件 / Loading State Component
// =============================================================================

type SpinnerSize = 'sm' | 'md' | 'lg';
type SpinnerColor = 'blue' | 'green' | 'purple' | 'gray';

const sizeClasses: Record<SpinnerSize, string> = {
  sm: 'w-4 h-4',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
};

const colorClasses: Record<SpinnerColor, string> = {
  blue: 'text-blue-600',
  green: 'text-green-600',
  purple: 'text-purple-600',
  gray: 'text-gray-600',
};

interface LoadingSpinnerProps {
  size?: SpinnerSize;
  color?: SpinnerColor;
  text?: string;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ size = 'md', color = 'blue', text = '加载中...' }) => {
  return (
    <div className="flex flex-col items-center justify-center space-y-4 min-h-[200px]">
      <div className={cn("animate-spin", sizeClasses[size], colorClasses[color])}>
        <svg
          className="w-full h-full"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      </div>
      {text && (
        <p className="text-sm text-gray-600 font-medium">{text}</p>
      )}
    </div>
  );
};

// =============================================================================
// 错误边界组件 / Error Boundary Component
// =============================================================================

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Page transition error:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 mx-auto bg-red-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-900">页面加载失败</h2>
            <p className="text-gray-600 max-w-md">
              抱歉，页面切换时出现了错误。请刷新页面重试。
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// =============================================================================
// 主页面过渡组件 / Main Page Transition Component
// =============================================================================

export const PageTransition: React.FC<PageTransitionProps> = ({
  children,
  className,
  duration = 0.4,
  type = 'slide',
  direction = 'right',
  easing = DEFAULT_EASING,
  enableGestures = false,
  preserveScroll = false,
}) => {
  const pathname = usePathname();
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('加载中...');

  // 配置过渡动画 / Configure transition animation
  const config = useMemo(
    () => getTransitionConfig(type, direction, duration, easing),
    [type, direction, duration, easing]
  );

  // 监听路由变化 / Listen to route changes
  useEffect(() => {
    const handleStart = () => {
      setIsLoading(true);
      setLoadingText('正在加载页面...');
    };

    const handleComplete = () => {
      setIsLoading(false);
    };

    const handleError = () => {
      setLoadingText('页面加载失败');
      setTimeout(() => setIsLoading(false), 2000);
    };

    // 监听自定义事件 / Listen to custom events
    window.addEventListener('routeChangeStart', handleStart);
    window.addEventListener('routeChangeComplete', handleComplete);
    window.addEventListener('routeChangeError', handleError);

    return () => {
      window.removeEventListener('routeChangeStart', handleStart);
      window.removeEventListener('routeChangeComplete', handleComplete);
      window.removeEventListener('routeChangeError', handleError);
    };
  }, []);

  // 处理滚动位置 / Handle scroll position
  useEffect(() => {
    if (!preserveScroll) {
      window.scrollTo(0, 0);
    }
  }, [pathname, preserveScroll]);

  // 触摸手势支持 / Touch gesture support
  useEffect(() => {
    if (!enableGestures) return;

    let startX = 0;
    let startY = 0;

    const handleTouchStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const diffX = startX - endX;
      const diffY = startY - endY;

      // 水平滑动阈值 / Horizontal swipe threshold
      if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
        if (diffX > 0) {
          // 向左滑动 - 前进 / Swipe left - go forward
          window.dispatchEvent(new CustomEvent('swipe:left'));
        } else {
          // 向右滑动 - 后退 / Swipe right - go back
          window.dispatchEvent(new CustomEvent('swipe:right'));
        }
      }
    };

    document.addEventListener('touchstart', handleTouchStart);
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [enableGestures]);

  return (
    <ErrorBoundary>
      <div className={cn("relative", className)}>
        {/* 加载状态 / Loading State */}
        <AnimatePresence mode="wait">
          {isLoading && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-white/80 backdrop-blur-sm flex items-center justify-center"
            >
              <LoadingSpinner text={loadingText} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* 页面内容过渡 / Page Content Transition */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={pathname}
            initial={config.initial}
            animate={config.animate}
            exit={config.exit}
            transition={config.transition}
            className="w-full"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </ErrorBoundary>
  );
};

// =============================================================================
// 简化的页面包装器 / Simplified Page Wrapper
// =============================================================================

interface SimplePageTransitionProps {
  children: React.ReactNode;
  className?: string;
  duration?: number;
}

/**
 * 简化的页面过渡包装器
 * Simple page transition wrapper
 */
export const SimplePageTransition: React.FC<SimplePageTransitionProps> = ({
  children,
  className,
  duration = 0.3,
}) => {
  return (
    <PageTransition
      type="fade"
      duration={duration}
      className={className}
    >
      {children}
    </PageTransition>
  );
};

/**
 * 滑动页面过渡包装器
 * Slide page transition wrapper
 */
export const SlidePageTransition: React.FC<SimplePageTransitionProps> = ({
  children,
  className,
  duration = 0.4,
}) => {
  return (
    <PageTransition
      type="slide"
      direction="right"
      duration={duration}
      className={className}
    >
      {children}
    </PageTransition>
  );
};

/**
 * 缩放页面过渡包装器
 * Scale page transition wrapper
 */
export const ScalePageTransition: React.FC<SimplePageTransitionProps> = ({
  children,
  className,
  duration = 0.3,
}) => {
  return (
    <PageTransition
      type="scale"
      duration={duration}
      className={className}
    >
      {children}
    </PageTransition>
  );
};

// =============================================================================
// 工具函数 / Utility Functions
// =============================================================================

/**
 * 触发路由变化事件
 * Trigger route change events
 */
export const triggerRouteChange = (type: 'start' | 'complete' | 'error') => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(`routeChange${type.charAt(0).toUpperCase() + type.slice(1)}`));
  }
};

/**
 * 平滑滚动到顶部
 * Smooth scroll to top
 */
export const scrollToTop = (behavior: ScrollBehavior = 'smooth') => {
  if (typeof window !== 'undefined') {
    window.scrollTo({ top: 0, behavior });
  }
};

/**
 * 获取过渡配置
 * Get transition configuration
 */
export const getTransitionConfig = (
  type: PageTransitionProps['type'],
  direction: PageTransitionProps['direction'] = 'right',
  duration: number,
  easing: Transition['ease']
) => {
  const factory = type ? transitionConfigs[type] : undefined;
  return (factory ?? transitionConfigs.slide)(direction, duration, easing);
};

export default PageTransition;
export { ErrorBoundary, LoadingSpinner };
