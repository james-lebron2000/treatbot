'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { uploadFile, UploadFileResponse } from '@/lib/api';
import { useAppContext, UploadedFileMeta } from '@/context/AppContext';
import { extractErrorMessage } from '@/lib/utils';

const MAX_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/plain',
]);

const isAllowedFileType = (file: File) => {
  if (ALLOWED_MIME_TYPES.has(file.type)) {
    return true;
  }

  const extension = file.name.split('.').pop()?.toLowerCase();
  return extension ? ['pdf', 'png', 'jpg', 'jpeg', 'txt'].includes(extension) : false;
};

type UseUploadReturn = {
  isUploading: boolean;
  error: string | null;
  uploadProgress: number;
  uploadedFileMeta: UploadedFileMeta | null;
  handleFiles: (files: FileList | File[]) => void;
  handleInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  resetError: () => void;
};

export function useUpload(): UseUploadReturn {
  const {
    setLocalFile,
    uploadedFileMeta,
    setUploadedFileMeta,
    uploadProgress,
    setUploadProgress,
    setMatchedTrials,
    resetFlow,
  } = useAppContext();

  const [error, setError] = useState<string | null>(null);
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);

  const stopProgressTimer = useCallback(() => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }, []);

  const startProgressTimer = useCallback(() => {
    stopProgressTimer();
    progressTimerRef.current = setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= 94) {
          return prev;
        }
        return prev + Math.max(1, Math.floor(Math.random() * 6));
      });
    }, 320);
  }, [setUploadProgress, stopProgressTimer]);

  useEffect(() => () => stopProgressTimer(), [stopProgressTimer]);

  const mutation = useMutation({
    mutationFn: async (file: File) => {
      const response = await uploadFile<UploadFileResponse>('/medical/upload', file);
      return response;
    },
    onMutate: async (file: File) => {
      setError(null);
      resetFlow();

      setLocalFile({
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
      });

      setMatchedTrials([]);
      setUploadProgress(5);
      startProgressTimer();
    },
    onError: (mutationError: unknown) => {
      stopProgressTimer();
      setUploadProgress(0);
      setError(
        extractErrorMessage(
          mutationError,
          '上传失败，请稍后重试'
        )
      );
    },
    onSuccess: (data: UploadFileResponse) => {
      stopProgressTimer();
      setUploadProgress(100);
      setUploadedFileMeta({
        uploadId: data.uploadId,
        filename: data.filename,
        mimeType: data.mimeType ?? '',
        size: data.size,
        uploadedAt: new Date().toISOString(),
      });
    },
  });

  const validateFile = useCallback((file: File): string | null => {
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      return '文件大小超过 20MB 限制';
    }

    if (!isAllowedFileType(file)) {
      return '仅支持 PDF、PNG、JPG、TXT 文件';
    }

    return null;
  }, []);

  const handleValidFile = useCallback(
    (file: File) => {
      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        return;
      }

      mutation.mutate(file);
    },
    [mutation, validateFile]
  );

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.isArray(files) ? files : Array.from(files);
      const primary = fileArray[0];
      if (!primary) {
        setError('请选择一个文件');
        return;
      }
      handleValidFile(primary);
    },
    [handleValidFile]
  );

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!event.target.files) return;
      handleFiles(event.target.files);
    },
    [handleFiles]
  );

  const resetError = useCallback(() => setError(null), []);

  const isUploading = mutation.isPending;

  return useMemo(
    () => ({
      isUploading,
      error,
      uploadProgress,
      uploadedFileMeta,
      handleFiles,
      handleInputChange,
      resetError,
    }),
    [isUploading, error, uploadProgress, uploadedFileMeta, handleFiles, handleInputChange, resetError]
  );
}
