const { selectCandidates } = require('../services/trialRetrievalService');

describe('trialRetrievalService.selectCandidates', () => {
  test('stage-aware ranking prefers advanced-stage trial for advanced patient', () => {
    const patient = {
      primary_diagnosis: '肝细胞癌',
      staging_value: 'IV期肺转移'
    };

    const trials = [
      {
        项目编码: 'T-ADV',
        项目状态: '招募中',
        疾病三级标签: '肝细胞癌（实体瘤）',
        入组条件: '适用于晚期不可切除或转移性肝细胞癌患者',
        简要入组条件: '晚期肝细胞癌'
      },
      {
        项目编码: 'T-EARLY',
        项目状态: '招募中',
        疾病三级标签: '肝细胞癌（实体瘤）',
        入组条件: '适用于术后辅助治疗的早期肝癌患者',
        简要入组条件: 'I期术后辅助'
      }
    ];

    const candidates = selectCandidates(patient, trials, 2);
    expect(candidates[0].项目编码).toBe('T-ADV');
  });

  test('token fallback returns trials even when no token match', () => {
    const patient = {
      primary_diagnosis: '未知疾病'
    };

    const trials = [
      { 项目编码: 'T1', 项目状态: '招募中', 疾病三级标签: '胃癌（实体瘤）' },
      { 项目编码: 'T2', 项目状态: '暂停', 疾病三级标签: '肺癌（实体瘤）' }
    ];

    const candidates = selectCandidates(patient, trials, 2);
    expect(candidates).toHaveLength(2);
  });
});

