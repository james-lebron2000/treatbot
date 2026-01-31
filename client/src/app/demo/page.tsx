'use client';

import Link from 'next/link';
import { ArrowRight, FileText, FlaskConical, LayoutDashboard, Target } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EnhancedStructuredRecord } from '@/components/medical/EnhancedStructuredRecord';
import { TrialCard } from '@/components/medical/TrialCard';
import type { JsonValue, LegacyTrialMatch, MatchProviderMetadata } from '@/types';
import { useAuthStore } from '@/lib/stores/auth';

const demoStructuredRecord: Record<string, JsonValue> = {
  name: '匿名患者 DEMO-001',
  patient_id: 'DEMO-001',
  age: '56',
  gender: '女',
  primary_diagnosis: 'KRAS G12D 阳性的转移性结直肠癌',
  staging: 'IV期（AJCC 第8版），伴肺和腹膜后转移',
  pathology: '中分化腺癌，MSS，PD-L1 CPS 3，Ki-67 60%',
  mutations: ['KRAS G12D', 'TP53 c.743G>A'],
  systemic_treatments: [
    '2022：CapeOX × 8 周期（辅助化疗）',
    '2023：FOLFIRI + 贝伐珠单抗 × 6 周期（系统治疗，评估 SD）',
    '2024：瑞戈非尼 + 信迪利单抗（靶向 + 免疫联合）',
  ],
  treatment_history: {
    surgery: '2022-04 乙状结肠癌根治术 D3 清扫，切缘阴性',
    radiotherapy: '2024-02 腹膜后转移灶放疗；PGTV 56 Gy / 28 次',
  },
  performance_status: 'ECOG 1，KPS 80%',
  lab_values: {
    cea: '25.4 ng/mL (2024-05)',
    ca19_9: '32.1 U/mL',
    anc: '2.8 × 10^9/L',
    platelet: '135 × 10^9/L',
    ast: '32 U/L',
    alt: '28 U/L',
    creatinine: '0.86 mg/dL',
  },
  measurable_lesions: ['双肺多发结节（最大 9×7 mm）', '腹膜后结节'],
  organ_function_ok: true,
  estimated_survival_months: 18,
};

const demoProvider: MatchProviderMetadata = {
  provider: '演示匹配引擎',
  model: '混合规则引擎 v3.1',
  source: '演示知识库（2024Q4）',
  totalTrials: 58,
  matchedTrials: 3,
  processingTime: 12.4,
  matchedAt: '2024-05-31T10:26:00.000Z',
};

const demoMatches: LegacyTrialMatch[] = [
  {
    trial_id: 'NCT04578230',
    trial_title: 'KRAS G12D mRNA 疫苗联合 PD-1 抑制剂的 II 期研究',
    match_score: 92,
    inclusion_checks: [
      { criterion: 'KRAS G12D 突变阳性', patient_value: '已确认', result: '满足' },
      { criterion: '转移性结直肠癌既往接受一线/二线治疗', patient_value: 'CapeOX、FOLFIRI 已完成', result: '满足' },
      { criterion: 'ECOG ≤ 1', patient_value: 'ECOG 1', result: '满足' },
    ],
    exclusion_checks: [
      { criterion: '活动性自身免疫性疾病', patient_value: '无', result: '不满足' },
      { criterion: '未控制的肺部疾病', patient_value: '无', result: '不满足' },
    ],
    summary: {
      inclusion_met: ['KRAS G12D 突变', '既往含 VEGF 方案', 'ECOG 0-1'],
      exclusion_triggered: [],
      uncertain: ['既往使用过 Regorafenib，需确认洗脱期'],
    },
    rank_reason: '高度匹配 KRAS 突变人群；疫苗+免疫联合策略',
    trial_metadata: {
      phase: 'II',
      status: 'recruiting',
      sponsor: 'OncoNova Biotech',
      location: '上海肿瘤中心',
      condition: '转移性结直肠癌',
      contactInfo: {
        name: '刘医生',
        email: 'liu.trials@onconova.cn',
        phone: '+86-21-5555-1234',
      },
      targetMutations: ['KRAS G12D'],
      estimatedEnrollment: 120,
      structuredEligibility: {
        inclusion: [
          { criterion: '18-75 岁成年人' },
          { criterion: '至少有一个 RECIST 可测量病灶' },
          { criterion: '既往至多 3 线全身治疗' },
        ],
        exclusion: [
          { criterion: '活动性中枢神经系统或脑膜转移' },
          { criterion: '未恢复的 3 级及以上治疗相关毒性' },
        ],
      },
    },
  },
  {
    trial_id: 'NCT04933725',
    trial_title: 'Regorafenib + PD-1 + TGFβ 抑制剂在难治性结直肠癌中的 II 期篮子研究',
    match_score: 86,
    inclusion_checks: [
      { criterion: '既往使用过 Regorafenib 或 Fruquintinib', patient_value: 'Regorafenib 使用中', result: '满足' },
      { criterion: 'MSS / pMMR 表型', patient_value: 'MSS', result: '满足' },
      { criterion: 'LDH ≤ 2 × ULN', patient_value: 'LDH 正常', result: '满足' },
    ],
    exclusion_checks: [
      { criterion: '免疫相关 3 级以上不良反应史', patient_value: '无', result: '不满足' },
      { criterion: '活动性 HBV 感染', patient_value: '阴性', result: '不满足' },
    ],
    summary: {
      inclusion_met: ['MSS·免疫联合策略', 'Regorafenib 既往经验'],
      exclusion_triggered: [],
      uncertain: ['放疗结束至入组需 ≥ 4 周，需确认时间窗'],
    },
    rank_reason: '可沿用现有 Regorafenib 基础；关注免疫联合增益',
    trial_metadata: {
      phase: 'II',
      status: 'active',
      sponsor: 'SinoBio Labs',
      location: '北京协和医院 / PUMCH',
      condition: 'Refractory Metastatic CRC',
      contactInfo: {
        name: '研究协调员 王女士',
        phone: '+86-10-8888-4321',
      },
      targetMutations: ['KRAS', 'NRAS 野生型不限制'],
      structuredEligibility: {
        inclusion: [
          { criterion: '既往至少 2 线全身治疗失败' },
          { criterion: '有可评估疾病，适用 RECIST 1.1' },
        ],
        exclusion: [
          { criterion: '既往接受 TGFβ 抑制剂' },
        ],
      },
    },
  },
  {
    trial_id: 'NCT05382154',
    trial_title: 'KRAS 抑制剂 + EGFR 抑制剂 联合方案的 III 期随机关联研究',
    match_score: 74,
    inclusion_checks: [
      { criterion: 'KRAS G12D 或 G12V 突变', patient_value: 'G12D', result: '满足' },
      { criterion: 'ECOG 0-1', patient_value: 'ECOG 1', result: '满足' },
    ],
    exclusion_checks: [
      { criterion: '既往接受 EGFR 抑制剂治疗', patient_value: '未使用 Cetuximab', result: '不满足' },
      { criterion: '严重心血管疾病', patient_value: '无', result: '不满足' },
    ],
    summary: {
      inclusion_met: ['KRAS G12D', 'ECOG 1'],
      exclusion_triggered: [],
      uncertain: ['需确认既往 VEGF 抑制剂间隔期'],
    },
    rank_reason: 'III 期随机验证，高级别证据',
    trial_metadata: {
      phase: 'III',
      status: 'recruiting',
      sponsor: 'Global Oncology Alliance',
      location: '新加坡国立大学医院（NUH）',
      condition: '转移性 KRAS 突变结直肠癌',
      contactInfo: {
        email: 'trialdesk@goa.org',
      },
      estimatedEnrollment: 280,
    },
  },
];

export default function DemoPage() {
  const { isAuthenticated } = useAuthStore();

  return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-100">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-12 sm:px-6 lg:px-8">
          <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white/70 px-4 py-1 text-xs font-semibold tracking-[0.3em] text-blue-600">
              匹配示例
              </span>
              <h1 className="text-4xl font-semibold text-slate-900 sm:text-5xl">
                结构化病历与临床试验匹配预览
              </h1>
              <div className="flex flex-wrap gap-3">
                <Link href="/patients">
                  <Button variant="primary" className="rounded-full px-6 py-2 text-sm font-semibold shadow-md shadow-blue-200/80">
                  进入患者列表
                  <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
                {!isAuthenticated && (
                  <Link href="/auth/login">
                    <Button variant="outline" className="rounded-full border-blue-200 px-6 py-2 text-sm text-blue-700 hover:border-blue-300 hover:bg-blue-50">
                    登录
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          </header>

        <section className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="flex flex-col gap-6">
            <Card className="border-blue-100/70 bg-white/80 shadow-lg shadow-blue-100/40">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base text-blue-700">
                  <FileText className="h-4 w-4" />
                  测试病历
                </CardTitle>
              </CardHeader>
              <CardContent>
                <EnhancedStructuredRecord
                  data={demoStructuredRecord}
                  title="结构化档案"
                  showRawData={false}
                  collapsible
                  defaultCollapsed={false}
                />
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-6">
            <Card className="border-emerald-100/60 bg-white/90 shadow-lg shadow-emerald-100/40">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base text-emerald-700">
                  <Target className="h-4 w-4" />
                  匹配引擎摘要
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-slate-600">
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-xl bg-emerald-50 p-4 text-center">
                    <p className="text-2xl font-semibold text-emerald-600">{demoProvider.matchedTrials}</p>
                    <p className="text-xs text-emerald-700">推荐临床试验</p>
                  </div>
                  <div className="rounded-xl bg-blue-50 p-4 text-center">
                    <p className="text-2xl font-semibold text-blue-600">{demoProvider.totalTrials}</p>
                    <p className="text-xs text-blue-700">评估试验总数</p>
                  </div>
                </div>
                <div className="space-y-1">
                  <p><span className="font-medium text-slate-800">匹配引擎：</span>{demoProvider.provider}</p>
                  <p><span className="font-medium text-slate-800">算法模型：</span>{demoProvider.model}</p>
                  <p><span className="font-medium text-slate-800">数据快照：</span>{demoProvider.source}</p>
                  <p><span className="font-medium text-slate-800">处理耗时：</span>{demoProvider.processingTime} 秒</p>
                  <p><span className="font-medium text-slate-800">生成时间：</span>2024-05-31 10:26</p>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-5">
              {demoMatches.map((match) => (
                <TrialCard key={match.trial_id} match={match} showMatchScore />
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
