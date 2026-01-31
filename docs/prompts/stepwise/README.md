# Stepwise Extraction Prompts

Each prompt matches a numbered extraction step in `StepwiseLLMService`. Prompts enforce strict JSON output aligned with `docs/record_trial_field_mapping.md` so that the downstream matching engine receives normalized data.

1. `step_1_basic_info.txt`
2. `step_2_diagnosis_staging.txt`
3. `step_3_metastasis.txt`
4. `step_4_performance_status.txt`
5. `step_5_surgical_history.txt`
6. `step_6_systemic_treatments.txt`
7. `step_7_lab_values.txt`
8. `step_8_comorbidities.txt`
9. `step_9_molecular_markers.txt`
10. `step_10_adverse_events.txt`
11. `step_11_special_conditions.txt`

Prompts include:
- Short system role instructions
- Structured JSON schema with required/optional fields
- Example values matching trial terminology
- Guidance on confidence scoring
- `evidence` snippets copied from the source text (for traceability)

Any time the patient schema or trial dataset evolves, update the mapping doc first, then refresh these prompts.
