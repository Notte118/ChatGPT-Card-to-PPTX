// ==UserScript==
// @name         ChatGPT 卡片导出 PPTX
// @namespace    local.chatgpt-card-export
// @version      0.1.5
// @author       Notte118
// @license      MIT
// @homepageURL  https://github.com/Notte118/ChatGPT-Card-to-PPTX
// @supportURL   https://github.com/Notte118/ChatGPT-Card-to-PPTX/issues
// @updateURL    https://raw.githubusercontent.com/Notte118/ChatGPT-Card-to-PPTX/main/chatgpt-card-export.user.js
// @downloadURL  https://raw.githubusercontent.com/Notte118/ChatGPT-Card-to-PPTX/main/chatgpt-card-export.user.js
// @description  点选 ChatGPT 页面区域，导出可编辑的 PPTX
// @match        https://chatgpt.com/*
// @require      https://cdn.jsdelivr.net/npm/dom-to-pptx@2.1.2/dist/dom-to-pptx.bundle.js
// @require      https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js
// @grant        GM_registerMenuCommand
// @sandbox      DOM
// @run-at       document-idle
// @noframes
// ==/UserScript==

// BEGIN sandbox scheduler
// JSZip 的 postMessage 调度器依赖 event.source === self；用户脚本代理环境
// 可能使这个判断失败，导致 ZIP 打包永远不推进。改用沙箱中的定时器。
var setImmediate = function (callback, ...args) {
  return setTimeout(callback, 0, ...args);
};
var clearImmediate = function (handle) { clearTimeout(handle); };
globalThis.setImmediate = setImmediate;
globalThis.clearImmediate = clearImmediate;
// END sandbox scheduler

// BEGIN output font
// 在生成文件后统一字体，保留浏览器测量的布局，不改动 ChatGPT 页面样式。
async function forcePptxFont(blob) {
  const zip = await JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()));
  const xmlFiles = Object.values(zip.files).filter(file => !file.dir && /^ppt\/.*\.xml$/.test(file.name));
  await Promise.all(xmlFiles.map(async file => {
    const xml = await file.async('string');
    const updated = xml.replace(/\btypeface\s*=\s*(["'])(.*?)\1/g, 'typeface="Microsoft YaHei UI"');
    if (updated !== xml) zip.file(file.name, updated);
  }));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
// END output font

(function () {
  'use strict';
  if (document.getElementById('chatgpt-card-pptx-tool')) return;

  // 使用用户脚本的隔离环境加载依赖，不向 ChatGPT 注入 script 标签。
  const exporter = typeof domToPptx !== 'undefined' && typeof JSZip !== 'undefined' ? domToPptx : null;
  const host = document.createElement('div');
  host.id = 'chatgpt-card-pptx-tool';
  host.style.cssText = 'position:fixed;right:18px;bottom:24px;z-index:2147483647;';
  const ui = host.attachShadow({ mode: 'open' });
  const panel = document.createElement('div');
  panel.style.cssText = 'box-sizing:border-box;width:290px;padding:14px;border:1px solid #cbd5e1;border-radius:12px;background:#fff;color:#0f172a;box-shadow:0 4px 24px #0003;font:13px/1.5 system-ui,sans-serif;';
  const title = document.createElement('strong');
  title.textContent = 'ChatGPT → PPTX';
  const status = document.createElement('div');
  status.style.cssText = 'margin:8px 0;white-space:pre-wrap;overflow-wrap:anywhere;';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
  const outline = document.createElement('div');
  outline.style.cssText = 'display:none;position:fixed;pointer-events:none;box-sizing:border-box;border:2px solid #2563eb;background:#2563eb12;';
  panel.append(title, status, controls);
  ui.append(outline, panel);
  document.body.append(host);

  let picking = false;
  let selected = null;
  let hovered = null;
  let busy = false;
  let includePseudoElements = false;
  let needsReload = false;
  const history = [];

  function button(label, action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.style.cssText = 'padding:6px 9px;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;color:#0f172a;font:inherit;cursor:pointer;';
    btn.addEventListener('click', action);
    controls.append(btn);
    return btn;
  }

  const pickButton = button('选择区域', startPicking);
  const parentButton = button('扩大到父级', () => {
    if (!usable(selected?.parentElement)) return;
    history.push(selected);
    selected = selected.parentElement;
    showSelection();
  });
  const backButton = button('缩回一级', () => {
    const previous = history.pop();
    selected = previous?.isConnected ? previous : null;
    showSelection();
  });
  const exportButton = button('导出 PPTX', exportSelection);
  const pseudoButton = button('装饰：关', () => {
    includePseudoElements = !includePseudoElements;
    pseudoButton.textContent = `装饰：${includePseudoElements ? '开' : '关'}`;
    status.textContent = includePseudoElements
      ? '包含 ::before/::after 装饰；复杂装饰可能需要截图，耗时更长。'
      : '跳过 ::before/::after 装饰；保留普通文字、形状和 SVG。';
  });
  const cancelButton = button('取消 / Esc', cancelSelection);

  function usable(el) {
    if (!(el instanceof Element) || !el.isConnected) return false;
    if (el === document.body || el === document.documentElement || el === host) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function refreshButtons() {
    pickButton.disabled = busy || needsReload || !exporter;
    parentButton.disabled = busy || picking || !usable(selected?.parentElement);
    backButton.disabled = busy || picking || history.length === 0;
    exportButton.disabled = busy || needsReload || picking || !usable(selected) || !exporter;
    pseudoButton.disabled = busy || needsReload;
    cancelButton.disabled = busy;
    for (const btn of controls.children) btn.style.opacity = btn.disabled ? '0.45' : '1';
  }

  function drawOutline() {
    const el = picking ? hovered : selected;
    if (!usable(el) || busy) {
      outline.style.display = 'none';
      return;
    }
    const rect = el.getBoundingClientRect();
    Object.assign(outline.style, {
      display: 'block', left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`,
    });
  }

  function showSelection() {
    if (usable(selected)) {
      const rect = selected.getBoundingClientRect();
      const component = selected.getAttribute('data-d-component');
      status.textContent = `已选择 ${selected.tagName.toLowerCase()}${component ? ` [${component}]` : ''}\n${Math.round(rect.width)} × ${Math.round(rect.height)} px。确认蓝框范围，再导出。`;
    } else {
      selected = null;
      status.textContent = '点击“选择区域”，再点击需要导出的卡片。';
    }
    drawOutline();
    refreshButtons();
  }

  function startPicking() {
    if (busy || needsReload || !exporter) return;
    picking = true;
    hovered = null;
    selected = null;
    history.length = 0;
    status.textContent = '移动鼠标查看蓝框，点击选中；Esc 取消。';
    drawOutline();
    refreshButtons();
  }

  function cancelSelection() {
    if (busy || needsReload) return;
    picking = false;
    hovered = selected = null;
    history.length = 0;
    showSelection();
  }

  function candidate(event) {
    if (event.composedPath().includes(host)) return null;
    const el = event.target;
    if (!(el instanceof Element)) return null;
    // 优先整张 box；没有该结构时仍允许选择普通网页元素。
    const box = el.closest('[data-d-component="box"]');
    const target = box || el.closest('svg') || el;
    return usable(target) ? target : null;
  }

  document.addEventListener('pointermove', (event) => {
    if (!picking) return;
    hovered = candidate(event);
    drawOutline();
  }, true);

  // 捕获阶段拦截选取点击，避免触发卡片里的链接、按钮。
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']) {
    document.addEventListener(type, (event) => {
      if (!picking || event.composedPath().includes(host)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (type !== 'click') return;
      const target = candidate(event);
      if (!target) return;
      selected = target;
      picking = false;
      hovered = null;
      showSelection();
    }, true);
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || busy || needsReload || (!picking && !selected)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancelSelection();
  }, true);
  document.addEventListener('scroll', drawOutline, true);
  window.addEventListener('resize', drawOutline);

  async function withTimeout(task, ms, stage) {
    let timer;
    try {
      return await Promise.race([
        task,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            needsReload = true;
            reject(new Error(`${stage}超过 ${ms / 1000} 秒。底层任务无法中断，请刷新页面后重试。`));
          }, ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function exportSelection() {
    if (busy || needsReload || picking || !usable(selected) || !exporter) return;
    const target = selected;
    busy = true;
    status.textContent = '正在等待页面字体加载……';
    drawOutline();
    refreshButtons();
    // 工具位于 body 的独立子节点，允许选择的区域不包含它；转换时保持可见。
    try {
      await withTimeout(document.fonts.ready, 10000, '等待字体');
      status.textContent = '正在等待所选区域的图片加载……';
      await withTimeout(Promise.all(Array.from(target.querySelectorAll('img'), img => img.decode().catch(() => {}))), 10000, '等待图片');
      if (!usable(target)) throw new Error('目标已消失或被隐藏，请重新选择。');
      status.textContent = '正在转换 PPTX，请等待；大型区域可能需要更长时间。';
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rawBlob = await withTimeout(exporter.exportToPptx(target, {
        fileName: `chatgpt-card-${stamp}.pptx`,
        svgAsVector: true,
        autoEmbedFonts: false,
        includePseudoElements,
        // 由脚本在成功后下载；超时的底层任务即使稍后完成也不会突然下载。
        skipDownload: true,
      }), 30000, '转换 PPTX');
      status.textContent = '正在统一为 Microsoft YaHei UI 字体……';
      const blob = await withTimeout(forcePptxFont(rawBlob), 10000, '统一字体');
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = `chatgpt-card-${stamp}.pptx`;
        document.body.append(link);
        link.click();
        link.remove();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
      status.textContent = '已生成 PPTX 并发起下载。请检查 Chrome 下载列表及 PPT 中的文字、图标。';
    } catch (error) {
      console.error('[ChatGPT PPTX]', error);
      status.textContent = `导出失败：${error?.message || String(error)}`;
    } finally {
      busy = false;
      drawOutline();
      refreshButtons();
    }
  }

  showSelection();
  if (!exporter) status.textContent = '转换库未加载。请检查 Tampermonkey 的 @require 下载状态，再刷新页面。';
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('选择区域并导出 PPTX', startPicking);
  }
})();
