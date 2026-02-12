'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Brain, Sparkles } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/auth';
import { usePatientStore } from '@/lib/stores/patients';
import { useWorkflowStore } from '@/lib/stores/workflow';
import { patientsApi } from '@/lib/api/patients';
import { medicalApi, LLMIntegrationResponse } from '@/lib/api/medical';
import { logClientErrorWithMessage } from '@/lib/logging';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { showToast } from '@/components/ui/Toast';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { EnhancedStructuredRecord } from '@/components/medical/EnhancedStructuredRecord';
import { MedicalTimeline } from '@/components/medical/MedicalTimeline';
import { Badge } from '@/components/ui/Badge';
import { JsonValue, ClinicalArchive, MedicalRecord } from '@/types';
import { WorkflowEmptyState, WorkflowErrorState, WorkflowLoadingState } from '@/components/workflow/WorkflowFeedback';

// Dynamic import for ClinicalArchiveView
const ClinicalArchiveView = dynamic(() => import('@/components/medical/ClinicalArchiveView').then(mod => ({ default: mod.ClinicalArchiveView })), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center p-8"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div></div>
});

interface PatientStructuredPageProps {
  params?: Promise<{
    id?: string;
  }>;
}

const isRecord = (value: JsonValue): value is Record<string, JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const mergeStructuredData = (
  base: Record<string, JsonValue> | null | undefined,
  updates: Record<string, JsonValue> | null | undefined
): Record<string, JsonValue> => {
  if (!updates) {
    return base ? { ...base } : {};
  }

  const result: Record<string, JsonValue> = base ? { ...base } : {};

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
  input?: Record<string, JsonValue> | null
): Record<string, JsonValue> | null => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  return mergeStructuredData({}, input as Record<string, JsonValue>);
};

// (intentionally removed) formatJsonValue helper was used by the legacy table view

export default function PatientStructuredPage({ params }: PatientStructuredPageProps) {
  const [patientRouteId, setPatientRouteId] = useState('');
  const [paramsResolved, setParamsResolved] = useState(false);
  const [isLoadingPatient, setIsLoadingPatient] = useState(false);
  const [patientLoadError, setPatientLoadError] = useState<string | null>(null);
  const [patientLoadTraceId, setPatientLoadTraceId] = useState<string | null>(null);
  const router = useRouter();
  const { isAuthenticated, hasHydrated } = useAuthStore();
  const { currentPatient, setCurrentPatient } = usePatientStore();
  const { extractedText, structuredRecord: workflowStructuredRecord, setCurrentStep } = useWorkflowStore();

  // Structured data state
  const [structuredRecord, setStructuredRecord] = useState<Record<string, JsonValue> | null>(null);
  const [clinicalArchive, setClinicalArchive] = useState<ClinicalArchive | null>(null);
  const [llmIntegrationResult, setLlmIntegrationResult] = useState<LLMIntegrationResponse | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [records, setRecords] = useState<MedicalRecord[]>([]);

  // Set current step to 3 (structured data viewing)
  useEffect(() => {
    setCurrentStep(3);
  }, [setCurrentStep]);

  // Load data from workflow store first, fallback to API
  useEffect(() => {
    if (workflowStructuredRecord) {
      setStructuredRecord(workflowStructuredRecord as Record<string, JsonValue>);
    } else if (extractedText) {
      // If we have extracted text but no structured record, we need to process it
      setStructuredRecord(null);
    }
  }, [workflowStructuredRecord, extractedText]);

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

  // Redirect if not authenticated
  useEffect(() => {
    if (hasHydrated && !isAuthenticated) {
      router.push('/auth/login');
      return;
    }
  }, [hasHydrated, isAuthenticated, router]);

  // Load patient data and records
  useEffect(() => {
    const loadPatientData = async () => {
      if (!paramsResolved || !patientRouteId) {
        return;
      }

      try {
        setIsLoadingPatient(true);
        setPatientLoadError(null);
        setPatientLoadTraceId(null);
        const patient = await patientsApi.getPatient(patientRouteId);
        setCurrentPatient(patient);

        // Load patient records
        const patientRecords = await patientsApi.getPatientRecords(patientRouteId);
        setRecords(patientRecords);

        if (patientRecords.length > 0) {
          const latest = patientRecords[0];
          if (latest.structuredData) {
            setStructuredRecord(toStructuredRecord(latest.structuredData as Record<string, JsonValue>));
          }
          if (latest.clinicalArchive) {
            setClinicalArchive(latest.clinicalArchive);
          }
          if (latest.llmIntegrationData) {
            const llmIntegrationData = latest.llmIntegrationData;
            setLlmIntegrationResult({
              correctedText: llmIntegrationData.correctedText ?? '',
              structuredData: llmIntegrationData.fullStructuredData ?? null,
              timeline: llmIntegrationData.timeline,
              metadata: llmIntegrationData.metadata,
              message: undefined,
            });
          }
        }
      } catch (error: unknown) {
        const { traceId, message } = logClientErrorWithMessage(
          'structured.loadPatientData',
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

    loadPatientData();
  }, [patientRouteId, paramsResolved, setCurrentPatient]);

  const handleAIExtraction = async () => {
    if (!currentPatient) {
      showToast.error('患者信息未加载');
      return;
    }

    setIsProcessing(true);

    try {
      // Priority 1: Use workflow store data if available
      if (workflowStructuredRecord) {
        setStructuredRecord(workflowStructuredRecord as Record<string, JsonValue>);
        showToast.success('使用已提取的结构化数据');
        setIsProcessing(false);
        return;
      }

      // Priority 2: Use extracted text from workflow store
      if (extractedText) {
        const response = await medicalApi.integrateMedicalRecord({
          text: extractedText,
        });

        setLlmIntegrationResult(response);

        if (response.structuredData) {
          const structuredUpdate = toStructuredRecord(response.structuredData as Record<string, JsonValue>);
          if (structuredUpdate) {
            setStructuredRecord(structuredUpdate);
          }
        }
        
        if (response.clinicalArchive) {
          setClinicalArchive(response.clinicalArchive);
        }
        
        showToast.success('结构化数据生成成功');
        setIsProcessing(false);
        return;
      }

      // Priority 3: Fallback to API records
      const latestRecord = records[0];
      if (!latestRecord || !latestRecord.extractedText) {
        showToast.error('没有找到OCR提取的文本，请先完成OCR步骤');
        return;
      }

      const response = await medicalApi.integrateMedicalRecord({
        text: latestRecord.extractedText,
        recordId: latestRecord._id,
      });

      setLlmIntegrationResult(response);
      
      if (response.structuredData) {
        const structuredUpdate = toStructuredRecord(response.structuredData as Record<string, JsonValue>);
        if (structuredUpdate) {
          setStructuredRecord(structuredUpdate);
        }
      }
      
      if (response.clinicalArchive) {
        setClinicalArchive(response.clinicalArchive);
      }

      // Refresh records
      const updatedRecords = await patientsApi.getPatientRecords(patientRouteId);
      setRecords(updatedRecords);

      showToast.success('结构化病历生成完成');
    } catch (error: unknown) {
      const { message } = logClientErrorWithMessage('structured.handleAIExtraction', error, '结构化处理失败', {
        patientRouteId,
      });
      showToast.error(message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleContinue = () => {
    router.push(`/patients/${patientRouteId}/results`);
  };

  const handleBack = () => {
    // OCR page may be removed in the new workflow; go back to upload step.
    router.push(`/patients/${patientRouteId}/upload`);
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
        retryAction={{ label: '重试', onClick: () => window.location.reload() }}
        backAction={{ label: '返回患者列表', href: '/patients' }}
      />
    );
  }

  if (isLoadingPatient || !currentPatient) {
    return <WorkflowLoadingState title="正在加载患者信息" message="请稍候..." />;
  }

  const hasAnyStructured =
    (structuredRecord && Object.keys(structuredRecord).length > 0) ||
    Boolean(llmIntegrationResult?.structuredData) ||
    Boolean(clinicalArchive);
  if (!hasAnyStructured && !isProcessing) {
    return (
      <WorkflowEmptyState
        title="还没有结构化结果"
        message="请先在提取步骤生成结构化病历，然后再查看结构化视图。"
        primaryAction={{ label: '去提取', href: `/patients/${patientRouteId}/extract` }}
        secondaryAction={{ label: '去上传', href: `/patients/${patientRouteId}/upload` }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-4">
            <Button
              onClick={() => router.push('/patients')}
              variant="link"
              size="sm"
              className="flex items-center space-x-2 px-0 text-blue-600"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>返回患者列表</span>
            </Button>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                {currentPatient.name}
              </h1>
              <p className="text-gray-600">患者ID：{currentPatient.patientId}</p>
            </div>
          </div>
        </div>

        {/* Progress Steps */}
        <div className="mb-8">
          <div className="flex items-center justify-center space-x-4">
            <div className="flex items-center space-x-2 cursor-pointer" onClick={() => router.push(`/patients/${patientRouteId}/extract`)}>
              <div className="w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center font-bold">
                ✓
              </div>
              <span className="text-green-600">OCR处理</span>
            </div>
            <div className="w-16 h-0.5 bg-blue-600"></div>
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
                2
              </div>
              <span className="font-medium text-blue-600">结构化病历</span>
            </div>
            <div className="w-16 h-0.5 bg-gray-300"></div>
            <div className="flex items-center space-x-2 cursor-pointer" onClick={() => router.push(`/patients/${patientRouteId}/results`)}>
              <div className="w-8 h-8 bg-gray-300 text-gray-600 rounded-full flex items-center justify-center font-bold">
                3
              </div>
              <span className="text-gray-600">临床试验匹配</span>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="max-w-6xl mx-auto space-y-6">
          {/* AI Processing Section */}
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle className="flex items-center space-x-2">
                <Brain className="h-5 w-5" />
                <span>AI智能提取 - 生成结构化病历</span>
              </CardTitle>
              <Button
                onClick={handleAIExtraction}
                variant="primary"
                size="sm"
                disabled={isProcessing}
                loading={isProcessing}
                className="flex items-center space-x-2"
              >
                <Sparkles className="h-4 w-4" />
                <span>{isProcessing ? '处理中...' : 'AI智能提取'}</span>
              </Button>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 mb-4">
                使用AI技术从OCR提取的文本中生成结构化的医疗记录，包括诊断、分期、基因突变等信息。
              </p>
              {llmIntegrationResult && llmIntegrationResult.metadata && (
                <div className="text-xs text-gray-500 space-y-1">
                  <p>提供方：{JSON.stringify(llmIntegrationResult.metadata.provider ?? 'moonshot')}</p>
                  {llmIntegrationResult.metadata.model && <p>模型：{JSON.stringify(llmIntegrationResult.metadata.model)}</p>}
                  {llmIntegrationResult.metadata.processingTime && <p>处理耗时：{JSON.stringify(llmIntegrationResult.metadata.processingTime)} ms</p>}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Patient Data Tabs */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>结构化病历（易读版）</span>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">LLM: Moonshot</Badge>
                  <Badge variant="outline">PHI: full</Badge>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="structured">
                <TabsList className="w-full justify-start">
                  <TabsTrigger value="structured">结构化卡片</TabsTrigger>
                  <TabsTrigger value="timeline">时间线</TabsTrigger>
                  <TabsTrigger value="archive">临床档案</TabsTrigger>
                  <TabsTrigger value="raw">原文</TabsTrigger>
                </TabsList>

                <TabsContent value="structured">
                  {structuredRecord ? (
                    <EnhancedStructuredRecord data={structuredRecord} />
                  ) : (
                    <div className="py-6 text-sm text-gray-600">暂无结构化数据，请先点击上方“AI智能提取”。</div>
                  )}
                </TabsContent>

                <TabsContent value="timeline">
                  {structuredRecord ? (
                    <MedicalTimeline data={structuredRecord} />
                  ) : (
                    <div className="py-6 text-sm text-gray-600">暂无时间线数据（需要先生成结构化病历）。</div>
                  )}
                </TabsContent>

                <TabsContent value="archive">
                  {clinicalArchive ? (
                    <ClinicalArchiveView archive={clinicalArchive} />
                  ) : (
                    <div className="py-6 text-sm text-gray-600">暂无临床档案数据。</div>
                  )}
                </TabsContent>

                <TabsContent value="raw">
                  {llmIntegrationResult?.correctedText ? (
                    <pre className="whitespace-pre-wrap rounded-md bg-gray-900/90 p-4 text-sm text-gray-100 max-h-[60vh] overflow-y-auto">
                      {llmIntegrationResult.correctedText}
                    </pre>
                  ) : (
                    <div className="py-6 text-sm text-gray-600">暂无原文（需要先进行OCR/上传文本）。</div>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* Navigation */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mt-8">
            <button
              type="button"
              onClick={handleBack}
              className="text-sm text-blue-600 hover:text-blue-700 transition-colors flex items-center space-x-2"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>返回OCR</span>
            </button>
            <Button
              onClick={handleContinue}
              variant="primary"
              disabled={!structuredRecord}
              className="flex items-center justify-center space-x-2 shadow-md hover:shadow-lg transition-shadow"
            >
              <span>继续匹配</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
