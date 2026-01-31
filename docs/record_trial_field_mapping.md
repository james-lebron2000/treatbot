# Medical Record ↔ Trial Criteria Mapping

This table aligns the structured patient medical record fields with the attributes used in `data/trials_structured.json`. All extraction and matching logic should normalize values to these shapes so that the scoring engine can evaluate eligibility precisely.

| Category | Trial Dataset Keys | Patient Record Fields | Normalization Notes |
|----------|-------------------|-----------------------|---------------------|
| Demographics | `入组条件` (age range, sex) | `age`, `gender` | Output integer age. Gender must be `male` / `female`. |
| Diagnosis | `疾病三级标签`, `入组条件` | `primary_diagnosis`, `pathology_type`, `grade` | Normalize diagnosis to accepted strings (e.g. `肝细胞癌`). |
| Staging | `入组条件` (TNM/BCLC/CNLC) | `staging_system`, `staging_value`, `mvi_grade` | Support multiple systems: map e.g. `CNLC IIIb` to `CNLC` + `IIIb`.|
| Metastasis | `排除条件` (CNS, bone, effusions) | `metastasis_sites`, `cns_metastasis`, `bone_metastasis`, `ascites_pleural_effusion` | Detect CNS involvement flags. |
| Performance Status | `入组条件` (ECOG) | `ecog_score`, `kps_score`, `expected_survival_months` | ECOG 0–4 integer, derived from text when missing. |
| Lab / Organ Function | `入组条件`, `排除条件` (ALT/AST, bilirubin, creatinine, coagulation) | `lab_values.liver_function`, `lab_values.kidney_function`, `lab_values.coagulation`, `lab_values.blood_counts`, `lab_values.tumor_markers` | Convert to numeric values with consistent units. |
| Viral Status | `排除条件` (HBV/HCV/HIV) | `viral_hepatitis.hbv_status`, `viral_hepatitis.hcv_status`, `other_infections` | Use values `阳性`/`阴性`/`既往感染`, supply DNA/RNA loads when available. |
| Comorbidities | `排除条件` (autoimmune, ILD, cardiovascular) | `comorbidities` (cardiovascular, autoimmune, respiratory) | Boolean flags indicating exclusion-risk conditions. |
| Treatment History | `治疗线数`, `试验组治疗方案`, `入组条件` (prior therapies) | `systemic_treatments` (array), `total_treatment_lines`, `previous_treatments` | Represent as ordered list of lines with regimen and response. |
| Prior Clinical Trials | `排除条件` (prior investigational therapy) | `systemic_treatments[].clinical_trial_history` | Mark participation in investigational regimens. |
| Contraindications | `排除条件` (pregnancy, transplant, infection, immunosuppressive meds) | `special_conditions`, `comorbidities` | Provide booleans for pregnancy, recent surgery, transplant, immunosuppressant use. |
| Biomarkers / Genetics | `入组条件` (HER2, EGFR, BRCA, MSI) | `molecular_markers`, `mutations`, `pd_l1_status`, `msi_status` | Normalize gene names uppercase; include mutation status strings. |
| Imaging / Lesions | `排除条件` (measurable lesions, brain metastasis) | `metastasis_sites`, `measurable_lesions` | `measurable_lesions` boolean and list of lesion descriptions. |
| Supportive Data | `报名资料`, `患者补助` (for reference) | `social_support`, `medication_compliance`, `substance_use` | Optional, improves trial matching context. |

**Required Fields for Matching (must be populated whenever possible):**
- `age`, `gender`
- `primary_diagnosis`, `staging_system`, `staging_value`
- `ecog_score`
- `metastasis_sites`
- `total_treatment_lines`, `systemic_treatments[]`
- `viral_hepatitis.hbv_status`
- Key lab values: ALT, AST, TBIL, creatinine, INR, platelets

**Value Normalization Rules:**
- Use ISO-style units (e.g., bilirubin `µmol/L`, creatinine `µmol/L`, ALT `U/L`).
- Convert staged text like `CNLC IIIb期` to `staging_system="CNLC"`, `staging_value="IIIb"`.
- ECOG extracted as integer; when missing, derive from functional description with confidence.
- Metastasis arrays contain canonical Chinese anatomic labels used in trial data (`肝`, `肺`, `骨`, `脑`, etc.).
- Treatments represented as:
```json
{
  "line": 1,
  "regimen": ["信迪利单抗", "仑伐替尼"],
  "drug_classes": ["免疫治疗", "靶向治疗"],
  "start_date": "2022-03-01",
  "end_date": "2022-09-15",
  "best_response": "SD",
  "reason_for_discontinuation": "疾病进展"
}
```

Keep this mapping synchronized with any updates to the trial dataset or patient schema.
