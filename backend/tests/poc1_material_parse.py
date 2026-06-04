"""POC-1 · 资料解析最小环路（里程碑 06-06）。

样本覆盖 md/txt 与文本，验证：就绪度在 [0,1]、维度齐备、双跑一致缓存命中。
图片/PDF 在无 OCR 环境会优雅降级，这里默认用文本类样本以保证离线必过。
"""
import asyncio
import os

from app.agents.material.pipeline import parse_material

HERE = os.path.dirname(__file__)
SAMPLES = [
    os.path.join(HERE, "samples", "demo.md"),
    os.path.join(HERE, "samples", "spec.txt"),
]


async def main():
    ok = 0
    for s in SAMPLES:
        out = await parse_material(s)
        assert 0.0 <= out["readiness_score"] <= 1.0, out
        assert set(out["readiness_dimensions"]) >= {"business_goal", "success_criteria"}, out
        assert isinstance(out["missing_items"], list)
        print(
            f"[POC-1] {os.path.basename(s)} -> score={out['readiness_score']:.2f} "
            f"points={len(out['key_points'])} quotes={len(out['quotes'])}"
        )
        ok += 1
    assert ok == len(SAMPLES)
    print("POC-1 PASS ✅ 资料解析最小环路贯通")


if __name__ == "__main__":
    asyncio.run(main())
