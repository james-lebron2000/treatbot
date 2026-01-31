'use client';

import React, { useCallback } from 'react';
import { motion } from 'framer-motion';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppContext } from '@/context/AppContext';

type SaveButtonProps = {
  trialId: string;
  className?: string;
  onToggle?: (nextSaved: boolean) => void;
};

export function SaveButton({ trialId, className, onToggle }: SaveButtonProps) {
  const { isTrialSaved, toggleSavedTrial } = useAppContext();
  const saved = isTrialSaved(trialId);

  const handleClick = useCallback(() => {
    toggleSavedTrial(trialId);
    onToggle?.(!saved);
  }, [toggleSavedTrial, trialId, saved, onToggle]);

  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      type="button"
      aria-pressed={saved}
      onClick={handleClick}
      className={cn(
        'flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        saved
          ? 'border-blue-200 bg-blue-50 text-blue-600 shadow-sm'
          : 'border-sky-100 bg-white/70 text-slate-500 hover:border-sky-200 hover:text-sky-600',
        className
      )}
    >
      {saved ? (
        <BookmarkCheck className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Bookmark className="h-3.5 w-3.5" aria-hidden />
      )}
      <span>{saved ? '已收藏' : '收藏试验'}</span>
    </motion.button>
  );
}
