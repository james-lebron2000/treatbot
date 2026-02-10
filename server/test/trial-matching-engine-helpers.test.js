const TrialMatchingEngine = require('../services/trialMatchingEngine');

describe('TrialMatchingEngine helper methods (structuredEligibility)', () => {
  const createEngine = () => new TrialMatchingEngine();

  test('extractAgeRequirements uses structured eligibility and hard-excludes below min age', () => {
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
    expect(requirements.min).toBe(18);
    expect(requirements.max).toBe(70);

    const exclusion = engine.checkHardExclusions({ age: 16 }, trial);
    expect(exclusion.isExcluded).toBe(true);
  });

  test('scoreLabValues reflects structured platelet threshold in details and reduces score', () => {
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
    expect(details.some((line) => String(line).includes('120'))).toBe(true);
    expect(score).toBeLessThan(10);
  });

  test('checkHardExclusions excludes active HBV when exclusion mentions HBV', () => {
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

    expect(exclusion.isExcluded).toBe(true);
  });

  test('scoreLabValues uses structured bilirubin max and reports within-limit detail', () => {
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
    expect(details.some((line) => String(line).includes('总胆红素符合要求'))).toBe(true);
    expect(score).toBeGreaterThan(0);
  });
});

