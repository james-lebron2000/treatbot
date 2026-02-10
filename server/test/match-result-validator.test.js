const { validateMatchResults } = require('../utils/matchResultValidator');
const enhancedMatcher = require('../services/enhancedTrialMatcher');

function sampleMatchResult() {
  return [{
    trial_id: 'CTR20250001',
    trial_title: '示例临床试验',
    match_score: 82,
    inclusion_checks: [
      { criterion: '年龄 ≥ 18', patient_value: '45岁', result: '满足' },
      { criterion: 'ECOG ≤ 1', patient_value: 'ECOG=1', result: '满足' }
    ],
    exclusion_checks: [
      { criterion: '无活动性感染', patient_value: '未提供', result: '不确定' }
    ],
    summary: {
      inclusion_met: ['年龄', 'ECOG评分'],
      exclusion_triggered: [],
      uncertain: ['感染状态']
    },
    rank_reason: '关键标准满足，感染状态待确认'
  }];
}

describe('matchResultValidator.validateMatchResults', () => {
  test('parses a valid match result array', () => {
    const valid = sampleMatchResult();
    const parsed = validateMatchResults(valid, 'unit-test');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].trial_id).toBe('CTR20250001');
    expect(parsed[0].summary.inclusion_met[0]).toBe('年龄');
  });

  test('throws when trial_id missing', () => {
    expect(() => validateMatchResults([
      {
        trial_title: '缺少 trial_id',
        match_score: 10,
        inclusion_checks: [],
        exclusion_checks: [],
        summary: { inclusion_met: [], exclusion_triggered: [], uncertain: [] }
      }
    ], 'invalid-case')).toThrow(/trial_id/);
  });
});

describe('enhancedTrialMatcher.matchTrialsWithArchive', () => {
  test('returns a result with expected shape', () => {
    const archive = {
      patient_id: 'P001',
      basic_info: { name: '张三', gender: 'male', age: '52', date_of_birth: '1973-01-01' },
      medical_history: {
        primary_diagnosis: '肝细胞癌',
        infection_status: { HBV: 'HBV-DNA<50 IU/ml' }
      },
      treatment_history: [],
      pathology: { stage: 'II', histology: 'HCC', molecular_markers: {} },
      imaging_findings: [],
      lab_results: {
        blood_counts: { Platelets: '95×10^9/L' },
        liver_function: {},
        renal_function: {},
        tumor_markers: {}
      },
      ecog_score: '1',
      current_status: { measurable_lesions: true, organ_function_ok: true, estimated_survival_months: '8', symptoms: [] }
    };

    const trials = [
      {
        trialId: 'CTR0001',
        title: '肝癌一线治疗试验',
        condition: '肝细胞癌',
        phase: 'Phase III',
        inclusionCriteria: ['年龄 18-75 岁', 'ECOG ≤ 1'],
        exclusionCriteria: ['血小板 ≥ 90×10^9/L', '活动性乙肝排除'],
        targetMutations: [],
        ageRange: { min: 18, max: 75 },
        gender: 'both'
      }
    ];

    const matches = enhancedMatcher.matchTrialsWithArchive(archive, trials);
    expect(matches).toHaveLength(1);
    expect(matches[0].trial_id).toBe('CTR0001');
    expect(Array.isArray(matches[0].inclusion_checks)).toBe(true);
    expect(Array.isArray(matches[0].exclusion_checks)).toBe(true);
    expect(matches[0].summary).toBeTruthy();
  });
});

