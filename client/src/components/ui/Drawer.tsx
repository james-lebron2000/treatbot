'use client';

import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};

export function Drawer({ open, onClose, title, subtitle, children }: DrawerProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-40 flex justify-end bg-slate-900/30 backdrop-blur"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 18, stiffness: 160 }}
            className="relative h-full w-full max-w-md overflow-y-auto border-l border-white/40 bg-gradient-to-b from-white/90 to-sky-50/90 p-6 shadow-2xl shadow-blue-200/40 backdrop-blur"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
                {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-sky-100 bg-white/70 p-2 text-slate-500 transition hover:border-sky-200 hover:text-sky-600"
                aria-label="关闭 / Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className={cn('mt-6 space-y-4 text-sm text-slate-600')}>{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
