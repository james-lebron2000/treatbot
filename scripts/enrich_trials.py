#!/usr/bin/env python3
"""Enrich trial eligibility text with structured intents and numeric bounds."""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "data" / "trials_structured.json"
DEFAULT_OUTPUT = ROOT / "data" / "trials_structured_enriched.json"

# Regex patterns reused across detectors
RANGE_PATTERN = re.compile(
    r"(?P<min>\d+(?:\.\d+)?)\s*(?:-|~|–|—|至|到|~|～)\s*(?P<max>\d+(?:\.\d+)?)"
)
MIN_PATTERN = re.compile(
    r"(?:(?:≥|>=|不少于|不小于|至少|大于等于|大于)\s*)(?P<value>\d+(?:\.\d+)?)"
)
MAX_PATTERN = re.compile(
    r"(?:(?:≤|<=|不大于|至多|最多|小于等于|小于)\s*)(?P<value>\d+(?:\.\d+)?)"
)
NUMBER_PATTERN = re.compile(r"\d+(?:\.\d+)?")
LINE_PATTERN = re.compile(r"(?:(?:^|\n)\s*)(?:\d+\.?|•|\-|\*|①|②|③|④|⑤|⑥|⑦|⑧|⑨|⑩)\s*")

@dataclass
class NumericBound:
    """Numeric boundary description."""
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    unit: Optional[str] = None

    def to_dict(self) -> Dict[str, float]:
        data: Dict[str, float] = {}
        if self.min_value is not None and not math.isnan(self.min_value):
            data["min"] = self.min_value
        if self.max_value is not None and not math.isnan(self.max_value):
            data["max"] = self.max_value
        if self.unit:
            data["unit"] = self.unit
        return data

@dataclass
class StructuredCriterion:
    criterion: str
    intent: str
    tags: List[str]
    numeric: Optional[NumericBound] = None

    def to_dict(self) -> Dict[str, object]:
        payload: Dict[str, object] = {
            "criterion": self.criterion,
            "intent": self.intent,
            "tags": list(dict.fromkeys(self.tags)),
        }
        if self.numeric:
            num_dict = self.numeric.to_dict()
            if num_dict:
                payload["numeric"] = num_dict
        return payload


INTENT_PATTERNS: List[Tuple[str, Iterable[re.Pattern], str]] = [
    (
        "age",
        [re.compile(r"年龄"), re.compile(r"age", re.I)],
        "demographics",
    ),
    (
        "ecog",
        [re.compile(r"ECOG", re.I)],
        "performance",
    ),
    (
        "kps",
        [re.compile(r"KPS", re.I)],
        "performance",
    ),
    (
        "survival",
        [re.compile(r"生存期"), re.compile(r"survival", re.I)],
        "status",
    ),
    (
        "measurable",
        [re.compile(r"可测量"), re.compile(r"RECIST", re.I)],
        "disease_status",
    ),
    (
        "pregnancy",
        [re.compile(r"妊娠"), re.compile(r"怀孕"), re.compile(r"哺乳")],
        "safety",
    ),
    (
        "hbv",
        [re.compile(r"HBV", re.I), re.compile(r"乙型?肝炎"), re.compile(r"乙肝")],
        "infection",
    ),
    (
        "hcv",
        [re.compile(r"HCV", re.I), re.compile(r"丙型?肝炎")],
        "infection",
    ),
    (
        "hiv",
        [re.compile(r"HIV", re.I), re.compile(r"艾滋")],
        "infection",
    ),
    (
        "platelet",
        [re.compile(r"血小板"), re.compile(r"platelet", re.I)],
        "laboratory",
    ),
    (
        "neutrophil",
        [re.compile(r"中性粒"), re.compile(r"ANC", re.I)],
        "laboratory",
    ),
    (
        "hemoglobin",
        [re.compile(r"血红蛋白"), re.compile(r"hemoglobin", re.I)],
        "laboratory",
    ),
    (
        "wbc",
        [re.compile(r"白细胞"), re.compile(r"WBC", re.I)],
        "laboratory",
    ),
    (
        "bilirubin",
        [re.compile(r"胆红素"), re.compile(r"bilirubin", re.I)],
        "laboratory",
    ),
    (
        "alt",
        [re.compile(r"ALT", re.I), re.compile(r"丙氨酸" )],
        "laboratory",
    ),
    (
        "ast",
        [re.compile(r"AST", re.I), re.compile(r"天门冬氨酸")],
        "laboratory",
    ),
    (
        "creatinine",
        [re.compile(r"肌酐"), re.compile(r"creatinine", re.I)],
        "laboratory",
    ),
    (
        "urea",
        [re.compile(r"尿素"), re.compile(r"urea", re.I)],
        "laboratory",
    ),
    (
        "therapy_history",
        [re.compile(r"既往"), re.compile(r"治疗"), re.compile(r"线")],
        "treatment",
    ),
    (
        "cns",
        [re.compile(r"中枢神经"), re.compile(r"脑膜")],
        "metastasis",
    ),
    (
        "bleeding",
        [re.compile(r"出血"), re.compile(r"凝血")],
        "safety",
    ),
]


def detect_intents(text: str) -> Tuple[str, List[str]]:
    tags: List[str] = []
    intent = "general"
    for candidate, patterns, category in INTENT_PATTERNS:
        for pattern in patterns:
            if pattern.search(text):
                tags.append(candidate)
                if intent == "general":
                    intent = candidate
                break
    return intent, tags if tags else ["general"]


def extract_numeric_bounds(text: str) -> Optional[NumericBound]:
    working = text.replace("× 10", "×10").replace("x10", "×10")
    range_match = RANGE_PATTERN.search(working)
    bounds = NumericBound()
    if range_match:
        bounds.min_value = float(range_match.group("min"))
        bounds.max_value = float(range_match.group("max"))

    min_match = MIN_PATTERN.search(working)
    max_match = MAX_PATTERN.search(working)
    if min_match:
        value = float(min_match.group("value"))
        bounds.min_value = value if bounds.min_value is None else min(bounds.min_value, value)
    if max_match:
        value = float(max_match.group("value"))
        bounds.max_value = value if bounds.max_value is None else max(bounds.max_value, value)

    if bounds.min_value is None and bounds.max_value is None:
        # Handle patterns like ALT ≤ 3×ULN
        multiples = re.findall(r"(\d+(?:\.\d+)?)\s*[×x]\s*(?:ULN|上限)", working, re.I)
        if multiples:
            bounds.max_value = float(multiples[0])
            bounds.unit = "ULN"

    unit_match = re.search(r"(g/L|U/L|×10\^9/L|×10\^9\/L|10\^9/L|mg/dL|μmol/L|umol/L)", working, re.I)
    if unit_match:
        bounds.unit = unit_match.group(1)

    if bounds.min_value is None and bounds.max_value is None and not bounds.unit:
        return None
    return bounds


def split_lines(raw: str) -> List[str]:
    if not raw:
        return []
    normalized = raw.replace("\r\n", "\n").replace("；", ";\n")
    parts = [segment.strip() for segment in re.split(r"[\n;]+", normalized) if segment.strip()]
    cleaned: List[str] = []
    for segment in parts:
        cleaned.append(segment.lstrip("1234567890.-•*①②③④⑤⑥⑦⑧⑨⑩").strip())
    return cleaned


def structure_criteria(criteria: Iterable[str]) -> List[Dict[str, object]]:
    structured: List[StructuredCriterion] = []
    for raw in criteria:
        text = raw.strip()
        if not text:
            continue
        intent, tags = detect_intents(text)
        numeric = extract_numeric_bounds(text)
        structured.append(
            StructuredCriterion(
                criterion=text,
                intent=intent,
                tags=tags,
                numeric=numeric,
            )
        )
    return [entry.to_dict() for entry in structured]


def enrich_trial(trial: Dict[str, object]) -> Dict[str, object]:
    inclusion_raw = trial.get("inclusion_list")
    exclusion_raw = trial.get("exclusion_list")
    inclusions = structure_criteria(inclusion_raw or split_lines(trial.get("入组条件", "")))
    exclusions = structure_criteria(exclusion_raw or split_lines(trial.get("排除条件", "")))

    enriched = dict(trial)
    enriched["structuredEligibility"] = {
        "inclusion": inclusions,
        "exclusion": exclusions,
    }
    # Derive quick filters
    enriched["diseaseTokens"] = sorted(
        {token for token in re.split(r"[，,；;\s]", trial.get("疾病三级标签", "")) if token}
    )
    enriched["therapies"] = sorted(
        {token.strip() for token in (trial.get("试验组治疗方案") or "").split(',') if token.strip()}
    )
    return enriched


def enrich_trials(trials: List[Dict[str, object]]) -> List[Dict[str, object]]:
    return [enrich_trial(trial) for trial in trials]


def main(input_path: Path = DEFAULT_INPUT, output_path: Path = DEFAULT_OUTPUT) -> None:
    with input_path.open("r", encoding="utf-8") as fh:
        trials = json.load(fh)
    enriched = enrich_trials(trials)
    with output_path.open("w", encoding="utf-8") as fh:
        json.dump(enriched, fh, ensure_ascii=False, indent=2)
    print(f"Wrote {len(enriched)} trials to {output_path}")


if __name__ == "__main__":
    main()
