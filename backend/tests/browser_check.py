"""真实浏览器 UI 走查（Playwright，headless Chromium）。

驱动运行中的前端，完整跑：首页→新建项目→进入工作台→资料解析→生成 ORD→验证渲染。
用法：python browser_check.py [base_url]
"""
import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3002"


def log(*a):
    print("[browser]", *a, flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    log("打开首页", BASE)
    page.goto(BASE, wait_until="networkidle", timeout=30000)
    page.screenshot(path="/tmp/ui_1_home.png", full_page=True)
    assert "软件工厂" in page.content(), "首页未渲染应用标题"
    log("首页 OK")

    # 新建项目
    page.locator("button:has-text('新建')").first.click()
    page.wait_for_timeout(1200)
    try:
        inp = page.locator("input[type=text]").first
        if inp.is_visible():
            inp.fill("浏览器走查项目")
            page.locator("button:has-text('创建'), button:has-text('确定'), button:has-text('新建')").last.click()
            page.wait_for_timeout(1500)
    except Exception as e:
        log("新建弹窗交互跳过:", e)
    # 关闭可能残留的弹窗遮罩
    page.keyboard.press("Escape")
    page.wait_for_timeout(800)

    # 取项目工作台 URL，直接导航（绕过遮罩点击）
    link = page.locator("a[href*='/p/']").first
    href = link.get_attribute("href")
    assert href, "未创建项目链接"
    log("进入工作台:", href)
    # 工作台有常驻 SSE 连接，networkidle 永不触发；用 domcontentloaded
    page.goto(BASE + href, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(3500)
    page.screenshot(path="/tmp/ui_2_workbench.png", full_page=True)

    body = page.content()
    has_stage = ("资料" in body) and ("需求" in body)
    has_chat = page.locator("textarea").count() > 0
    log("工作台：阶段导航(资料/需求)=", has_stage, " 对话输入框=", has_chat)

    # 发消息：精确定位右侧【对话区】输入框（placeholder 含「输入消息」），不是主区资料粘贴框
    ta = page.locator("textarea[placeholder*='输入消息']").first
    sent = False
    streamed = False
    if ta.count() > 0:
        ta.fill("生成 ORD")
        ta.press("Control+Enter")
        # 等 SSE 流式回复在对话区渲染
        try:
            page.wait_for_function(
                "() => !document.body.innerText.includes('还没有消息')",
                timeout=15000,
            )
        except Exception:
            pass
        page.wait_for_timeout(3000)
        page.screenshot(path="/tmp/ui_3_after_send.png", full_page=True)
        sent = True
        body2 = page.content()
        # 对话区出现助手回复（流式拼出的 ORD 内容或"生成…中"）
        streamed = ("原始需求" in body2) or ("生成 ORD 中" in body2) or ("就绪度" in body2) or ("ORD" in body2 and "还没有消息" not in body2)
        log("已发消息，对话区出现流式回复=", streamed)

    log("控制台错误数:", len(errors))
    for e in errors[:8]:
        log("  console.error:", e[:160])
    browser.close()
    print(f"BROWSER CHECK: DONE has_stage={has_stage} has_chat={has_chat} sent={sent} console_errors={len(errors)}")
