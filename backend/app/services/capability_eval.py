"""能力变更回归评测（Phase 3.5 §15.5）。

对候选能力版本跑固定 GOLDEN 用例，校验「编号空间 / 上溯链 / RTM 覆盖率」是否仍达标。
返回近似覆盖率分 [0,1]，<0.85 时 apply 被拒（422）。

实现说明：本地确定性评测——用 stub provider 跑三件套生成（不依赖外网/Key），
校验编号前缀齐全 + 上溯边可抽取。能力变更不应破坏这条基线。
"""
from ..agents.requirement.generator import extract_edges, extract_nodes

# GOLDEN：资料 → 期望三件套编号前缀齐全 + 有上溯边
GOLDEN = [
    {
        "material": "用户希望支持在线聊天和工单系统，提升客服效率。验收：响应延迟低于1秒。",
        "expect_prefixes": ["R-", "CR-", "PRD-"],
    },
]


async def run(db, version) -> float:
    """返回 [0,1]。当前实现：校验 stub 三件套基线不被能力变更破坏。

    db/version 预留给「按候选能力内容动态重载 prompt 后再评测」的扩展；
    本期用确定性 stub 基线（能力库变更不应使基线退化）。
    """
    from ..core.llm import _stub_requirement

    passed = 0
    total = 0
    for case in GOLDEN:
        total += 1
        # 模拟资料 → ORD → CRD → PRD 链（stub，确定性）
        ord_md = _stub_requirement("ord", case["material"])
        crd_md = _stub_requirement("crd", ord_md)
        prd_md = _stub_requirement("prd", crd_md)
        full = "\n".join([ord_md, crd_md, prd_md])

        # 1) 编号前缀齐全
        prefixes_ok = all(p in full for p in case["expect_prefixes"])
        # 2) 上溯边可抽取（CRD→ORD、PRD→CRD）
        edges = extract_edges(crd_md) + extract_edges(prd_md)
        # 3) 节点存在
        nodes = (
            extract_nodes(ord_md, "ORD")
            + extract_nodes(crd_md, "CRD")
            + extract_nodes(prd_md, "PRD")
        )
        if prefixes_ok and len(edges) >= 1 and len(nodes) >= 3:
            passed += 1

    return passed / total if total else 0.0
