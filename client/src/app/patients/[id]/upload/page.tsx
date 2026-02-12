/**
 * =============================================================================
 * 文件上传页面 - 集成进度跟踪
 * File Upload Page - Integrated Progress Tracking
 * =============================================================================
 * Linus哲学：上传体验要像内核I/O一样可靠
 * Good taste: Upload experience should be as reliable as kernel I/O
 * =============================================================================
 */

'use client';

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, FileText, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/auth';
import { usePatientStore } from '@/lib/stores/patients';
import { patientsApi } from '@/lib/api/patients';
import { useWorkflowStore, type WorkflowStep } from '@/lib/stores/workflow';
import { useUploadProgressStore, generateUploadId, type UploadTask } from '@/lib/stores/uploadProgress';
import { useUploadProgress } from '@/hooks/useUploadProgress';
import { medicalApi } from '@/lib/api/medical';
import { uploadProgressApi } from '@/lib/api/uploadProgress';
import { cn, extractErrorMessage } from '@/lib/utils';
import { logClientError, logClientWarn } from '@/lib/logging';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { UploadProgress } from '@/components/ui/UploadProgress';
import { GlobalUploadProgress } from '@/components/ui/UploadProgress';
import { showToast } from '@/components/ui/Toast';
import { SlidePageTransition } from '@/components/layout/PageTransition';
import { ProcessingTimeline } from '@/components/upload/ProcessingTimeline';
import { MedicalRecord, type JsonValue } from '@/types';
import { StepNavigation } from '@/components/workflow/StepNavigation';
import { WorkflowErrorState, WorkflowLoadingState } from '@/components/workflow/WorkflowFeedback';

const TEST_MEDICAL_RECORD_TEXT = `姓名： 测试患者  性别： 男  年龄： 53岁
日期： 2024-05-31  科别： 肿瘤内科门诊

主诉：结肠癌术后复发，腹膜后及肺转移，放疗后随访复查。

现病史：患者于2022年3月因大便带血行肠镜检查，发现乙状结肠占位性病变，病理提示中-低分化腺癌。术后行CapeOX辅助化疗8周期，2023年起出现腹膜后及肺转移，2024年接受放疗并使用瑞戈非尼联合信迪利单抗。

免疫组化：KRAS突变(+)，PD-L1 CPS=3，Ki-67 60%。

既往史：无糖尿病、高血压史。

诊断：转移性结直肠癌 (KRAS G12D, MSS)。

当前治疗：Regorafenib + Sintilimab。`;



interface FileUploadItem {
  id: string;
  file: File;
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'error';
  progress: number;
  error?: string;
  uploadId: string;
}

const formatTimestamp = (value?: string | number | Date | null): string => {
  if (!value) return '未知时间';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '未知时间';
  }

  return date.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

export default function UploadStep({ params }: { params?: Promise<{ id?: string }> }) {
  const [patientRouteId, setPatientRouteId] = useState('');
  const [paramsResolved, setParamsResolved] = useState(false);
  const [isLoadingPatient, setIsLoadingPatient] = useState(false);
  const [patientLoadError, setPatientLoadError] = useState<string | null>(null);
  const [patientLoadTraceId, setPatientLoadTraceId] = useState<string | null>(null);
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const { currentPatient, setCurrentPatient } = usePatientStore();
  const {
    extractedText,
    step1Data,
    resetWorkflow,
    setExtractedText,
    setStep1Data,
    setCurrentStep,
    setStepCompleted,
  } = useWorkflowStore();

  const { activeUploads } = useUploadProgressStore();

  const currentPatientId = currentPatient?.id ?? null;
  const manualTextValue = step1Data?.manualText ?? '';

  // 状态管理 / State management
  const [fileQueue, setFileQueue] = useState<FileUploadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [currentUploadId, setCurrentUploadId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recentRecords, setRecentRecords] = useState<MedicalRecord[]>([]);
  const [isLoadingRecords, setIsLoadingRecords] = useState(false);

  // 使用上传进度Hook / Use upload progress hook
  const {
    task: currentTask,
    isActive,
    isError,
    error,
    startStage,
    updateStageProgress,
    completeUpload,
    failUpload
  } = useUploadProgress(currentUploadId ?? undefined, {
    showNotifications: true,
    onComplete: (completedTask) => {
      handleUploadComplete(completedTask);
    },
    onError: (error) => {
      handleUploadError(error);
    }
  });

  // Resolve params
  useEffect(() => {
    let isActive = true;

    const resolveParams = async () => {
      if (!params) {
        if (isActive) {
          setPatientRouteId('');
          setParamsResolved(true);
        }
        return;
      }

      const resolved = await params;
      if (!isActive) return;

      setPatientRouteId(resolved?.id ?? '');
      setParamsResolved(true);
    };

    resolveParams();

    return () => {
      isActive = false;
    };
  }, [params]);

  // Set current step
  const lastPatientRef = useRef<string | null>(null);

  useEffect(() => {
    if (!paramsResolved || !patientRouteId) return;
    if (lastPatientRef.current !== patientRouteId) {
      resetWorkflow();
      setCurrentStep(1);
      lastPatientRef.current = patientRouteId;
    }
  }, [paramsResolved, patientRouteId, resetWorkflow, setCurrentStep]);

  const handleApplyTestData = useCallback(() => {
    if (isProcessing) return;
    setStep1Data({
      ...(step1Data ?? { files: [], ocrResult: null }),
      manualText: TEST_MEDICAL_RECORD_TEXT,
    });
    setExtractedText(TEST_MEDICAL_RECORD_TEXT);
    showToast.info('已填入示例病历，可直接进入下一步');
  }, [isProcessing, setStep1Data, step1Data, setExtractedText]);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/auth/login');
      return;
    }
  }, [isAuthenticated, router]);

  const loadPatient = useCallback(async () => {
    if (!paramsResolved) return;
    if (!patientRouteId) return;

    try {
      setIsLoadingPatient(true);
      setPatientLoadError(null);
      setPatientLoadTraceId(null);
      const patient = await patientsApi.getPatient(patientRouteId);
      setCurrentPatient(patient);
    } catch (error: unknown) {
      const traceId = logClientError('upload.loadPatient', error, { patientRouteId });
      const message = extractErrorMessage(error, '患者信息加载失败');
      setPatientLoadError(message);
      setPatientLoadTraceId(traceId);
      showToast.error(message);
    } finally {
      setIsLoadingPatient(false);
    }
  }, [paramsResolved, patientRouteId, setCurrentPatient]);

  // Load patient data
  useEffect(() => {
    if (!paramsResolved) return;
    if (!patientRouteId) return;
    void loadPatient();
  }, [loadPatient, paramsResolved, patientRouteId]);

  const refreshPatientRecords = useCallback(async () => {
    if (!patientRouteId) return;

    try {
      setIsLoadingRecords(true);
      const records = await patientsApi.getPatientRecords(patientRouteId);
      setRecentRecords(records.slice(0, 5));
    } catch (error: unknown) {
      logClientWarn('upload.refreshPatientRecords', error, { patientRouteId });
    } finally {
      setIsLoadingRecords(false);
    }
  }, [patientRouteId]);

  useEffect(() => {
    if (!paramsResolved || !patientRouteId) {
      return;
    }
    refreshPatientRecords();
  }, [paramsResolved, patientRouteId, refreshPatientRecords]);

  // 文件处理函数 / File Handling Functions

  const validateFiles = useCallback((files: FileList): File[] => {
    const validFiles: File[] = [];
    const maxSize = 50 * 1024 * 1024; // 50MB
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/tiff',
      'text/plain'
    ];

    Array.from(files).forEach(file => {
      if (file.size > maxSize) {
        showToast.error(`文件 "${file.name}" 超过50MB限制`);
        return;
      }

      if (!allowedTypes.some(type => file.type.startsWith(type) || file.type === type)) {
        showToast.error(`文件 "${file.name}" 格式不支持`);
        return;
      }

      validFiles.push(file);
    });

    return validFiles;
  }, []);

  const addFilesToQueue = useCallback((files: File[]) => {
    const newFiles: FileUploadItem[] = files.map(file => ({
      id: generateUploadId(),
      file,
      status: 'pending',
      progress: 0,
      uploadId: generateUploadId()
    }));

    setFileQueue(prev => [...prev, ...newFiles]);
  }, []);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const validFiles = validateFiles(files);
    if (validFiles.length > 0) {
      addFilesToQueue(validFiles);
    }

    // 重置input / Reset input
    event.target.value = '';
  }, [validateFiles, addFilesToQueue]);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);

    const files = event.dataTransfer.files;
    const validFiles = validateFiles(files);
    if (validFiles.length > 0) {
      addFilesToQueue(validFiles);
    }
  }, [validateFiles, addFilesToQueue]);

  // 文件上传处理 / File Upload Processing

  const simulateFileUpload = useCallback(async () => {
    await new Promise<void>((resolve) => {
      const totalSteps = 10;
      let currentStep = 0;

      const uploadInterval = setInterval(async () => {
        currentStep += 1;
        const simulatedProgress = Math.round((currentStep / totalSteps) * 100);

        await updateStageProgress(simulatedProgress, `上传中 ${simulatedProgress}%...`);

        if (currentStep >= totalSteps) {
          clearInterval(uploadInterval);
          resolve();
        }
      }, 200);
    });
  }, [updateStageProgress]);

  const processOCRResult = useCallback(async (file: File, uploadId: string) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (currentPatientId) {
        formData.append('patientId', currentPatientId);
      }

      await startStage('ocr', '正在识别文字内容...');
      await updateStageProgress(30, 'OCR识别中...');

      const response = await medicalApi.uploadMedicalFile(formData);

      if (!response.success) {
        throw new Error(response.message || 'OCR处理失败');
      }

      await updateStageProgress(100, '文字识别完成');

      const extracted = response.extractedText || response.combinedText || '';

      const completionPayload: JsonValue = {
        extractedText: extracted,
        fileId: response.fileId ?? null,
        ocrMetadata: response.ocrMetadata ?? null,
        overallMetadata: response.overallMetadata ?? null,
      };

      await completeUpload(completionPayload);

      setFileQueue(prev => prev.map(item =>
        item.uploadId === uploadId
          ? { ...item, status: 'completed', progress: 100 }
          : item
      ));

      setExtractedText(extracted);
      setStep1Data({
        ...(step1Data ?? { files: [], ocrResult: null }),
        files: [file],
        ocrResult: (response.results && response.results[0]) || response.ocrMetadata || null,
        fileName: file.name,
        fileSize: file.size,
        uploadId,
        manualText: extracted,
      });

      showToast.success(`文件 "${file.name}" 处理完成`);
    } catch (error: unknown) {
      logClientError('upload.processOCRResult', error, {
        fileName: file.name,
        uploadId
      });
      const errorMessage = extractErrorMessage(error, '文字识别失败');

      failUpload(errorMessage);
      setFileQueue(prev => prev.map(item =>
        item.uploadId === uploadId
          ? { ...item, status: 'error', error: errorMessage }
          : item
      ));

      showToast.error(`处理失败: ${errorMessage}`);
    }
  }, [
    completeUpload,
    currentPatientId,
    failUpload,
    setExtractedText,
    setFileQueue,
    setStep1Data,
    startStage,
    step1Data,
    updateStageProgress
  ]);

  const processFileUpload = useCallback(async (fileItem: FileUploadItem) => {
    const { file, uploadId } = fileItem;

    try {
      setFileQueue(prev => prev.map(item =>
        item.id === fileItem.id
          ? { ...item, status: 'uploading', progress: 0 }
          : item
      ));

      // 设置当前上传ID / Set current upload ID
      setCurrentUploadId(uploadId);

      // 创建上传进度任务 / Create upload progress task
      await uploadProgressApi.createTask({
        uploadId,
        fileName: file.name,
        fileSize: file.size,
        patientId: currentPatientId ?? undefined
      });

      // 开始OCR处理阶段 / Start OCR processing stage
      await startStage('ocr', '正在上传文件...');

      // 模拟文件上传进度 / Simulate file upload progress
      await simulateFileUpload();

      // 处理OCR结果 / Process OCR result
      await processOCRResult(file, uploadId);

    } catch (error: unknown) {
      logClientError('upload.processFileUpload', error, {
        fileName: file.name,
        uploadId
      });
      const errorMessage = extractErrorMessage(error, '文件上传失败');

      failUpload(errorMessage);
      setFileQueue(prev => prev.map(item =>
        item.id === fileItem.id
          ? { ...item, status: 'error', error: errorMessage }
          : item
      ));
    }
  }, [currentPatientId, failUpload, processOCRResult, setCurrentUploadId, setFileQueue, simulateFileUpload, startStage]);

  // 上传完成处理 / Upload Completion Handling

  const handleUploadComplete = useCallback(async (_completedTask: UploadTask) => {
    void _completedTask;

    // 清理当前上传ID / Clean up current upload ID
    setCurrentUploadId(null);
    setIsProcessing(false);

    await refreshPatientRecords();

    showToast.success('文件处理完成，可继续下一步');
  }, [refreshPatientRecords]);

  const handleUploadError = useCallback((error: string) => {
    logClientError('upload.handleUploadError', error);

    setCurrentUploadId(null);
    setIsProcessing(false);

    showToast.error(`上传失败: ${error}`);
  }, []);

  // 批量上传处理 / Batch Upload Processing

  const processAllFiles = useCallback(async () => {
    if (fileQueue.length === 0) return;

    setIsProcessing(true);

    for (const fileItem of fileQueue) {
      if (fileItem.status === 'pending') {
        await processFileUpload(fileItem);
      }
    }

    setIsProcessing(false);
  }, [fileQueue, processFileUpload]);

  useEffect(() => {
    if (fileQueue.length > 0 && !isProcessing && !currentUploadId) {
      processAllFiles();
    }
  }, [fileQueue, isProcessing, currentUploadId, processAllFiles]);

  const hasPendingUploads = useMemo(
    () =>
      fileQueue.some(
        (item) =>
          item.status === 'pending' ||
          item.status === 'uploading' ||
          item.status === 'processing'
      ),
    [fileQueue]
  );

  const extracted = extractedText ? extractedText.trim() : '';
  const hasReadyData = Boolean(extracted);

  const stageReady =
    hasReadyData && !isActive && !isProcessing && !currentUploadId && !hasPendingUploads;

  useEffect(() => {
    setStepCompleted(1, stageReady);
  }, [setStepCompleted, stageReady]);

  const handleProceedToExtraction = useCallback(async () => {
    if (!currentPatientId) {
      return;
    }

    if (isActive || isProcessing || currentUploadId) {
      showToast.error('文件仍在处理中，请稍候');
      return;
    }

    const extracted = extractedText ? extractedText.trim() : '';

    if (!extracted) {
      showToast.error('请先上传文件或输入文本内容');
      return;
    }

    router.push(`/patients/${currentPatientId}/extract`);
  }, [
    currentPatientId,
    isActive,
    isProcessing,
    currentUploadId,
    extractedText,
    router
  ]);

  const handleStepNavigation = useCallback(
    (step: WorkflowStep) => {
      if (step === 1) {
        return;
      }

      if (step === 2) {
        if (!stageReady) {
          showToast.error('请先上传文件或输入文本，并等待处理完成');
          return;
        }
        void handleProceedToExtraction();
        return;
      }

      if (step === 3) {
        showToast.info('完成数据提取后即可查看匹配结果');
      }
    },
    [handleProceedToExtraction, stageReady]
  );

  const canNavigateToStep = useCallback(
    (step: WorkflowStep) => {
      if (step === 1) return true;
      if (step === 2) return stageReady;
      return false;
    },
    [stageReady]
  );

  if (!isAuthenticated) {
    return <WorkflowLoadingState title="正在跳转登录" message="需要登录后才能继续" />;
  }

  if (!paramsResolved) {
    return <WorkflowLoadingState title="正在加载患者信息" message="请稍候..." />;
  }

  if (!patientRouteId) {
    return (
      <WorkflowErrorState
        title="患者标识无效"
        message="未获取到患者 ID，请返回患者列表重试。"
        backAction={{ label: '返回患者列表', href: '/patients' }}
      />
    );
  }

  if (patientLoadError) {
    return (
      <WorkflowErrorState
        title="患者信息加载失败"
        message={patientLoadError}
        traceId={patientLoadTraceId}
        retryAction={{ label: '重试', onClick: () => void loadPatient() }}
        backAction={{ label: '返回患者列表', href: '/patients' }}
      />
    );
  }

  if (isLoadingPatient || !currentPatient) {
    return (
      <WorkflowLoadingState title="正在加载患者信息" message="请稍候..." />
    );
  }

  return (
    <SlidePageTransition>
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
        <div className="container mx-auto px-4 py-8">
          {/* 头部信息 / Header Info */}
          <div className="flex items-center mb-8">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{currentPatient.name}</h1>
              <p className="text-gray-600">患者ID: {currentPatient.patientId}</p>
            </div>
          </div>

          <div className="mb-10">
            <StepNavigation
              currentStep={1}
              onStepClick={handleStepNavigation}
              canNavigateToStep={canNavigateToStep}
            />
          </div>

          {/* 全局上传进度面板 / Global Upload Progress Panel */}
          {Object.keys(activeUploads).length > 0 && (
            <div className="mb-8">
              <GlobalUploadProgress
                maxVisible={3}
                onAllComplete={() => undefined}
              />
            </div>
          )}

          <div className="grid lg:grid-cols-3 gap-8">
            {/* 左侧：文件上传区域 / Left: File Upload Area */}
            <div className="lg:col-span-2 space-y-6">
              <Card className="shadow-xl border-blue-100">
                <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100">
                  <CardTitle className="text-xl flex items-center space-x-3">
                    <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center shadow-md">
                      <Upload className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <div className="text-gray-900">上传医疗文件</div>
                      <div className="text-sm font-normal text-gray-600 mt-1">支持PDF、图片和文本文件</div>
                    </div>
                  </CardTitle>
                </CardHeader>

                <CardContent className="p-6">
                  {/* 拖拽上传区域 / Drag and Drop Upload Area */}
                  <div
                    className={cn(
                      "border-2 border-dashed rounded-xl p-8 text-center transition-all duration-300 cursor-pointer",
                      "hover:border-blue-400 hover:bg-blue-50/50",
                      isDragging && "border-blue-500 bg-blue-50/50 scale-105",
                      "min-h-[200px] flex flex-col items-center justify-center"
                    )}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => document.getElementById('file-input')?.click()}
                  >
                    <input
                      id="file-input"
                      type="file"
                      multiple
                      accept=".pdf,.jpg,.jpeg,.png,.tiff,.txt"
                      onChange={handleFileSelect}
                      className="hidden"
                      disabled={isProcessing}
                    />

                    <div className="space-y-4">
                      <div className="w-16 h-16 mx-auto bg-gradient-to-br from-blue-100 to-indigo-100 rounded-full flex items-center justify-center shadow-sm">
                        <Upload className="w-8 h-8 text-blue-600" />
                      </div>

                      <div className="space-y-2">
                        <p className="text-lg font-semibold text-gray-900">
                          {isProcessing ? '正在处理文件...' : '拖拽文件到此处或点击上传'}
                        </p>
                        <p className="text-sm text-gray-600">
                          支持 PDF、JPG、PNG、TIFF 格式，最大50MB
                        </p>
                      </div>

                      {!isProcessing && (
                        <Button
                          variant="primary"
                          size="sm"
                          className="px-6"
                          onClick={(event) => {
                            event.stopPropagation();
                            document.getElementById('file-input')?.click();
                          }}
                        >
                          上传文件
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* 当前上传进度 / Current Upload Progress */}
                  {currentUploadId && currentTask && (
                    <div className="mt-6">
                      <UploadProgress
                        taskId={currentUploadId}
                        className="w-full"
                      />
                    </div>
                  )}
                  {currentUploadId && (
                    <ProcessingTimeline uploadId={currentUploadId} />
                  )}

                  {/* 文件队列 / File Queue */}
                  {fileQueue.length > 0 && (
                    <div className="mt-6 space-y-3">
                      <h3 className="text-lg font-semibold text-gray-900">上传队列 ({fileQueue.length})</h3>
                      {fileQueue.map((fileItem) => (
                        <div
                          key={fileItem.id}
                          className={cn(
                            "p-4 bg-white rounded-lg border transition-all duration-200",
                            fileItem.status === 'completed' && "border-green-200 bg-green-50",
                            fileItem.status === 'error' && "border-red-200 bg-red-50",
                            fileItem.status === 'processing' && "border-blue-200 bg-blue-50"
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              <FileText className="w-5 h-5 text-gray-500" />
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">{fileItem.file.name}</p>
                                <p className="text-xs text-gray-500">
                                  {(fileItem.file.size / 1024 / 1024).toFixed(2)} MB
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center space-x-2">
                              {fileItem.status === 'pending' && (
                                <span className="text-xs text-gray-500">等待中</span>
                              )}
                              {fileItem.status === 'uploading' && (
                                <div className="flex items-center space-x-2">
                                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                                  <span className="text-xs text-blue-600">{fileItem.progress}%</span>
                                </div>
                              )}
                              {fileItem.status === 'processing' && (
                                <div className="flex items-center space-x-2">
                                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-600"></div>
                                  <span className="text-xs text-purple-600">处理中</span>
                                </div>
                              )}
                              {fileItem.status === 'completed' && (
                                <CheckCircle className="w-4 h-4 text-green-600" />
                              )}
                              {fileItem.status === 'error' && (
                                <div className="flex items-center space-x-2">
                                  <AlertCircle className="w-4 h-4 text-red-600" />
                                  <span className="text-xs text-red-600">失败</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {fileItem.error && (
                            <p className="mt-2 text-xs text-red-600">{fileItem.error}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="shadow-md border-gray-200">
                <CardHeader className="bg-gradient-to-r from-gray-50 to-slate-50 border-b border-gray-100">
                  <CardTitle className="text-lg flex items-center space-x-2">
                    <FileText className="w-5 h-5 text-gray-600" />
                    <span>手动输入医疗文本</span>
                  </CardTitle>
                </CardHeader>

                <CardContent className="p-6 space-y-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-gray-600">
                      可直接粘贴病历文本或一键填入示例，便于演示流程。
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={handleApplyTestData}
                      disabled={isProcessing}
                      className="sm:w-auto w-full"
                    >
                      使用测试数据
                    </Button>
                  </div>

                  <textarea
                    className="w-full h-32 p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                    placeholder="请在此输入或粘贴医疗文本内容..."
                    value={manualTextValue}
                    onChange={(event) => {
                      const value = event.target.value;
                      setStep1Data({
                        ...(step1Data ?? { files: [], ocrResult: null }),
                        manualText: value,
                      });
                      setExtractedText(value);
                    }}
                    disabled={isProcessing}
                  />
                </CardContent>
              </Card>

            </div>

            {/* 右侧：操作面板 / Right: Action Panel */}
            <div className="space-y-6">
              {/* 快速操作 / Quick Actions */}
              <Card className="shadow-md border-blue-100">
                <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100">
                  <CardTitle className="text-base flex items-center space-x-2">
                    <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span>操作提示</span>
                  </CardTitle>
                </CardHeader>

                <CardContent className="space-y-3 pt-4 text-sm text-slate-600">
                  <p>上传完成后，请点击页面上方的「下一步」按钮进入数据提取阶段。</p>
                  {extractedText && (
                    <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                      <div className="flex items-center space-x-2">
                        <CheckCircle className="w-4 h-4 text-green-600" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-green-800">文本已提取</p>
                          <p className="text-xs text-green-600 mt-0.5">可以开始数据提取</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {isActive && (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                      <div className="flex items-center space-x-3">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-blue-800">正在处理文件</p>
                          <p className="text-xs text-blue-600 mt-1">请稍候，不要关闭页面</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {isError && error && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                      <div className="flex items-center space-x-2">
                        <AlertCircle className="w-4 h-4 text-red-600" />
                        <span className="text-sm text-red-800">处理失败，请重新上传文件</span>
                      </div>
                      <p className="mt-2 text-xs text-red-600">{error}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* 历史记录 / Recent Records */}
              <Card className="shadow-md border-purple-100">
                <CardHeader className="bg-gradient-to-r from-purple-50 to-pink-50 border-b border-purple-100">
                  <CardTitle className="text-base flex items-center space-x-2 text-purple-900">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                    </svg>
                    <span>近期处理记录</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pt-4">
                  {isLoadingRecords ? (
                    <div className="flex items-center space-x-3 text-sm text-purple-700">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-500" />
                      <span>正在加载历史记录...</span>
                    </div>
                  ) : recentRecords.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      暂无历史记录。完成一次上传后，这里会展示提取和匹配摘要。
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {recentRecords.map((record) => {
                        const recordId = (record as unknown as { _id?: string })._id || (record as { id?: string }).id || record.uploadDate?.toString();
                        const rawDiagnosis =
                          record.structuredData && typeof record.structuredData === 'object'
                            ? (record.structuredData as Record<string, JsonValue>).diagnosis
                            : undefined;
                        let diagnosis = record.originalFileName || '未命名记录';
                        if (rawDiagnosis !== undefined && rawDiagnosis !== null) {
                          if (typeof rawDiagnosis === 'string') {
                            diagnosis = rawDiagnosis;
                          } else if (Array.isArray(rawDiagnosis)) {
                            diagnosis = rawDiagnosis
                              .map((item) => {
                                if (typeof item === 'string') return item;
                                if (typeof item === 'number' || typeof item === 'boolean') return String(item);
                                return JSON.stringify(item);
                              })
                              .join('、');
                          } else if (typeof rawDiagnosis === 'number' || typeof rawDiagnosis === 'boolean') {
                            diagnosis = String(rawDiagnosis);
                          } else if (typeof rawDiagnosis === 'object') {
                            diagnosis = JSON.stringify(rawDiagnosis);
                          }
                        }
                        const matchCount = Array.isArray(record.matchResults) ? record.matchResults.length : 0;

                        return (
                          <div
                            key={recordId}
                            className="rounded-lg border border-purple-100 bg-white/70 p-3 shadow-sm transition hover:border-purple-200"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                <p className="text-sm font-semibold text-gray-900 line-clamp-2">{diagnosis || '未提取诊断'}</p>
                                <p className="mt-1 text-xs text-gray-500">{formatTimestamp(record.uploadDate)}</p>
                                {matchCount > 0 && (
                                  <p className="mt-1 text-xs text-purple-600">{matchCount} 条临床试验匹配结果</p>
                                )}
                              </div>
                              {recordId && (
                                <a
                                  href={`/patients/${patientRouteId}/structured?record=${recordId}`}
                                  className="text-xs font-medium text-purple-700 hover:text-purple-900 hover:underline"
                                >
                                  查看详情
                                </a>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* 文件统计 / File Statistics */}
              {fileQueue.length > 0 && (
                <Card className="shadow-md border-gray-200">
                  <CardHeader className="bg-gradient-to-r from-gray-50 to-slate-50 border-b border-gray-100">
                    <CardTitle className="text-base flex items-center space-x-2">
                      <FileText className="w-5 h-5 text-gray-600" />
                      <span>文件统计</span>
                    </CardTitle>
                  </CardHeader>

                  <CardContent className="pt-4 space-y-3">
                    <div className="flex items-center justify-between py-2 border-b border-gray-100">
                      <span className="text-xs text-gray-600">总文件数</span>
                      <span className="text-sm font-bold text-gray-900">{fileQueue.length}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-gray-100">
                      <span className="text-xs text-gray-600">已完成</span>
                      <span className="text-sm font-bold text-green-600">
                        {fileQueue.filter(f => f.status === 'completed').length}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <span className="text-xs text-gray-600">处理中</span>
                      <span className="text-sm font-bold text-blue-600">
                        {fileQueue.filter(f => f.status === 'processing').length}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )}

            </div>
          </div>
        </div>
      </div>
    </SlidePageTransition>
  );
}
