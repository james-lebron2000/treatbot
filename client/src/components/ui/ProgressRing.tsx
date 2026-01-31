'use client';

import React, { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface ProgressRingProps {
  progress: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  backgroundColor?: string;
  showPercentage?: boolean;
  animate?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export function ProgressRing({
  progress = 0,
  size = 120,
  strokeWidth = 8,
  color = '#3b82f6',
  backgroundColor = '#e5e7eb',
  showPercentage = true,
  animate = true,
  children,
  className,
}: ProgressRingProps) {
  const circleRef = useRef<SVGCircleElement>(null);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDasharray = circumference;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  useEffect(() => {
    if (circleRef.current && animate) {
      const circle = circleRef.current;
      circle.style.transition = 'stroke-dashoffset 0.5s ease-in-out';
    }
  }, [animate]);

  const gradientBaseId = React.useId();
  const gradientId = `progress-ring-${gradientBaseId}`;

  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      {/* Background pulsing effect */}
      {animate && progress > 0 && (
        <>
          <div
            className="absolute rounded-full animate-ping opacity-20"
            style={{
              width: size + 20,
              height: size + 20,
              backgroundColor: color,
            }}
          />
          <div
            className="absolute rounded-full animate-pulse opacity-30"
            style={{
              width: size + 10,
              height: size + 10,
              backgroundColor: color,
            }}
          />
        </>
      )}

      <svg
        width={size}
        height={size}
        className="transform -rotate-90 relative z-10"
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={color} />
            <stop offset="50%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>

        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          stroke={backgroundColor}
          fill="none"
        />

        {/* Progress circle */}
        <circle
          ref={circleRef}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          stroke={animate ? `url(#${gradientId})` : color}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={strokeDasharray}
          strokeDashoffset={strokeDashoffset}
          filter={animate ? "url(#glow)" : "none"}
          className={animate ? 'animate-pulse' : ''}
        />

        {/* Inner glow effect */}
        {animate && progress > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius - strokeWidth}
            fill={`${color}10`}
            className="animate-breathe"
          />
        )}
      </svg>

      {/* Center content */}
      <div className="absolute inset-0 flex items-center justify-center">
        {children || (showPercentage && (
          <div className="text-center">
            <div className={cn(
              'font-bold transition-all duration-300',
              size > 80 ? 'text-2xl' : 'text-lg',
              animate && progress > 0 && 'animate-pulse'
            )} style={{ color }}>
              {Math.round(progress)}%
            </div>
            {size > 100 && (
              <div className="text-xs text-gray-500 mt-1">完成</div>
            )}
          </div>
        ))}
      </div>

      {/* Decorative dots around the ring */}
      {animate && progress > 0 && (
        <div className="absolute inset-0">
          {[...Array(12)].map((_, i) => {
            const angle = (i * 30) * Math.PI / 180;
            const x = size / 2 + (radius + strokeWidth) * Math.cos(angle);
            const y = size / 2 + (radius + strokeWidth) * Math.sin(angle);

            return (
              <div
                key={i}
                className="absolute w-1 h-1 bg-current rounded-full animate-pulse opacity-60"
                style={{
                  left: x - 2,
                  top: y - 2,
                  color: color,
                  animationDelay: `${i * 0.1}s`,
                }}
              />
            );
          })}
        </div>
      )}

      {/* Progress indicator particles */}
      {animate && progress > 0 && (
        <>
          {[...Array(3)].map((_, i) => {
            const progressAngle = (progress / 100) * 360 - 90;
            const particleAngle = (progressAngle + (i * 10)) * Math.PI / 180;
            const particleX = size / 2 + radius * Math.cos(particleAngle);
            const particleY = size / 2 + radius * Math.sin(particleAngle);

            return (
              <div
                key={i}
                className="absolute w-2 h-2 rounded-full animate-float"
                style={{
                  left: particleX - 4,
                  top: particleY - 4,
                  backgroundColor: color,
                  animationDelay: `${i * 0.3}s`,
                }}
              />
            );
          })}
        </>
      )}
    </div>
  );
}

// Preset variations
export function SmallProgressRing(props: Omit<ProgressRingProps, 'size'>) {
  return <ProgressRing size={60} strokeWidth={4} {...props} />;
}

export function MediumProgressRing(props: Omit<ProgressRingProps, 'size'>) {
  return <ProgressRing size={100} strokeWidth={6} {...props} />;
}

export function LargeProgressRing(props: Omit<ProgressRingProps, 'size'>) {
  return <ProgressRing size={160} strokeWidth={10} {...props} />;
}
