'use client';

import React, { useCallback, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { UploadCloud, FileText, ImageIcon, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

type UploadCardProps = {
  onFileSelected: (file: File) => void;
  isUploading: boolean;
  progress: number;
  uploadedFileName?: string | null;
};

const uploadVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' as const } },
};

export function UploadCard({
  onFileSelected,
  isUploading,
  progress,
  uploadedFileName,
}: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];
      onFileSelected(file);
    },
    [onFileSelected]
  );

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(event.target.files);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    handleFiles(event.dataTransfer.files);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!isDragOver) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
  };

  return (
    <motion.div
      variants={uploadVariants}
      initial="initial"
      animate="animate"
      className="space-y-6"
    >
      {/* Drag-and-drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={cn(
          'relative rounded-3xl border border-dashed border-sky-300 bg-sky-50/60 p-8 text-center shadow-inner transition',
          isDragOver && 'border-blue-400 bg-sky-100/80'
        )}
      >
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-sky-400 text-white shadow-lg shadow-blue-200/60">
          <UploadCloud className="h-7 w-7" />
        </div>
        <h2 className="mt-6 text-lg font-semibold text-slate-900">拖拽文件到此处</h2>
        <p className="mt-2 text-sm text-slate-600">
          或{' '}
          <button
            type="button"
            className="font-semibold text-sky-600 underline-offset-2 hover:underline"
            onClick={() => inputRef.current?.click()}
          >
            点击选择文件
          </button>
          {' '}上传病历、检查报告、化验单。
        </p>

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.txt"
          className="hidden"
          onChange={handleInputChange}
        />

        <div className="mt-6 grid gap-3 text-left text-sm text-slate-500 sm:grid-cols-2">
          <div className="flex items-center gap-2 rounded-2xl border border-white/60 bg-white/70 px-3 py-2 shadow-sm">
            <FileText className="h-4 w-4 text-sky-500" />
            PDF / DOC / TXT
          </div>
          <div className="flex items-center gap-2 rounded-2xl border border-white/60 bg-white/70 px-3 py-2 shadow-sm">
            <ImageIcon className="h-4 w-4 text-sky-500" />
            DICOM / PNG / JPG
          </div>
        </div>
      </div>

      {/* Upload progress status */}
      <div className="space-y-3 rounded-2xl border border-sky-100 bg-white/70 p-5 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>AI 解析进度</span>
          <span className="font-semibold text-sky-600">{progress}%</span>
        </div>
        <div className="relative h-3 w-full overflow-hidden rounded-full bg-sky-100">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-blue-500 via-sky-400 to-sky-300"
            style={{ width: `${progress}%` }}
            transition={{ duration: 0.4, ease: 'easeOut' as const }}
          />
        </div>
        <p className="text-xs text-slate-500">
          智能分析重点：肿瘤分期、基因突变、既往治疗、实验室指标等。
        </p>
        {uploadedFileName && (
          <div className="flex items-center gap-2 rounded-2xl border border-sky-100 bg-sky-50/70 px-4 py-3 text-xs text-slate-500">
            <Sparkles className="h-4 w-4 text-sky-500" />
            当前文件：<span className="font-medium text-slate-700">{uploadedFileName}</span>
          </div>
        )}
        {isUploading && (
          <p className="text-xs font-semibold text-sky-600">
            正在安全加密上传...
          </p>
        )}
      </div>
    </motion.div>
  );
}
