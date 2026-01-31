const { matchTrialsWithArchive } = require('../services/enhancedTrialMatcher');
const { computeClassicMatches } = require('../utils/matching');
const { mapClassicMatchesToEnhanced } = require('../controllers/medicalController');
const { validateMatchResults } = require('../utils/matchResultValidator');

function buildSampleArchive() {
  return {
    patient_id: 'P-DEMO-001',
    basic_info: {
      name: '李雷',
      gender: 'male',
      age: '53',
      date_of_birth: '1972-12-12'
    },
    medical_history: {
      primary_diagnosis: '肝细胞癌',
      infection_status: {
        HBV: 'HBV-DNA < 50 IU/ml'
      }
    },
    pathology: {
      stage: 'II',
      histology: 'HCC',
      molecular_markers: {
        'PD-L1': '10%'
      }
    },
    lab_results: {
      blood_counts: {
        Platelets: '110×10^9/L',
        Hemoglobin: '125 g/L'
      }
    },
    current_status: {
      measurable_lesions: true,
      organ_function_ok: true,
      estimated_survival_months: '12',
      symptoms: ['疲劳']
    },
    ecog_score: '1'
  };
}

function buildSampleTrials() {
  return [
    {
      trialId: 'CTR-LLM-001',
      title: '肝癌组合疗法试验',
      condition: '肝细胞癌',
      phase: 'Phase III',
      inclusionCriteria: ['年龄 18-75 岁', 'ECOG ≤ 1', '存在可测量病灶'],
      exclusionCriteria: ['血小板 ≥ 90×10^9/L', '活动性乙肝排除'],
      targetMutations: ['PD-L1 阳性'],
      ageRange: { min: 18, max: 75 },
      gender: 'both',
      location: '上海',
      status: 'recruiting',
      contactInfo: {
        name: '王主任',
        email: 'contact@example.com',
        phone: '+86-21-000000'
      }
    },
    {
      trialId: 'CTR-LLM-002',
      title: '免疫治疗探索',
      condition: '晚期肝癌',
      phase: 'Phase II',
      inclusionCriteria: ['ECOG ≤ 2'],
      exclusionCriteria: ['严重肝功能不全'],
      targetMutations: [],
      ageRange: { min: 18, max: 80 },
      gender: 'both',
      location: '北京',
      status: 'recruiting'
    }
  ];
}

function runEnhancedMatcherScenario() {
  const archive = buildSampleArchive();
  const trials = buildSampleTrials();
  const results = matchTrialsWithArchive(archive, trials);
  validateMatchResults(results, 'enhanced-success');
  if (!results.length) {
    throw new Error('Enhanced matcher returned no results for valid archive');
  }
  console.log('✅ Enhanced matcher produced structured match results:', results[0].trial_id, results[0].match_score);
}

function runFallbackScenario() {
  const trials = buildSampleTrials();
  const medicalRecord = {
    structuredData: {
      age: 52,
      gender: 'male',
      diagnosis: '肝细胞癌',
      mutations: ['PD-L1 阳性']
    }
  };
  const classicMatches = computeClassicMatches(trials, medicalRecord);
  if (!classicMatches.length) {
    throw new Error('Classic matcher produced no results, cannot test fallback');
  }
  const enhancedFallback = mapClassicMatchesToEnhanced(classicMatches);
  validateMatchResults(enhancedFallback, 'classic-fallback');
  console.log('✅ Classic fallback converted to enhanced structure:', enhancedFallback[0].trial_id, enhancedFallback[0].match_score);
}

function run() {
  runEnhancedMatcherScenario();
  runFallbackScenario();
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error('❌ Enhanced matching integration test failed');
    console.error(error);
    process.exit(1);
  }
}

module.exports = {
  runEnhancedMatcherScenario,
  runFallbackScenario
};
