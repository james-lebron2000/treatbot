'use client';

import React from 'react';
import { ClinicalArchive } from '@/types';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

interface ClinicalArchiveViewProps {
  archive: ClinicalArchive;
}

const InfoRow = ({ label, value }: { label: string; value?: React.ReactNode }) => (
  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1">
    <span className="text-sm text-gray-500">{label}</span>
    <span className="text-sm font-medium text-gray-900 text-right break-words max-w-full">
      {value && value !== '' ? value : <span className="text-gray-400">—</span>}
    </span>
  </div>
);

const joinArray = (values?: Array<string | number>) => (values && values.length ? values.join('，') : undefined);

const therapyTypeLabel = (value?: string) => {
  const map: Record<string, string> = {
    surgery: '手术',
    chemo: '化疗',
    immunotherapy: '免疫治疗',
    targeted: '靶向治疗',
    radiotherapy: '放疗',
    TKI: 'TKI',
    other: '其他',
  };
  return value ? (map[value] ?? value) : undefined;
};

export function ClinicalArchiveView({ archive }: ClinicalArchiveViewProps) {
  const { basic_info, medical_history, treatment_history, lab_results, pathology, current_status, trial_eligibility } = archive;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>基本信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <InfoRow label="姓名" value={basic_info.name} />
          <InfoRow label="性别" value={basic_info.gender || undefined} />
          <InfoRow label="年龄" value={basic_info.age != null ? `${basic_info.age}` : undefined} />
          <InfoRow label="科室" value={basic_info.department} />
          <InfoRow label="就诊日期" value={basic_info.visit_date} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>病史</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <InfoRow label="主要诊断" value={medical_history.primary_diagnosis} />
          <InfoRow label="发病日期" value={medical_history.onset_date} />
          <InfoRow label="合并症" value={joinArray(medical_history.comorbidities)} />
          <InfoRow label="转移部位" value={joinArray(medical_history.metastasis_sites)} />
          <InfoRow label="HBV 状态" value={medical_history.infection_status?.HBV} />
        </CardContent>
      </Card>

      {treatment_history?.length ? (
        <Card>
          <CardHeader>
            <CardTitle>近期治疗</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {treatment_history.slice(0, 3).map((item, index) => (
              <div key={`${item.therapy_type}-${index}`} className="rounded-md border p-3 bg-gray-50">
                <InfoRow label="日期" value={item.date} />
                <InfoRow label="治疗类型" value={therapyTypeLabel(item.therapy_type)} />
                <InfoRow label="方案/操作" value={item.drug_or_procedure} />
                <InfoRow label="疗效评估" value={item.response_evaluation} />
                <InfoRow label="不良反应" value={item.side_effects} />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>检验摘要</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <InfoRow label="检验日期" value={lab_results.date} />
          <InfoRow label="白细胞（WBC）" value={lab_results.blood_counts?.WBC} />
          <InfoRow label="血小板" value={lab_results.blood_counts?.Platelets} />
          <InfoRow label="ALT" value={lab_results.liver_function?.ALT} />
          <InfoRow label="AFP" value={lab_results.tumor_markers?.AFP} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>病理与状态</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <InfoRow label="组织学" value={pathology.histology} />
          <InfoRow label="分期" value={pathology.stage} />
          <InfoRow label="PD-L1" value={pathology.molecular_markers?.['PD-L1']} />
          <InfoRow label="ECOG" value={archive.ecog_score || undefined} />
          <InfoRow label="症状" value={joinArray(current_status.symptoms)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>入组条件摘要</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <InfoRow label="满足条件" value={joinArray(trial_eligibility.inclusion_met)} />
          <InfoRow label="触发排除" value={joinArray(trial_eligibility.exclusion_triggered)} />
          <InfoRow label="总体判断" value={trial_eligibility.overall_judgment} />
        </CardContent>
      </Card>
    </div>
  );
}

export default ClinicalArchiveView;
