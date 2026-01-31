'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

type ScoreBarProps = {
  value: number;
  className?: string;
};

const barVariants = {
  initial: { width: '0%' },
  animate: (value: number) => ({ width: `${value}%` }),
};

export function ScoreBar({ value, className }: ScoreBarProps) {
  const clampedValue = Math.max(0, Math.min(100, Math.round(value)));

  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-sky-100/80', className)}>
      <motion.div
        custom={clampedValue}
        variants={barVariants}
        initial="initial"
        animate="animate"
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="h-full rounded-full bg-gradient-to-r from-blue-500 via-sky-400 to-teal-300"
      />
    </div>
  );
}
