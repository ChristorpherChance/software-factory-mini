"""E2E 验证 20260603 变更的全部新端点。"""
import io
import json
import urllib.request

BASE = "http://localhost:8001/api/v1"
TOKEN = "dev-single-workspace-token"


def call(method, path, body=None, files=None):
    url = BASE + path
    headers = {"Authorization": f"Bearer {TOKEN}"}
    data = None
    if files:
        boundary = "----sfmini20260603"
        parts = []
        fname, fcontent = files
        parts.append(f"--{boundary}".encode())
        parts.append(
            f'Content-Disposition: form-data; name="file"; filename="{fname}"'.encode()
        )
        parts.append(b"Content-Type: text/markdown")
        parts.append(b"")
        parts.append(fcontent.encode("utf-8"))
        parts.append(f"--{boundary}--".encode())
        data = b"\r\n".join(parts)
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def main():
    results = []

    # 1) 创建项目
    s, r = call("POST", "/projects", {"name": "变更验证项目"})
    pid = r["data"]["id"]
    results.append(("创建项目", s == 200, pid))

    # 2) 上传文件
    md = "# 测试文档\n用户登录、下单、支付功能。\n联系人：张三 13800138000"
    s, r = call("POST", f"/projects/{pid}/files/upload", files=("test-doc.md", md))
    fid = r["data"]["id"] if s == 200 else None
    results.append(("上传文件", s == 200, f"status={r['data']['status'] if s==200 else r}"))

    # 3) 列出待解析
    s, r = call("GET", f"/projects/{pid}/files")
    results.append(("列出文件", s == 200 and len(r["data"]) == 1, f"{len(r['data']) if s==200 else '?'} 个"))

    # 4) file_id 解析
    s, r = call("POST", f"/projects/{pid}/materials", {"file_id": fid})
    mid = r["data"]["id"] if s == 200 else None
    results.append(("file_id 解析", s == 200, f"mid={mid}"))

    # 5) 文件状态变 parsed
    s, r = call("GET", f"/projects/{pid}/files")
    fstatus = r["data"][0]["status"] if s == 200 else "?"
    results.append(("文件状态→parsed", fstatus == "parsed", f"status={fstatus}"))

    # 6) 资料定稿
    s, r = call("POST", f"/projects/{pid}/materials/{mid}/finalize")
    results.append(("资料定稿", s == 200 and r["data"]["status"] == "finalized", str(r.get("data"))))

    # 7) materials 列表含 finalized
    s, r = call("GET", f"/projects/{pid}/materials")
    mstatus = r["data"][0]["status"] if s == 200 else "?"
    results.append(("列表 status=finalized", mstatus == "finalized", f"status={mstatus}"))

    # 8) 内容解析 transform（翻译）
    s, r = call("POST", f"/projects/{pid}/materials/{mid}/transform", {"op": "translate_en_zh"})
    results.append(("内容解析-翻译", s == 200 and r["data"]["version"] == 2, f"v={r['data'].get('version') if s==200 else r}"))

    # 9) transform 脱敏
    s, r = call("POST", f"/projects/{pid}/materials/{mid}/transform", {"op": "desensitize"})
    results.append(("内容解析-脱敏", s == 200 and "脱敏" in r["data"]["content"], f"v={r['data'].get('version') if s==200 else '?'}"))

    # 10) 不支持的 op
    s, r = call("POST", f"/projects/{pid}/materials/{mid}/transform", {"op": "bogus"})
    results.append(("非法 op 拒绝", s == 400, f"status={s}"))

    # 11) 创建 CRD 工件
    s, r = call("POST", f"/projects/{pid}/artifacts", {"type": "crd", "title": "客户需求 CRD", "content": "# CRD\n初版"})
    aid = r["data"]["id"] if s == 200 else None
    results.append(("创建 CRD 工件", s == 200, f"aid={aid}"))

    # 12) 设置参考资料
    s, r = call("POST", f"/projects/{pid}/artifacts/{aid}/references", {"materialIds": [mid]})
    results.append(("设置参考资料", s == 200 and r["data"]["references"] == [mid], str(r.get("data"))))

    # 13) 版本提交
    s, r = call("POST", f"/projects/{pid}/artifacts/{aid}/submit-version", {"content": "# CRD\n第二版", "note": "版本提交"})
    results.append(("版本提交", s == 200 and r["data"]["version"] == 2, f"v={r['data'].get('version') if s==200 else r}"))

    # 14) 删除文件
    s, r = call("DELETE", f"/projects/{pid}/files/{fid}")
    results.append(("删除文件", s == 200, str(r.get("data"))))

    print("\n" + "=" * 60)
    ok = 0
    for name, passed, detail in results:
        mark = "[PASS]" if passed else "[FAIL]"
        if passed:
            ok += 1
        print(f"  {mark} {name:24s} {detail}")
    print("=" * 60)
    print(f"  {ok}/{len(results)} passed")
    return ok == len(results)


if __name__ == "__main__":
    import sys
    sys.exit(0 if main() else 1)
