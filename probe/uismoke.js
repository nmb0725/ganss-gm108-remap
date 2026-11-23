// 无头冒烟: 用最小 DOM 桩跑 renderKeyboard, 暴露渲染期异常
function el(tag) {
  return {
    tag, children: [], attrs: {}, _cls: new Set(),
    classList: {
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); },
      _s: new Set()
    },
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { this.children.push(...cs); },
    addEventListener() {},
    set innerHTML(v) { this.children = []; },
    querySelector(sel) { return el(sel); },
    set textContent(v) { this._t = v; }, get textContent() { return this._t; }
  };
}
global.document = {
  createElementNS: (ns, tag) => el(tag),
  getElementById: () => el('div'),
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener: () => {}
};
global.window = { addEventListener: () => {} };
global.prompt = global.confirm = () => false;
require('l:/git/ganss/app/renderer/keyboard-layout.js');
// 从 app.js 里只取渲染部分(整文件 require 会因缺少 api 失败, 手动 eval renderKeyboard 段)
const src = require('fs').readFileSync('l:/git/ganss/app/renderer/app.js', 'utf8');
const start = src.indexOf('function renderKeyboard');
const end = src.indexOf('function refreshAllFaces') + 'function refreshAllFaces() { for (const k of KEYBOARD) refreshKeyFace(k); }'.length;
const window2 = global.window;
window2.KEYBOARD = global.window.KEYBOARD;
window2.KNOB = global.window.KNOB;
global.KEYBOARD = global.window.KEYBOARD;
global.KNOB = global.window.KNOB;
const code = "const SVGNS='x', U=44; const $ = () => document.getElementById('x');" + String.raw`${src.slice(start, end)}` +
  '; try { renderKeyboard(); console.log("renderKeyboard OK, keys=", KEYBOARD.length, "首键_g=", !!KEYBOARD[0]._g, "末键_g=", !!KEYBOARD[103]._g); } catch (e) { console.log("renderKeyboard 抛出:", e.message, " @", e.stack.split(String.fromCharCode(10))[1]); }';
eval(code);
