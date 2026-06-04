"""就绪度评分（T-MAT-04）。"""
DIMS = ["business_goal", "user_persona", "key_flow", "constraints", "success_criteria"]


def score_readiness(s: dict):
    dims = s.get("readiness_dimensions") or {}
    vals = [float(dims.get(d, 0.0)) for d in DIMS]
    score = round(sum(vals) / len(DIMS), 3)
    missing = s.get("missing_items") or [d for d, v in zip(DIMS, vals) if v < 0.5]
    return score, {d: float(dims.get(d, 0.0)) for d in DIMS}, missing
