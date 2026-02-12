'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Search } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/auth';
import { usePatientStore } from '@/lib/stores/patients';
import { useWorkflowStore } from '@/lib/stores/workflow';
import { useThinkingMode } from '@/hooks/useThinkingMode';
import { patientsApi } from '@/lib/api/patients';
import { medicalApi, FieldExtractionResponse, LLMIntegrationResponse } from '@/lib/api/medical';
import { logClientError, logClientErrorWithMessage, logClientWarn } from '@/lib/logging';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { StepNavigation } from '@/components/workflow/StepNavigation';
import { showToast } from '@/components/ui/Toast';
import { JsonValue, StructuredData, ClinicalArchive } from '@/types';
import { getFieldLabel } from '@/lib/clinical/fieldLabels';
import { WorkflowEmptyState, WorkflowErrorState, WorkflowLoadingState } from '@/components/workflow/WorkflowFeedback';

type StructuredRecord = Record<string, JsonValue>;

const isRecord = (value: unknown): value is StructuredRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const mergeStructuredData = (
  base: StructuredRecord | null | undefined,
  updates: StructuredRecord | null | undefined
): StructuredRecord => {
  if (!updates) {
    return base ? { ...base } : {};
  }

  const result: StructuredRecord = base ? { ...base } : {};

  Object.entries(updates).forEach(([key, value]) => {
    if (isRecord(value)) {
      const existingValue = result[key];
      const existingRecord = isRecord(existingValue) ? existingValue : {};
      result[key] = mergeStructuredData(existingRecord, value);
    } else {
      result[key] = value;
    }
  });

  return result;
};

const toStructuredRecord = (
  input?: StructuredRecord | StructuredData | null
): StructuredRecord | null => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  return mergeStructuredData({}, input as StructuredRecord);
};

const formatJsonValue = (value: JsonValue | undefined): string => {
  if (value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map((item) => formatJsonValue(item)).join(', ');
  }

  if (isRecord(value)) {
    if ('value' in value) {
      const rawValue = (value as Record<string, JsonValue>).value as JsonValue;
      const base = formatJsonValue(rawValue);

      const meta: string[] = [];
      const confidence = (value as Record<string, JsonValue>).confidence;
      const reasoning = (value as Record<string, JsonValue>).reasoning;

      if (typeof confidence === 'string' && confidence.trim()) {
        meta.push(`置信度: ${confidence}`);
      }

      if (typeof reasoning === 'string' && reasoning.trim()) {
        meta.push(`依据: ${reasoning}`);
      }

      return meta.length > 0 ? `${base} (${meta.join('; ')})` : base;
    }

    return Object.entries(value)
      .map(([nestedKey, nestedValue]) => `${nestedKey}: ${formatJsonValue(nestedValue)}`)
      .join('; ');
  }

  if (value === null) {
    return '-';
  }

  return String(value);
};

const formatDataTypeLabel = (value: JsonValue | undefined): string => {
  if (value === undefined) return '未定义';
  if (Array.isArray(value)) return `数组[${value.length}]`;
  if (isRecord(value)) return '对象';
  switch (typeof value) {
    case 'string':
      return '文本';
    case 'number':
      return '数字';
    case 'boolean':
      return '是/否';
    default:
      return typeof value;
  }
};

interface ExtractStepProps {
  params?: Promise<{
    id?: string;
  }>;
}

export default function ExtractStep({ params }: ExtractStepProps) {
  const [patientRouteId, setPatientRouteId] = useState('');
  const [paramsResolved, setParamsResolved] = useState(false);
  const [isLoadingPatient, setIsLoadingPatient] = useState(false);
  const [patientLoadError, setPatientLoadError] = useState<string | null>(null);
  const [patientLoadTraceId, setPatientLoadTraceId] = useState<string | null>(null);
  const router = useRouter();
  const { isAuthenticated, hasHydrated } = useAuthStore();
  const { currentPatient, setCurrentPatient } = usePatientStore();
  const {
    extractedText,
    structuredRecord,
    step1Data,
    step2Completed,
    setExtractedText,
    setStructuredRecord,
    setStep2Data,
    setStepCompleted,
    setCurrentStep,
    setMatchResults,
    setStep3Data,
  } = useWorkflowStore();

  const [llmIntegrationResult, setLlmIntegrationResult] = useState<LLMIntegrationResponse | null>(null);
  const [fieldExtractionResult, setFieldExtractionResult] = useState<FieldExtractionResponse | null>(null);
  const [isAIExtracting, setIsAIExtracting] = useState(false);
  const [isAutoExtracting, setIsAutoExtracting] = useState(false);
  const [clinicalArchive, setClinicalArchive] = useState<ClinicalArchive | null>(null);
  const [existingRecordId, setExistingRecordId] = useState<string | null>(null);

  // Double-click protection ref
  const extractionInProgressRef = useRef(false);

  // Thinking mode integration with enhanced stage messages
  const thinking = useThinkingMode({
    onComplete: () => {
      showToast.success('医疗信息提取完成');
    },
    onError: (error) => {
      showToast.error(`提取失败：${error}`);
    },
    onStageChange: (stage) => {
      // Provide more specific messages based on stage
      switch (stage) {
        case 'parsing':
          thinking.setMessage('正在解析病历内容与医学术语...');
          break;
        case 'complete':
          thinking.setMessage('医疗信息提取完成');
          break;
        case 'error':
          thinking.setMessage('提取失败，请重试');
          break;
      }
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
  useEffect(() => {
    setCurrentStep(2);
  }, [setCurrentStep]);

  // Auto-extraction logic - automatically extract when page loads with valid data
  useEffect(() => {
    const performAutoExtraction = async () => {
      // Check if we should auto-extract
      const hasValidText = extractedText && typeof extractedText === 'string' && extractedText.trim();
      const shouldAutoExtract = hasValidText && !step2Completed && !isAIExtracting && !thinking.isThinking;
      
      if (shouldAutoExtract) {
        setIsAutoExtracting(true);
        
        // Add a small delay to let the UI settle
        setTimeout(() => {
          handleAIExtraction();
          setIsAutoExtracting(false);
        }, 500);
      }
    };

    // Only run auto-extraction if params are resolved and we have a valid patient
    if (paramsResolved && currentPatient && patientRouteId) {
      performAutoExtraction();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extractedText, step2Completed, isAIExtracting, thinking.isThinking, paramsResolved, currentPatient, patientRouteId]);

  // Redirect if not authenticated
  useEffect(() => {
    if (hasHydrated && !isAuthenticated) {
      router.push('/auth/login');
      return;
    }
  }, [hasHydrated, isAuthenticated, router]);

  const loadPatient = async () => {
    if (!paramsResolved || !patientRouteId) return;
    try {
      setIsLoadingPatient(true);
      setPatientLoadError(null);
      setPatientLoadTraceId(null);
      const patient = await patientsApi.getPatient(patientRouteId);
      setCurrentPatient(patient);
    } catch (error: unknown) {
      const { traceId, message } = logClientErrorWithMessage(
        'extract.loadPatient',
        error,
        '患者信息加载失败',
        { patientRouteId }
      );
      setPatientLoadError(message);
      setPatientLoadTraceId(traceId);
      showToast.error(message);
    } finally {
      setIsLoadingPatient(false);
    }
  };

  useEffect(() => {
    if (!paramsResolved || !patientRouteId) return;
    void loadPatient();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsResolved, patientRouteId]);

  // Load patient records and existing data
  useEffect(() => {
    const loadPatientData = async () => {
      if (!paramsResolved || !patientRouteId) return;

      try {
        // Load patient records
        const patientRecords = await patientsApi.getPatientRecords(patientRouteId);
        
        if (patientRecords.length > 0) {
          const latest = patientRecords[0];
          setExistingRecordId(latest._id || null);
          
          if (latest.structuredData && !structuredRecord) {
            setStructuredRecord(toStructuredRecord(latest.structuredData));
          }
          if (latest.clinicalArchive) {
            setClinicalArchive(latest.clinicalArchive);
          }
          if (latest.extractedText && !extractedText) {
            setExtractedText(latest.extractedText || '');
          }
          
          // Load LLM integration data if available
          if (latest.llmIntegrationData) {
            const llmData = latest.llmIntegrationData;
            setLlmIntegrationResult({
              correctedText: llmData.correctedText ?? '',
              structuredData: llmData.fullStructuredData ?? null,
              timeline: llmData.timeline,
              metadata: llmData.metadata,
              message: undefined,
            });
            if (llmData.correctedText && !extractedText) {
              setExtractedText(llmData.correctedText || '');
            }
          }
        }
      } catch (error: unknown) {
        logClientError('extract.loadPatientData', error, { patientRouteId });
      }
    };

    loadPatientData();
  }, [patientRouteId, paramsResolved, setExtractedText, setStructuredRecord, structuredRecord, extractedText]);

  // Load step1 data if available
  useEffect(() => {
    if (step1Data?.manualText && !extractedText) {
      setExtractedText(step1Data.manualText);
    }
  }, [step1Data, extractedText, setExtractedText]);

  const handleAIExtraction = async () => {
    // Double-click protection
    if (extractionInProgressRef.current || isAIExtracting || thinking.isThinking) {
      return;
    }

    if (!extractedText || !extractedText.trim()) {
      showToast.error('暂无文本内容，无法提取医疗数据');
      return;
    }

    // Set protection flag immediately
    extractionInProgressRef.current = true;

    try {
      setIsAIExtracting(true);
      thinking.startThinking('ocr');
      thinking.setMessage('AI智能提取中...');

      // Step 1: Complete medical record integration
      thinking.setStage('parsing', '正在生成医疗记录...');
      const integrateResponse = await medicalApi.integrateMedicalRecord({
        text: extractedText,
        recordId: existingRecordId || undefined,
      });

      // Update integration result
      setLlmIntegrationResult(integrateResponse);
      if (integrateResponse.correctedText) {
        setExtractedText(integrateResponse.correctedText);
      }
      if (integrateResponse.structuredData) {
        const structuredUpdate = toStructuredRecord(integrateResponse.structuredData);
        if (structuredUpdate) {
          const currentRecord = toStructuredRecord(structuredRecord);
          setStructuredRecord(mergeStructuredData(currentRecord, structuredUpdate));
        }
      }
      if (integrateResponse.clinicalArchive) {
        setClinicalArchive(integrateResponse.clinicalArchive);
      }

      // Step 2: Field-level detailed extraction
      thinking.setStage('parsing', '正在提取详细信息...');
      const extractResponse = await medicalApi.extractFieldsWithLLM({
        text: integrateResponse.correctedText || extractedText,
        recordId: existingRecordId || undefined,
        patientId: currentPatient?.id,
      });

      setFieldExtractionResult(extractResponse);
      
      if (extractResponse.structuredData) {
        const structuredUpdate = toStructuredRecord(extractResponse.structuredData);
        
        if (structuredUpdate) {
          // Update the workflow store with the new structured data
          setStructuredRecord(structuredUpdate);
        }
      }
      if (extractResponse.clinicalArchive) {
        setClinicalArchive(extractResponse.clinicalArchive);
      }
      if (extractResponse.record?.id) {
        setExistingRecordId(extractResponse.record.id);
      }

      // Refresh patient records
      if (patientRouteId) {
        try {
          const updatedRecords = await patientsApi.getPatientRecords(patientRouteId);
          
          if (updatedRecords.length > 0) {
            const latestRecord = updatedRecords[0];
            
            setExistingRecordId((prevId) => latestRecord._id || prevId || null);
            
            if (latestRecord.clinicalArchive) {
              setClinicalArchive(latestRecord.clinicalArchive);
            }
            
            // Also check if there's structured data in the record that we should use
            if (latestRecord.structuredData && !extractResponse.structuredData) {
              const structuredUpdate = toStructuredRecord(latestRecord.structuredData);
              if (structuredUpdate) {
                setStructuredRecord(structuredUpdate);
              }
            }
          }
        } catch (refreshError: unknown) {
          logClientWarn('extract.refreshPatientRecordsAfterAI', refreshError, { patientRouteId });
        }
      }

      thinking.setStage('complete', 'complete');
      thinking.setMessage('AI智能提取完成！');
      showToast.success('医疗数据提取成功');

      // Save step data
      setStep2Data({
        extractedText: integrateResponse.correctedText || extractedText,
        llmResult: {
          integrateResponse: integrateResponse as unknown as Record<string, JsonValue>,
          extractResponse: extractResponse as unknown as Record<string, JsonValue>
        },
        structuredRecord: structuredRecord,
      });
      
      // Mark step as completed
      setStepCompleted(2, true);

    } catch (error: unknown) {
      const { message } = logClientErrorWithMessage('extract.handleAIExtraction', error, 'AI智能提取失败', {
        patientRouteId,
        existingRecordId
      });
      thinking.setError('提取失败，请重试');
      showToast.error(message);
    } finally {
      setIsAIExtracting(false);
      extractionInProgressRef.current = false; // Clear protection flag
      setTimeout(() => thinking.stopThinking(), 1500);
    }
  };

  // Handle trial matching - separate function to fix async/await scope issue
  const handleMatchTrials = async () => {
    // More intelligent validation - check multiple sources of medical data
    const hasStructuredRecord = structuredRecord && Object.keys(structuredRecord).length > 0;
    const hasClinicalArchive = clinicalArchive != null;
    const hasRecordId = existingRecordId != null;
    const hasExtractionResult = fieldExtractionResult != null;

    // Allow matching if we have ANY form of extracted medical data
    const hasValidMedicalData = hasStructuredRecord || hasClinicalArchive || hasRecordId || hasExtractionResult;
    
    if (!hasValidMedicalData) {
      showToast.error('暂无可用于匹配的医疗信息，请先完成信息提取。');
      return;
    }

    try {
      thinking.startThinking('matching');
      thinking.setMessage('正在基于提取信息匹配临床试验...');
      thinking.setProgress(5);

      // Build request data - prioritize structured record, fallback to other data
      const requestData: {
        recordId?: string;
        record?: StructuredRecord | ClinicalArchive;
      } = {};
      
      if (existingRecordId) {
        requestData.recordId = existingRecordId;
      }
      
      if (hasStructuredRecord) {
        requestData.record = structuredRecord as StructuredRecord | ClinicalArchive;
      } else if (hasClinicalArchive) {
        // Fallback: convert clinicalArchive to structured format if needed
        requestData.record = clinicalArchive;
      } else if (hasExtractionResult && fieldExtractionResult.structuredData) {
        // Another fallback: use the extraction result directly
        requestData.record = fieldExtractionResult.structuredData;
      }

      thinking.setMatchingProgress(0, thinking.totalItems ?? 100);

      if (!requestData.recordId) {
        // Use fallback mechanism - match with structured data directly
        // Ensure we only use StructuredRecord, filter out ClinicalArchive
        let fallbackRecord: StructuredData | Record<string, JsonValue> | undefined;

        if (requestData.record && 'disease' in requestData.record) {
          // Is a ClinicalArchive, use structuredRecord instead
          fallbackRecord = structuredRecord ?? undefined;
        } else if (requestData.record) {
          // Not a ClinicalArchive, safe to use
          fallbackRecord = requestData.record as Record<string, JsonValue>;
        } else if (structuredRecord) {
          fallbackRecord = structuredRecord;
        }

        const matchResult = await medicalApi.matchTrials({
          record: fallbackRecord,
          restart: true,
          filters: { statuses: ['recruiting', 'active'] }
        });

        const matches = Array.isArray(matchResult.matches) ? matchResult.matches : [];
        const totalTrials = matchResult.provider?.totalTrials ?? matches.length;
        const matchedCount = matches.length;
        thinking.setMatchingProgress(matchedCount, totalTrials);
        thinking.setMessage(`已匹配 ${matchedCount} / ${totalTrials} 项试验`);

        setMatchResults(matches);
        setStep3Data({
          matchResults: matches,
          provider: matchResult.provider || null,
        });
        setStepCompleted(3, true);

        thinking.setStage('complete', '匹配结果已就绪');
        showToast.success(`匹配成功，找到 ${matches.length} 条临床试验`);

        // Navigate to results page to show the matching trials
        router.push(`/patients/${patientRouteId}/results`);
        return;
      }

      const matchResult = await medicalApi.matchTrials({
        recordId: requestData.recordId,
        restart: true,
        filters: { statuses: ['recruiting', 'active'] }
      });
      const matches = Array.isArray(matchResult.matches) ? matchResult.matches : [];
      const totalTrials = matchResult.provider?.totalTrials ?? matches.length;
      const matchedCount = matches.length;
      thinking.setMatchingProgress(matchedCount, totalTrials);
      thinking.setMessage(`已匹配 ${matchedCount} / ${totalTrials} 项试验`);

      setMatchResults(matches);
      setStep3Data({
        matchResults: matches,
        provider: matchResult.provider || null,
      });
      setStepCompleted(3, true);

      thinking.setStage('complete', '匹配结果已就绪');
      showToast.success(`匹配任务已启动，已找到 ${matches.length} 条试验`);

      if (matchResult.jobId) {
        showToast.custom('更多批次结果将会在结果页持续更新。');
      }

      // Navigate to results page to show the matching trials
      setTimeout(() => {
        router.push(`/patients/${patientRouteId}/results`);
      }, 1500);

    } catch (error: unknown) {
      const { message } = logClientErrorWithMessage('extract.handleMatchTrials', error, '匹配失败', {
        patientRouteId,
        existingRecordId
      });
      thinking.setError(message);
      showToast.error(message);
    } finally {
      setTimeout(() => thinking.stopThinking(), 1500);
    }
  };

  const handleStepNavigation = (step: number) => {
    if (step === 1) {
      router.push(`/patients/${patientRouteId}/upload`);
    } else if (step === 2) {
      // Stay on current page
    } else if (step === 3) {
      if (step2Completed) {
        router.push(`/patients/${patientRouteId}/results`);
      } else {
        showToast.error('请先完成信息提取');
      }
    }
  };

  const canNavigateToStep = (step: number) => {
    if (step === 1) return true;
    if (step === 2) return true; // Current step
    if (step === 3) return step2Completed;
    return false;
  };

  if (!hasHydrated) {
    return <WorkflowLoadingState title="正在加载用户状态" message="请稍候..." />;
  }

  if (!isAuthenticated) {
    return <WorkflowLoadingState title="正在跳转登录" message="需要登录后才能继续" />;
  }

  if (!paramsResolved) {
    return <WorkflowLoadingState title="正在加载患者流程" message="请稍候..." />;
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
    return <WorkflowLoadingState title="正在加载患者信息" message="请稍候..." />;
  }

  const hasAnyText = typeof extractedText === 'string' && extractedText.trim().length > 0;
  const hasAnyStructured = structuredRecord && typeof structuredRecord === 'object' && Object.keys(structuredRecord).length > 0;

  if (!hasAnyText && !hasAnyStructured && !thinking.isThinking && !isAIExtracting) {
    return (
      <WorkflowEmptyState
        title="还没有可提取的病历内容"
        message="请先在上传步骤上传文件或粘贴病历文本，然后再进行结构化提取。"
        primaryAction={{ label: '去上传', href: `/patients/${patientRouteId}/upload` }}
        secondaryAction={{ label: '返回患者列表', href: '/patients' }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
          <div className="flex items-center gap-4">
            <Button
              onClick={() => router.push('/')}
              variant="link"
              size="sm"
              className="flex items-center space-x-2 px-0 text-blue-600"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>返回首页</span>
            </Button>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                {currentPatient.name}
              </h1>
              <p className="text-gray-600">患者ID：{currentPatient.patientId}</p>
            </div>
          </div>
        </div>

        {/* Step Navigation */}
        <StepNavigation
          currentStep={2}
          onStepClick={handleStepNavigation}
          canNavigateToStep={canNavigateToStep}
        />

        {/* Main Content */}
        <div className="grid gap-8 mt-8 lg:grid-cols-3">
          {/* Left Column - Only show Structured Medical Record after extraction */}
          <div className="lg:col-span-2 space-y-6">
            {/* Only show Structured Record after step2 is completed */}
            {step2Completed && (llmIntegrationResult?.structuredData || (structuredRecord && Object.keys(structuredRecord).length > 0)) && (
              <Card className="shadow-lg border-blue-100">
                <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center shadow-md">
                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <div>
                        <div className="text-lg font-bold text-gray-900">结构化病历</div>
                        <div className="text-xs font-normal text-gray-500 mt-0.5">已提取的患者关键医疗信息</div>
                      </div>
                    </CardTitle>
                    {llmIntegrationResult?.structuredData && (
                      <span className="px-3 py-1.5 bg-gradient-to-r from-blue-500 to-indigo-500 text-white text-xs font-semibold rounded-full shadow-sm flex items-center space-x-1">
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M13 7H7v6h6V7z" />
                          <path fillRule="evenodd" d="M7 2a1 1 0 012 0v1h2V2a1 1 0 112 0v1h2a2 2 0 012 2v2h1a1 1 0 110 2h-1v2h1a1 1 0 110 2h-1v2a2 2 0 01-2 2h-2v1a1 1 0 11-2 0v-1H9v1a1 1 0 11-2 0v-1H5a2 2 0 01-2-2v-2H2a1 1 0 110-2h1V9H2a1 1 0 010-2h1V5a2 2 0 012-2h2V2zM5 5h10v10H5V5z" clipRule="evenodd" />
                        </svg>
                        <span>AI 增强</span>
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-6">
                  {/* Summary Statistics Bar */}
                  <div className="mb-6 grid grid-cols-1 gap-4 rounded-lg border border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50 p-4 sm:grid-cols-3">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-600">
                        {Object.keys(llmIntegrationResult?.structuredData || structuredRecord || {}).length}
                      </div>
                      <div className="mt-1 text-xs text-gray-600">字段数</div>
                    </div>
                    <div className="text-center sm:border-l sm:border-r sm:border-blue-200">
                      <div className="text-2xl font-bold text-indigo-600">
                        {Object.values(llmIntegrationResult?.structuredData || structuredRecord || {})
                          .filter(v => Array.isArray(v) && v.length > 0).length}
                      </div>
                      <div className="mt-1 text-xs text-gray-600">多值字段</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-purple-600">
                        {Object.values(llmIntegrationResult?.structuredData || structuredRecord || {})
                          .filter(v => v !== null && v !== undefined && v !== '').length}
                      </div>
                      <div className="mt-1 text-xs text-gray-600">已填字段</div>
                    </div>
                  </div>

                  <div className="space-y-5">
                    {/* Show LLM-processed data if available, otherwise show basic structured data */}
                    {Object.entries(llmIntegrationResult?.structuredData || structuredRecord || {}).map(([key, value], index) => {
                      const isEmpty = value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
                      const fieldNumber = index + 1;

                      return (
                        <div key={key} className={`group hover:bg-blue-50/50 p-4 rounded-lg transition-all duration-200 border ${isEmpty ? 'border-gray-200 opacity-60' : 'border-transparent hover:border-blue-200'}`}>
                          <div className="flex items-start gap-4">
                            {/* Icon indicator with field number */}
                            <div className="relative mt-0.5 w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:bg-blue-200 transition-colors">
                              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                              </svg>
                              <span className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                                {fieldNumber}
                              </span>
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-2">
                                <label className="block text-sm font-semibold text-gray-800 tracking-wide">
                                  {getFieldLabel(key) || key}
                                </label>
                                {/* Data type badge */}
                                <span className="text-[10px] px-2 py-0.5 rounded bg-gray-200 text-gray-600 font-mono">
                                  {formatDataTypeLabel(value)}
                                </span>
                              </div>

                              <div className="text-sm">
                                {Array.isArray(value) ? (
                                  value.length > 0 ? (
                                    <div className="flex flex-wrap gap-2">
                                      {value.map((item, itemIndex) => (
                                        <span
                                          key={itemIndex}
                                          className="inline-flex items-center px-3 py-1.5 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-full text-xs font-medium shadow-sm hover:shadow-md transition-shadow"
                                        >
                                          <svg className="w-3 h-3 mr-1.5" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                          </svg>
                                          {formatJsonValue(item)}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="bg-gray-50 px-4 py-3 rounded-lg border border-dashed border-gray-300">
                                      <span className="text-gray-400 italic text-xs">空数组</span>
                                    </div>
                                  )
                                ) : isRecord(value) ? (
                                  <div className="space-y-2.5 bg-gradient-to-br from-gray-50 to-gray-100 p-4 rounded-lg border border-gray-200 shadow-sm">
                                    {Object.entries(value).map(([childKey, childValue]) => (
                                      <div key={childKey} className="flex items-start gap-3 pb-2.5 border-b border-gray-200 last:border-0 last:pb-0">
                                        <span className="text-gray-600 font-medium min-w-[90px] sm:min-w-[120px] text-xs tracking-wide flex items-center shrink-0">
                                          <svg className="w-3 h-3 mr-1 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                                          </svg>
                                          {getFieldLabel(childKey) || childKey}：
                                        </span>
                                        <span className="text-gray-900 font-medium flex-1 text-sm break-words">
                                          {formatJsonValue(childValue)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className={`px-4 py-3 rounded-lg border ${value === null || value === '' ? 'bg-gray-50 border-dashed border-gray-300' : 'bg-gradient-to-r from-gray-50 to-gray-100 border-gray-200 shadow-sm'}`}>
                                    {value === null || value === '' ? (
                                      <span className="text-gray-400 italic text-xs flex items-center">
                                        <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                        </svg>
                                        未填写
                                      </span>
                                    ) : (
                                      <span className="text-gray-900 font-medium">{formatJsonValue(value)}</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Data Completeness Indicator */}
                  <div className="mt-6 p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg border border-green-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-gray-800">数据完整度</span>
                      <span className="text-sm font-bold text-green-600">
                        {Math.round((Object.values(llmIntegrationResult?.structuredData || structuredRecord || {})
                          .filter(v => v !== null && v !== undefined && v !== '' && (!Array.isArray(v) || v.length > 0)).length /
                          Math.max(Object.keys(llmIntegrationResult?.structuredData || structuredRecord || {}).length, 1)) * 100)}%
                      </span>
                    </div>
                    <div className="w-full bg-green-100 rounded-full h-2.5">
                      <div
                        className="bg-gradient-to-r from-green-500 to-emerald-500 h-2.5 rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.round((Object.values(llmIntegrationResult?.structuredData || structuredRecord || {})
                            .filter(v => v !== null && v !== undefined && v !== '' && (!Array.isArray(v) || v.length > 0)).length /
                            Math.max(Object.keys(llmIntegrationResult?.structuredData || structuredRecord || {}).length, 1)) * 100)}%`
                        }}
                      ></div>
                    </div>
                  </div>

                  {/* Show raw JSON toggle for debugging */}
                  {llmIntegrationResult?.structuredData && (
                    <details className="mt-6 pt-6 border-t border-gray-200">
                      <summary className="text-xs font-semibold text-gray-600 cursor-pointer hover:text-blue-600 transition-colors flex items-center space-x-2 select-none">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                        </svg>
                        <span>查看原始 JSON 数据</span>
                      </summary>
                      <pre className="mt-3 p-4 bg-gray-900 text-green-400 text-xs rounded-lg overflow-auto max-h-96 shadow-inner font-mono border border-gray-700">
                        {JSON.stringify(llmIntegrationResult.structuredData, null, 2)}
                      </pre>
                    </details>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Show message when extraction not complete */}
            {!step2Completed && (
              <Card className="border-blue-200 bg-blue-50/30">
                <CardContent className="py-12 text-center">
                  <div className="flex flex-col items-center space-y-4">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-3 border-blue-600"></div>
                    <div>
                      <p className="text-lg font-semibold text-blue-800">正在提取医疗信息...</p>
                      <p className="mt-2 text-sm text-blue-600">请稍候，我们正在处理您的病历资料</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Column - Actions */}
          <div className="space-y-6">
            {/* Quick Actions */}
            <Card className="shadow-md border-blue-100">
              <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100">
                <CardTitle className="text-base flex items-center space-x-2">
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span>下一步</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                {/* Find Clinical Trials Button - Enabled only when step2 is completed */}
                <Button
                  onClick={handleMatchTrials}
                  variant="primary"
                  disabled={!step2Completed || thinking.isThinking}
                  className="w-full flex items-center justify-center space-x-2 shadow-md hover:shadow-lg transition-shadow"
                >
                  <Search className="h-4 w-4" />
                  <span>开始匹配临床试验</span>
                </Button>

                {/* Status indicator */}
                {step2Completed && !thinking.isThinking && (
                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center space-x-2">
                      <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <div className="flex-1">
                        <p className="text-xs font-semibold text-green-800">可开始匹配</p>
                        <p className="mt-0.5 text-xs text-green-600">医疗信息已提取完成</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Processing Status Indicator - Always show during extraction */}
                {(isAIExtracting || isAutoExtracting || (!step2Completed && thinking.isThinking)) && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                    <div className="flex items-center space-x-3">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                     <div className="flex-1">
                        <p className="text-sm font-medium text-blue-800">请稍候...</p>
                        <p className="text-xs text-blue-600 mt-1">
                          正在生成结构化病历
                        </p>
                        {thinking.stage === 'matching' && (
                          <p className="text-xs text-blue-700 mt-2">
                            已匹配 {thinking.completedItems ?? 0} / {thinking.totalItems ?? '…'} 项临床试验
                          </p>
                        )}
                     </div>
                   </div>
                    <div className="mt-3">
                      <div className="w-full bg-blue-100 rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${thinking.progress}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Extraction Summary */}
            {step2Completed && (
              <Card className="shadow-md border-green-100">
                <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-green-100">
                  <CardTitle className="text-base flex items-center space-x-2">
                    <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>提取摘要</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4 space-y-3">
                  <div className="flex items-center justify-between py-2 border-b border-gray-100">
                    <span className="text-xs text-gray-600">字段总数</span>
                    <span className="text-sm font-bold text-gray-900">
                      {Object.keys(llmIntegrationResult?.structuredData || structuredRecord || {}).length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-gray-100">
                    <span className="text-xs text-gray-600">已填字段</span>
                    <span className="text-sm font-bold text-green-600">
                      {Object.values(llmIntegrationResult?.structuredData || structuredRecord || {})
                        .filter(v => v !== null && v !== undefined && v !== '' && (!Array.isArray(v) || v.length > 0)).length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-xs text-gray-600">完整率</span>
                    <span className="text-sm font-bold text-blue-600">
                      {Math.round((Object.values(llmIntegrationResult?.structuredData || structuredRecord || {})
                        .filter(v => v !== null && v !== undefined && v !== '' && (!Array.isArray(v) || v.length > 0)).length /
                        Math.max(Object.keys(llmIntegrationResult?.structuredData || structuredRecord || {}).length, 1)) * 100)}%
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Processing Info */}
            {llmIntegrationResult?.metadata && (
              <Card className="shadow-md border-purple-100">
                <CardHeader className="bg-gradient-to-r from-purple-50 to-pink-50 border-b border-purple-100">
                  <CardTitle className="text-base flex items-center space-x-2">
                    <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>处理信息</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4 space-y-2">
                  {llmIntegrationResult.metadata.processingTime && (
                    <div className="flex items-center justify-between text-xs py-1.5">
                      <span className="text-gray-600 flex items-center">
                        <svg className="w-3 h-3 mr-1 text-purple-500" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                        </svg>
                        处理耗时
                      </span>
                      <span className="font-mono font-semibold text-gray-800">
                        {formatJsonValue(llmIntegrationResult.metadata.processingTime)} ms
                      </span>
                    </div>
                  )}
                  {llmIntegrationResult.metadata.totalTokens && (
                    <div className="flex items-center justify-between text-xs py-1.5">
                      <span className="text-gray-600 flex items-center">
                        <svg className="w-3 h-3 mr-1 text-purple-500" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
                        </svg>
                        Token 总量
                      </span>
                      <span className="font-mono font-semibold text-gray-800">
                        {formatJsonValue(llmIntegrationResult.metadata.totalTokens)}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Navigation */}
            <Card className="shadow-md border-gray-200">
              <CardHeader className="bg-gradient-to-r from-gray-50 to-slate-50 border-b border-gray-100">
                <CardTitle className="text-base flex items-center space-x-2">
                  <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                  <span>导航</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                <button
                  type="button"
                  onClick={() => router.push(`/patients/${patientRouteId}/upload`)}
                  className="w-full text-sm text-blue-600 hover:text-blue-700 transition-colors flex items-center justify-center space-x-2"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>返回上传</span>
                </button>

                {step2Completed && (
                  <Button
                    onClick={() => router.push(`/patients/${patientRouteId}/results`)}
                    variant="primary"
                    className="w-full flex items-center justify-center space-x-2 shadow-md hover:shadow-lg transition-shadow"
                  >
                    <span>查看匹配结果</span>
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
