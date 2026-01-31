'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

type AnyObject = Record<string, unknown>;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function get(obj: UnknownRecord | null | undefined, path: string, fallback: unknown = null): unknown {
  if (!obj) return fallback;
  const parts = path.split('.').filter(Boolean);
  let cur: unknown = obj;
  
  // eslint-disable-next-line no-restricted-syntax
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return fallback;
    cur = (cur as UnknownRecord)[p];
  }
  return cur ?? fallback;
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v)).filter((v) => v.trim().length > 0);
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

export function MatchReportView({ report }: { report: AnyObject }) {
  const generatedAt = asString(report?.generatedAt);
  const patientSummary = asRecord(report?.patientSummary) || {};
  const matchingSummary = asRecord(report?.matchingSummary) || {};
  const trials = Array.isArray(report?.recommendedTrials) ? report.recommendedTrials : [];

  const missingChecklistValue = (matchingSummary as UnknownRecord)?.missingChecklist ?? get(matchingSummary, 'provider.missingChecklist', null);
  const missingChecklist = (missingChecklistValue && typeof missingChecklistValue === 'object') ? (missingChecklistValue as UnknownRecord) : null;
  const missingRequired = list(missingChecklist?.requiredFields);
  const missingIntents = list(missingChecklist?.trialIntents);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>报告概览</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-2 text-sm text-gray-700 sm:grid-cols-2">
            <div>
              <span className="text-gray-500">生成时间：</span>
              <span className="font-medium">{generatedAt ? new Date(generatedAt).toLocaleString() : '—'}</span>
            </div>
            <div>
              <span className="text-gray-500">病历ID：</span>
              <span className="font-mono text-xs">{String(patientSummary?.recordId || '—')}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>病历摘要（结构化）</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 text-sm text-gray-700 sm:grid-cols-2">
            <div>
              <div className="text-gray-500">上传时间</div>
              <div className="font-medium">{asString(patientSummary?.uploadedAt) ? new Date(asString(patientSummary.uploadedAt)).toLocaleString() : '—'}</div>
            </div>
            <div>
              <div className="text-gray-500">文件名</div>
              <div className="font-medium">{String(patientSummary?.originalFileName || '—')}</div>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-xs font-semibold text-gray-600">结构化数据预览</div>
            <pre className="mt-2 max-h-[260px] overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-800">
              {JSON.stringify(patientSummary?.structuredData || {}, null, 2)}
            </pre>
          </div>
        </CardContent>
      </Card>

      {(missingRequired.length > 0 || missingIntents.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>趋势向补齐（缺什么补什么）</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-gray-700">
              <div className="font-medium">建议优先补齐以下信息，提高匹配准确度：</div>
              {missingRequired.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-semibold text-gray-600">基础必填字段</div>
                  <ul className="mt-1 list-disc pl-5 text-sm">
                    {missingRequired.slice(0, 12).map((item) => (
                      <li key={`req-${item}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {missingIntents.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-semibold text-gray-600">与试验纳排相关的关键点</div>
                  <ul className="mt-1 list-disc pl-5 text-sm">
                    {missingIntents.slice(0, 12).map((item) => (
                      <li key={`intent-${item}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>推荐临床试验（按匹配度排序）</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {trials.length === 0 ? (
              <div className="text-sm text-gray-600">暂无推荐试验，请先完成匹配流程。</div>
            ) : (
              trials.map((trial: AnyObject) => {
                const trialRecord = asRecord(trial) || {};
                const explanation = asRecord(trialRecord.explanation) || {};
                const inclusion = list(explanation.inclusion_met);
                const exclusion = list(explanation.exclusion_triggered);
                const uncertain = list(explanation.uncertain);

                const trialMeta = asRecord(trialRecord.trial_metadata) || {};

                return (
                  <div key={String(trialRecord.trial_id || trialRecord.trial_title)} className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-base font-semibold text-gray-900">{asString(trialRecord.trial_title) || asString(trialRecord.trial_id) || '未命名试验'}</div>
                        <div className="mt-1 text-xs text-gray-500">
                          {asString(trialMeta.phase) ? `分期：${asString(trialMeta.phase)}` : ''}
                          {asString(trialMeta.location) ? ` · 地点：${asString(trialMeta.location)}` : ''}
                          {asString(trialMeta.status) ? ` · 状态：${asString(trialMeta.status)}` : ''}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-gray-500">匹配度</div>
                        <div className="text-2xl font-bold text-blue-700">{Number(trialRecord.match_score ?? 0)}</div>
                      </div>
                    </div>

                    {(inclusion.length || exclusion.length || uncertain.length) ? (
                      <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                        <div>
                          <div className="text-xs font-semibold text-green-700">满足</div>
                          <ul className="mt-1 list-disc pl-5 text-xs text-gray-700">
                            {inclusion.slice(0, 5).map((x) => <li key={`in-${x}`}>{x}</li>)}
                          </ul>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-red-700">不满足/风险</div>
                          <ul className="mt-1 list-disc pl-5 text-xs text-gray-700">
                            {exclusion.slice(0, 5).map((x) => <li key={`ex-${x}`}>{x}</li>)}
                          </ul>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-amber-700">待确认</div>
                          <ul className="mt-1 list-disc pl-5 text-xs text-gray-700">
                            {uncertain.slice(0, 5).map((x) => <li key={`un-${x}`}>{x}</li>)}
                          </ul>
                        </div>
                      </div>
                    ) : null}

                    {trial?.rank_reason ? (
                      <div className="mt-3 text-xs text-gray-600">
                        <span className="font-semibold">说明：</span> {String(trial.rank_reason)}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
