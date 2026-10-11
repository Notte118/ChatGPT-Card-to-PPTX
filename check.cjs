// 运行：node check.cjs。验证交互状态；不替代 Chrome/Tampermonkey 实测。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const elements = [];
class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.style = {};
    this.children = [];
    this.events = {};
    this.attributes = {};
    this.isConnected = true;
    elements.push(this);
  }
  append(...nodes) {
    for (const node of nodes) { this.children.push(node); node.parentElement = this; }
  }
  attachShadow() { const shadow = new Element(); shadow.parentElement = this; return shadow; }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key] || null; }
  addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
  getBoundingClientRect() { return { left: 10, top: 20, width: 320, height: 180 }; }
  querySelectorAll() { return []; }
  click() { downloads++; }
  remove() { this.parentElement.children = this.parentElement.children.filter(el => el !== this); }
  closest(selector) {
    for (let el = this; el; el = el.parentElement) {
      if (selector === 'svg' ? el.tagName === 'SVG' : el.attributes['data-d-component'] === 'box') return el;
    }
    return null;
  }
}
const body = new Element('body');
const html = new Element('html');
html.append(body);
const document = {
  body, documentElement: html, fonts: { ready: Promise.resolve() }, events: {},
  createElement: tag => new Element(tag),
  getElementById: id => elements.find(el => el.id === id),
  addEventListener: Element.prototype.addEventListener,
};
const calls = [];
let fail = false;
let hang = false;
let downloads = 0;
let finishLate;
const context = vm.createContext({
  document, Element, window: { addEventListener() {} }, console: { error() {} },
  URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
  JSZip: {
    async loadAsync() {
      return { files: {}, async generateAsync() { return {}; } };
    },
  },
  setTimeout: (fn, ms) => {
    const timer = setTimeout(fn, hang && ms === 30000 ? 0 : ms);
    if (ms === 10000) timer.unref();
    return timer;
  }, clearTimeout,
  domToPptx: { async exportToPptx(target, options) {
    assert.notEqual(document.getElementById('chatgpt-card-pptx-tool').style.display, 'none');
    calls.push({ target, options });
    if (fail) throw new Error('模拟导出失败');
    if (hang) await new Promise(resolve => { finishLate = resolve; });
    return { async arrayBuffer() { return new ArrayBuffer(0); } };
  } },
  GM_registerMenuCommand() {},
});
vm.runInContext(fs.readFileSync(`${__dirname}/chatgpt-card-export.user.js`, 'utf8'), context);
const buttons = elements.filter(el => el.tagName === 'BUTTON');
const btn = label => buttons.find(el => el.textContent === label);
const clickButton = label => btn(label).events.click[0]();
const status = elements.find(el => el.attributes.role === 'status');
const host = document.getElementById('chatgpt-card-pptx-tool');
const reply = new Element('section');
const card = new Element();
const text = new Element('span');
body.append(reply); reply.append(card); card.append(text);
card.setAttribute('data-d-component', 'box');
function fire(type, target, extra = {}) {
  const path = [];
  for (let el = target; el; el = el.parentElement) path.push(el);
  const event = {
    target, composedPath: () => path, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; }, ...extra,
  };
  for (const fn of document.events[type] || []) fn(event);
  return event;
}

(async () => {
  assert.equal(btn('导出 PPTX').disabled, true);
  clickButton('选择区域');
  // 工具按钮不应被当作导出目标。
  assert.equal(fire('click', btn('取消 / Esc')).prevented, false);
  fire('pointermove', text);
  const selectionClick = fire('click', text);
  assert.equal(selectionClick.prevented && selectionClick.stopped, true);
  assert.match(status.textContent, /\[box\]/);
  clickButton('扩大到父级');
  assert.match(status.textContent, /section/);
  clickButton('缩回一级');
  await clickButton('导出 PPTX');
  assert.equal(calls[0].target, card);
  assert.equal(calls[0].options.svgAsVector, true);
  assert.equal(calls[0].options.autoEmbedFonts, false);
  assert.equal(calls[0].options.includePseudoElements, false);
  assert.equal(calls[0].options.skipDownload, true);
  assert.equal(downloads, 1);
  assert.notEqual(host.style.display, 'none');
  assert.equal(btn('导出 PPTX').disabled, false);
  fail = true;
  await clickButton('导出 PPTX');
  assert.match(status.textContent, /模拟导出失败/);
  assert.notEqual(host.style.display, 'none');
  assert.equal(btn('选择区域').disabled, false);
  fire('keydown', text, { key: 'Escape' });
  assert.equal(btn('导出 PPTX').disabled, true);
  fail = false;
  hang = true;
  clickButton('选择区域');
  fire('click', text);
  await clickButton('导出 PPTX');
  assert.match(status.textContent, /超过 30 秒/);
  assert.equal(btn('导出 PPTX').disabled, true);
  assert.notEqual(host.style.display, 'none');
  finishLate();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(downloads, 1, '超时任务迟到完成时不能触发下载');
  console.log('PASS: 选取、导出、失败恢复、超时提示及迟到任务不下载');
})().catch(error => { console.error(error); process.exitCode = 1; });
