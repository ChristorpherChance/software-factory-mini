// 软件工厂缩小版 · 客户端导出工具（问题4）
// 零依赖：仅用浏览器原生 Blob / a[download] / window.open。
// 设计：Markdown 直接由源文本导出；Word(.doc)/PDF 用「已渲染 HTML」以保留排版，
//       故调用方从已渲染的 <article> 节点取 innerHTML 传入。

/** 去掉文件名中的非法字符（Windows/类 Unix 通用），并去除首尾空白。 */
export function sanitizeFilename(name: string): string {
  const cleaned = (name ?? "")
    .replace(/[\\/:*?"<>|]/g, "_") // 文件系统非法字符
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "document";
}

/** 触发浏览器下载一个 Blob，文件名为 filename（调用方负责带扩展名）。 */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 释放对象 URL（延迟一拍，确保下载已开始）
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** 下载 Markdown 源文本为 filename.md。 */
export function downloadMarkdown(filename: string, md: string): void {
  const blob = new Blob([md ?? ""], { type: "text/markdown;charset=utf-8" });
  triggerDownload(blob, `${sanitizeFilename(filename)}.md`);
}

/** 文档内联样式：标题层级字号、表格边框、正文行高。doc/pdf 共用。 */
const DOC_STYLE = `
  body { font-family: -apple-system, "Segoe UI", "Microsoft YaHei", Arial, sans-serif;
         color: #1a1a1a; line-height: 1.7; font-size: 14px; margin: 32px; }
  h1 { font-size: 26px; margin: 0.6em 0 0.4em; }
  h2 { font-size: 21px; margin: 0.6em 0 0.4em; }
  h3 { font-size: 17px; margin: 0.6em 0 0.4em; }
  h4, h5, h6 { font-size: 15px; margin: 0.6em 0 0.4em; }
  p { margin: 0.5em 0; }
  ul, ol { margin: 0.5em 0; padding-left: 1.6em; }
  table { border-collapse: collapse; width: 100%; margin: 0.8em 0; }
  th, td { border: 1px solid #888; padding: 6px 10px; text-align: left; }
  th { background: #f2f2f2; }
  code { font-family: Consolas, Menlo, monospace; background: #f4f4f4; padding: 1px 4px; border-radius: 3px; }
  pre { background: #f4f4f4; padding: 12px; border-radius: 6px; overflow: auto; white-space: pre-wrap; }
  blockquote { border-left: 3px solid #ccc; margin: 0.5em 0; padding-left: 12px; color: #555; }
`;

/** 组装完整 HTML 文档字符串（含 charset 与内联样式）。 */
function buildHtmlDoc(innerHtml: string, title: string, extraStyle = ""): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>${DOC_STYLE}${extraStyle}</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${innerHtml}
</body>
</html>`;
}

/** 转义标题里可能出现的 HTML 特殊字符（正文 innerHtml 已是受信 DOM 内容，不再转义）。 */
function escapeHtml(s: string): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * 把已渲染 HTML 另存为 Word 文档（filename.doc）。
 * Blob 类型 application/msword，Word 可正常打开并保留排版。
 */
export function exportDocFromHtml(
  filename: string,
  innerHtml: string,
  title?: string
): void {
  const docTitle = title ?? filename;
  const html = buildHtmlDoc(innerHtml, docTitle);
  const blob = new Blob(["﻿", html], { type: "application/msword" });
  triggerDownload(blob, `${sanitizeFilename(filename)}.doc`);
}

/**
 * 把已渲染 HTML 在新窗口打印（用户在打印对话框可「另存为 PDF」）。
 * 处理弹窗被拦截：window.open 返回 null 时 alert 提示。
 */
export function exportPdfFromHtml(innerHtml: string, title?: string): void {
  const docTitle = title ?? "导出文档";
  // 打印友好样式：去页边距由浏览器接管，正文适配 A4。
  const printStyle = `
    @media print { body { margin: 0; } @page { margin: 18mm; } }
  `;
  const html = buildHtmlDoc(innerHtml, docTitle, printStyle);
  const win = window.open("", "_blank");
  if (!win) {
    alert("导出 PDF 失败：浏览器拦截了弹出窗口，请允许本站点弹窗后重试。");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  // onload 后触发打印；若资源已就绪则兜底直接调用。
  win.onload = () => {
    win.focus();
    win.print();
  };
  if (win.document.readyState === "complete") {
    win.focus();
    win.print();
  }
}
