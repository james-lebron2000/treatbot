'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, Upload, FileText, Brain, Search, RefreshCw, Sparkles } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/auth';
import { usePatientStore } from '@/lib/stores/patients';
import { useThinkingMode } from '@/hooks/useThinkingMode';
import { patientsApi } from '@/lib/api/patients';
import { medicalApi, FieldExtractionResponse, LLMIntegrationResponse } from '@/lib/api/medical';
import { extractErrorMessage } from '@/lib/utils';
import { FileUpload } from '@/components/forms/FileUpload';
import { TrialCard } from '@/components/medical/TrialCard';
import { ClinicalArchiveView } from '@/components/medical/ClinicalArchiveView';
import { EnhancedStructuredRecord } from '@/components/medical/EnhancedStructuredRecord';
import { MedicalDataSummary } from '@/components/medical/MedicalDataSummary';
import { ThinkingMode } from '@/components/ui/ThinkingMode';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { showToast } from '@/components/ui/Toast';
import {
  ClinicalArchive,
  JsonValue,
  MatchProviderMetadata,
  MedicalRecord,
  StructuredData,
  LegacyTrialMatch,
} from '@/types';

type StructuredRecord = Record<string, JsonValue>;

type ParsePayload = {
  text: string;
  useLLM: boolean;
  patientId?: string;
  fileId?: string;
  ocrMetadata?: Record<string, JsonValue>;
  results?: Array<Record<string, JsonValue>>;
  overallMetadata?: Record<string, JsonValue>;
  recordId?: string;
};

type UploadPayload = {
  fileId?: string;
  ocrMetadata?: Record<string, JsonValue>;
  results?: Array<Record<string, JsonValue>>;
  overallMetadata?: Record<string, JsonValue>;
};

const isRecord = (value: JsonValue): value is StructuredRecord =>
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

const formatJsonValue = (value: JsonValue): string => {
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
        meta.push(`confidence: ${confidence}`);
      }

      if (typeof reasoning === 'string' && reasoning.trim()) {
        meta.push(`reasoning: ${reasoning}`);
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

const formatProviderMetadataValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (Array.isArray(value)) {
    return value.map((item) => formatProviderMetadataValue(item)).join(', ');
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (error) {
      console.warn('Failed to stringify provider metadata value', error);
      return '[object]';
    }
  }

  return '';
};
interface PatientDetailPageProps {
  params?: Promise<{
    id?: string;
  }>;
}

export default function PatientDetailPage({ params }: PatientDetailPageProps) {
  const [patientRouteId, setPatientRouteId] = useState('');
  const [paramsResolved, setParamsResolved] = useState(false);
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const { currentPatient, setCurrentPatient } = usePatientStore();

  // Redirect to upload step for new workflow
  useEffect(() => {
    if (paramsResolved && patientRouteId) {
      router.push(`/patients/${patientRouteId}/upload`);
    }
  }, [paramsResolved, patientRouteId, router]);

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

  // Local state
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [manualText, setManualText] = useState('');
  const useLLM = true; // Always use AI-enhanced medical analysis
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [extractedText, setExtractedText] = useState('');
  const [structuredRecord, setStructuredRecord] = useState<StructuredRecord | null>(null);
  const [clinicalArchive, setClinicalArchive] = useState<ClinicalArchive | null>(null);
  const [matchResults, setMatchResults] = useState<LegacyTrialMatch[]>([]);
  const [matchProvider, setMatchProvider] = useState<MatchProviderMetadata | undefined>(undefined);
  const [existingRecordId, setExistingRecordId] = useState<string | null>(null);
  const [fieldExtractionResult, setFieldExtractionResult] = useState<FieldExtractionResponse | null>(null);
  const extractionCompletedAtRaw = fieldExtractionResult?.metadata?.completedAt;
  const extractionCompletedAt =
    typeof extractionCompletedAtRaw === 'string' || typeof extractionCompletedAtRaw === 'number'
      ? new Date(extractionCompletedAtRaw)
      : null;
  const formattedExtractionCompletedAt = extractionCompletedAt && !Number.isNaN(extractionCompletedAt.getTime())
    ? extractionCompletedAt.toLocaleString()
    : null;
  const [llmIntegrationResult, setLlmIntegrationResult] = useState<LLMIntegrationResponse | null>(null);
  const [isAIExtracting, setIsAIExtracting] = useState(false);

  // Thinking mode integration
  const thinking = useThinkingMode({
    onComplete: () => {
      showToast.success('流程已完成');
    },
    onError: (error) => {
      showToast.error(`流程执行失败：${error}`);
    },
    onStageChange: (stage) => {
      console.log('Stage changed to:', stage);
    },
  });

  const thinkingStageLabels: Record<string, string> = {
    idle: '就绪',
    ocr: 'OCR 识别',
    parsing: '病历解析',
    matching: '试验匹配',
    complete: '完成',
    error: '错误',
  };

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/auth/login');
      return;
    }
  }, [isAuthenticated, router]);

  useEffect(() => {
    if (!currentPatient) return;

    if (currentPatient.latestStructuredData) {
      setStructuredRecord((prev) => prev ?? toStructuredRecord(currentPatient.latestStructuredData));
    }

    if (currentPatient.latestRecordId) {
      setExistingRecordId((prev) => prev ?? currentPatient.latestRecordId ?? null);
    }
  }, [currentPatient]);

  // Load patient data
  useEffect(() => {
    const loadPatient = async () => {
      if (!paramsResolved) {
        return;
      }

      if (!patientRouteId) {
        showToast.error('患者标识无效');
        router.push('/');
        return;
      }

      try {
        const patient = await patientsApi.getPatient(patientRouteId);
        setCurrentPatient(patient);

        // Load patient records
        const patientRecords = await patientsApi.getPatientRecords(patientRouteId);
        setRecords(patientRecords);

        if (patientRecords.length > 0) {
          const latest = patientRecords[0];
          setExistingRecordId(latest._id || null);
          setStructuredRecord((prev) => {
            if (prev) return prev;
            return toStructuredRecord(latest.structuredData);
          });
          if (latest.clinicalArchive) {
            setClinicalArchive(latest.clinicalArchive);
          }
          setExtractedText((prev) => prev || latest.extractedText || '');
          if (latest.llmIntegrationData) {
            const llmIntegrationData = latest.llmIntegrationData;
            setLlmIntegrationResult({
              correctedText: llmIntegrationData.correctedText ?? '',
              structuredData: llmIntegrationData.fullStructuredData ?? null,
              timeline: llmIntegrationData.timeline,
              metadata: llmIntegrationData.metadata,
              message: undefined,
            });
            if (llmIntegrationData.correctedText) {
              setExtractedText((value) => value || llmIntegrationData.correctedText || '');
            }
            if (llmIntegrationData.fullStructuredData) {
              const structuredUpdate = toStructuredRecord(llmIntegrationData.fullStructuredData);
              if (structuredUpdate) {
                setStructuredRecord((value) => mergeStructuredData(value, structuredUpdate));
              }
            }
          }
        } else if (patient?.latestStructuredData) {
          setStructuredRecord((prev) => prev ?? toStructuredRecord(patient.latestStructuredData));
          setExistingRecordId(patient.latestRecordId || null);
          if (patient.latestClinicalArchive) {
            setClinicalArchive((prev) => prev ?? patient.latestClinicalArchive ?? null);
          }
        }
      } catch (error: unknown) {
        console.error('Error loading patient:', error);
        const message = extractErrorMessage(error, '患者信息加载失败');
        showToast.error(message);
        router.push('/');
      }
    };

    loadPatient();
  }, [patientRouteId, paramsResolved, setCurrentPatient, router]);

  const handleFilesSelected = (files: File[]) => {
    setUploadedFiles(files);
  };

  const handleManualTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setManualText(e.target.value);
  };

  const handleMatchExistingRecord = async () => {
    if (thinking.isThinking) return;

    const targetRecord = records.find((r) => r.structuredData) || null;
    const recordId = existingRecordId || targetRecord?._id || null;
    const structuredDataToUse = structuredRecord || targetRecord?.structuredData;

    if (!recordId && !structuredDataToUse) {
      showToast.error('No structured record available. Please upload or parse a medical record first.');
      return;
    }

    try {
      thinking.startThinking('matching');
      thinking.setMessage('正在使用既有记录匹配临床试验...');
      thinking.setProgress(20);

      if (!recordId) {
        // Use fallback mechanism - match with structured data directly
        console.log('No recordId available, using fallback matching with structured data');
        const matchResult = await medicalApi.matchTrials({
          record: structuredDataToUse,
          restart: true,
          filters: { statuses: ['recruiting', 'active'] }
        });

        thinking.setProgress(100);
        const matches = Array.isArray(matchResult.matches) ? matchResult.matches : [];
        setMatchResults(matches);
        setMatchProvider(matchResult.provider || undefined);
        thinking.setStage('complete', '匹配结果已就绪');
        showToast.success(`${matches.length} clinical trials matched successfully.`);
        return;
      }

      const matchResult = await medicalApi.matchTrials({
        recordId,
        restart: true,
        filters: { statuses: ['recruiting', 'active'] }
      });
      thinking.setProgress(100);
      const matches = Array.isArray(matchResult.matches) ? matchResult.matches : [];
      setMatchResults(matches);
      setMatchProvider(matchResult.provider || undefined);
      thinking.setStage('complete', matchResult.jobId ? '首批结果已就绪' : '匹配结果已就绪');
      if (matchResult.jobId) {
        showToast.custom('Streaming match job running. View results to see updates.');
      } else {
        showToast.success(`${matches.length} clinical trials matched successfully.`);
      }
    } catch (error: unknown) {
      console.error('Existing record match error:', error);
      const message = extractErrorMessage(error, '匹配失败');
      thinking.setError(message);
      showToast.error(message);
    } finally {
      setTimeout(() => thinking.stopThinking(), 1500);
    }
  };

  // 原有的独立处理函数（已整合到handleAIExtraction中，保留作为备用）
  /*
  const handleKimiFieldExtraction = async () => {
    if (!extractedText || !extractedText.trim()) {
      showToast.error('暂无可提取的文本，请先完成OCR或输入病历文本');
      return;
    }

    if (thinking.isThinking) {
      showToast.error('当前正在执行其他流程，请稍后再试');
      return;
    }

    try {
      setIsKimiExtracting(true);
      const response = await medicalApi.extractFieldsWithLLM({
        text: extractedText,
        recordId: existingRecordId || undefined,
        patientId: currentPatient?.id,
      });

      setFieldExtractionResult(response);
      if (response.structuredData) {
        const structuredUpdate = toStructuredRecord(response.structuredData);
        if (structuredUpdate) {
          setStructuredRecord((prev) => mergeStructuredData(prev, structuredUpdate));
        }
      }
      if (response.clinicalArchive) {
        setClinicalArchive(response.clinicalArchive);
      }
      if (response.record?.id) {
        setExistingRecordId(response.record.id);
      }

      if (response.success) {
        showToast.success(response.message || 'Kimi 字段提取完成');
      } else {
        showToast.error(response.message || 'Kimi 字段提取完成，但存在缺失信息');
      }
    } catch (error: unknown) {
      console.error('Kimi extraction error:', error);
      const message = extractErrorMessage(error, 'Kimi 字段提取失败');
      showToast.error(message);
    } finally {
      // setIsKimiExtracting(false); // 已注释掉，使用isAIExtracting
    }
  }; */

  const handleAIExtraction = async () => {
    if (!extractedText || !extractedText.trim()) {
      showToast.error('暂无文本内容，无法提取医疗数据');
      return;
    }

    if (thinking.isThinking) {
      showToast.error('当前正在执行其他流程，请稍后再试');
      return;
    }

    try {
      setIsAIExtracting(true);
      thinking.startThinking('ocr');
      thinking.setMessage('AI智能提取中...');

      // 第一步：完整整合处理
      thinking.setStage('parsing', '正在生成医疗记录...');
      const integrateResponse = await medicalApi.integrateMedicalRecord({
        text: extractedText,
        recordId: existingRecordId || undefined,
      });

      // 更新整合结果
      setLlmIntegrationResult(integrateResponse);
      if (integrateResponse.correctedText) {
        setExtractedText(integrateResponse.correctedText);
      }
      if (integrateResponse.structuredData) {
        const structuredUpdate = toStructuredRecord(integrateResponse.structuredData);
        if (structuredUpdate) {
          setStructuredRecord((prev) => mergeStructuredData(prev, structuredUpdate));
        }
      }
      if (integrateResponse.clinicalArchive) {
        setClinicalArchive(integrateResponse.clinicalArchive);
      }

      // 第二步：字段级精细提取
      thinking.setStage('parsing', '正在提取详细信息...');
      const extractResponse = await medicalApi.extractFieldsWithLLM({
        text: integrateResponse.correctedText || extractedText,
        recordId: existingRecordId || undefined,
        patientId: currentPatient?.id,
      });

      // 更新提取结果
      setFieldExtractionResult(extractResponse);
      if (extractResponse.structuredData) {
        const structuredUpdate = toStructuredRecord(extractResponse.structuredData);
        if (structuredUpdate) {
          setStructuredRecord((prev) => mergeStructuredData(prev, structuredUpdate));
        }
      }
      if (extractResponse.clinicalArchive) {
        setClinicalArchive(extractResponse.clinicalArchive);
      }
      if (extractResponse.record?.id) {
        setExistingRecordId(extractResponse.record.id);
      }

      // 更新记录列表
      if (patientRouteId) {
        try {
          const updatedRecords = await patientsApi.getPatientRecords(patientRouteId);
          setRecords(updatedRecords);
          if (updatedRecords.length > 0) {
            setExistingRecordId((prevId) => updatedRecords[0]?._id || prevId || null);
            setClinicalArchive(updatedRecords[0]?.clinicalArchive || null);
          }
        } catch (refreshError) {
          console.warn('Failed to refresh patient records after AI extraction', refreshError);
        }
      }

      thinking.setStage('complete', 'complete');
      thinking.setMessage('AI智能提取完成！');
      showToast.success('医疗数据提取成功');

    } catch (error: unknown) {
      console.error('AI智能提取失败:', error);
      thinking.setError('提取失败，请重试');
      const message = extractErrorMessage(error, 'AI智能提取失败');
      showToast.error(message);
    } finally {
      setIsAIExtracting(false);
      setTimeout(() => thinking.stopThinking(), 1500);
    }
  };

  const startMedicalWorkflow = async () => {
    if (!uploadedFiles.length && !manualText.trim()) {
      showToast.error('Please upload files or enter text manually');
      return;
    }

    try {
      // Start thinking mode
      thinking.startThinking('ocr');

      let extractedTextResult = '';
      let workingRecordId: string | null = existingRecordId || null;
      let uploadPayload: UploadPayload = {};

      // Stage 1: Upload and OCR
      if (uploadedFiles.length > 0) {
        thinking.setMessage('Uploading files and extracting text...');

        const formData = new FormData();
        uploadedFiles.forEach((file) => {
          formData.append('files', file);
        });
        if (currentPatient) {
          formData.append('patientId', currentPatient.id);
        }

        // Simulate progress during upload
        const progressInterval = setInterval(() => {
          thinking.setProgress(Math.min(thinking.progress + 5, 95));
        }, 200);

        const uploadResult = await medicalApi.uploadFiles(formData);
        clearInterval(progressInterval);

        extractedTextResult = uploadResult.extractedText || uploadResult.text || uploadResult.combinedText || '';
        setExtractedText(extractedTextResult);
        uploadPayload = {
          fileId: uploadResult.fileId,
          ocrMetadata: uploadResult.ocrMetadata,
          results: uploadResult.results,
          overallMetadata: uploadResult.overallMetadata,
        };

        const ocrRecord = await medicalApi.createRecordFromOCR({
          text: extractedTextResult,
          patientId: currentPatient?.id,
          fileId: uploadResult.fileId,
          ocrMetadata: uploadResult.ocrMetadata,
          results: uploadResult.results,
          overallMetadata: uploadResult.overallMetadata,
        });

        workingRecordId = ocrRecord.recordId;
        setExistingRecordId(ocrRecord.recordId);

        thinking.setProgress(100);
        setTimeout(() => thinking.nextStage(), 500);
      } else {
        extractedTextResult = manualText;
        setExtractedText(extractedTextResult);
        thinking.setProgress(100);
        setTimeout(() => thinking.nextStage(), 500);
      }

      // Wait for stage transition
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Stage 2: Parse to structured data
      thinking.setMessage('Analyzing medical information with AI...');

      const progressInterval2 = setInterval(() => {
        thinking.setProgress(Math.min(thinking.progress + 3, 95));
      }, 150);

      const parsePayload: ParsePayload = {
        text: extractedTextResult,
        useLLM,
        patientId: currentPatient?.id,
      };

      if (uploadPayload.fileId) parsePayload.fileId = uploadPayload.fileId;
      if (uploadPayload.ocrMetadata) parsePayload.ocrMetadata = uploadPayload.ocrMetadata;
      if (uploadPayload.results) parsePayload.results = uploadPayload.results;
      if (uploadPayload.overallMetadata) parsePayload.overallMetadata = uploadPayload.overallMetadata;
      if (workingRecordId) parsePayload.recordId = workingRecordId;

      const parseResult = await medicalApi.parseText(parsePayload);

      clearInterval(progressInterval2);
      setStructuredRecord(toStructuredRecord(parseResult.structuredData ?? null) ?? {});
      if (parseResult.clinicalArchive) {
        setClinicalArchive(parseResult.clinicalArchive);
      }
      if (parseResult.recordId) {
        workingRecordId = parseResult.recordId;
        setExistingRecordId(parseResult.recordId);
      }
      thinking.setProgress(100);
      setTimeout(() => thinking.nextStage(), 500);

      // Wait for stage transition
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Stage 3: Match clinical trials
      thinking.setMessage('Finding matching clinical trials...');

      const progressInterval3 = setInterval(() => {
        thinking.setProgress(Math.min(thinking.progress + 4, 95));
      }, 200);

      const targetRecordId = workingRecordId || parseResult.recordId;
      if (!targetRecordId) {
        throw new Error('Missing record identifier for batch matching');
      }

      const matchResponse = await medicalApi.matchTrials({
        recordId: targetRecordId,
        restart: true,
        filters: { statuses: ['recruiting', 'active'] }
      });

      clearInterval(progressInterval3);
      const matches = Array.isArray(matchResponse.matches) ? matchResponse.matches : [];
      setMatchResults(matches);
      setMatchProvider(matchResponse.provider || undefined);
      thinking.setProgress(100);
      setTimeout(() => thinking.nextStage(), 500);

      if (matchResponse.jobId) {
        showToast.custom('Streaming match job running. View results to watch progress.');
      }

      // Reload records
      if (patientRouteId) {
        const updatedRecords = await patientsApi.getPatientRecords(patientRouteId);
        setRecords(updatedRecords);
        if (updatedRecords.length > 0) {
          setExistingRecordId(updatedRecords[0]._id || null);
        }
      }

    } catch (error: unknown) {
      console.error('Workflow error:', error);
      const message = extractErrorMessage(error, '流程执行失败');
      thinking.setError(message);
      setMatchResults([]);
      setMatchProvider(undefined);
    }
  };

  const handleReset = () => {
    thinking.stopThinking();
    setManualText('');
    setUploadedFiles([]);
    setExtractedText('');
    setStructuredRecord(null);
    setClinicalArchive(null);
    setMatchResults([]);
    setMatchProvider(undefined);
    setFieldExtractionResult(null);
    setIsAIExtracting(false);
    setLlmIntegrationResult(null);
  };

  if (!isAuthenticated || !currentPatient) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
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
              variant="ghost"
              size="sm"
              className="flex items-center space-x-2"
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
          <Button
            onClick={handleReset}
            variant="outline"
            disabled={thinking.isThinking}
            className="flex items-center space-x-2 w-full sm:w-auto"
          >
            <RefreshCw className="h-4 w-4" />
            <span>重置流程</span>
          </Button>
        </div>

        {/* Main Content */}
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Left Column - File Upload & Workflow */}
          <div className="lg:col-span-2 space-y-6">
            {/* File Upload Section */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Upload className="h-5 w-5" />
                  <span>上传医疗资料</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <FileUpload
                  onFilesSelected={handleFilesSelected}
                  disabled={thinking.isThinking}
                  loading={thinking.isThinking && thinking.stage === 'ocr'}
                />

                {/* Manual Text Input */}
                <div className="mt-6">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    或手动输入文本：
                  </label>
                  <textarea
                    value={manualText}
                    onChange={handleManualTextChange}
                    placeholder="在此粘贴病历文本..."
                    rows={4}
                    disabled={thinking.isThinking}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                {/* Start Workflow Button */}
                <div className="mt-6">
                  <Button
                    onClick={startMedicalWorkflow}
                    variant="primary"
                    disabled={thinking.isThinking || (!uploadedFiles.length && !manualText.trim())}
                    loading={thinking.isThinking}
                    className="w-full flex items-center justify-center space-x-2"
                  >
                    <Brain className="h-4 w-4" />
                    <span>开始AI提取</span>
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Thinking Mode Visualization */}
            {thinking.isThinking && (
              <Card>
                <CardHeader>
                  <CardTitle>AI 处理流程</CardTitle>
                </CardHeader>
                <CardContent>
                  <ThinkingMode
                    variant="full"
                    showSteps={true}
                    showProgress={true}
                  />
                </CardContent>
              </Card>
            )}

            {/* Extracted Text */}
            {llmIntegrationResult?.correctedText && (
              <Card>
                <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <CardTitle className="flex items-center space-x-2">
                    <Sparkles className="h-5 w-5" />
                    <span>LLM 医疗记录</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="whitespace-pre-wrap rounded-md bg-gray-900/90 p-4 text-sm text-gray-100">
                    {llmIntegrationResult.correctedText}
                  </pre>
                  {llmIntegrationResult.metadata && (
                    <div className="mt-3 text-xs text-gray-500 space-y-1">
                      <p>
                        提供方：{' '}
                        {formatJsonValue((llmIntegrationResult.metadata.provider ?? 'moonshot') as JsonValue)}
                      </p>
                      {llmIntegrationResult.metadata.model && (
                        <p>模型：{formatJsonValue(llmIntegrationResult.metadata.model)}</p>
                      )}
                      {llmIntegrationResult.metadata.processingTime && (
                        <p>
                          处理耗时：{formatJsonValue(llmIntegrationResult.metadata.processingTime)} ms
                        </p>
                      )}
                      {llmIntegrationResult.metadata.totalTokens && (
                        <p>Token 总量：{formatJsonValue(llmIntegrationResult.metadata.totalTokens)}</p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {(extractedText || llmIntegrationResult?.correctedText) && (
              <Card>
                <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <CardTitle className="flex items-center space-x-2">
                    <FileText className="h-5 w-5" />
                    <span>可编辑病历文本</span>
                  </CardTitle>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={handleAIExtraction}
                      variant="primary"
                      size="sm"
                      disabled={isAIExtracting || thinking.isThinking || !extractedText.trim()}
                      loading={isAIExtracting}
                      className="flex items-center space-x-2"
                    >
                      {!isAIExtracting && <Sparkles className="h-4 w-4" />}
                      <span>AI智能提取</span>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {formattedExtractionCompletedAt && (
                    <p className="mb-3 text-xs text-gray-500">
                      最近提取时间：
                      {formattedExtractionCompletedAt}
                    </p>
                  )}
                  <textarea
                    value={extractedText}
                    onChange={(e) => setExtractedText(e.target.value)}
                    rows={8}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    placeholder="提取后的文本将显示在此处..."
                  />
                </CardContent>
              </Card>
            )}

            {/* Structured Record */}
            {clinicalArchive && <ClinicalArchiveView archive={clinicalArchive} />}

            {/* Medical Data Summary */}
            {structuredRecord && Object.keys(structuredRecord).length > 0 && (
              <MedicalDataSummary
                data={structuredRecord}
                className="mb-6"
                showAlerts={true}
              />
            )}

            {/* Enhanced Structured Record */}
            {structuredRecord && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold text-gray-900">详细医疗记录</h2>
                  <Button
                    onClick={handleMatchExistingRecord}
                    variant="primary"
                    size="sm"
                    disabled={thinking.isThinking}
                    className="whitespace-nowrap"
                  >
                    匹配临床试验
                  </Button>
                </div>
                <EnhancedStructuredRecord
                  data={structuredRecord}
                  title="结构化医疗记录"
                  showRawData={false}
                  collapsible={true}
                  defaultCollapsed={false}
                />
              </div>
            )}

            {llmIntegrationResult?.timeline && (
              <Card>
                <CardHeader>
                  <CardTitle>LLM 时间线</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="whitespace-pre-wrap rounded-md bg-gray-900/90 p-4 text-xs text-gray-100">
                    {llmIntegrationResult.timeline}
                  </pre>
                  {llmIntegrationResult.metadata && (
                    <div className="mt-3 text-xs text-gray-500">
                      <p>
                        提供方：{' '}
                        {formatJsonValue((llmIntegrationResult.metadata.provider ?? 'moonshot') as JsonValue)}
                      </p>
                      <p>
                        模型：{' '}
                        {formatJsonValue((llmIntegrationResult.metadata.model ?? 'kimi-k2-turbo-preview') as JsonValue)}
                      </p>
                      {llmIntegrationResult.metadata.processingTime && (
                        <p>
                          处理耗时：{formatJsonValue(llmIntegrationResult.metadata.processingTime)} ms
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Column - Results */}
          <div className="space-y-6">
            {/* Clinical Trial Matches */}
            {Array.isArray(matchResults) && matchResults.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Search className="h-5 w-5" />
                    <span>临床试验匹配结果（{matchResults.length}）</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {matchProvider?.error && (
                    <div className="mb-4 flex items-center space-x-2 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
                      <AlertCircle className="h-5 w-5" />
                      <span>
                        已回退经典匹配
                        {matchProvider.error ? `：${matchProvider.error}` : ''}
                      </span>
                    </div>
                  )}

                  {matchProvider && (
                    <div className="mb-4 text-xs text-gray-500 space-y-1">
                      <div>
                        提供方：{formatProviderMetadataValue(matchProvider.provider ?? 'moonshot')}
                      </div>
                      {matchProvider.model !== undefined && matchProvider.model !== null && (
                        <div>模型：{formatProviderMetadataValue(matchProvider.model)}</div>
                      )}
                      {matchProvider.processingTime !== undefined && matchProvider.processingTime !== null && (
                        <div>
                          处理耗时：{formatProviderMetadataValue(matchProvider.processingTime)} ms
                        </div>
                      )}
                      {matchProvider.totalTokens !== undefined && matchProvider.totalTokens !== null && (
                        <div>Token 总量：{formatProviderMetadataValue(matchProvider.totalTokens)}</div>
                      )}
                    </div>
                  )}

                  <div className="space-y-4">
                    {matchResults.map((match) => (
                      <TrialCard
                        key={match.trial_id || match.trial_title}
                        match={match}
                        showMatchScore={true}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Upload History */}
            {records.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>上传历史</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {records.map((record, index) => (
                      <div
                        key={record._id}
                        className="p-3 border rounded-lg hover:bg-gray-50 cursor-pointer"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium">
                              {record.originalFileName || `上传记录 #${index + 1}`}
                            </p>
                            <p className="text-xs text-gray-500">
                              {new Date(record.uploadDate).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="text-xs text-gray-400">
                            {record.structuredData ? '已处理' : '原始'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Processing Status */}
            {thinking.isThinking && (
              <Card>
                <CardHeader>
                  <CardTitle>当前状态</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>阶段：</span>
                      <span className="font-medium">{thinkingStageLabels[thinking.stage] ?? thinking.stage}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>进度：</span>
                      <span className="font-medium">{Math.round(thinking.progress)}%</span>
                    </div>
                    <div className="text-sm text-gray-600">
                      {thinking.message}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
