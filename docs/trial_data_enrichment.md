# Trial Data Enrichment Workflow

This repo now keeps two JSON snapshots of the clinical trial corpus:

- `data/trials_structured.json` – source dataset synced from upstream
- `data/trials_structured_enriched.json` – generated file with parsed eligibility metadata

The enriched file contains, for every trial:

- `structuredEligibility.inclusion[]` / `structuredEligibility.exclusion[]` objects with
  - `intent`: normalized category (age, ecog, platelet, hbv, pregnancy, etc.)
  - `tags`: keywords detected in the original text
  - `numeric`: optional `{ min, max, unit }` bounds extracted from the criterion
- `diseaseTokens` and `therapies` arrays for quick candidate retrieval

`server/services/trialCache.js` automatically loads the enriched snapshot when it exists, so the matching engine and retrieval layer can leverage the additional structure without extra configuration.

## Regenerating the enriched dataset

Run the enrichment script whenever `trials_structured.json` changes:

```bash
python scripts/enrich_trials.py
```

The script reads from `data/trials_structured.json` and writes the enriched output next to it. Commit both the script and the generated JSON whenever the upstream data changes so other environments stay in sync.

## Custom data paths

Set `TRIALS_JSON_PATH` if you need the API to load a bespoke dataset. When unset, `trialCache` first looks for `data/trials_structured_enriched.json`, then falls back to the raw file.

## Extending intents

To recognize additional eligibility patterns:

1. Update `INTENT_PATTERNS` in `scripts/enrich_trials.py` with new regexes.
2. Map the new intent inside `trialRetrievalService` and/or `trialMatchingEngine` for scoring.
3. Regenerate the enriched snapshot and add targeted tests to cover the new behavior.
