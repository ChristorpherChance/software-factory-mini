"""需求 Agent：三件套生成 + 追溯边抽取（T-REQ-01~04）。

经 core.llm provider（默认 stub）。RTM 边方向约定：
  from = 下游/子（被定义的节点），to = 上游/父（其来源），relation='derives'。
从 Markdown 中解析「<编号> ... 上溯：<上游编号,...>」生成边。
"""
import re

from ...core.llm import generate_requirement

# 兼容「上溯」与可能的 OCR 变体「上港」
_UP = r"(?:上溯|上港|来源|derive[s]?)"
_CODE = r"(?:PRD-[A-Z]+-\d+|CR-[A-Z]+-\d+|CR-\d+|R-[A-Z]+-\d+|R-\d+|PRD-\d+)"


async def generate(kind: str, upstream_md: str, session_id: str | None = None) -> dict:
    md = await generate_requirement(kind, upstream_md, session_id=session_id)
    return {"kind": kind, "markdown": md, "edges": extract_edges(md)}


def extract_edges(md: str) -> list[dict]:
    """每行形如 ``- CR-001 文案（上溯：R-001, R-002）`` → 边 from=CR-001 to=R-00x。"""
    edges: list[dict] = []
    for line in md.splitlines():
        m = re.search(rf"({_CODE}).*?{_UP}[:：]\s*([^（）()]*)", line)
        if not m:
            continue
        src = m.group(1)
        for tgt in re.split(r"[,，、\s]+", m.group(2).strip()):
            tgt = tgt.strip("。.;；")
            if re.fullmatch(_CODE, tgt):
                edges.append({"from": src, "to": tgt, "relation": "derives"})
    return edges


def extract_nodes(md: str, layer: str) -> list[dict]:
    """抽取本文档定义的节点编号（行首列表项的编号）。"""
    nodes: list[dict] = []
    seen: set[str] = set()
    for line in md.splitlines():
        m = re.match(rf"\s*[-*]\s*({_CODE})\s+(.*)", line)
        if m and m.group(1) not in seen:
            seen.add(m.group(1))
            title = re.split(r"（", m.group(2))[0].strip()
            nodes.append({"code": m.group(1), "layer": layer, "title": title[:80]})
    return nodes
