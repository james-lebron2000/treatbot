import { ExtractedPatient, TrialMatch, TrialMatchSchema } from '@/types';

type MockUploadEntry = {
  uploadId: string;
  filename: string;
  size: number;
  mimeType: string;
  createdAt: number;
  status: 'queued' | 'processing' | 'done';
  patient?: ExtractedPatient;
};

const uploads = new Map<string, MockUploadEntry>();

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const createRandomId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `mock-${Math.random().toString(36).slice(2, 10)}`;
};

const basePatient: ExtractedPatient = {
  age: 53,
  sex: 'male',
  cancerType: '结直肠癌 / Colorectal Cancer',
  stage: 'IV',
  biomarkers: ['KRAS G12C', 'PD-L1 CPS 3'],
  ecog: 1,
  labs: {
    hb: 11.2,
    alt: 32,
    crea: 1.1,
  },
  priorTherapies: ['CapeOX x8', 'FOLFIRI + Bevacizumab x6', 'Radiotherapy (56Gy/28次)'],
  msi: 'MSS',
  tmb: 4.8,
  notes:
    '患者术后复发，伴腹膜后及肺多发转移，KRAS 突变阳性，考虑入组免疫联合试验。',
};

const mockTrials: TrialMatch[] = [
  TrialMatchSchema.parse({
    id: 'mock-trial-001',
    title: 'KRAS G12C 抑制剂联合 PD-1 治疗 / KRAS G12C Inhibitor + PD-1 (Phase II)',
    phase: 'II',
    condition: 'KRAS 突变结直肠癌 / KRAS+ Colorectal Cancer',
    institution: '复旦大学附属肿瘤医院',
    siteCity: '上海 Shanghai',
    siteCountry: '中国 China',
    matchScore: 92,
    nctId: 'NCT05012345',
    url: 'https://clinicaltrials.gov/study/NCT05012345',
    briefEligibility: [
      'KRAS G12C 突变阳性',
      '既往接受≤2线系统治疗',
      'ECOG ≤ 1',
    ],
  }),
  TrialMatchSchema.parse({
    id: 'mock-trial-002',
    title: 'mRNA-245 个体化疫苗辅助治疗 / mRNA-245 Personalized Vaccine (Phase III)',
    phase: 'III',
    condition: '实体瘤术后辅助治疗 / Post-operative Solid Tumour',
    institution: 'MD Anderson Cancer Center',
    siteCity: '休斯顿 Houston',
    siteCountry: '美国 USA',
    matchScore: 87,
    nctId: 'NCT05198765',
    url: 'https://clinicaltrials.gov/study/NCT05198765',
    briefEligibility: [
      '完成根治性手术或放疗',
      'KRAS 及 MSI 状态已知',
      '无活动性自身免疫疾病',
    ],
  }),
  TrialMatchSchema.parse({
    id: 'mock-trial-003',
    title: '多靶点 TIL 细胞疗法 / Multi-target TIL Therapy (Phase I/II)',
    phase: 'II',
    condition: '放化疗后复发消化道肿瘤 / Recurrent GI Tumours',
    institution: 'Gustave Roussy Cancer Campus',
    siteCity: '巴黎 Paris',
    siteCountry: '法国 France',
    matchScore: 81,
    nctId: 'NCT04987654',
    url: 'https://clinicaltrials.gov/study/NCT04987654',
    briefEligibility: [
      '病理证实消化道肿瘤',
      '接受标准治疗后复发',
      '器官功能符合入组要求',
    ],
  }),
];

export const mockApi = {
  async uploadFile(file: File): Promise<{ uploadId: string; filename: string; size: number; mimeType: string }> {
    await delay(400);
    const uploadId = createRandomId();
    const mimeType = file.type || 'application/octet-stream';
    uploads.set(uploadId, {
      uploadId,
      filename: file.name,
      size: file.size,
      mimeType,
      createdAt: Date.now(),
      status: 'queued',
    });

    return {
      uploadId,
      filename: file.name,
      size: file.size,
      mimeType,
    };
  },

  async pollExtraction(uploadId: string) {
    await delay(500);
    const entry = uploads.get(uploadId);
    if (!entry) {
      return {
        status: 'queued' as const,
        message: '正在为您初始化解析任务 / Preparing extraction task…',
      };
    }

    const elapsed = Date.now() - entry.createdAt;

    if (elapsed < 2000) {
      entry.status = 'queued';
      return {
        status: 'queued' as const,
        message: '排队中 · 正在等待可用算力 / Queued for processing…',
      };
    }

    if (elapsed < 4000) {
      entry.status = 'processing';
      return {
        status: 'processing' as const,
        message: 'AI 正在解析病历 / AI is parsing the medical record…',
      };
    }

    entry.status = 'done';
    if (!entry.patient) {
      entry.patient = { ...basePatient };
    }
    return {
      status: 'done' as const,
      data: entry.patient,
      message: '解析完成 / Extraction complete',
    };
  },

  async postMatch(patient: ExtractedPatient): Promise<TrialMatch[]> {
    await delay(600);
    const personalized = mockTrials.map((trial, index) => ({
      ...trial,
      matchScore: Math.max(
        60,
        Math.min(
          98,
          trial.matchScore +
            (patient.biomarkers.length ? 2 : 0) +
            (patient.ecog !== null && patient.ecog <= 1 ? 1 : 0) -
            index
        )
      ),
    }));
    return personalized;
  },
};
