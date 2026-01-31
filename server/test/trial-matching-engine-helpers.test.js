const assert = require('assert/strict');
const TrialMatchingEngine = require('../services/trialMatchingEngine');

function createEngine() {
  return new TrialMatchingEngine();
}

function testStructuredAgeExtraction() {
  const engine = createEngine();
  const trial = {
    structuredEligibility: {
      inclusion: [
        { intent: 'age', numeric: { min: 18, max: 70 } }
      ],
      exclusion: []
    }
  };

  const requirements = engine.extractAgeRequirements(trial);
  assert.equal(requirements.min, 18, 'Structured min age should be used');
  assert.equal(requirements.max, 70, 'Structured max age should be used');

  const exclusion = engine.checkHardExclusions({ age: 16 }, trial);
  assert.equal(exclusion.isExcluded, true, 'Age below min should trigger exclusion');
}

function testStructuredPlateletThreshold() {
  const engine = createEngine();
  const trial = {
    structuredEligibility: {
      inclusion: [
        { intent: 'platelet', numeric: { min: 120, unit: '×10^9/L' } }
      ],
      exclusion: []
    }
  };
  const details = [];
  const patient = {
    blood_counts: {
      platelet: 110,
      hemoglobin: 100,
      anc: 2
    },
    liver_function: {}
  };

  const score = engine.scoreLabValues(patient, trial, details);
  assert.ok(details.some((line) => line.includes('120')), 'Details should reflect structured platelet threshold');
  assert.ok(score < 10, 'Score should be reduced when platelet below threshold');
}

function testStructuredHBVExclusion() {
  const engine = createEngine();
  const trial = {
    structuredEligibility: {
      inclusion: [],
      exclusion: [
        { intent: 'hbv', criterion: '活动性乙肝受试者排除' }
      ]
    }
  };

  const exclusion = engine.checkHardExclusions({
    age: 55,
    viral_hepatitis: { hbv_status: 'HBV-DNA 阳性' }
  }, trial);

  assert.equal(exclusion.isExcluded, true, 'Active HBV should trigger exclusion');
}

function testStructuredBilirubinUsage() {
  const engine = createEngine();
  const trial = {
    structuredEligibility: {
      inclusion: [
        { intent: 'bilirubin', numeric: { max: 30, unit: 'μmol/L' } }
      ],
      exclusion: []
    }
  };

  const details = [];
  const patient = {
    primary_diagnosis: '肝细胞癌',
    blood_counts: {},
    liver_function: {
      alt: 120,
      tbil: 28
    }
  };

  const score = engine.scoreLabValues(patient, trial, details);
  assert.ok(details.some((line) => line.includes('总胆红素符合要求')), 'Details should reflect bilirubin limit');
  assert.ok(score > 0, 'Bilirubin within limit should contribute to score');
}

function run() {
  testStructuredAgeExtraction();
  testStructuredPlateletThreshold();
  testStructuredHBVExclusion();
  testStructuredBilirubinUsage();
  console.log('✅ trial-matching-engine helper tests passed');
}

try {
  run();
} catch (error) {
  console.error('❌ trial-matching-engine helper tests failed');
  console.error(error);
  process.exit(1);
}
