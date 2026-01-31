# Clinical Trial Matching Overview

This document explains how the platform prepares, evaluates, and serves clinical trial matches so that reviewers can understand every step of the pipeline.

## 1. Trial Data Preparation

1. **Source Dataset**: The canonical dataset lives in `data/trials_structured.json`. It stores sponsor-supplied fields (trial IDs, inclusion/exclusion text, disease tags, etc.).
2. **Enrichment Script**: `scripts/enrich_trials.py` normalises that raw JSON into `data/trials_structured_enriched.json` by:
   - Tokenising `inclusion_list` / `exclusion_list` into line-level criteria.
   - Detecting intents (age, ECOG, platelet, HBV, pregnancy, CNS metastasis, etc.).
   - Extracting numeric bounds with unit metadata so downstream code can compare versus patient labs.
   - Deriving helper fields (`diseaseTokens`, `therapies`) used for retrieval.
3. **Cache Layer**: `server/services/trialCache.js` loads the enriched file, caches it (memory + Redis), and exposes two key helpers:
   - `loadNormalizedTrials()` – returns trial objects with normalised fields (`trialId`, `phase`, `ageRange`, etc.). This is the single source used by all matching flows.
   - `buildTrialsCsv()` – serialises the same data to a CSV string for LLM prompts.
   - Each normalised trial also keeps the structured eligibility fragments so rules can reuse numeric bounds.

## 2. Candidate Retrieval

Before scoring, the rule engine reduces the trial pool:

- `server/services/trialRetrievalService.js` derives patient tokens (diagnosis, biomarkers, metastasis hints) and compares them with `diseaseTokens` plus stage keywords extracted from eligibility text.
- This produces a baseline score (token overlap + stage + therapy history) and returns the top candidates (default ≤80). All later scoring starts from this filtered set.

## 3. Matching Engines

### 3.1 Classic Rule Matching (`POST /api/medical/match`)
1. Controller: `matchClinicalTrials` in `server/controllers/medicalController.js`.
2. Steps:
   - Load normalised trials (`status ∈ {recruiting, active}`).
   - Convert the patient record (structured fields or clinical archive fallback).
   - Run `computeClassicMatches` (simple weighted factors: age-range, gender, mutations, diagnosis).
   - Map results into the standard match schema with `mapClassicMatchesToEnhanced`, including trial metadata from the cache.
3. Response Metadata: `provider.totalTrials` and `provider.matchedTrials` show how many trials were evaluated vs. passed filters; front-end uses these counts for progress displays.

### 3.2 LLM-Assisted Matching (`POST /api/medical/match/llm`)
1. Controller: `matchClinicalTrialsWithLLM`.
2. Steps:
   - Load the same normalised trials and build a CSV via `trialCache.buildTrialsCsv`.
   - Send patient data + CSV to `TrialMatchingService.matchWithLLM`, which wraps the Moonshot LLM prompt.
   - Validate LLM output with `validateMatchResults`. If parsing fails or the model returns nothing, fall back to the classic matcher above.
   - Attach metadata (`provider.source`, `totalTrials`, `matchedTrials`) so the UI can report progress.
3. Provider metadata indicates the matching backend (`moonshot` when LLM succeeds; `classic-rule-engine` when falling back).

### 3.3 Enhanced Rule Matching (`POST /api/medical/match/enhanced`)
1. Controller: `matchTrialsWithStructuredData`.
2. For structured archives (`clinicalArchive` payload):
   - Run `enhancedTrialMatcher.matchTrialsWithArchive`, which evaluates each criterion intent using the structured eligibility metadata (numeric thresholds, infection flags, etc.).
3. For legacy structured records:
   - Run `TrialMatchingEngine.matchPatient` (category-weighted scoring: demographics, lab values, treatment history, biomarkers, comorbidities).
   - Convert results to the enhanced schema with `convertEngineMatchesToEnhanced` so inclusion/exclusion checks and summaries remain consistent.
4. All match arrays are augmented with trial metadata, total evaluated trial count, and match counts for UI progress.

## 4. Patient-Level Matching (`GET /api/patients/:id/match`)
- `matchPatientTrials` in `server/controllers/patientController.js` reuses the LLM flow, so patient dashboard requests automatically share the same trial dataset, fallbacks, and metadata fields.

## 5. Front-End Progress Feedback

- The React hook `useThinkingMode` (in `client/src/hooks/useThinkingMode.ts`) now tracks `completedItems` and `totalItems`. Controllers populate `provider.totalTrials` / `provider.matchedTrials`, and the UI feeds those counts back into the hook via `setMatchingProgress`.
- **Extraction Step UI** (`client/src/app/patients/[id]/extract/page.tsx`): status banners display “Matched X / Y” while the matching request is running.
- **Results Page** (`client/src/app/patients/[id]/results/page.tsx`):
  - Shows a live progress card during refresh/matching.
  - Displays matched vs. total and remaining trials in the header and summary.
  - Reuses provider metadata when loading cached results for consistent counts.

## 6. Error Handling & Fallbacks

- Each controller degrades gracefully: LLM failures route to classic matches (with metadata stating the fallback), and validation errors surface to the client with progress reset.
- Front-end components surface these errors via `thinking.setError` and toast notifications so users know when manual review is needed.

## 7. How to Regenerate or Review Data

1. Update raw trial data → run `python scripts/enrich_trials.py` → commits the regenerated `trials_structured_enriched.json`.
2. Restart backend/clear Redis cache (`trialCache.refreshTrials()`) so services load the refreshed dataset.
3. Review the enriched file (`structuredEligibility`) to audit intent tagging; update `scripts/enrich_trials.py` patterns if new criteria need explicit rules.

This pipeline ensures that every matching endpoint consumes the same curated dataset, exposes deterministic metadata for auditing, and keeps the UI progress indicators in sync with backend processing.
