'use client';

import React from 'react';
import {
  MapPin,
  Building,
  Phone,
  Mail,
  ExternalLink,
  Star,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  XCircle
} from 'lucide-react';
import { ClinicalTrial, LegacyTrialMatch } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export type TrialCardMode = 'public' | 'pro';

interface TrialCardProps {
  match: LegacyTrialMatch;
  showMatchScore?: boolean;
  mode?: TrialCardMode;
  pendingConfirmations?: string[];
  onOpenConfirm?: () => void;
  onContact?: (trial: Partial<ClinicalTrial> & { trialId?: string; trialTitle?: string }) => void;
}

const getMatchScoreColor = (score: number) => {
  if (score >= 80) return 'text-green-600 bg-green-100';
  if (score >= 60) return 'text-yellow-600 bg-yellow-100';
  return 'text-red-600 bg-red-100';
};

const getStatusChip = (status?: ClinicalTrial['status']) => {
  if (!status) return null;
  const map: Record<NonNullable<ClinicalTrial['status']>, string> = {
    recruiting: 'bg-green-100 text-green-800',
    active: 'bg-blue-100 text-blue-800',
    completed: 'bg-gray-100 text-gray-800',
    suspended: 'bg-red-100 text-red-800'
  };
  const labels: Record<NonNullable<ClinicalTrial['status']>, string> = {
    recruiting: '招募中',
    active: '进行中',
    completed: '已完成',
    suspended: '已暂停'
  };
  const classes = map[status] || 'bg-gray-100 text-gray-800';
  const text = labels[status] ?? status;
  return <span className={`px-2 py-1 rounded-full text-xs font-medium ${classes}`}>{text}</span>;
};

const resultConfigMap = {
  满足: {
    color: 'bg-green-50 border border-green-200 text-green-800',
    icon: <CheckCircle2 className="h-4 w-4 text-green-500" aria-hidden />,
    label: '满足'
  },
  不满足: {
    color: 'bg-red-50 border border-red-200 text-red-800',
    icon: <XCircle className="h-4 w-4 text-red-500" aria-hidden />,
    label: '不满足'
  },
  可能不满足: {
    color: 'bg-orange-50 border border-orange-200 text-orange-800',
    icon: <AlertCircle className="h-4 w-4 text-orange-500" aria-hidden />,
    label: '可能不满足'
  },
  不确定: {
    color: 'bg-yellow-50 border border-yellow-200 text-yellow-800',
    icon: <HelpCircle className="h-4 w-4 text-yellow-500" aria-hidden />,
    label: '不确定'
  }
} as const;

export function TrialCard({ match, showMatchScore = false, mode = 'public', pendingConfirmations = [], onOpenConfirm, onContact }: TrialCardProps) {
  const trialMeta = (match.trial_metadata || {}) as Partial<ClinicalTrial> & Record<string, unknown>;
  const trialTitle = match.trial_title || (trialMeta.title as string) || match.trial_id || '临床试验';
  const trialId = match.trial_id || (trialMeta.trialId as string) || (trialMeta._id as string) || undefined;
  const contactInfo = trialMeta.contactInfo as ClinicalTrial['contactInfo'] | undefined;
  const location = trialMeta.location as string | undefined;
  const phase = trialMeta.phase as string | undefined;
  const condition = trialMeta.condition as string | undefined;
  const sponsor = trialMeta.sponsor as string | undefined;
  const status = trialMeta.status as ClinicalTrial['status'] | undefined;
  const estimatedEnrollment = trialMeta.estimatedEnrollment as number | undefined;
  const ageRange = trialMeta.ageRange as ClinicalTrial['ageRange'] | undefined;
  const targetMutations = Array.isArray(trialMeta.targetMutations) ? (trialMeta.targetMutations as string[]) : [];
  const structuredEligibility = trialMeta.structuredEligibility as
    | {
        inclusion?: Array<Record<string, unknown>>;
        exclusion?: Array<Record<string, unknown>>;
      }
    | undefined;
  const structuredInclusionList = Array.isArray(structuredEligibility?.inclusion)
    ? structuredEligibility.inclusion
        .map((item) => {
          if (typeof item?.criterion === 'string') return item.criterion;
          if (typeof item?.label === 'string') return item.label;
          if (typeof item?.description === 'string') return item.description;
          return undefined;
        })
        .filter((text) => typeof text === 'string' && text.trim().length > 0) as string[]
    : [];
  const structuredExclusionList = Array.isArray(structuredEligibility?.exclusion)
    ? structuredEligibility.exclusion
        .map((item) => {
          if (typeof item?.criterion === 'string') return item.criterion;
          if (typeof item?.label === 'string') return item.label;
          if (typeof item?.description === 'string') return item.description;
          return undefined;
        })
        .filter((text) => typeof text === 'string' && text.trim().length > 0) as string[]
    : [];
  const inclusionList = Array.isArray(trialMeta.inclusionCriteria) && trialMeta.inclusionCriteria.length > 0
    ? (trialMeta.inclusionCriteria as string[])
    : structuredInclusionList;
  const exclusionList = Array.isArray(trialMeta.exclusionCriteria) && trialMeta.exclusionCriteria.length > 0
    ? (trialMeta.exclusionCriteria as string[])
    : structuredExclusionList;
  const inclusionChecks = Array.isArray(match.inclusion_checks) ? match.inclusion_checks : [];
  const exclusionChecks = Array.isArray(match.exclusion_checks) ? match.exclusion_checks : [];
  const summary = match.summary || { inclusion_met: [], exclusion_triggered: [], uncertain: [] };
  const matchScore = match.match_score ?? 0;
  const rankReason = match.rank_reason;

  const handleContact = () => {
    if (onContact) {
      onContact({ ...trialMeta, trialId, trialTitle });
      return;
    }
    if (contactInfo?.email) {
      window.location.href = `mailto:${contactInfo.email}?subject=${encodeURIComponent(`关于“${trialTitle}”的咨询`)}`;
    } else if (contactInfo?.phone) {
      window.location.href = `tel:${contactInfo.phone}`;
    }
  };

  const renderChecks = (title: string, checks: typeof inclusionChecks) => (
    <div>
      <h4 className="text-sm font-medium text-gray-700 mb-2">{title}</h4>
      <div className="space-y-2">
        {checks.map((check, index) => {
          const config = resultConfigMap[check.result] || resultConfigMap['不确定'];
          return (
            <div key={index} className={`rounded-md px-3 py-2 text-sm flex items-start space-x-2 ${config.color}`}>
              <span className="mt-0.5">{config.icon}</span>
              <div className="space-y-1">
                <div className="font-medium">{check.criterion}</div>
                <div className="text-xs text-gray-600">
                  患者数据：<span className="font-medium text-gray-800">{check.patient_value}</span>
                </div>
                <div className="text-xs font-semibold uppercase tracking-wide">{config.label}</div>
              </div>
            </div>
          );
        })}
        {checks.length === 0 && <p className="text-xs text-gray-400">暂无数据</p>}
      </div>
    </div>
  );

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-lg mb-2 pr-4">{trialTitle}</CardTitle>
            <div className="flex items-center flex-wrap gap-2 text-sm text-gray-600">
              {phase && (
                <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                  分期 {phase}
                </span>
              )}
              {getStatusChip(status)}
              {trialId && <span className="text-xs text-gray-400">编号：{trialId}</span>}
            </div>
          </div>

          {showMatchScore && (
            <div className={`px-3 py-2 rounded-lg text-center ${getMatchScoreColor(matchScore)}`}>
              <div className="flex items-center space-x-1">
                <Star className="h-4 w-4" />
                <span className="font-bold text-lg">{matchScore}%</span>
              </div>
              <div className="text-xs font-medium">匹配度</div>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Public mode: compact & patient-friendly */}
        {mode === 'public' && (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">满足条件</p>
                <div className="flex flex-wrap gap-2">
                  {summary.inclusion_met.length > 0 ? (
                    summary.inclusion_met.slice(0, 6).map((item, idx) => (
                      <span key={idx} className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs">
                        {item}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-gray-400">暂无</span>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">触发排除</p>
                <div className="flex flex-wrap gap-2">
                  {summary.exclusion_triggered.length > 0 ? (
                    summary.exclusion_triggered.slice(0, 6).map((item, idx) => (
                      <span key={idx} className="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs">
                        {item}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-gray-400">无</span>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">待确认</p>
                <div className="flex flex-wrap gap-2">
                  {summary.uncertain.length > 0 ? (
                    summary.uncertain.slice(0, 6).map((item, idx) => (
                      <span key={idx} className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs">
                        {item}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-gray-400">无</span>
                  )}
                </div>
              </div>
            </div>

            {rankReason && (
              <div className="rounded-md bg-blue-50 border border-blue-100 p-3 text-sm text-blue-800">
                <p className="font-medium mb-1">为什么推荐</p>
                <p>{rankReason}</p>
              </div>
            )}

            {pendingConfirmations.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-semibold mb-1">需要你确认（系统暂按满足展示）</p>
                <div className="flex flex-wrap gap-2">
                  {pendingConfirmations.slice(0, 6).map((label) => (
                    <span key={label} className="px-2 py-0.5 rounded-full bg-white border border-amber-200 text-xs text-amber-800">
                      {label}
                    </span>
                  ))}
                  {pendingConfirmations.length > 6 ? (
                    <span className="text-xs text-amber-700">+ {pendingConfirmations.length - 6} 项</span>
                  ) : null}
                </div>
                {onOpenConfirm ? (
                  <div className="mt-2">
                    <Button variant="outline" size="sm" onClick={onOpenConfirm}>
                      去确认/补齐
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </>
        )}

        {/* Pro mode: details */}
        {mode === 'pro' && (
          <>
            <div className="space-y-2">
              {condition && (
                <div className="flex items-center space-x-2 text-sm">
                  <span className="text-gray-500">适应症：</span>
                  <span className="font-medium">{condition}</span>
                </div>
              )}

          {sponsor && (
            <div className="flex items-center space-x-2 text-sm">
              <Building className="h-4 w-4 text-gray-400" />
              <span className="text-gray-500">申办方：</span>
              <span>{sponsor}</span>
            </div>
          )}

          {location && (
            <div className="flex items-center space-x-2 text-sm">
              <MapPin className="h-4 w-4 text-gray-400" />
              <span className="text-gray-500">地点：</span>
              <span>{location}</span>
            </div>
          )}

          {typeof estimatedEnrollment === 'number' && (
            <div className="flex items-center space-x-2 text-sm">
              <span className="text-gray-500">计划入组：</span>
              <span>{estimatedEnrollment} 人</span>
            </div>
          )}
        </div>

        {ageRange && (
          <div className="flex items-center space-x-2 text-sm">
            <span className="text-gray-500">年龄范围：</span>
            <span>
              {ageRange.min} - {ageRange.max} 岁
            </span>
          </div>
        )}

        {inclusionList.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">关键入组条件</h4>
            <ul className="text-sm text-gray-600 space-y-1">
              {inclusionList.slice(0, 3).map((criteria, index) => (
                <li key={index} className="flex items-start space-x-2">
                  <span className="text-green-500 mt-1">•</span>
                  <span>{criteria}</span>
                </li>
              ))}
              {inclusionList.length > 3 && (
                <li className="text-xs text-gray-500 italic">
                  + 还有 {inclusionList.length - 3} 条
                </li>
              )}
            </ul>
          </div>
        )}

        {exclusionList.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">常见排除条件</h4>
            <ul className="text-sm text-gray-600 space-y-1">
              {exclusionList.slice(0, 3).map((criteria, index) => (
                <li key={index} className="flex items-start space-x-2">
                  <span className="text-red-500 mt-1">•</span>
                  <span>{criteria}</span>
                </li>
              ))}
              {exclusionList.length > 3 && (
                <li className="text-xs text-gray-500 italic">
                  + 还有 {exclusionList.length - 3} 条
                </li>
              )}
            </ul>
          </div>
        )}

        {targetMutations.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">靶向生物标志物</h4>
            <div className="flex flex-wrap gap-2">
              {targetMutations.map((mutation, index) => (
                <span key={index} className="px-2 py-1 bg-purple-100 text-purple-800 rounded-full text-xs font-medium">
                  {mutation}
                </span>
              ))}
            </div>
          </div>
        )}

        {(inclusionChecks.length > 0 || exclusionChecks.length > 0) && (
          <div className="grid gap-4 md:grid-cols-2">
            {inclusionChecks.length > 0 && renderChecks('入组条件核对', inclusionChecks)}
            {exclusionChecks.length > 0 && renderChecks('排除条件核对', exclusionChecks)}
          </div>
        )}

        {contactInfo && (contactInfo.email || contactInfo.phone) && (
          <div className="pt-4 border-t">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                {contactInfo.name && (
                  <p className="text-sm font-medium text-gray-700">{contactInfo.name}</p>
                )}
                <div className="flex items-center space-x-4 text-sm text-gray-600">
                  {contactInfo.email && (
                    <div className="flex items-center space-x-1">
                      <Mail className="h-3 w-3" />
                      <span>{contactInfo.email}</span>
                    </div>
                  )}
                  {contactInfo.phone && (
                    <div className="flex items-center space-x-1">
                      <Phone className="h-3 w-3" />
                      <span>{contactInfo.phone}</span>
                    </div>
                  )}
                </div>
              </div>

              <Button onClick={handleContact} variant="primary" size="sm" className="flex items-center space-x-1">
                <span>联系</span>
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
