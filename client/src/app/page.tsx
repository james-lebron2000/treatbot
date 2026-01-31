'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Sparkles, ShieldCheck, UploadCloud, Stethoscope, ArrowRight, Activity } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';

const featureCards = [
  {
    title: '极速匹配',
    description:
      '10秒内分析病历，智能筛选全球临床试验，提供最契合的候选名单。',
    icon: Sparkles,
  },
  {
    title: '隐私与合规',
    description:
      '端到端匿名处理与多重加密，保障每一份医疗资料的安全与合规。',
    icon: ShieldCheck,
  },
  {
    title: '专家共创',
    description:
      '由附属医院肿瘤专家、药企临床团队与AI协同打造的推荐引擎。',
    icon: Stethoscope,
  },
];

const journeySteps = [
  { label: '1. 上传资料', detail: '拖拽病历、化验单或影像报告' },
  { label: '2. AI 解析', detail: '智能抽取关键病情、突变与治疗史' },
  { label: '3. 智能匹配', detail: '直达入组条件合适的临床试验' },
  { label: '4. 专家跟进', detail: '附属医院专员协助对接研究中心' },
];

const highlightStats = [
  { value: '350+', label: '合作研究中心' },
  { value: '89%', label: '患者满意度' },
  { value: '<48h', label: '平均反馈时间' },
];

export default function LandingPage() {
  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-white via-sky-50 to-blue-100">
      {/* Decorative background orbs */}
      <motion.div
        className="pointer-events-none absolute -top-32 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-sky-200/40 blur-3xl"
        initial={{ opacity: 0.3 }}
        animate={{ opacity: 0.6 }}
        transition={{ duration: 4, repeat: Infinity, repeatType: 'mirror' }}
      />
      <motion.div
        className="pointer-events-none absolute -bottom-28 right-10 h-64 w-64 rounded-full bg-blue-300/30 blur-3xl"
        initial={{ opacity: 0.2 }}
        animate={{ opacity: 0.5 }}
        transition={{ duration: 5, repeat: Infinity, repeatType: 'mirror', delay: 0.6 }}
      />

      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl flex-col gap-16 px-4 py-14 sm:gap-24 sm:px-6 sm:py-20 lg:px-8">
        {/* Hero Section */}
        <section className="relative grid gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="space-y-8"
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white/70 px-4 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-sky-600 shadow-sm backdrop-blur">
              AI 智能临床试验匹配
            </span>
            <h1 className="text-3xl font-semibold text-slate-900 sm:text-5xl lg:text-6xl">
              AI 驱动的临床试验匹配 <br />
              <span className="text-sky-600">AI帮助病人找到最前沿的治疗方案</span>
            </h1>
            <div className="flex flex-wrap items-baseline gap-x-2 text-lg text-slate-600 sm:text-xl">
              <span>上传病历，快速发现更适合的临床试验。</span>
              <span>结合AI解析与专家审阅，帮助患者快速链接全球创新治疗机会。</span>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row">
              <Link href="/patients">
                <Button
                  variant="primary"
                  className="group rounded-full px-8 py-3 text-base font-semibold shadow-lg shadow-blue-200/80 transition hover:scale-[1.01]"
                >
                  <span className="flex items-center gap-2">
                    开始匹配
                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                  </span>
                </Button>
              </Link>
              <Link href="/demo">
                <Button
                  variant="outline"
                  className="rounded-full border-sky-200/90 bg-white/70 px-8 py-3 text-base text-sky-700 shadow-sm backdrop-blur transition hover:border-sky-300 hover:bg-sky-50"
                >
                  <span>查看示例演示</span>
                </Button>
              </Link>
            </div>
            <div className="flex flex-wrap gap-8 rounded-2xl border border-sky-100 bg-white/60 px-6 py-4 shadow-sm backdrop-blur">
              {highlightStats.map((stat) => (
                <div key={stat.label} className="flex flex-col">
                  <span className="text-2xl font-semibold text-slate-900">{stat.value}</span>
                  <span className="text-sm text-slate-500">{stat.label}</span>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.1 }}
            className="relative"
          >
            <Card className="overflow-hidden rounded-3xl border border-white/60 bg-white/70 shadow-2xl shadow-blue-100/50 backdrop-blur">
              <CardContent className="relative space-y-6 p-6 sm:p-8">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-500">实时解析预览</p>
                    <span className="text-lg font-medium text-slate-900">结直肠癌病例 · KRAS+</span>
                  </div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-sky-400 text-white shadow-lg">
                    <UploadCloud className="h-6 w-6" />
                  </div>
                </div>
                <div className="rounded-2xl border border-sky-100 bg-white/60 p-4 shadow-sm">
                  <div className="flex items-center justify-between text-sm text-slate-500">
                    <span>AI 置信度</span>
                    <span className="font-semibold text-sky-600">94%</span>
                  </div>
                  <div className="mt-6 space-y-4">
                    {[
                      '检测到 KRAS G12D 突变',
                      '术后辅助化疗已完成',
                      '优先匹配 II/III 期免疫联合方案',
                    ].map((item) => (
                      <div key={item} className="flex items-center gap-3 rounded-xl bg-sky-50/70 p-3 text-sm text-slate-600">
                        <Activity className="h-4 w-4 text-sky-500" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid gap-3 rounded-2xl border border-sky-100 bg-white/70 p-4 text-sm shadow-sm">
                  <p className="text-slate-500">推荐试验</p>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-slate-800">mRNA-245 II 期研究</span>
                    <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-600">匹配度 92%</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-slate-800">KRAS 联合治疗 III 期</span>
                    <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-600">匹配度 88%</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </section>

        {/* Feature Section */}
        <section className="grid gap-8 md:grid-cols-3">
          {featureCards.map((feature) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.6 }}
            >
              <Card className="h-full rounded-3xl border border-white/60 bg-white/70 shadow-xl shadow-blue-100/40 backdrop-blur">
                <CardContent className="space-y-4 p-6">
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-sky-400 text-white shadow-lg shadow-blue-200/70">
                    <feature.icon className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">{feature.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">{feature.description}</p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </section>

        {/* Journey Section */}
        <section className="grid gap-10 rounded-3xl border border-sky-100/60 bg-white/70 p-6 shadow-2xl shadow-blue-100/40 backdrop-blur sm:p-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <span className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.3em] text-sky-600">
              患者旅程
            </span>
            <h2 className="text-3xl font-semibold text-slate-900">
              清晰、贴心的创新治疗路径
            </h2>
            <p className="text-base leading-relaxed text-slate-600">
              我们将复杂的临床试验匹配流程，浓缩为四步体验。每一步都提供清晰指引，并由附属医院团队协助对接研究中心。
            </p>
            <div className="grid gap-4">
              {journeySteps.map((step, index) => (
                <motion.div
                  key={step.label}
                  initial={{ opacity: 0, x: -18 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, amount: 0.5 }}
                  transition={{ duration: 0.5, delay: index * 0.08 }}
                  className="flex items-center gap-4 rounded-2xl border border-sky-100 bg-sky-50/80 p-4 shadow-sm"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-sm font-semibold text-sky-600 shadow-md">
                    {index + 1}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{step.label}</p>
                    <p className="text-sm text-slate-500">{step.detail}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
          <div className="flex flex-col justify-between rounded-3xl bg-gradient-to-br from-blue-500/15 via-white/60 to-sky-200/40 p-8">
            <div className="space-y-4">
              <h3 className="text-xl font-semibold text-slate-900">附属医院合作网络</h3>
              <p className="text-sm leading-relaxed text-slate-600">
                附属肿瘤医院、上海市临床研究中心与国际制药企业共同维护试验库，确保信息准确与及时更新。我们以患者为中心，提供真实可行的治疗选择。
              </p>
            </div>
            <Card className="mt-8 rounded-2xl border border-white/70 bg-white/80 p-6 text-sm shadow-md shadow-blue-100/50">
              <p className="text-slate-500">
                "通过AI辅助筛选，我们将优质临床试验真正带到患者身边，帮助他们更快、更安心地做出治疗决策。"
              </p>
            </Card>
          </div>
        </section>

        {/* CTA Section */}
        <section className="relative overflow-hidden rounded-3xl border border-sky-100/80 bg-white/80 p-6 shadow-2xl shadow-blue-100/50 sm:p-12">
          <motion.div
            className="pointer-events-none absolute -left-16 top-1/2 h-56 w-56 -translate-y-1/2 rounded-full bg-blue-200/40 blur-3xl"
            initial={{ opacity: 0.3 }}
            whileInView={{ opacity: 0.6 }}
            viewport={{ once: true }}
          />
          <motion.div
            className="pointer-events-none absolute -right-10 top-10 h-40 w-40 rounded-full bg-sky-300/30 blur-3xl"
            initial={{ opacity: 0.2 }}
            whileInView={{ opacity: 0.4 }}
            viewport={{ once: true }}
          />

          <div className="relative flex flex-col gap-6 text-center lg:flex-row lg:items-center lg:justify-between lg:text-left">
            <div className="space-y-3">
              <h3 className="text-2xl font-semibold text-slate-900">
                现在开始上传，获取适配病情的临床试验推荐
              </h3>
              <p className="text-sm text-slate-600">
                上传病历，探索AI推荐的全球临床试验机会。
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/patients">
                <Button
                  variant="primary"
                  className="rounded-full px-8 py-3 text-base font-semibold shadow-lg shadow-blue-200/70"
                >
                  <span>开始上传病历</span>
                </Button>
              </Link>
              <Link href="/demo">
                <Button
                  variant="outline"
                  className="rounded-full border-sky-200 px-8 py-3 text-base text-sky-700 hover:border-sky-300 hover:bg-sky-50"
                >
                  <span>预览匹配示例</span>
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
