'use client';

import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

type LoadingOverlayProps = {
  isVisible: boolean;
  message: string;
  subText?: string;
};

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.4, ease: 'easeOut' as const } },
  exit: { opacity: 0, transition: { duration: 0.3, ease: 'easeIn' as const } },
};

const messageVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' as const } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.2, ease: 'easeIn' as const } },
};

export function LoadingOverlay({ isVisible, message, subText }: LoadingOverlayProps) {
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 backdrop-blur"
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut' as const }}
            className="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/40 bg-gradient-to-br from-white/80 via-sky-50/80 to-blue-100/70 p-8 shadow-2xl shadow-blue-200/40"
          >
            {/* Animated gradient halo */}
            <motion.div
              className="pointer-events-none absolute -top-20 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-sky-200/50 blur-3xl"
              animate={{ opacity: [0.3, 0.6, 0.3] }}
              transition={{ duration: 4, repeat: Infinity }}
            />
            <motion.div
              className="pointer-events-none absolute -bottom-16 right-10 h-36 w-36 rounded-full bg-blue-300/40 blur-3xl"
              animate={{ opacity: [0.2, 0.5, 0.2] }}
              transition={{ duration: 5, repeat: Infinity, delay: 0.6 }}
            />

            {/* Pulse indicator */}
            <div className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-sky-400 text-white shadow-lg shadow-blue-200/60">
              <motion.div
                className="absolute inset-0 rounded-2xl bg-blue-400/60"
                animate={{ opacity: [0.4, 0.1, 0.4], scale: [1, 1.1, 1] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' as const }}
              />
              <Sparkles className="relative h-6 w-6" />
            </div>

            {/* Status text */}
            <motion.div
              key={message}
              variants={messageVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="relative mt-6 text-center"
            >
              <p className="text-lg font-semibold text-slate-900">
                {message}
              </p>
              {subText && (
                <p className="mt-2 text-sm text-slate-600">{subText}</p>
              )}
            </motion.div>

            {/* Animated progress indicator */}
            <div className="relative mt-6 h-2 overflow-hidden rounded-full bg-sky-100/80">
              <motion.div
                className={cn(
                  'absolute inset-y-0 left-0 w-1/2 rounded-full bg-gradient-to-r from-blue-500 via-sky-400 to-teal-300'
                )}
                animate={{ x: ['-50%', '150%'] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' as const }}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
