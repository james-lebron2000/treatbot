# 临床试验匹配策略文档 / Clinical Trial Matching Strategy Document

## 🎯 概述 / Overview

本文档详细阐述了临床试验匹配系统的核心策略、技术实现和优化方向，为产品经理提供决策依据。

This document details the core strategy, technical implementation, and optimization directions for the clinical trial matching system, providing decision-making basis for product managers.

## 🧠 核心匹配思路 / Core Matching Philosophy

### 1. 多策略融合方法 / Multi-Strategy Fusion Approach

**中文**: 系统采用"规则引擎+AI语义+机器学习"的三层融合策略，确保匹配的准确性和覆盖率。

**English**: The system employs a three-layer fusion strategy of "rule engine + AI semantics + machine learning" to ensure matching accuracy and coverage.

```
┌─────────────────────────────────────────────────────────────┐
│                    匹配策略层级 / Matching Strategy Layers                    │
├─────────────────────────────────────────────────────────────┤
│  1️⃣ 规则引擎层 / Rule Engine Layer (确定性匹配 / Deterministic)              │
│     ├── 年龄范围检查 / Age range validation                 │
│     ├── 分期匹配 / Stage matching                          │
│     ├── 生物标志物验证 / Biomarker verification            │
│     └── 硬性排除标准 / Hard exclusion criteria             │
├─────────────────────────────────────────────────────────────┤
│  2️⃣ AI语义层 / AI Semantic Layer (智能理解 / Intelligent Understanding)     │
│     ├── 医学文本解析 / Medical text parsing                 │
│     ├── 同义词识别 / Synonym recognition                    │
│     └── 上下文理解 / Contextual understanding              │
├─────────────────────────────────────────────────────────────┤
│  3️⃣ 机器学习层 / ML Layer (模式识别 / Pattern Recognition)                   │
│     ├── 历史数据学习 / Historical data learning            │
│     ├── 相似度计算 / Similarity calculation                │
│     └── 预测性匹配 / Predictive matching                   │
└─────────────────────────────────────────────────────────────┘
```

### 2. 双路径架构 / Dual-Path Architecture

**中文**: 系统支持两种匹配路径，根据数据可用性智能选择最优方案。

**English**: The system supports two matching paths, intelligently selecting the optimal solution based on data availability.

#### 路径A：基于保存记录的匹配 / Path A: Saved Record-Based Matching
- **触发条件 / Trigger**: 当用户已有保存的医疗记录时
- **API端点 / API Endpoint**: `/medical/match/{recordId}/start`
- **优势 / Advantages**:
  - 支持批处理和流式传输
  - 可复用历史匹配结果
  - 支持断点续传

#### 路径B：直接数据匹配 / Path B: Direct Data Matching
- **触发条件 / Trigger**: 用户刚完成数据提取，尚未保存记录
- **API端点 / API Endpoint**: `/medical/match/llm`
- **优势 / Advantages**:
  - 零门槛即时匹配
  - 无需数据库持久化
  - 响应速度快

## 🔍 详细匹配逻辑 / Detailed Matching Logic

### 1. 数据预处理层 / Data Preprocessing Layer

**文件位置 / File Location**: `server/services/matching/featureNormalizer.js`

```javascript
// 分期标准化 / Stage Normalization
const STAGE_PATTERNS = {
  advanced: /(iv|4期|四期|转移|晚期|终末|广泛|多发|复发|不可切除)/i,
  locally_advanced: /(iii|3期|三期|局部晚期|不可切除)/i,
  early: /(i|ii|1期|2期|早期|术后|辅助)/i
};

// 生物标志物别名映射 / Biomarker Alias Mapping
const BIOMARKER_ALIASES = {
  pdl1: [/pd[-\s]?l1/i, /cps/i, /combined positive score/i],
  kras: [/kras/i],
  braf: [/braf/i],
  msi: [/msi/i, /microsatellite/i],
  tmb: [/tmb/i, /tumor mutation burden/i]
};
```

**处理逻辑 / Processing Logic**:
1. **文本标准化 / Text Normalization**: 统一医学术语表达
2. **别名解析 / Alias Resolution**: 识别不同表述的相同概念
3. **缺失值处理 / Missing Value Handling**: 智能补全不完整数据
4. **置信度评分 / Confidence Scoring**: 为每个字段分配可靠性分数

### 2. 规则引擎核心 / Rule Engine Core

**文件位置 / File Location**: `server/services/trialMatchingEngine.js`

```javascript
// 评分权重配置 / Scoring Weights Configuration
const SCORING_WEIGHTS = {
  demographics: 12,      // 人口学特征
  diagnosis: 25,         // 诊断与分期 (最高权重)
  performance_status: 15, // 功能状态
  lab_values: 20,        // 实验室指标
  treatment_history: 15,  // 治疗史
  biomarkers: 10,        // 生物标志物
  comorbidities: 5       // 并发症情况
};

// 硬性排除标准 / Hard Exclusion Criteria
const HARD_EXCLUSIONS = [
  { intent: "age", label: "年龄限制" },
  { intent: "pregnancy", label: "妊娠/哺乳排除" },
  { intent: "hbv", label: "HBV活动性感染" },
  { intent: "cns", label: "中枢神经系统转移" }
];
```

**匹配流程 / Matching Process**:

```
患者数据输入 / Patient Data Input
    ↓
特征提取与标准化 / Feature Extraction & Normalization
    ↓
┌─────────────────────────────────────────────────────────────┐
│                多阶段评估 / Multi-Stage Evaluation               │
├─────────────────────────────────────────────────────────────┤
│ ① 硬性排除检查 / Hard Exclusion Check (通过/拒绝)              │
│ ② 包容性标准评估 / Inclusion Criteria Evaluation (打分)        │
│ ③ 不确定性分析 / Uncertainty Analysis (置信度)                 │
│ ④ 综合评分计算 / Comprehensive Score Calculation (0-100)       │
└─────────────────────────────────────────────────────────────┘
    ↓
结果排序与呈现 / Result Ranking & Presentation
```

### 3. AI增强匹配 / AI-Enhanced Matching

**文件位置 / File Location**: `server/services/llmIntegrationService.js`

**Moonshot AI集成 / Moonshot AI Integration**:
```javascript
const response = await this.openai.chat.completions.create({
  model: 'kimi-k2-turbo-preview',
  messages: [
    { role: 'system', content: this.systemPrompt },
    { role: 'user', content: `请整合以下病历信息：\n\n${medicalText}` }
  ],
  temperature: 0.1,  // 低温度确保稳定性 / Low temperature for stability
  max_tokens: 4000,
  timeout: 120000    // 120秒超时 / 120s timeout
});
```

**AI能力 / AI Capabilities**:
- **语义理解 / Semantic Understanding**: 理解医学文本的深层含义
- **实体识别 / Entity Recognition**: 自动提取医学实体（疾病、药物、指标）
- **关系推理 / Relationship Reasoning**: 识别症状与疾病间的关联
- **不确定性处理 / Uncertainty Handling**: 处理模糊或不完整的医学描述

### 4. 实时处理与流式传输 / Real-time Processing & Streaming

**文件位置 / File Location**: `server/services/matchJobManager.js`

**批处理作业管理 / Batch Job Management**:
```javascript
class MatchJobManager {
  constructor() {
    this.jobs = new Map();        // jobId -> JobRuntime
    this.recordJobMap = new Map(); // recordId -> jobId
  }

  async startJob({ recordId, userId, batchSize, restart = false }) {
    // 作业去重 / Job Deduplication
    const existingJobId = this.recordJobMap.get(String(recordId));
    if (existingJobId && !restart) {
      return { reused: true, jobId: existingJobId, status: existingDoc?.status };
    }

    // 流式事件发射 / Streaming Event Emission
    const emitter = new EventEmitter();
    emitter.on('batch', (batchData) => {
      // 发送批次结果 / Send batch results
    });
    emitter.on('complete', (finalData) => {
      // 发送完成信号 / Send completion signal
    });
  }
}
```

## 📊 评分与排名机制 / Scoring & Ranking Mechanism

### 多维度评分体系 / Multi-dimensional Scoring System

| 评估维度 / Evaluation Dimension | 权重 / Weight | 评估内容 / Evaluation Content |
|-------------------------------|---------------|------------------------------|
| 诊断与分期 / Diagnosis & Stage | 25% | 主要诊断、TNM分期、病理类型 |
| 实验室指标 / Lab Values | 20% | 血常规、肝肾功能、凝血功能 |
| 功能状态 / Performance Status | 15% | ECOG评分、症状严重程度 |
| 治疗史 / Treatment History | 15% | 既往治疗线数、药物反应 |
| 人口学特征 / Demographics | 12% | 年龄、性别、种族 |
| 生物标志物 / Biomarkers | 10% | PD-L1、MSI、基因突变 |
| 并发症 / Comorbidities | 5% | 合并症、禁忌症 |

### 评分算法 / Scoring Algorithm

```javascript
// 综合评分计算 / Comprehensive Score Calculation
function calculateMatchScore(patient, trial) {
  let totalScore = 0;
  let maxPossibleScore = 0;

  for (const [dimension, weight] of Object.entries(SCORING_WEIGHTS)) {
    const dimensionScore = evaluateDimension(patient, trial, dimension);
    totalScore += dimensionScore * weight;
    maxPossibleScore += weight;
  }

  return Math.round((totalScore / maxPossibleScore) * 100);
}

// 单个维度评估 / Single Dimension Evaluation
function evaluateDimension(patient, trial, dimension) {
  const criteria = trial.eligibility[dimension];
  let metCriteria = 0;
  let totalCriteria = 0;

  for (const criterion of criteria) {
    totalCriteria++;
    if (evaluateCriterion(patient, criterion)) {
      metCriteria++;
    }
  }

  return totalCriteria > 0 ? metCriteria / totalCriteria : 0;
}
```

## 🚀 产品经理优化建议 / Product Manager Optimization Recommendations

### 1. 用户体验优化 / User Experience Optimization

**中文建议**:
- **渐进式匹配**: 先显示快速匹配结果，再逐步加载详细分析
- **匹配度可视化**: 使用雷达图展示患者在各维度的匹配情况
- **解释性AI**: 为每个匹配结果提供详细的医学解释

**English Recommendations**:
- **Progressive Matching**: Show quick match results first, then load detailed analysis gradually
- **Match Visualization**: Use radar charts to display patient's matching status across dimensions
- **Explainable AI**: Provide detailed medical explanations for each match result

### 2. 算法精度提升 / Algorithm Accuracy Enhancement

**中文建议**:
- **医学本体库集成**: 集成SNOMED CT、ICD-10等标准医学术语库
- **领域专家标注**: 建立医学专家标注的训练数据集
- **A/B测试框架**: 持续测试不同匹配策略的效果

**English Recommendations**:
- **Medical Ontology Integration**: Integrate standard medical terminology like SNOMED CT, ICD-10
- **Domain Expert Annotation**: Build training datasets annotated by medical experts
- **A/B Testing Framework**: Continuously test effectiveness of different matching strategies

### 3. 业务价值优化 / Business Value Optimization

**中文建议**:
- **转化率追踪**: 追踪从匹配到实际入组的转化漏斗
- **个性化推荐**: 基于患者偏好和治疗目标进行个性化排序
- **多中心协调**: 支持跨多个研究中心的试验匹配

**English Recommendations**:
- **Conversion Tracking**: Track conversion funnel from matching to actual enrollment
- **Personalized Recommendations**: Personalize ranking based on patient preferences and treatment goals
- **Multi-center Coordination**: Support trial matching across multiple research centers

### 4. 技术架构优化 / Technical Architecture Optimization

**中文建议**:
- **微服务拆分**: 将匹配引擎拆分为独立的微服务
- **边缘计算**: 考虑在用户端进行轻量级预筛选
- **缓存策略**: 实现多级缓存提高响应速度

**English Recommendations**:
- **Microservices Split**: Split matching engine into independent microservices
- **Edge Computing**: Consider lightweight pre-screening on user side
- **Caching Strategy**: Implement multi-level caching to improve response speed

## 📈 关键指标建议 / Key Metrics Recommendations

| 指标类型 / Metric Type | 具体指标 / Specific Metric | 目标值 / Target | 监控频率 / Monitoring Frequency |
|------------------------|----------------------------|-----------------|---------------------------------|
| 匹配精度 / Matching Accuracy | 医学专家验证通过率 | >90% | 每周 |
| 响应速度 / Response Speed | 平均匹配时间 | <3秒 | 实时 |
| 用户体验 / User Experience | 匹配结果点击率 | >60% | 每日 |
| 业务转化 / Business Conversion | 匹配到咨询转化率 | >15% | 每月 |
| 系统稳定性 / System Stability | 匹配服务可用性 | 99.9% | 实时 |

## 🔮 未来发展方向 / Future Development Directions

### 短期 (1-3个月) / Short-term (1-3 months)
1. **多语言支持**: 支持更多语言的医学文本处理
2. **移动端优化**: 优化移动端匹配体验
3. **实时通知**: 新试验匹配推送通知

### 中期 (3-6个月) / Medium-term (3-6 months)
1. **AI模型优化**: 基于用户反馈持续优化AI模型
2. **临床试验数据库扩展**: 集成更多试验数据源
3. **患者社区功能**: 添加患者交流和经验分享

### 长期 (6-12个月) / Long-term (6-12 months)
1. **预测性匹配**: 基于基因组学的个性化试验预测
2. **全球试验匹配**: 支持国际多中心试验匹配
3. **疗效预测模型**: 预测患者在特定试验中的可能疗效

---

## 💡 总结 / Summary

本临床试验匹配系统通过多策略融合、双路径架构和智能化算法，实现了高精度、低延迟的试验匹配服务。系统的核心价值在于降低了患者参与临床试验的门槛，提高了试验匹配的效率和准确性。

This clinical trial matching system achieves high-precision, low-latency trial matching services through multi-strategy fusion, dual-path architecture, and intelligent algorithms. The core value lies in lowering the barrier for patient participation in clinical trials while improving matching efficiency and accuracy.

**产品价值主张 / Product Value Proposition**:
> "让合适的患者快速找到合适的临床试验，让每一个医学发现都能更快惠及需要的患者。"
>
> "Help the right patients find the right clinical trials quickly, so every medical discovery can reach patients in need faster."