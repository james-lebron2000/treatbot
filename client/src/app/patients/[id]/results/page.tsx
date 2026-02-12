'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Search, RefreshCw, Download } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/auth';
import { usePatientStore } from '@/lib/stores/patients';
import { useWorkflowStore } from '@/lib/stores/workflow';
import { patientsApi } from '@/lib/api/patients';
import { medicalApi, MatchStreamSubscription } from '@/lib/api/medical';
import type { FieldPromptConfig, MatchFilters } from '@/lib/api/medical';
import { extractErrorMessage } from '@/lib/utils';
import { logClientError } from '@/lib/logging';
import { TrialCard } from '@/components/medical/TrialCard';
import { MissingConfirmBanner } from '@/components/medical/MissingConfirmBanner';
import { MatchDeltaBanner, type MatchDelta } from '@/components/medical/MatchDeltaBanner';
import { useViewModeStore } from '@/lib/stores/viewMode';
import { MatchReportView } from '@/components/medical/MatchReportView';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { StepNavigation } from '@/components/workflow/StepNavigation';
import { showToast } from '@/components/ui/Toast';
import { WorkflowEmptyState, WorkflowErrorState, WorkflowLoadingState } from '@/components/workflow/WorkflowFeedback';
import {
  LegacyTrialMatch,
  MatchProviderMetadata,
  MatchHistoryEntry,
  MatchBatchDetails,
  JsonValue,
} from '@/types';
import { useThinkingMode } from '@/hooks/useThinkingMode';
import {
  buildMissingItems,
  formatJsonValueForInput,
  getDottedValue,
  getItemKeyForLookup,
  type MissingChecklist,
  type MissingFieldItem
} from '@/lib/clinical/missingFields';

type JsonObject = Record<string, JsonValue>;

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function applyDottedKey(target: JsonObject, dottedKey: string, value: JsonValue) {
  const parts = dottedKey.split('.').filter(Boolean);
  if (parts.length === 0) return;
  let cursor: JsonObject = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    const existing = cursor[part];
    if (!isJsonObject(existing)) {
      cursor[part] = {} as JsonObject;
    }
    cursor = cursor[part] as JsonObject;
  }
  cursor[parts[parts.length - 1]] = value;
}

function deepMerge(target: JsonObject, patch: JsonObject): JsonObject {
  const output: JsonObject = { ...(target || {}) };
  Object.keys(patch || {}).forEach((key) => {
    const patchValue = patch[key];
    const existing = output[key];
    if (isJsonObject(patchValue) && isJsonObject(existing)) {
      output[key] = deepMerge(existing, patchValue);
      return;
    }
    output[key] = patchValue;
  });
  return output;
}

function parseArrayInput(value: string) {
  return value
    .split(/[,，、;；\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatStatusScope(statuses: unknown): string | null {
  if (!Array.isArray(statuses) || statuses.length === 0) return null;
  const labels: Record<string, string> = {
    recruiting: '招募中',
    active: '进行中',
    completed: '已完成',
    suspended: '已暂停',
  };
  const cleaned = statuses.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  if (!cleaned.length) return null;
  return cleaned.map((s) => labels[s] ?? s).join('，');
}

function sanitizeJsonValue(value: JsonValue | undefined): JsonValue {
  if (value === undefined) return null;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonValue(item as JsonValue));
  }
  if (value && typeof value === 'object') {
    const out: JsonObject = {};
    Object.entries(value as Record<string, JsonValue | undefined>).forEach(([k, v]) => {
      out[k] = sanitizeJsonValue(v);
    });
    return out;
  }
  return value;
}

function sanitizeJsonObject(input: Record<string, JsonValue | undefined> | null | undefined): JsonObject {
  const out: JsonObject = {};
  if (!input) return out;
  Object.entries(input).forEach(([k, v]) => {
    out[k] = sanitizeJsonValue(v);
  });
  return out;
}

function hasMeaningfulValue(value: JsonValue | undefined): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return false;
}

interface ResultsStepProps {
  params?: Promise<{
    id?: string;
  }>;
}

export default function ResultsStep({ params }: ResultsStepProps) {
  const [patientRouteId, setPatientRouteId] = useState('');
  const [paramsResolved, setParamsResolved] = useState(false);
  const [isLoadingPatient, setIsLoadingPatient] = useState(false);
  const [patientLoadError, setPatientLoadError] = useState<string | null>(null);
  const [patientLoadTraceId, setPatientLoadTraceId] = useState<string | null>(null);
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const { currentPatient, setCurrentPatient } = usePatientStore();
  const {
    matchResults: workflowMatchResults,
    structuredRecord,
    extractedText: workflowExtractedText,
    setMatchResults,
    setStepCompleted,
    setCurrentStep,
    setStep3Data,
    step3Data,
    step2Data,
    currentRecord,
    setCurrentRecord,
    setStructuredRecord,
    setStep1Data,
    setStep2Data,
    setExtractedText,
  } = useWorkflowStore();

  const [matchResults, setLocalMatchResults] = useState<LegacyTrialMatch[]>([]);
  const [matchProvider, setMatchProvider] = useState<MatchProviderMetadata | null | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [sortBy, setSortBy] = useState<'match_score' | 'title' | 'phase'>('match_score');
  const [filterStatus, setFilterStatus] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [currentRecordId, setCurrentRecordId] = useState<string | null>(null);
  const [history, setHistory] = useState<MatchHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [historyDiff, setHistoryDiff] = useState<{ added: LegacyTrialMatch[]; removed: LegacyTrialMatch[] }>({ added: [], removed: [] });
  const [restoringHistoryId, setRestoringHistoryId] = useState<string | null>(null);
  const [historyNextCursor, setHistoryNextCursor] = useState<string | null>(null);
  const [historyTotal, setHistoryTotal] = useState<number>(0);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [latestBatch, setLatestBatch] = useState<MatchBatchDetails | null>(null);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [missingSelection, setMissingSelection] = useState<Record<string, boolean>>({});
  const [missingModalOpen, setMissingModalOpen] = useState(false);
  const [manualMissingValues, setManualMissingValues] = useState<Record<string, string>>({});
  const [isFixingMissing, setIsFixingMissing] = useState(false);
  const [onlyRecruitingActive, setOnlyRecruitingActive] = useState(true);
  const { trialViewMode, setTrialViewMode } = useViewModeStore();
  const [missingConfirmations, setMissingConfirmations] = useState<Record<string, '满足' | '不确定' | '不满足'>>({});
  const [matchDelta, setMatchDelta] = useState<MatchDelta | null>(null);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [matchReport, setMatchReport] = useState<Record<string, JsonValue> | null>(null);

  // 分页状态 / Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const streamSubscriptionRef = useRef<MatchStreamSubscription | null>(null);
  const matchesRef = useRef<LegacyTrialMatch[]>([]);
  const preMatchSnapshotRef = useRef<LegacyTrialMatch[]>([]);
  const thinking = useThinkingMode();
  const {
    completedItems,
    totalItems,
    setMatchingProgress,
    startThinking,
    stopThinking,
    setStage,
    setProgress,
    setMessage,
    setError,
    progress: thinkingProgress
  } = thinking;

  const formatTimestamp = (value: string) => new Date(value).toLocaleString();

  const missingChecklist: MissingChecklist | null = useMemo(() => {
    if (!matchProvider || typeof matchProvider !== 'object') return null;
    const raw = (matchProvider as Record<string, unknown>).missingChecklist;
    if (!raw || typeof raw !== 'object') return null;
    const rawObj = raw as Record<string, unknown>;
    const requiredFields = Array.isArray(rawObj.requiredFields)
      ? rawObj.requiredFields.filter((v): v is string => typeof v === 'string')
      : [];
    const trialIntents = Array.isArray(rawObj.trialIntents)
      ? rawObj.trialIntents.filter((v): v is string => typeof v === 'string')
      : [];
    return { requiredFields, trialIntents };
  }, [matchProvider]);

  const providerDataQuality = useMemo(() => {
    if (!matchProvider || typeof matchProvider !== 'object') return null;
    const raw = (matchProvider as Record<string, unknown>).dataQuality;
    if (!raw || typeof raw !== 'object') return null;
    const rawObj = raw as Record<string, unknown>;
    const completionRate = typeof rawObj.completionRate === 'string' ? rawObj.completionRate : null;
    const missingFields = Array.isArray(rawObj.missingFields)
      ? rawObj.missingFields.filter((v): v is string => typeof v === 'string')
      : [];
    return { completionRate, missingFields };
  }, [matchProvider]);

  const matchFilters: MatchFilters | undefined = useMemo(() => {
    return onlyRecruitingActive
      ? { statuses: ['recruiting', 'active'] }
      : { statuses: ['recruiting', 'active', 'completed', 'suspended'] };
  }, [onlyRecruitingActive]);

  const missingItems: MissingFieldItem[] = useMemo(() => {
    return buildMissingItems(missingChecklist);
  }, [missingChecklist]);

  const pendingConfirmationLabels = useMemo(
    () => missingItems.map((item) => item.label).filter(Boolean),
    [missingItems]
  );

  const missingItemKey = useMemo(() => missingItems.map((i) => i.id).join('|'), [missingItems]);

  useEffect(() => {
    if (!missingItems.length) {
      setMissingSelection({});
      return;
    }
    setMissingSelection((prev) => {
      const next: Record<string, boolean> = {};
      missingItems.forEach((item) => {
        const existing = prev[item.id];
        next[item.id] = existing !== undefined ? existing : Boolean(item.fieldConfig || item.manual);
      });
      return next;
    });
  }, [currentRecordId, missingItemKey, missingItems]);

  const selectedMissingItems = useMemo(
    () => missingItems.filter((item) => Boolean(missingSelection[item.id])),
    [missingItems, missingSelection]
  );

  const selectedMissingConfirmationKey = useMemo(
    () => selectedMissingItems.map((i) => i.id).join('|'),
    [selectedMissingItems]
  );

  useEffect(() => {
    if (!missingModalOpen) return;
    // Default all selected items to “满足” (optimistic) unless user already set.
    setMissingConfirmations((prev) => {
      const next = { ...prev };
      selectedMissingItems.forEach((item) => {
        if (!next[item.id]) next[item.id] = '满足';
      });
      return next;
    });
  }, [missingModalOpen, selectedMissingConfirmationKey, selectedMissingItems]);
  const selectedManualMissingItems = useMemo(
    () => selectedMissingItems.filter((item) => Boolean(item.manual)),
    [selectedMissingItems]
  );
  const selectedAutoMissingItems = useMemo(
    () => selectedMissingItems.filter((item) => Boolean(item.fieldConfig)),
    [selectedMissingItems]
  );
  const selectedManualKeys = useMemo(
    () => selectedManualMissingItems.map((item) => item.manual!.key).join('|'),
    [selectedManualMissingItems]
  );

  const setMissingSelectionAll = (checked: boolean) => {
    setMissingSelection((prev) => {
      const next = { ...prev };
      missingItems.forEach((item) => {
        const selectable = Boolean(item.fieldConfig || item.manual);
        next[item.id] = selectable ? checked : false;
      });
      return next;
    });
  };

  const setMissingSelectionBySource = (source: 'required' | 'trial') => {
    setMissingSelection((prev) => {
      const next = { ...prev };
      missingItems.forEach((item) => {
        const selectable = Boolean(item.fieldConfig || item.manual);
        next[item.id] = selectable && item.source === source;
      });
      return next;
    });
  };

  const prefillManualMissingValues = useCallback(() => {
    if (!selectedManualMissingItems.length) return;
    setManualMissingValues((prev) => {
      const next = { ...prev };
      selectedManualMissingItems.forEach((item) => {
        const manual = item.manual!;
        const existing = next[manual.key];
        if (typeof existing === 'string' && existing.trim().length > 0) return;
        const currentValue = getDottedValue(structuredRecord as JsonValue | undefined, manual.key);
        const formatted = formatJsonValueForInput(currentValue);
        if (formatted) {
          next[manual.key] = formatted;
        }
      });
      return next;
    });
  }, [selectedManualMissingItems, structuredRecord]);

  useEffect(() => {
    if (!missingModalOpen) return;
    prefillManualMissingValues();
  }, [missingModalOpen, prefillManualMissingValues, selectedManualKeys]);

  const resolveTextForExtraction = () => {
    if (typeof workflowExtractedText === 'string' && workflowExtractedText.trim().length > 0) {
      return workflowExtractedText;
    }
    if (currentRecord && typeof currentRecord.extractedText === 'string' && currentRecord.extractedText.trim().length > 0) {
      return currentRecord.extractedText;
    }
    if (typeof step2Data?.extractedText === 'string' && step2Data.extractedText.trim().length > 0) {
      return step2Data.extractedText;
    }
    return '';
  };

  const runAutoExtractionForMissing = async () => {
    if (!currentRecordId) {
      showToast.error('暂无可用的病历记录');
      return;
    }

    const fieldConfigs = selectedAutoMissingItems
      .map((item) => item.fieldConfig)
      .filter(Boolean) as FieldPromptConfig[];

    const dedup = new Map<string, FieldPromptConfig>();
    fieldConfigs.forEach((cfg) => {
      if (typeof cfg === 'string') {
        dedup.set(cfg, cfg);
      } else if (cfg && typeof cfg === 'object' && typeof cfg.key === 'string') {
        dedup.set(cfg.key, cfg);
      }
    });

    const fields = Array.from(dedup.values());
    if (!fields.length) {
      showToast.error('未选择可自动抽取的字段');
      return;
    }

    const text = resolveTextForExtraction();
    if (!text) {
      showToast.error('缺少可用于抽取的 OCR 文本');
      return;
    }

    setIsFixingMissing(true);
    try {
      const response = await medicalApi.extractFieldsWithLLM({
        text,
        fields,
        recordId: currentRecordId
      });

      if (!response.success) {
        showToast.error(response.message || '字段抽取完成，但未返回结果');
        return;
      }

      showToast.success('缺失字段已抽取完成');
      const updatedRecord = await medicalApi.getRecord(currentRecordId);
      setCurrentRecord(updatedRecord);
      const structuredSource = (updatedRecord.llmIntegrationData?.fullStructuredData as Record<string, JsonValue> | undefined)
        || (updatedRecord.structuredData as Record<string, JsonValue> | undefined);
      if (structuredSource) {
        setStructuredRecord(structuredSource);
      }
      if (typeof updatedRecord.extractedText === 'string') {
        setExtractedText(updatedRecord.extractedText);
      }

      await performTrialMatching({ restart: true, silent: true });
      showToast.success('字段已更新，匹配结果已刷新');
    } catch (error) {
      showToast.error(extractErrorMessage(error, '缺失字段抽取失败'));
    } finally {
      setIsFixingMissing(false);
    }
  };

  const saveManualMissing = async () => {
    if (!currentRecordId) {
      showToast.error('暂无可用的病历记录');
      return;
    }

    const selected = selectedManualMissingItems;
    if (!selected.length) {
      showToast.error('未选择需要手动补录的字段');
      return;
    }

    const patch: JsonObject = {};

    // Record confirmation states (even if user doesn't fill values yet)
    const confirmationPatch: JsonObject = {};
    selectedMissingItems.forEach((item) => {
      const status = missingConfirmations[item.id] || '满足';
      const key = getItemKeyForLookup(item) || item.id;
      // Store under confirmations.<key>
      applyDottedKey(confirmationPatch, `confirmations.${key}`, status as unknown as JsonValue);
    });
    selected.forEach((item) => {
      const manual = item.manual!;
      const raw = manualMissingValues[manual.key];
      if (raw === undefined) return;

      if (manual.type === 'number') {
        const num = Number(String(raw).trim());
        if (!Number.isFinite(num)) return;
        applyDottedKey(patch, manual.key, num as JsonValue);
        return;
      }

      if (manual.type === 'boolean') {
        const norm = String(raw).trim().toLowerCase();
        if (norm === 'true' || norm === 'yes' || norm === '是') {
          applyDottedKey(patch, manual.key, true);
          return;
        }
        if (norm === 'false' || norm === 'no' || norm === '否') {
          applyDottedKey(patch, manual.key, false);
          return;
        }
        if (norm === 'null' || norm === '') {
          applyDottedKey(patch, manual.key, null);
        }
        return;
      }

      if (manual.type === 'array') {
        applyDottedKey(patch, manual.key, parseArrayInput(String(raw)) as unknown as JsonValue);
        return;
      }

      applyDottedKey(patch, manual.key, String(raw).trim() || null);
    });

    if (!Object.keys(patch).length && !Object.keys(confirmationPatch).length) {
      showToast.error('未填写任何补录内容');
      return;
    }

    setIsFixingMissing(true);
    try {
      const base = (structuredRecord && typeof structuredRecord === 'object' && !Array.isArray(structuredRecord))
        ? sanitizeJsonObject(structuredRecord as Record<string, JsonValue | undefined>)
        : {};
      const merged = deepMerge(deepMerge(base, confirmationPatch), patch);
      const updated = await medicalApi.updateRecord(currentRecordId, {
        structuredData: merged
      });

      setCurrentRecord(updated);
      const structuredSource = (updated.llmIntegrationData?.fullStructuredData as Record<string, JsonValue> | undefined)
        || (updated.structuredData as Record<string, JsonValue> | undefined);
      if (structuredSource) {
        setStructuredRecord(structuredSource);
      }
      if (typeof updated.extractedText === 'string') {
        setExtractedText(updated.extractedText);
      }

      setMissingModalOpen(false);
      showToast.success('补录信息已保存');
      await performTrialMatching({ restart: true, silent: true });
      showToast.success('字段已更新，匹配结果已刷新');
    } catch (error) {
      showToast.error(extractErrorMessage(error, '补录信息保存失败'));
    } finally {
      setIsFixingMissing(false);
    }
  };

  const computeHistoryDiff = (historyMatches: LegacyTrialMatch[]) => {
    const currentIds = new Set(matchResults.map((m) => m.trial_id));
    const historyIds = new Set(historyMatches.map((m) => m.trial_id));
    return {
      added: historyMatches.filter((match) => !currentIds.has(match.trial_id)),
      removed: matchResults.filter((match) => !historyIds.has(match.trial_id))
    };
  };

  const deriveBatchDetails = useCallback((metadata?: MatchProviderMetadata | null): MatchBatchDetails | null => {
    if (!metadata || !metadata.totalBatches) {
      return null;
    }
    const timeline = Array.isArray(metadata.batchTimeline) ? metadata.batchTimeline : [];
    const lastEntry = timeline.length ? timeline[timeline.length - 1] : null;
    return {
      number: Number(metadata.lastBatchNumber ?? metadata.completedBatches ?? timeline.length ?? 0),
      total: Number(metadata.totalBatches ?? 0),
      size: Number(metadata.batchSize ?? 0),
      processedTrials: Number(metadata.processedTrials ?? 0),
      remainingTrials: Number(metadata.remainingTrials ?? 0),
      durationMs: Number((lastEntry && typeof lastEntry === 'object' ? (lastEntry as Record<string, unknown>).durationMs : 0) || 0),
      hasMore: Boolean(metadata.hasMore)
    };
  }, []);

  const updateProgressFromMetadata = useCallback((metadata?: MatchProviderMetadata | null) => {
    if (!metadata) return;
    const total = Number(metadata.totalTrials ?? metadata.processedTrials ?? matchResults.length);
    const completed = Number(metadata.processedTrials ?? metadata.matchedTrials ?? matchResults.length);
    if (total > 0) {
      setMatchingProgress(completed, total);
    }
  }, [matchResults.length, setMatchingProgress]);

  const loadMatchHistory = useCallback(async (recordId: string, options: { reset?: boolean } = {}) => {
    const { reset = false } = options;
    if (reset) {
      setHistoryLoading(true);
      setHistory([]);
      setHistoryNextCursor(null);
      setHistoryTotal(0);
      setSelectedHistoryId(null);
      setHistoryDiff({ added: [], removed: [] });
    } else {
      setHistoryLoadingMore(true);
    }
    try {
      const cursor = reset ? undefined : historyNextCursor || undefined;
      const { history: page, latest, metadata, nextCursor, total } = await medicalApi.getMatchHistory(recordId, {
        limit: 10,
        cursor
      });
      setHistory((prev) => (reset ? page : [...prev, ...page]));
      setHistoryNextCursor(nextCursor);
      setHistoryTotal(total);
      setHistoryError(null);

      if (metadata) {
        setMatchProvider(metadata);
        setLatestBatch(deriveBatchDetails(metadata));
        updateProgressFromMetadata(metadata);
      }

      if ((!matchResults.length || recordId !== currentRecordId) && latest && latest.length) {
        setLocalMatchResults(latest);
        setMatchResults(latest);
      }
    } catch (error) {
      setHistoryError(extractErrorMessage(error, '匹配历史加载失败'));
    } finally {
      setHistoryLoading(false);
      setHistoryLoadingMore(false);
    }
  }, [currentRecordId, deriveBatchDetails, historyNextCursor, matchResults, setMatchResults, updateProgressFromMetadata]);

  const handleSelectHistory = (entry: MatchHistoryEntry) => {
    if (selectedHistoryId === entry._id) {
      setSelectedHistoryId(null);
      setHistoryDiff({ added: [], removed: [] });
      return;
    }

    const diff = computeHistoryDiff(entry.matches || []);
    setSelectedHistoryId(entry._id);
    setHistoryDiff(diff);
  };

  const handleRestoreHistory = async (historyId: string) => {
    if (!currentRecordId) {
      showToast.error('暂无可恢复的病历记录');
      return;
    }

    try {
      setRestoringHistoryId(historyId);
      const response = await medicalApi.restoreMatchHistory(currentRecordId, historyId);
      const restoredMatches = Array.isArray(response.matches) ? response.matches : [];
      setLocalMatchResults(restoredMatches);
      setMatchResults(restoredMatches);
      setMatchProvider(response.metadata);
      setStep3Data({ matchResults: restoredMatches, provider: response.metadata || null });
      setStepCompleted(3, true);
      setMatchingProgress(restoredMatches.length, response.metadata?.totalTrials ?? restoredMatches.length);
      showToast.success('历史匹配结果已恢复');
      setSelectedHistoryId(null);
      setHistoryDiff({ added: [], removed: [] });
      await loadMatchHistory(currentRecordId, { reset: true });
    } catch (error) {
      showToast.error(extractErrorMessage(error, '历史记录恢复失败'));
    } finally {
      setRestoringHistoryId(null);
    }
  };

  const loadMatchStatus = useCallback(async (recordId: string, options: { refreshMatches?: boolean } = {}) => {
    try {
      const { refreshMatches = false } = options;
      const status = await medicalApi.getMatchStatus(recordId);
      if (status.metadata) {
        setMatchProvider(status.metadata);
        setLatestBatch(deriveBatchDetails(status.metadata));
        updateProgressFromMetadata(status.metadata);
      }
      if (refreshMatches && status.matches && status.matches.length) {
        setLocalMatchResults(status.matches);
        setMatchResults(status.matches);
      }
    } catch (error: unknown) {
      logClientError('results.loadMatchStatus', error, { recordId });
    }
  }, [deriveBatchDetails, setMatchProvider, setMatchResults, updateProgressFromMetadata]);

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
    setCurrentStep(3);
  }, [setCurrentStep]);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/auth/login');
      return;
    }
  }, [isAuthenticated, router]);

  const loadPatient = useCallback(async () => {
    if (!paramsResolved || !patientRouteId) return;
    try {
      setIsLoadingPatient(true);
      setPatientLoadError(null);
      setPatientLoadTraceId(null);
      const patient = await patientsApi.getPatient(patientRouteId);
      setCurrentPatient(patient);
    } catch (error: unknown) {
      const traceId = logClientError('results.loadPatient', error, { patientRouteId });
      const message = extractErrorMessage(error, '患者信息加载失败');
      setPatientLoadError(message);
      setPatientLoadTraceId(traceId);
      showToast.error(message);
    } finally {
      setIsLoadingPatient(false);
    }
  }, [paramsResolved, patientRouteId, setCurrentPatient]);

  useEffect(() => {
    if (!paramsResolved || !patientRouteId) return;
    void loadPatient();
  }, [loadPatient, paramsResolved, patientRouteId]);

  useEffect(() => {
    if (currentRecord && currentRecord._id) {
      setCurrentRecordId(currentRecord._id.toString());
    }
  }, [currentRecord]);

  useEffect(() => {
    matchesRef.current = matchResults;
  }, [matchResults]);

  const computeDelta = (before: LegacyTrialMatch[], after: LegacyTrialMatch[]): MatchDelta => {
    const beforeMap = new Map(before.map((m) => [m.trial_id, m]));
    const afterMap = new Map(after.map((m) => [m.trial_id, m]));

    let added = 0;
    let removed = 0;
    let scoreChanged = 0;

    afterMap.forEach((m, id) => {
      if (!beforeMap.has(id)) {
        added += 1;
        return;
      }
      const prev = beforeMap.get(id);
      const prevScore = Number(prev?.match_score ?? 0);
      const nextScore = Number(m?.match_score ?? 0);
      if (prevScore !== nextScore) {
        scoreChanged += 1;
      }
    });

    beforeMap.forEach((_m, id) => {
      if (!afterMap.has(id)) removed += 1;
    });

    return {
      added,
      removed,
      scoreChanged,
      timestamp: new Date().toISOString(),
    };
  };

  const attachStreamListener = useCallback((jobId: string) => {
    if (!currentRecordId) {
      return;
    }

    if (streamSubscriptionRef.current) {
      streamSubscriptionRef.current.close();
      streamSubscriptionRef.current = null;
    }

    const subscription = medicalApi.streamMatchJob(currentRecordId, jobId, {
      onInitial: (payload) => {
        const matches = Array.isArray(payload.matches) ? payload.matches : [];
        setLocalMatchResults(matches);
        setMatchResults(matches);
        if (payload.metadata) {
          setMatchProvider(payload.metadata);
          updateProgressFromMetadata(payload.metadata);
          setStep3Data({ matchResults: matches, provider: payload.metadata });
        }
        setStepCompleted(3, true);
      },
      onBatch: (payload) => {
        const matches = Array.isArray(payload.aggregatedMatches) ? payload.aggregatedMatches : [];
        setLocalMatchResults(matches);
        setMatchResults(matches);
        setLatestBatch(payload.batch);
        setIsBatchRunning(true);
        setStage('matching', `正在处理批次 ${payload.batch.number} / ${payload.batch.total}`);
        setMessage(`已处理 ${payload.batch.processedTrials} 项试验`);
        if (payload.metadata) {
          setMatchProvider(payload.metadata);
          updateProgressFromMetadata(payload.metadata);
          setStep3Data({ matchResults: matches, provider: payload.metadata });
        }
        setStepCompleted(3, true);
      },
      onComplete: (payload) => {
        if (streamSubscriptionRef.current) {
          streamSubscriptionRef.current.close();
          streamSubscriptionRef.current = null;
        }
        setActiveJobId(null);
        const finalMatches = Array.isArray(payload.aggregatedMatches) ? payload.aggregatedMatches : matchesRef.current;
        const delta = computeDelta(preMatchSnapshotRef.current || [], finalMatches);
        setMatchDelta(delta);
        setLocalMatchResults(finalMatches);
        setMatchResults(finalMatches);
        const finalMetadata = payload.metadata || matchProvider || null;
        if (finalMetadata) {
          setMatchProvider(finalMetadata);
          updateProgressFromMetadata(finalMetadata);
          setStep3Data({ matchResults: finalMatches, provider: finalMetadata });
        }
        setIsBatchRunning(false);
        setStage('complete', '全部批次处理完成');
        setMessage('流式更新完成');
        if (currentRecordId) {
          loadMatchHistory(currentRecordId, { reset: true });
        }
        setTimeout(() => stopThinking(), 800);
      },
      onError: (payload) => {
        if (streamSubscriptionRef.current) {
          streamSubscriptionRef.current.close();
          streamSubscriptionRef.current = null;
        }
        setActiveJobId(null);
        setIsBatchRunning(false);
        const errorMessage = payload.error || '流式匹配任务发生错误';
        setError(errorMessage);
        showToast.error(errorMessage);
        stopThinking();
      },
      onCancelled: (payload) => {
        if (streamSubscriptionRef.current) {
          streamSubscriptionRef.current.close();
          streamSubscriptionRef.current = null;
        }
        setActiveJobId(null);
        setIsBatchRunning(false);
        showToast.custom(payload.reason ? `匹配任务已结束：${payload.reason}` : '匹配任务已结束');
        stopThinking();
      }
    });

    if (subscription) {
      streamSubscriptionRef.current = subscription;
      setActiveJobId(jobId);
    }
  }, [currentRecordId, loadMatchHistory, matchProvider, setError, setLocalMatchResults, setMatchProvider, setMessage, setMatchResults, setStage, setStep3Data, setStepCompleted, stopThinking, updateProgressFromMetadata]);

  const performTrialMatching = useCallback(async ({ restart = false, silent = false }: { restart?: boolean; silent?: boolean } = {}) => {
    if (!currentRecordId) {
      showToast.error('暂无可用于匹配的病历记录');
      return;
    }

    try {
      setIsBatchRunning(true);
      setIsLoading(true);
      startThinking('matching');
      setMessage(restart ? '正在开始匹配临床试验...' : '正在继续匹配临床试验...');
      setProgress(restart ? 5 : Math.min(95, thinkingProgress + 5));
      setLatestBatch(null);

      if (streamSubscriptionRef.current) {
        streamSubscriptionRef.current.close();
        streamSubscriptionRef.current = null;
      }

      const matchResult = await medicalApi.matchTrials({
        recordId: currentRecordId,
        filters: matchFilters,
        batchSize: matchProvider?.batchSize,
        restart
      });

      const initialMatches = Array.isArray(matchResult.matches) ? matchResult.matches : [];
      setLocalMatchResults(initialMatches);
      setMatchResults(initialMatches);
      if (matchResult.provider) {
        setMatchProvider(matchResult.provider);
        updateProgressFromMetadata(matchResult.provider);
        setStep3Data({ matchResults: initialMatches, provider: matchResult.provider });
      }
      setStepCompleted(3, true);

      if (!silent) {
        if (matchResult.jobId) {
          showToast.success(matchResult.reused ? '已继续上次匹配任务（实时更新）' : '匹配任务已启动（实时更新）');
        } else {
          showToast.success('匹配结果已生成');
        }
      }

      if (matchResult.jobId) {
        setActiveJobId(matchResult.jobId);
        attachStreamListener(matchResult.jobId);
      } else {
        setActiveJobId(null);
        setIsBatchRunning(false);
        setStage('complete', '匹配任务完成');
        setMessage('匹配结果已生成');
        stopThinking();
      }
    } catch (error: unknown) {
      logClientError('results.performTrialMatching', error, { currentRecordId });
      const message = extractErrorMessage(error, '批次匹配失败');
      setError(message);
      showToast.error(message);
      setIsBatchRunning(false);
      stopThinking();
    } finally {
      setIsLoading(false);
    }
  }, [attachStreamListener, currentRecordId, matchFilters, matchProvider?.batchSize, setError, setLocalMatchResults, setMatchProvider, setMessage, setMatchResults, setProgress, setStage, setStep3Data, setStepCompleted, startThinking, stopThinking, thinkingProgress, updateProgressFromMetadata]);

  const performStructuredDataMatching = useCallback(async ({ restart = false, silent = false }: { restart?: boolean; silent?: boolean } = {}) => {
    if (!structuredRecord) {
      showToast.error('暂无可用于匹配的结构化医疗信息');
      return;
    }

    try {
      setIsBatchRunning(true);
      setIsLoading(true);
      startThinking('matching');
      setMessage(restart ? '正在开始匹配临床试验...' : '正在加载下一批试验...');
      setProgress(restart ? 5 : Math.min(95, thinkingProgress + 5));
      setLatestBatch(null);

      if (streamSubscriptionRef.current) {
        streamSubscriptionRef.current.close();
        streamSubscriptionRef.current = null;
      }

      const matchResult = await medicalApi.matchTrialsEnhanced({
        structuredData: structuredRecord,
        patientId: currentPatient?.patientId,
        filters: matchFilters
      });

      const initialMatches = Array.isArray(matchResult.matches) ? matchResult.matches : [];
      setLocalMatchResults(initialMatches);
      setMatchResults(initialMatches);

      if (matchResult.provider) {
        setMatchProvider(matchResult.provider);
        updateProgressFromMetadata(matchResult.provider);
        setStep3Data({ matchResults: initialMatches, provider: matchResult.provider });
      }

      setStepCompleted(3, true);

      if (!silent) {
        showToast.success('临床试验匹配完成');
      }

      setActiveJobId(null);
      setIsBatchRunning(false);
      setStage('complete', '结构化数据匹配完成');
      setMessage('匹配结果已生成');
      stopThinking();

      if (currentRecordId) {
        loadMatchHistory(currentRecordId, { reset: true });
      }
    } catch (error: unknown) {
      logClientError('results.performStructuredDataMatching', error, { currentRecordId });
      const message = extractErrorMessage(error, '结构化数据匹配失败');
      setError(message);
      showToast.error(message);
      setIsBatchRunning(false);
      stopThinking();
    } finally {
      setIsLoading(false);
    }
  }, [currentPatient?.patientId, matchFilters, setError, setLocalMatchResults, setMatchProvider, setMessage, setMatchResults, setProgress, setStage, setStep3Data, setStepCompleted, startThinking, stopThinking, structuredRecord, thinkingProgress, updateProgressFromMetadata, loadMatchHistory, currentRecordId]);

  const performTrialMatchingRef = useRef(performTrialMatching);
  const performStructuredDataMatchingRef = useRef(performStructuredDataMatching);
  useEffect(() => {
    performTrialMatchingRef.current = performTrialMatching;
    performStructuredDataMatchingRef.current = performStructuredDataMatching;
  }, [performTrialMatching, performStructuredDataMatching]);

  const autoMatchGuardRef = useRef<string | null>(null);

  useEffect(() => {
    autoMatchGuardRef.current = null;
  }, [structuredRecord, currentRecordId]);

  useEffect(() => {
    return () => {
      if (streamSubscriptionRef.current) {
        streamSubscriptionRef.current.close();
        streamSubscriptionRef.current = null;
      }
      setActiveJobId(null);
    };
  }, []);

  useEffect(() => {
    if (currentRecordId) {
      const refreshMatches = matchResults.length === 0;
      loadMatchHistory(currentRecordId, { reset: true });
      loadMatchStatus(currentRecordId, { refreshMatches });
    }
  }, [currentRecordId, loadMatchHistory, loadMatchStatus, matchResults.length]);

  useEffect(() => {
    if (step3Data?.provider) {
      setMatchProvider(step3Data.provider);
      const total = step3Data.provider.totalTrials ?? matchResults.length;
      setMatchingProgress(matchResults.length, total);
    }
  }, [step3Data, matchResults.length, setMatchingProgress]);

  // Load matching results
  useEffect(() => {
    if (!paramsResolved || !patientRouteId) {
      return;
    }

    let isMounted = true;

    const loadMatchResults = async () => {
      if (!isMounted) return;
      setIsLoading(true);

      try {
        if (workflowMatchResults.length > 0) {
          if (currentRecord?._id) {
            const recordId = currentRecord._id.toString();
            setCurrentRecordId((prev) => (prev === recordId ? prev : recordId));
          }
          setLocalMatchResults(workflowMatchResults);
          setMatchResults(workflowMatchResults);
          return;
        }

        const patientRecords = await patientsApi.getPatientRecords(patientRouteId);
        if (!isMounted) return;

        if (patientRecords.length > 0) {
          const latest = patientRecords[0];
          if (latest?._id) {
            const latestId = latest._id.toString();
            setCurrentRecordId((prev) => (prev === latestId ? prev : latestId));
          }

          const structuredSource = (latest.llmIntegrationData?.fullStructuredData as Record<string, JsonValue> | undefined)
            || (latest.structuredData as Record<string, JsonValue> | undefined);

          if (structuredSource) {
            setStructuredRecord(structuredSource);
            setStepCompleted(1, true);
            setStepCompleted(2, true);
            setStep2Data({
              extractedText: (latest.extractedText as string) ?? '',
              llmResult: latest.llmIntegrationData
                ? {
                    integrateResponse: latest.llmIntegrationData as unknown as Record<string, JsonValue>,
                    extractResponse: null,
                  }
                : null,
              structuredRecord: structuredSource,
            });
          }

          setStep1Data({
            files: [],
            ocrResult: (latest.ocrMetadata as Record<string, JsonValue> | null) ?? null,
            fileName: (latest.originalFileName as string | undefined) ?? undefined,
            manualText: typeof latest.extractedText === 'string' ? latest.extractedText : undefined,
            uploadId: latest._id ? latest._id.toString() : undefined,
          });

          if (typeof latest.extractedText === 'string' && latest.extractedText.trim().length > 0) {
            setExtractedText(latest.extractedText);
          }

        const recordWithResults = latest as typeof latest & { matchResults?: LegacyTrialMatch[]; matchMetadata?: MatchProviderMetadata };
          if (recordWithResults.matchResults && Array.isArray(recordWithResults.matchResults)) {
            setLocalMatchResults(recordWithResults.matchResults);
            setMatchResults(recordWithResults.matchResults);
            if (recordWithResults.matchMetadata) {
              setMatchProvider(recordWithResults.matchMetadata);
              updateProgressFromMetadata(recordWithResults.matchMetadata);
            }
            return;
          }

          if (latest?._id) {
            const guardKey = `record:${latest._id.toString()}`;
            if (autoMatchGuardRef.current !== guardKey) {
              autoMatchGuardRef.current = guardKey;
              // Prefer resuming an existing streaming job (if any) to avoid cancelling work
              // started from the Extract step.
              await performTrialMatchingRef.current?.({ restart: false, silent: true });
            }
          }
          return;
        }

        if (structuredRecord) {
          const guardKey = `structured:${currentRecordId ?? 'none'}`;
          if (autoMatchGuardRef.current !== guardKey) {
            autoMatchGuardRef.current = guardKey;
            await performStructuredDataMatchingRef.current?.({ restart: true, silent: true });
          }
          return;
        }

        // No data available
        setLocalMatchResults([]);
        setMatchProvider(undefined);
        setHistory([]);
        setSelectedHistoryId(null);
        setHistoryDiff({ added: [], removed: [] });
        setCurrentRecordId(null);
      } catch (error: unknown) {
        logClientError('results.loadMatchResults', error, { patientRouteId, currentRecordId });
        const message = extractErrorMessage(error, '匹配结果加载失败');
        showToast.error(message);
        if (isMounted) {
          setLocalMatchResults([]);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadMatchResults();

    return () => {
      isMounted = false;
    };
  }, [
    paramsResolved,
    patientRouteId,
    currentPatient,
    currentRecordId,
    structuredRecord,
    workflowMatchResults,
    updateProgressFromMetadata,
    setMatchResults,
    setStructuredRecord,
    setStepCompleted,
    setStep1Data,
    setStep2Data,
    setExtractedText,
    currentRecord?._id,
  ]);

  useEffect(() => {
    const total = matchProvider?.totalTrials ?? matchResults.length;
    if (total > 0) {
      if (completedItems !== matchResults.length || totalItems !== total) {
        setMatchingProgress(matchResults.length, total);
      }
    }
  }, [matchResults.length, matchProvider?.totalTrials, completedItems, totalItems, setMatchingProgress]);

  const handleStepNavigation = (step: number) => {
    if (step === 1) {
      router.push(`/patients/${patientRouteId}/upload`);
    } else if (step === 2) {
      router.push(`/patients/${patientRouteId}/extract`);
    } else if (step === 3) {
      // Stay on current page
    }
  };

  const canNavigateToStep = (step: number) => {
    if (step === 1) return true;
    if (step === 2) return true;
    if (step === 3) return true; // Current step
    return false;
  };

  const handleRefreshResults = async () => {
    // 支持无记录情况下的匹配 / Support matching without a saved record
    if (!currentRecordId && !structuredRecord) {
      showToast.error('暂无可用于匹配的病历记录或结构化信息');
      return;
    }

    setIsLoading(true);
    try {
      // 如果有记录ID，使用记录匹配；否则使用结构化数据匹配 / If record ID exists, use record matching; otherwise use structured data matching
      if (currentRecordId) {
        await performTrialMatchingRef.current?.({ restart: true, silent: true });
      } else if (structuredRecord) {
        // 使用结构化数据进行匹配 / Use structured data for matching
        await performStructuredDataMatchingRef.current?.({ restart: true, silent: true });
      }
      showToast.success('匹配结果已刷新');
    } catch (error: unknown) {
      logClientError('results.handleRefreshResults', error, { currentRecordId });
      showToast.error('刷新失败，请稍后重试');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportResults = () => {
    if (matchResults.length === 0) {
      showToast.error('暂无可导出的匹配结果');
      return;
    }

    const exportData = {
      patient: currentPatient,
      matchResults: matchResults,
      provider: matchProvider,
      exportDate: new Date().toISOString(),
    };

    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });

    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `trial-matches-${currentPatient?.patientId || 'patient'}-${new Date().toISOString().split('T')[0]}.json`;
    link.click();

    URL.revokeObjectURL(url);
    showToast.success('匹配结果已导出');
  };

  const handleGenerateReport = async () => {
    if (!currentRecordId) {
      showToast.error('暂无可生成报告的病历记录');
      return;
    }

    setReportLoading(true);
    try {
      const report = await medicalApi.getMatchReport(currentRecordId);
      setMatchReport(report);
      setReportModalOpen(true);
    } catch (error) {
      showToast.error(extractErrorMessage(error, '生成匹配报告失败'));
    } finally {
      setReportLoading(false);
    }
  };

  const handleDownloadReport = () => {
    if (!matchReport) {
      showToast.error('暂无可下载的报告');
      return;
    }

    const dataStr = JSON.stringify(matchReport, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });

    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `match-report-${currentPatient?.patientId || 'patient'}-${new Date().toISOString().split('T')[0]}.json`;
    link.click();

    URL.revokeObjectURL(url);
    showToast.success('匹配报告已下载');
  };

  const getFilteredAndSortedResults = () => {
    let filtered = [...matchResults];

    // Filter by match score
    if (filterStatus !== 'all') {
      filtered = filtered.filter(match => {
        const score = match.match_score ?? 0;
        if (filterStatus === 'high') return score >= 80;
        if (filterStatus === 'medium') return score >= 60 && score < 80;
        if (filterStatus === 'low') return score < 60;
        return true;
      });
    }

    // Sort results
    filtered.sort((a, b) => {
      if (sortBy === 'match_score') {
        return (b.match_score ?? 0) - (a.match_score ?? 0);
      }
      if (sortBy === 'title') {
        return (a.trial_title || '').localeCompare(b.trial_title || '');
      }
      if (sortBy === 'phase') {
        const phaseA = (a.trial_metadata?.phase as string | undefined) || 'Z';
        const phaseB = (b.trial_metadata?.phase as string | undefined) || 'Z';
        return phaseA.localeCompare(phaseB);
      }
      return 0;
    });

    return filtered;
  };

  const filteredResults = getFilteredAndSortedResults();

  // 分页逻辑 / Pagination logic
  const totalPages = Math.ceil(filteredResults.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedResults = filteredResults.slice(startIndex, endIndex);

  // 重置当前页如果超出范围 / Reset current page if out of range
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  // 当筛选或排序改变时重置到第1页 / Reset to page 1 when filter or sort changes
  useEffect(() => {
    setCurrentPage(1);
  }, [filterStatus, sortBy]);

  const totalTrialsForProgress = matchProvider?.totalTrials ?? Math.max(matchResults.length, Number(matchProvider?.processedTrials || 0));
  const processedTrialsForProgress = matchProvider?.processedTrials ?? matchProvider?.matchedTrials ?? matchResults.length;
  const progressPercent = totalTrialsForProgress > 0 ? Math.min(100, Math.round((processedTrialsForProgress / totalTrialsForProgress) * 100)) : 0;
  const batchLabel = matchProvider?.totalBatches
    ? `批次 ${matchProvider.lastBatchNumber ?? matchProvider.completedBatches ?? latestBatch?.number ?? 0} / ${matchProvider.totalBatches}`
    : null;
  const isStreaming = Boolean(activeJobId);

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

  const hasAnyInput = Boolean(currentRecordId) || Boolean(structuredRecord) || Boolean(workflowMatchResults?.length) || Boolean(workflowExtractedText?.trim?.());
  if (!hasAnyInput && !isLoading && !thinking.isThinking) {
    return (
      <WorkflowEmptyState
        title="还没有匹配结果"
        message="请先完成信息提取（Extract），再开始匹配临床试验。"
        primaryAction={{ label: '去提取', href: `/patients/${patientRouteId}/extract` }}
        secondaryAction={{ label: '去上传', href: `/patients/${patientRouteId}/upload` }}
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
          currentStep={3}
          onStepClick={handleStepNavigation}
          canNavigateToStep={canNavigateToStep}
        />

        {thinking.isThinking && thinking.stage === 'matching' && (
          <Card className="mt-6">
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-blue-800">{thinking.message}</p>
                  <p className="text-xs text-blue-600 mt-1">
                    已匹配 {thinking.completedItems ?? 0} / {thinking.totalItems ?? '…'} 项临床试验
                  </p>
                </div>
                <div className="text-sm font-semibold text-blue-700">
                  {Math.round(thinking.progress)}%
                </div>
              </div>
              <div className="mt-3 w-full bg-blue-100 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${thinking.progress}%` }}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {(matchProvider?.totalBatches || isStreaming) ? (
          <Card className="mt-4">
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-800">匹配进度</p>
                  <p className="text-xs text-gray-500 mt-1">
                    已处理 {processedTrialsForProgress} / {totalTrialsForProgress} 项试验
                    {batchLabel ? ` (${batchLabel})` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-sm font-semibold text-blue-700">{progressPercent}%</span>
                  {isStreaming && (
                    <span className="block text-xs font-semibold text-blue-600 mt-1">
                      流式更新中…
                      {activeJobId ? ` ${activeJobId.substring(0, 8)}…` : ''}
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-3 w-full bg-blue-100 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Results Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-6 mt-8">
          <div className="flex items-center gap-4">
            <Search className="h-6 w-6 text-blue-600" />
            <div>
             <h2 className="text-2xl font-bold text-gray-900">临床试验匹配结果</h2>
              <p className="text-gray-600 flex items-center gap-2 flex-wrap">
                <span>基于提取的医疗信息</span>
                {isStreaming && (
                  <span className="inline-flex items-center px-2 py-0.5 text-xs font-semibold text-blue-700 bg-blue-100 rounded-full">
                    实时更新
                  </span>
                )}
              </p>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center rounded-xl border border-gray-200 bg-white/70 p-1 text-xs">
              <button
                type="button"
                onClick={() => setTrialViewMode('public')}
                className={`rounded-lg px-3 py-1.5 font-semibold transition-colors ${trialViewMode === 'public' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`}
              >
                公众版
              </button>
              <button
                type="button"
                onClick={() => setTrialViewMode('pro')}
                className={`rounded-lg px-3 py-1.5 font-semibold transition-colors ${trialViewMode === 'pro' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`}
              >
                专业版
              </button>
            </div>
            {(matchProvider?.hasMore || latestBatch?.hasMore) && !isStreaming && (
              <Button
                onClick={() => performTrialMatching({ restart: false })}
                variant="primary"
                size="sm"
                disabled={isBatchRunning}
                className="flex items-center space-x-2"
              >
                <ArrowRight className={`h-4 w-4 ${isBatchRunning ? 'animate-pulse' : ''}`} />
                <span>{isBatchRunning ? '处理中…' : '继续匹配'}</span>
              </Button>
            )}
            <Button
              onClick={handleRefreshResults}
              variant="outline"
              size="sm"
              disabled={isLoading || isBatchRunning}
              className="flex items-center space-x-2"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              <span>刷新</span>
            </Button>
            
            <Button
              onClick={handleGenerateReport}
              variant="outline"
              size="sm"
              disabled={reportLoading || !currentRecordId}
              className="flex items-center space-x-2"
            >
              <span>{reportLoading ? '生成中…' : '生成匹配报告'}</span>
            </Button>

            <Button
              onClick={handleExportResults}
              variant="outline"
              size="sm"
              disabled={matchResults.length === 0}
              className="flex items-center space-x-2"
            >
              <Download className="h-4 w-4" />
              <span>导出</span>
            </Button>
          </div>
        </div>

        <MatchDeltaBanner delta={matchDelta} onClear={() => setMatchDelta(null)} />

        <MissingConfirmBanner
          items={pendingConfirmationLabels}
          onConfirm={() => setMissingModalOpen(true)}
        />

        {missingItems.length > 0 && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>补全缺失信息（提高匹配准确度）</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4">
                <div className="text-sm text-gray-600">
                  当前匹配提示缺少 {missingItems.length} 项关键信息。系统会先按“满足/可用”展示匹配结果，但需要你逐项确认（可选：满足/不确定/不满足），以便后续人工二次核查。
                </div>

                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-gray-600">
                    已选择 <span className="font-medium text-gray-900">{selectedMissingItems.length}</span> 项
                  </span>
                  {providerDataQuality?.completionRate && (
                    <span className="text-gray-500">
                      · 数据完整率 {providerDataQuality.completionRate}%
                    </span>
                  )}
                  <div className="ml-auto flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setMissingSelectionAll(true)} disabled={isFixingMissing}>
                      全选
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setMissingSelectionAll(false)} disabled={isFixingMissing}>
                      清空
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setMissingSelectionBySource('required')} disabled={isFixingMissing}>
                      仅必填
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setMissingSelectionBySource('trial')} disabled={isFixingMissing}>
                      仅试验条件
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {missingItems.map((item) => {
                    const disabled = !item.fieldConfig && !item.manual;
                    const lookupKey = getItemKeyForLookup(item);
                    const currentValue = lookupKey ? getDottedValue(structuredRecord as JsonValue | undefined, lookupKey) : undefined;
                    const currentPreviewRaw = hasMeaningfulValue(currentValue) ? formatJsonValueForInput(currentValue) : '';
                    const currentPreview = currentPreviewRaw.length > 40 ? `${currentPreviewRaw.slice(0, 40)}…` : currentPreviewRaw;
                    return (
                      <label key={item.id} className={`flex items-center gap-2 rounded border px-3 py-2 ${disabled ? 'opacity-60' : ''}`}>
                        <input
                          type="checkbox"
                          checked={Boolean(missingSelection[item.id])}
                          onChange={(e) => setMissingSelection((prev) => ({ ...prev, [item.id]: e.target.checked }))}
                          disabled={disabled || isFixingMissing}
                        />
                        <span className="text-sm font-medium text-gray-800">
                          {item.label}
                          {currentPreview ? <span className="ml-2 text-xs font-normal text-gray-500">当前：{currentPreview}</span> : null}
                        </span>
                        <span className="ml-auto text-xs text-gray-500">
                          {item.source === 'required' ? '必填' : '试验条件'}
                          {!item.fieldConfig ? ' · 无自动抽取' : ''}
                        </span>
                      </label>
                    );
                  })}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => setMissingModalOpen(true)}
                    variant="outline"
                    size="sm"
                    disabled={isFixingMissing || selectedManualMissingItems.length === 0}
                  >
                    手动补录
                  </Button>
                  <Button
                    onClick={runAutoExtractionForMissing}
                    variant="primary"
                    size="sm"
                    disabled={isFixingMissing || selectedAutoMissingItems.length === 0}
                    className="flex items-center gap-2"
                  >
                    <RefreshCw className={`h-4 w-4 ${isFixingMissing ? 'animate-spin' : ''}`} />
                    <span>
                      {isFixingMissing ? '抽取中…' : `LLM 二次抽取并刷新匹配${selectedAutoMissingItems.length ? `（${selectedAutoMissingItems.length}项）` : ''}`}
                    </span>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Modal
          isOpen={missingModalOpen}
          onClose={() => setMissingModalOpen(false)}
          title="手动补录缺失信息"
          description="补录后将自动刷新匹配结果。"
          className="max-w-2xl"
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={prefillManualMissingValues} disabled={isFixingMissing || selectedManualMissingItems.length === 0}>
                自动填充（从当前结构化数据）
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setManualMissingValues({})}
                disabled={isFixingMissing}
              >
                清空输入
              </Button>
              <span className="ml-auto text-xs text-gray-500">
                已选可补录字段：{selectedManualMissingItems.length}
              </span>
            </div>

            {selectedManualMissingItems
              .map((item) => {
                const manual = item.manual!;
                const value = manualMissingValues[manual.key] ?? '';
                const label = item.label;

                if (manual.type === 'boolean') {
                  return (
                    <div key={item.id} className="space-y-1">
                      <div className="text-sm font-medium text-gray-800">{label}</div>
                      <select
                        value={value}
                        onChange={(e) => setManualMissingValues((prev) => ({ ...prev, [manual.key]: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={isFixingMissing}
                      >
                        <option value="">未填写</option>
                        <option value="true">是 / 有</option>
                        <option value="false">否 / 无</option>
                        <option value="null">不确定</option>
                      </select>
                    </div>
                  );
                }

                if (manual.type === 'array') {
                  return (
                    <div key={item.id} className="space-y-1">
                      <div className="text-sm font-medium text-gray-800">{label}</div>
                      <textarea
                        value={value}
                        onChange={(e) => setManualMissingValues((prev) => ({ ...prev, [manual.key]: e.target.value }))}
                        placeholder={manual.placeholder || '用逗号分隔'}
                        className="w-full min-h-[70px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={isFixingMissing}
                      />
                    </div>
                  );
                }

                return (
                  <div key={item.id} className="space-y-1">
                    <div className="text-sm font-medium text-gray-800">{label}</div>
                    <Input
                      value={value}
                      onChange={(e) => setManualMissingValues((prev) => ({ ...prev, [manual.key]: e.target.value }))}
                      placeholder={manual.placeholder}
                      disabled={isFixingMissing}
                      type={manual.type === 'number' ? 'number' : 'text'}
                    />
                  </div>
                );
              })}

            {selectedManualMissingItems.length === 0 && (
              <div className="text-sm text-gray-600">
                当前选择的字段不支持手动补录，请勾选上方列表中的“必填/试验条件”字段后再打开此窗口。
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setMissingModalOpen(false)} disabled={isFixingMissing}>
                取消
              </Button>
              <Button variant="primary" size="sm" onClick={saveManualMissing} disabled={isFixingMissing}>
                {isFixingMissing ? '保存中…' : '保存并刷新匹配'}
              </Button>
            </div>
          </div>
        </Modal>

        <Modal
          isOpen={reportModalOpen}
          onClose={() => setReportModalOpen(false)}
          title="匹配报告（MVP）"
          description="用于导出/分享的结构化报告（JSON）。"
          className="max-w-3xl"
        >
          <div className="space-y-4">
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setReportModalOpen(false)}>
                关闭
              </Button>
              <Button variant="primary" size="sm" onClick={handleDownloadReport} disabled={!matchReport}>
                下载报告
              </Button>
            </div>
            {matchReport ? (
              <MatchReportView report={matchReport as Record<string, unknown>} />
            ) : (
              <div className="text-sm text-gray-600">暂无报告内容</div>
            )}
          </div>
        </Modal>

        {/* Filters and Controls */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">排序方式</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'match_score' | 'title' | 'phase')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="match_score">匹配度（高到低）</option>
              <option value="title">试验标题（A-Z）</option>
              <option value="phase">分期（早到晚）</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">匹配度筛选</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as 'all' | 'high' | 'medium' | 'low')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">全部</option>
              <option value="high">高匹配（≥80%）</option>
              <option value="medium">中匹配（60-79%）</option>
              <option value="low">低匹配（＜60%）</option>
            </select>
          </div>
          
          <div className="flex items-end">
            <div className="w-full space-y-2">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={onlyRecruitingActive}
                  onChange={(e) => setOnlyRecruitingActive(e.target.checked)}
                  disabled={isBatchRunning || isLoading}
                />
                仅招募中/进行中（切换后点“刷新”生效）
              </label>
              <div className="text-sm text-gray-600">
                已处理 {processedTrialsForProgress} / {totalTrialsForProgress} 项试验
                {batchLabel && (
                  <div className="text-xs text-gray-500">{batchLabel}</div>
                )}
                <div className="text-xs text-gray-500">
                  剩余：{Math.max(totalTrialsForProgress - processedTrialsForProgress, 0)}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Trial Results */}
          <div className="lg:col-span-3 space-y-6">
            {isLoading ? (
              <Card>
                <CardContent className="py-12">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-gray-500">正在加载匹配结果...</p>
                  </div>
                </CardContent>
              </Card>
            ) : filteredResults.length === 0 ? (
              <Card>
                <CardContent className="py-12">
                  <div className="text-center">
                    <Search className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">未找到匹配试验</h3>
                    <p className="text-gray-500 mb-4">
                      {matchResults.length === 0 
                        ? "暂无符合该患者病情特征的临床试验。"
                        : "当前筛选条件下暂无匹配试验。"
                      }
                    </p>
                    {matchResults.length > 0 && (
                      <Button
                        onClick={() => setFilterStatus('all')}
                        variant="primary"
                        size="sm"
                      >
                        清除筛选
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                {paginatedResults.map((match, index) => (
                  <TrialCard
                    key={`${match.trial_id || match.trial_title}-${index}`}
                    match={match}
                    mode={trialViewMode}
                    pendingConfirmations={(() => {
                      const checks = [
                        ...(Array.isArray(match.inclusion_checks) ? match.inclusion_checks : []),
                        ...(Array.isArray(match.exclusion_checks) ? match.exclusion_checks : []),
                      ];
                      const pending = checks
                        .filter((c) => c && (c.result === '不确定' || c.patient_value === '未提供'))
                        .map((c) => c.criterion)
                        .filter((v) => typeof v === 'string' && v.trim().length > 0)
                        .slice(0, 8);
                      // If model didn't produce check-level unknowns, fallback to global missing list.
                      return pending.length > 0 ? pending : (trialViewMode === 'public' ? pendingConfirmationLabels : []);
                    })()}
                    onOpenConfirm={() => setMissingModalOpen(true)}
                    showMatchScore={true}
                    onContact={(trial) => {
                      // Handle contact action
                      showToast.success(`已复制“${trial.trialTitle}”的联系方式`);
                    }}
                  />
                ))}

                {/* 分页控件 / Pagination controls */}
                {totalPages > 1 && (
                  <div className="mt-8 flex flex-col gap-3 border-t border-gray-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm text-gray-600">
                      显示 {startIndex + 1}-{Math.min(endIndex, filteredResults.length)} / {filteredResults.length}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                        variant="outline"
                        size="sm"
                      >
                        <ArrowLeft className="h-4 w-4 mr-1" />
                        上一页
                      </Button>
                      <div className="flex flex-wrap items-center gap-1">
                        {Array.from({ length: totalPages }, (_, i) => i + 1)
                          .filter(page => {
                            // 显示前3页，后3页，以及当前页附近的页码
                            // Show first 3 pages, last 3 pages, and pages near current page
                            return page <= 3 || page > totalPages - 3 || Math.abs(page - currentPage) <= 1;
                          })
                          .map((page, idx, arr) => {
                            // 添加省略号
                            const prevPage = arr[idx - 1];
                            const showEllipsis = prevPage && page - prevPage > 1;

                            return (
                              <React.Fragment key={page}>
                                {showEllipsis && (
                                  <span className="px-2 text-gray-400">...</span>
                                )}
                                <Button
                                  onClick={() => setCurrentPage(page)}
                                  variant={currentPage === page ? 'default' : 'outline'}
                                  size="sm"
                                  className="min-w-[2.5rem]"
                                >
                                  {page}
                                </Button>
                              </React.Fragment>
                            );
                          })}
                      </div>
                      <Button
                        onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                        disabled={currentPage === totalPages}
                        variant="outline"
                        size="sm"
                      >
                        下一页
                        <ArrowRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Summary Card */}
        {!isLoading && matchResults.length > 0 && (
          <div className="mt-8">
            <Card>
              <CardHeader>
                <CardTitle>摘要</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {matchResults.filter(m => (m.match_score ?? 0) >= 80).length}
                    </div>
                    <div className="text-sm text-gray-500">高匹配试验（≥80%）</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-yellow-600">
                      {matchResults.filter(m => (m.match_score ?? 0) >= 60 && (m.match_score ?? 0) < 80).length}
                    </div>
                    <div className="text-sm text-gray-500">中匹配试验（60-79%）</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">
                      {matchResults.length}
                    </div>
                    <div className="text-sm text-gray-500">匹配试验总数</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-indigo-600">
                      {matchProvider?.totalTrials ?? '—'}
                    </div>
                    <div className="text-sm text-gray-500">已评估试验</div>
                    {matchProvider?.totalTrials !== undefined && (
                      <div className="text-xs text-gray-400 mt-1">
                        剩余：{Math.max((matchProvider.totalTrials ?? 0) - processedTrialsForProgress, 0)}
                      </div>
                    )}
                  </div>
                </div>

                {matchProvider && (
                  <div className="mt-6 pt-6 border-t border-gray-200">
                    <div className="text-sm text-gray-500 space-y-1">
                      {typeof matchProvider.totalTrials === 'number' && (
                        <div>评估试验总数：{matchProvider.totalTrials}</div>
                      )}
                      {typeof matchProvider.matchedTrials === 'number' && (
                        <div>已匹配试验：{matchProvider.matchedTrials}</div>
                      )}
                      {typeof matchProvider.totalTrials === 'number' && (
                        <div>剩余：{Math.max((matchProvider.totalTrials ?? 0) - processedTrialsForProgress, 0)}</div>
                      )}
                      {typeof matchProvider.processedTrials === 'number' && (
                        <div>已处理试验：{matchProvider.processedTrials}</div>
                      )}
                      {typeof matchProvider.batchSize === 'number' && matchProvider.totalBatches && (
                        <div>批次：{(matchProvider.completedBatches ?? matchProvider.lastBatchNumber ?? 0)} / {matchProvider.totalBatches}（每批 {matchProvider.batchSize} 条）</div>
                      )}
                      {matchProvider.processingTime !== undefined && (
                        <div>处理耗时：{typeof matchProvider.processingTime === 'number' ? matchProvider.processingTime : String(matchProvider.processingTime)}ms</div>
                      )}
                      {matchProvider.algorithmVersion && (
                        <div>算法版本：{matchProvider.algorithmVersion}</div>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {currentRecordId && (
          <Card className="mt-8">
            <CardHeader>
              <CardTitle>匹配历史</CardTitle>
            </CardHeader>
            <CardContent>
              {historyLoading ? (
                <div className="flex items-center space-x-3 text-blue-600">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                  <span className="text-sm">正在加载历史...</span>
                </div>
              ) : historyError ? (
                <p className="text-sm text-red-600">{historyError}</p>
              ) : history.length === 0 ? (
                <p className="text-sm text-gray-500">暂无历史匹配记录。</p>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>
                      已加载 {history.length}{historyTotal ? ` / ${historyTotal}` : ''} 次
                    </span>
                    {historyNextCursor && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={historyLoadingMore}
                        onClick={() => currentRecordId && loadMatchHistory(currentRecordId, { reset: false })}
                      >
                        {historyLoadingMore ? '加载中…' : '加载更多'}
                      </Button>
                    )}
                  </div>
                  {history.map((entry) => {
                    const providerMeta = (entry.metadata || {}) as MatchProviderMetadata & { matchedAt?: string; restoredFrom?: string };
                    const matchedTrials = providerMeta.matchedTrials ?? entry.matches.length;
                    const totalTrials = providerMeta.totalTrials ?? undefined;
                    const statusScope = formatStatusScope((providerMeta as unknown as { matchFilters?: MatchFilters })?.matchFilters?.statuses);
                    return (
                      <div key={entry._id} className="border border-gray-200 rounded-lg p-4 space-y-3">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-gray-800">{formatTimestamp(entry.createdAt)}</p>
                            <p className="text-xs text-gray-500">
                              匹配结果：{matchedTrials}{totalTrials !== undefined ? ` / ${totalTrials}` : ''}
                            </p>
                            {providerMeta.provider && (
                              <p className="text-xs text-gray-500">提供方：{providerMeta.provider}</p>
                            )}
                            {statusScope && (
                              <p className="text-xs text-gray-500">状态筛选：{statusScope}</p>
                            )}
                            {providerMeta.matchedAt && (
                              <p className="text-xs text-gray-400">匹配时间：{formatTimestamp(providerMeta.matchedAt)}</p>
                            )}
                            {providerMeta.restoredFrom && (
                              <p className="text-xs text-amber-600">从记录 {providerMeta.restoredFrom} 恢复</p>
                            )}
                          </div>
                          <div className="flex items-center space-x-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleSelectHistory(entry)}
                            >
                              {selectedHistoryId === entry._id ? '收起差异' : '查看差异'}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={restoringHistoryId === entry._id}
                              onClick={() => handleRestoreHistory(entry._id)}
                            >
                              {restoringHistoryId === entry._id ? '恢复中...' : '恢复'}
                            </Button>
                          </div>
                        </div>
                        {selectedHistoryId === entry._id && (
                          <div className="mt-3 bg-gray-50 border border-gray-200 rounded-md p-3 space-y-3">
                            <div>
                              <h4 className="text-sm font-semibold text-green-600">新增试验</h4>
                              {historyDiff.added.length > 0 ? (
                                <ul className="mt-1 space-y-1">
                                  {historyDiff.added.map((item) => (
                                    <li key={item.trial_id} className="text-sm text-green-700">
                                      + {item.trial_title || item.trial_id}（{item.match_score ?? '—'}%）
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-xs text-gray-500">与当前结果相比无新增试验。</p>
                              )}
                            </div>
                            <div>
                              <h4 className="text-sm font-semibold text-red-600">移除试验</h4>
                              {historyDiff.removed.length > 0 ? (
                                <ul className="mt-1 space-y-1">
                                  {historyDiff.removed.map((item) => (
                                    <li key={item.trial_id} className="text-sm text-red-700">
                                      – {item.trial_title || item.trial_id}（{item.match_score ?? '—'}%）
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-xs text-gray-500">与当前结果相比无移除试验。</p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Navigation */}
        <div className="mt-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <button
            type="button"
            onClick={() => router.push(`/patients/${patientRouteId}/extract`)}
            className="text-sm text-blue-600 hover:text-blue-700 transition-colors flex items-center space-x-2"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>返回信息提取</span>
          </button>
          
          <Button
            onClick={() => router.push('/')}
            variant="primary"
            className="flex items-center space-x-2 shadow-md hover:shadow-lg transition-shadow"
          >
            <span>完成并返回首页</span>
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
