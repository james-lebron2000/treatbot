"use client";

import React from 'react';
import { cn } from '@/lib/utils';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
}

const sizeMap: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-10 w-10 border-4',
};

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ size = 'md', className, label }) => {
  return (
    <div className={cn('flex items-center space-x-2 text-sm text-gray-600', className)}>
      <span
        className={cn(
          'inline-flex animate-spin rounded-full border-blue-500 border-t-transparent border-solid',
          sizeMap[size]
        )}
        role="status"
        aria-label={label ?? '加载中'}
      />
      {label && <span>{label}</span>}
    </div>
  );
};
