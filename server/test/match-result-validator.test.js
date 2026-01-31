const assert = require('assert/strict');
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

function testValidateMatchResults() {
  const valid = sampleMatchResult();
  const parsed = validateMatchResults(valid, 'unit-test');
  assert.equal(parsed.length, 1, 'Should parse a single match result');
  assert.equal(parsed[0].trial_id, 'CTR20250001');
  assert.equal(parsed[0].summary.inclusion_met[0], '年龄');

  let threw = false;
  try {
    validateMatchResults([
      {
        trial_title: '缺少 trial_id',
        match_score: 10,
        inclusion_checks: [],
        exclusion_checks: [],
        summary: { inclusion_met: [], exclusion_triggered: [], uncertain: [] }
      }
    ], 'invalid-case');
  } catch (error) {
    threw = true;
    assert.match(error.message, /trial_id/);
  }
  assert.equal(threw, true, 'Validator should throw when trial_id missing');
}

function testEnhancedMatcherValidation() {
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
  assert.equal(matches.length, 1, 'Enhanced matcher should return one result');
  const [match] = matches;
  assert.equal(match.trial_id, 'CTR0001');
  assert.ok(Array.isArray(match.inclusion_checks));
  assert.ok(Array.isArray(match.exclusion_checks));
  assert.ok(match.summary);
}

function run() {
  testValidateMatchResults();
  testEnhancedMatcherValidation();
  console.log('✅ match-result-validator tests passed');
}

try {
  run();
} catch (error) {
  console.error('❌ match-result-validator tests failed');
  console.error(error);
  process.exit(1);
}
