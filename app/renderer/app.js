'use strict';
/* global KEYBOARD */
const $ = id => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';
const U = 44; // 每单位像素
// 键的显示名: tip 括号里的校准说明不展示
const shortName = k => (k.tip || k.l).split(' (')[0];

// ---- 状态 ----
let config = null;          // 正在编辑的配置 {schema,name,overrides}
let applied = null;         // 已下发到键盘的配置
let appliedMacros;          // 已下发到键盘的宏库; undefined=老档无此字段(设备宏状态未知)
let macroLib = [];          // 当前宏库 [{slot,name,steps}] (设备全局, 不随配置档)
let currentProfile = null;
let selKey = null;
let device = { present: false };
let busy = false;           // 下发/还原进行中: 锁定写入相关按钮, 不查询固件版本 (修复审查 #17)
let appliedUnknown = false; // 键盘实际状态未知 (applied.json 损坏/被标记/上次下发中断): 下次下发自动全量
let savedSnapshot = '[]';   // 当前草稿载入/保存时的 overrides 快照, 用于未保存提示 (修复审查 #18)
// HTML 转义: 任何拼进 innerHTML 的用户/导入数据都要过它 (修复审查 #14)
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const draftDirty = () => !!config && JSON.stringify(config.overrides) !== savedSnapshot;
// 切换/覆盖草稿前确认 (修复审查 #18)
async function confirmDiscard(what) {
  if (!draftDirty()) return true;
  return askDialog({ title: '放弃未保存的修改?', bodyHTML: `当前草稿有未保存的修改, ${esc(what)}将丢弃它们。<br>需要保留请先点"取消", 再"保存"或"另存为"。`, okText: '放弃修改', danger: true });
}

const actionOf = cell => ((config && config.overrides) || []).find(o => o.cell === cell)?.action || 'default';
// 单格变更签名: 与主进程共用 renderer/entry-sig.js (修复审查 #9)
const entrySig = window.entrySig;
// 待下发变更 = 当前编辑 vs 键盘已生效(applied)。"改回默认"也是一处变更!
const diffList = () => {
  const ap = new Map(((applied && applied.overrides) || []).filter(o => o.action !== 'default').map(o => [o.cell, entrySig(o)]));
  const cu = new Map(config.overrides.filter(o => o.action !== 'default').map(o => [o.cell, o]));
  const out = [];
  for (const [cell, o] of cu) if (ap.get(cell) !== entrySig(o)) out.push({ ...o, change: 'set' });
  for (const cell of ap.keys()) if (!cu.has(cell)) out.push({ cell, action: 'default', change: 'revert' });
  return out;
};

// ---- SVG 键盘 ----
// 键帽图标 (24x24 坐标, 描边绘制)。键位表里带 icon 字段的键只画图标不写文字
const SPEAKER = 'M4 9.5v5h3.5l4.5 3.8V5.7L7.5 9.5z';
const KEY_ICONS = {
  'vol-up': [SPEAKER, 'M15.5 12h5', 'M18 9.5v5'],
  'vol-down': [SPEAKER, 'M15.5 12h5'],
  mute: [SPEAKER, 'M15.5 9.5l5 5', 'M20.5 9.5l-5 5'],
  custom: ['M12 4.5l2.2 4.6 5 .6-3.7 3.4 1 5-4.5-2.5-4.5 2.5 1-5-3.7-3.4 5-.6z']
};
function renderKeyboard() {
  const svg = $('kb-svg');
  svg.innerHTML = '';
  const W = 24.2 * U, H = 6 * U + 8;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  for (const k of KEYBOARD) {
    const g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('class', 'key');
    const w = (k.w || 1) * U - 4, h = (k.h || 1) * U - 4;
    const rect = document.createElementNS(SVGNS, 'rect');
    rect.setAttribute('x', k.x * U); rect.setAttribute('y', k.y * U + 4);
    rect.setAttribute('width', w); rect.setAttribute('height', h); rect.setAttribute('rx', 6);
    g.appendChild(rect);
    const t = document.createElementNS(SVGNS, 'text');
    t.setAttribute('class', 'main');
    t.setAttribute('x', k.x * U + w / 2);
    g.appendChild(t);
    if (k.icon && KEY_ICONS[k.icon]) {
      const ic = document.createElementNS(SVGNS, 'g');
      ic.setAttribute('class', 'kicon');
      for (const d of KEY_ICONS[k.icon]) { const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', d); ic.appendChild(p); }
      g.appendChild(ic);
    }
    const s = document.createElementNS(SVGNS, 'text');
    s.setAttribute('class', 'sub');
    s.setAttribute('x', k.x * U + w / 2);
    g.appendChild(s);
    if (k.conf !== 'v') g.classList.add('unc'); // 推断(i)与未校准(?)都画虚线
    const tip = document.createElementNS(SVGNS, 'title');
    tip.textContent = shortName(k) + (k.cell != null ? ` | 格号 ${k.cell}` : ' | 格号未定');
    g.appendChild(tip);
    g.addEventListener('click', () => selectKey(k, g));
    svg.appendChild(g);
    k._g = g;
    refreshKeyFace(k);
  }
}

function refreshKeyFace(k) {
  if (!k._g) return;
  const ov = k.cell != null ? ((config && config.overrides) || []).find(o => o.cell === k.cell) : null;
  const act = ov ? ov.action : 'default';
  const g = k._g;
  g.dataset.act = act; // 样式按功能着色 (styles.css .key[data-act=…])
  g.classList.toggle('dis', act === 'disable');
  g.classList.toggle('remap', act !== 'default' && act !== 'disable');
  const main = g.querySelector('text.main');
  const sub = g.querySelector('text.sub');
  const cy = k.y * U + 4 + ((k.h || 1) * U - 4) / 2;
  let subStr = '';
  const icon = g.querySelector('g.kicon');
  const label = icon ? '' : k.l; // 图标键不写文字
  if (act === 'disable') main.textContent = '✕';
  else if (act !== 'default') { main.textContent = label; subStr = ov.target || ''; }
  else { main.textContent = label; if (k.conf === '?') subStr = '?'; }
  sub.textContent = subStr;
  main.setAttribute('y', cy - (subStr ? 6 : 0));
  sub.setAttribute('y', cy + 10);
  if (icon) {
    icon.style.display = act === 'disable' ? 'none' : '';
    const cx = k.x * U + ((k.w || 1) * U - 4) / 2, sz = 20;
    icon.setAttribute('transform', `translate(${cx - sz / 2} ${cy - sz / 2 - (subStr ? 6 : 0)}) scale(${sz / 24})`);
  }
}
function refreshAllFaces() { for (const k of KEYBOARD) refreshKeyFace(k); }

// ---- 属性面板 ----
// 改键目标: 按键捕捉输入框。captured = {mod, hid, target}
//   mod = 标准 HID 修饰位 (LCtrl01 LShift02 LAlt04 LWin08 RCtrl10 RShift20 RAlt40 RWin80), hid = 主键 usage (纯修饰键时为 null)
const capBox = $('remap-capture');
let capturing = false, liveMod = 0, pressedMod = 0, captured = null;
const CODE_MAP = (() => {
  const m = {};
  const set = (code, hid, label) => { m[code] = { hid, label }; };
  for (let c = 65; c <= 90; c++) set('Key' + String.fromCharCode(c), 4 + c - 65, String.fromCharCode(c));
  for (let d = 1; d <= 9; d++) { set('Digit' + d, 29 + d, String(d)); set('Numpad' + d, 89 + d - 1, 'Num ' + d); }
  for (let i = 0; i < 12; i++) set('F' + (i + 1), 58 + i, 'F' + (i + 1));
  Object.entries({
    Digit0: [39, '0'], Backquote: [53, '`'], Minus: [45, '-'], Equal: [46, '='], Backspace: [42, '⌫'], Tab: [43, 'Tab'],
    BracketLeft: [47, '['], BracketRight: [48, ']'], Enter: [40, '⏎'], Backslash: [49, '\\'],
    Semicolon: [51, ';'], Quote: [52, "'"], Comma: [54, ','], Period: [55, '.'], Slash: [56, '/'],
    CapsLock: [57, 'Caps'], Escape: [41, 'Esc'], Space: [44, 'Space'],
    PrintScreen: [70, 'PrtSc'], ScrollLock: [71, 'ScrLk'], Pause: [72, 'Pause'],
    Insert: [73, 'Ins'], Home: [74, 'Home'], PageUp: [75, 'PgUp'], Delete: [76, 'Del'], End: [77, 'End'], PageDown: [78, 'PgDn'],
    ArrowRight: [79, '→'], ArrowLeft: [80, '←'], ArrowDown: [81, '↓'], ArrowUp: [82, '↑'],
    NumLock: [83, 'NumLk'], NumpadDivide: [84, 'Num /'], NumpadMultiply: [85, 'Num *'], NumpadSubtract: [86, 'Num -'],
    NumpadAdd: [87, 'Num +'], NumpadEnter: [88, 'Num ⏎'], Numpad0: [98, 'Num 0'], NumpadDecimal: [99, 'Num .']
  }).forEach(([code, [hid, label]]) => set(code, hid, label));
  return m;
})();
const MOD_BIT = { ControlLeft: 0x01, ControlRight: 0x10, ShiftLeft: 0x02, ShiftRight: 0x20, AltLeft: 0x04, AltRight: 0x40, MetaLeft: 0x08, MetaRight: 0x80 };
// 连击键用: 修饰键作为独立格时的 HID usage (E0..E7)
const MOD_HID = { ControlLeft: [0xe0, 'Ctrl'], ControlRight: [0xe4, '右Ctrl'], ShiftLeft: [0xe1, 'Shift'], ShiftRight: [0xe5, '右Shift'], AltLeft: [0xe2, 'Alt'], AltRight: [0xe6, '右Alt'], MetaLeft: [0xe3, 'Win'], MetaRight: [0xe7, '右Win'] };
const MOD_LABEL = [[0x01, 'Ctrl'], [0x10, '右Ctrl'], [0x04, 'Alt'], [0x40, '右Alt'], [0x02, 'Shift'], [0x20, '右Shift'], [0x08, 'Win'], [0x80, '右Win']];
const modsLabel = m => MOD_LABEL.filter(([b]) => m & b).map(([, n]) => n).join(' + ');
// 旧档兼容: {hid: 224..230} 表示纯修饰键
function normOv(ov) {
  let mod = 0, hid = null;
  if (ov.mod != null) mod = ov.mod | 0;
  if (ov.hid != null && ov.hid < 0xe0) hid = ov.hid;
  else if (ov.hid >= 0xe0 && ov.hid <= 0xe7 && !mod) mod = 1 << (ov.hid - 0xe0);
  const target = ov.target || '';
  const modOnly = mod && hid == null; // 纯修饰键目标整体显示在主键槽, 不点亮修饰灯条
  const parts = target.split(' + ');
  return { mod, hid, target, mods: modOnly ? 0 : mod, keyLabel: modOnly ? target : parts[parts.length - 1] };
}
// 修饰键灯条 + 主键槽 的统一渲染
const CHIP_DEFS = [['Ctrl', 0x01, 0x10], ['Alt', 0x04, 0x40], ['Shift', 0x02, 0x20], ['Win', 0x08, 0x80]];
function renderRemapSlots() {
  const mod = capturing ? liveMod : (captured ? (captured.mods || 0) : 0);
  capBox.classList.toggle('mod', mod !== 0); // 带修饰键的组合: 捕捉框变紫
  document.querySelectorAll('#mod-chips .chip').forEach(c => {
    const [name, l, r] = CHIP_DEFS[Number(c.dataset.i)];
    const on = mod & (l | r);
    c.classList.toggle('on', !!on);
    c.textContent = (on && !(mod & l) && (mod & r)) ? '右' + name : name;
  });
  if (capturing) capBox.value = liveMod ? '修饰键已按下, 再按主键…' : '请按下按键…';
  else capBox.value = captured ? (captured.keyLabel || captured.target || '') : '';
}
// 功能卡片网格: default / remap(键盘功能) / disable 可用, 其余为固件不支持的占位
let fnSel = 'default';
const FN_HINT = {
  default: '恢复这个键的出厂功能。',
  disable: '按下这个键不会有任何输出。',
  remap: '把这个键变成另一个键, 或带 Ctrl/Alt/Shift/Win 的组合键。',
  mouse: '让这个键执行鼠标点击、前进后退或滚轮。',
  macro: '按下时播放宏库里的一段按键序列。',
  combo: '按一下, 依次输出 1~3 个键。',
  media: '音量、播放控制等多媒体功能。',
  shortcut: '一键发出 Windows 或 macOS 的系统快捷键。'
};
function renderFnPanel() {
  $('fn-hint').textContent = FN_HINT[fnSel] || '';
  document.querySelectorAll('#fn-grid .fn-card').forEach(c => c.classList.toggle('active', c.dataset.fn === fnSel));
  $('fn-remap').hidden = fnSel !== 'remap';
  $('fn-mouse').hidden = fnSel !== 'mouse';
  $('fn-combo').hidden = fnSel !== 'combo';
  $('fn-macro').hidden = fnSel !== 'macro';
  $('fn-media').hidden = fnSel !== 'media';
  $('fn-shortcut').hidden = fnSel !== 'shortcut';
}
// Windows 快捷键预设 = 同一套 02 <修饰位> <usage> 00 线格式, 记录后与键盘功能共用应用逻辑
// 系统快捷键 (Windows / macOS): 独立的功能卡片, 写入格式与"键盘功能"相同 (02 <修饰位> <usage> 00)
let shortcutPick = null;
$('win-preset').addEventListener('change', e => {
  const v = e.target.value;
  if (!v) { shortcutPick = null; return; }
  const [mod, hid, target] = v.split('|');
  shortcutPick = { mod: Number(mod), hid: Number(hid), target };
  setStatus('已选快捷键: ' + target + ' — 点"应用到草稿"', 'ok');
});
document.querySelectorAll('#fn-grid .fn-card').forEach(c => c.addEventListener('click', () => {
  if (c.classList.contains('off')) { setStatus(`「${c.textContent.trim()}」: ${c.title || 'GM108 固件不支持此功能'}`, 'err'); return; }
  fnSel = c.dataset.fn;
  renderFnPanel();
}));
// PrtSc 等 Chromium 捕捉不到的键: 从兜底下拉直选
$('remap-special').addEventListener('change', e => {
  const v = e.target.value;
  e.target.selectedIndex = 0;
  if (!v) return;
  const [mod, hid, target] = v.split('|');
  captured = { mod: Number(mod), hid: Number(hid), target, mods: Number(mod), keyLabel: target.split(' + ').pop() };
  renderRemapSlots();
  setStatus('目标键: ' + target + ' — 点"应用到草稿"', 'ok');
});
// 鼠标功能 / 多媒体键: 下拉直选 (编码协议见 main/protocol.js)
const MOUSE_LABEL = { left: '鼠标左键', right: '鼠标右键', middle: '鼠标中键', back: '鼠标后退', forward: '鼠标前进', 'wheel-up': '滚轮上滚', 'wheel-down': '滚轮下滚' };
let mousePick = null, mediaPick = null, comboCap = null;
$('mouse-pick').addEventListener('change', e => {
  const v = e.target.value;
  mousePick = v ? { button: v, target: MOUSE_LABEL[v] } : null;
  if (mousePick) setStatus('已选鼠标功能: ' + mousePick.target + ' — 点"应用"加入草稿', 'ok');
});
$('media-pick').addEventListener('change', e => {
  const v = e.target.value;
  mediaPick = v ? { usage: Number(v), target: e.target.selectedOptions[0].textContent.trim() } : null;
  if (mediaPick) setStatus('已选多媒体键: ' + mediaPick.target + ' — 点"应用"加入草稿', 'ok');
});
// 宏绑定播放模式: mode=1(播放多次) 时才显示 1..255 次数输入 (线协议 06 槽 mode [次数])
$('macro-mode').addEventListener('change', e => {
  $('macro-loop-wrap').hidden = e.target.value !== '1';
});
// 连击键: 三段小格, 隐藏的 #combo-capture 只做捕捉焦点代理
const comboBox = $('combo-capture');
let comboCapturing = false;
function renderComboSlots() {
  document.querySelectorAll('.combo-slot').forEach((s, i) => {
    const label = comboCap && comboCap.labels[i];
    s.textContent = label || ('键' + (i + 1));
    s.classList.toggle('filled', !!label);
    s.classList.toggle('active', comboCapturing && i === (comboCap ? comboCap.keys.length : 0));
  });
}
comboBox.addEventListener('focus', () => {
  comboCapturing = true;
  if (!comboCap || comboCap.keys.length >= 3) comboCap = { keys: [], labels: [], target: '' };
  renderComboSlots();
});
comboBox.addEventListener('blur', () => {
  comboCapturing = false;
  if (comboCap && !comboCap.keys.length) comboCap = null;
  renderComboSlots();
});
document.querySelectorAll('.combo-slot').forEach(s => s.addEventListener('click', () => {
  const i = Number(s.dataset.i);
  if (comboCap && i < comboCap.keys.length) { // 点已录格 = 从该格起清除重录
    comboCap.keys = comboCap.keys.slice(0, i);
    comboCap.labels = comboCap.labels.slice(0, i);
    comboCap.target = comboCap.labels.join(' + ');
  }
  comboBox.focus();
}));
capBox.hidden = false;
capBox.addEventListener('focus', () => {
  capturing = true; liveMod = 0; pressedMod = 0;
  capBox.classList.add('capturing');
  renderRemapSlots();
});
capBox.addEventListener('blur', () => {
  capturing = false;
  capBox.classList.remove('capturing');
  renderRemapSlots();
});
document.addEventListener('keydown', e => {
  if (mmRec) { // 宏录制模式: 吞掉所有键, 只记事件, 表格实时同步
    e.preventDefault(); e.stopPropagation();
    if (e.repeat) return;
    const mh = MOD_HID[e.code];
    const t = mh ? { hid: mh[0], label: mh[1] } : CODE_MAP[e.code];
    if (t) { mmRec.events.push({ hid: t.hid, label: t.label, down: true, t: Date.now() }); mmLive(); }
    return;
  }
  if (mmInsCapturing) { // "插入键": 吞掉下一个键, 插入 按下+释放 一对
    e.preventDefault(); e.stopPropagation();
    if (e.repeat) return;
    mmInsCapturing = false;
    $('mac-ins-capture').blur();
    const mh = MOD_HID[e.code];
    const t = mh ? { hid: mh[0], label: mh[1] } : CODE_MAP[e.code];
    if (!t) { setStatus('插入键: 未识别的键 ' + e.code, 'err'); return; }
    mmDraft.push({ kind: 'key', hid: t.hid, label: t.label, down: true, delay: 50 });
    mmDraft.push({ kind: 'key', hid: t.hid, label: t.label, down: false, delay: 10 });
    mmRenderSteps();
    setStatus(`已插入 ${t.label} (按下+释放) — 可用 ↑↓ 调整位置`, 'ok');
    return;
  }
  if (comboCapturing) {
    e.preventDefault(); e.stopPropagation();
    if (e.repeat) return;
    // 修饰键可作为单独一格录入 (usage E0..E7), 但不参与组合
    const mh = MOD_HID[e.code];
    const t = mh ? { hid: mh[0], label: mh[1] } : CODE_MAP[e.code];
    if (!t || comboCap.keys.length >= 3) return;
    comboCap.keys.push(t.hid); comboCap.labels.push(t.label);
    comboCap.target = comboCap.labels.join(' + ');
    renderComboSlots();
    if (comboCap.keys.length >= 3) comboBox.blur();
    return;
  }
  if (!capturing) return;
  e.preventDefault(); e.stopPropagation();
  if (e.repeat) return;
  if (MOD_BIT[e.code]) {
    liveMod |= MOD_BIT[e.code]; pressedMod |= MOD_BIT[e.code];
    renderRemapSlots();
    return;
  }
  const t = CODE_MAP[e.code];
  if (!t) { capBox.value = '未识别的键: ' + e.code; return; }
  captured = { mod: liveMod, mods: liveMod, hid: t.hid, keyLabel: t.label, target: (liveMod ? modsLabel(liveMod) + ' + ' : '') + t.label };
  setStatus('目标键: ' + captured.target + ' — 点"应用到草稿"', 'ok');
  capBox.blur(); // 结束捕捉并回填
}, true);
// 修饰键全部抬手: 若期间没按过主键, 目标就是这组修饰键本身 (如 Caps→右Ctrl)
document.addEventListener('keyup', e => {
  if (mmRec) { // 宏录制: 记录释放时刻
    e.preventDefault(); e.stopPropagation();
    const mh = MOD_HID[e.code];
    const t = mh ? { hid: mh[0], label: mh[1] } : CODE_MAP[e.code];
    if (t) { mmRec.events.push({ hid: t.hid, label: t.label, down: false, t: Date.now() }); mmLive(); }
    return;
  }
  if (!capturing || !MOD_BIT[e.code]) return;
  e.preventDefault(); e.stopPropagation();
  liveMod &= ~MOD_BIT[e.code];
  if (liveMod || captured) return;
  if (pressedMod) {
    captured = { mod: pressedMod, mods: 0, hid: null, keyLabel: modsLabel(pressedMod), target: modsLabel(pressedMod) };
    setStatus('目标键: ' + captured.target + ' — 点"应用到草稿"', 'ok');
    capBox.blur();
  }
}, true);

function selectKey(k, g) {
  if (selKey && selKey._g) selKey._g.classList.remove('sel');
  selKey = k;
  g.classList.add('sel');
  $('insp-empty').hidden = true;
  $('insp-body').hidden = false;
  const editable = k.cell != null;
  $('insp-key').textContent = shortName(k);
  $('insp-cell').textContent = editable ? `格号 ${k.cell}` : '格号未定 · 不可编辑';
  const CONF = { v: ['已实测', 'v'], i: ['推断格号, 写入后请试按', 'i'], '?': ['未校准', 'q'] };
  const [cTxt, cCls] = CONF[k.conf] || CONF['?'];
  $('insp-conf').textContent = cTxt; $('insp-conf').className = 'conf ' + cCls;
  if (!editable) setStatus(shortName(k) + ': 该键格号未定, 本期不可编辑', 'err');
  else setStatus(`已选中 ${shortName(k)} (格号 ${k.cell})`);
  $('win-preset').selectedIndex = 0; $('remap-special').selectedIndex = 0;
  const act = editable ? actionOf(k.cell) : 'default';
  fnSel = ['default', 'remap', 'mouse', 'combo', 'macro', 'media', 'disable'].includes(act) ? act : 'default';
  const ov = (config.overrides || []).find(o => o.cell === k.cell);
  captured = act === 'remap' && ov ? normOv(ov) : null;
  renderRemapSlots();
  mousePick = act === 'mouse' && ov ? { button: ov.button, target: ov.target } : null;
  $('mouse-pick').value = mousePick ? mousePick.button : '';
  mediaPick = act === 'media' && ov ? { usage: ov.usage, target: ov.target } : null;
  $('media-pick').value = mediaPick ? String(mediaPick.usage) : '';
  comboCap = act === 'combo' && ov ? { keys: ov.keys.slice(), labels: (ov.target || '').split(' + '), target: ov.target || '' } : null;
  renderComboSlots();
  populateMacroPick();
  $('macro-pick').value = act === 'macro' && ov ? String(ov.slot) : '';
  const mMode = act === 'macro' && ov ? (ov.mode | 0) : 0;
  $('macro-mode').value = String(mMode);
  $('macro-loop').value = act === 'macro' && ov ? (ov.loop | 0 || 1) : 1;
  $('macro-loop-wrap').hidden = mMode !== 1;
  // 改键目标正好是某个系统快捷键预设 => 显示在"快捷键"卡片里
  shortcutPick = null; $('win-preset').selectedIndex = 0;
  if (act === 'remap' && ov) {
    const opt = [...$('win-preset').options].find(o => o.value && o.value.startsWith(`${ov.mod | 0}|${ov.hid}|`));
    if (opt) {
      fnSel = 'shortcut'; $('win-preset').value = opt.value;
      const [m, h, t] = opt.value.split('|'); shortcutPick = { mod: +m, hid: +h, target: t };
    }
  }
  renderFnPanel();
  $('btn-apply-key').disabled = !editable;
}

$('btn-apply-key').addEventListener('click', () => {
  if (!selKey || selKey.cell == null) return;
  const act = fnSel;
  const idx = config.overrides.findIndex(o => o.cell === selKey.cell);
  let entry = { cell: selKey.cell, action: act };
  if (act === 'remap') {
    if (!captured) { setStatus('请先按下目标键/组合键, 或从下拉选择', 'err'); return; }
    if (captured.mod === 0 && captured.hid === (selKey.hid || -1)) { setStatus('目标与自身相同, 请按别的键', 'err'); return; }
    entry = { cell: selKey.cell, action: 'remap', target: captured.target, mod: captured.mod, hid: captured.hid };
  } else if (act === 'mouse') {
    if (!mousePick) { setStatus('请先在上方选择鼠标功能', 'err'); return; }
    entry = { cell: selKey.cell, action: 'mouse', button: mousePick.button, target: mousePick.target };
  } else if (act === 'media') {
    if (!mediaPick) { setStatus('请先在上方选择多媒体键', 'err'); return; }
    entry = { cell: selKey.cell, action: 'media', usage: mediaPick.usage, target: mediaPick.target };
  } else if (act === 'shortcut') {
    if (!shortcutPick) { setStatus('请先选择一个快捷键', 'err'); return; }
    entry = { cell: selKey.cell, action: 'remap', target: shortcutPick.target, mod: shortcutPick.mod, hid: shortcutPick.hid };
  } else if (act === 'combo') {
    if (!comboCap || !comboCap.keys.length) { setStatus('请先在输入框依次按下 1~3 个键', 'err'); return; }
    entry = { cell: selKey.cell, action: 'combo', keys: comboCap.keys, target: comboCap.target };
  } else if (act === 'macro') {
    const v = $('macro-pick').value;
    if (v === '') { setStatus('请先选择一个宏槽 (可点"管理宏库…"新建)', 'err'); return; }
    const mode = $('macro-mode').value | 0;
    let loop = 0;
    if (mode === 1) {
      loop = $('macro-loop').value | 0;
      if (loop < 1 || loop > 255) { setStatus('播放次数需在 1~255 之间', 'err'); return; }
    }
    const m = macroLib.find(x => x.slot === Number(v));
    entry = { cell: selKey.cell, action: 'macro', slot: Number(v), mode, loop, target: (m && m.name) || ('槽' + v) };
  }
  if (act === 'default') { if (idx >= 0) config.overrides.splice(idx, 1); }
  else if (idx >= 0) config.overrides[idx] = entry;
  else config.overrides.push(entry);
  refreshKeyFace(selKey);
  markDirty();
  const what = act === 'default' ? '恢复默认' : act === 'disable' ? '禁用' : (entry.target || act);
  setStatus(`已加入草稿: ${shortName(selKey)} → ${what}  (共 ${diffList().length} 处待写入)`, 'ok');
});

// ---- 状态栏 / 差异 ----
// 宏库是设备全局的: 与"已下发宏库"不同就是一次待下发变更 (老档无 macros 字段时, 仅本地库非空算变更)
const libDirty = () => appliedMacros === undefined
  ? macroLib.length > 0
  : JSON.stringify(macroLib) !== JSON.stringify(appliedMacros || []);
function markDirty() {
  const n = diffList().length, md = libDirty();
  // 宏库: 有"已写入"记录才算差异; 没有记录(从未经本工具写入过宏库) 时如实说"未同步", 不说成有改动
  const macTxt = !md ? '' : appliedMacros === undefined ? `宏库未同步 (本地 ${macroLib.length} 个宏, 键盘上的宏未知)` : `宏库 (${macroLib.length} 个宏)`;
  $('diff-summary').textContent =
    (n ? `待下发变更: ${n} 处` : '') + (macTxt ? (n ? ' + ' : (appliedMacros === undefined ? '' : '待下发变更: ')) + macTxt : '');
  $('diff-summary').title = appliedMacros === undefined && md
    ? '本工具还没有成功写入过宏库 (或上次写入未完成), 无法确认键盘里的宏和本地宏库是否一致。点"写入到键盘"同步一次后此提示消失。' : '';
  const canWrite = !busy && device.present && device.mode === 'normal' && !device.suspectBusy;
  // 状态未知时任何时候都允许(全量)下发
  $('apply-btn').disabled = !((n || md || appliedUnknown) && canWrite);
  $('btn-factory').disabled = !canWrite;
  if (appliedUnknown) $('diff-summary').textContent = '键盘状态未知 — 将全量写入当前配置';
  // 修复审查 #26: 与 diffList 同一口径 (只比线协议字段), 仅改名不算差异
  $('cur-profile').textContent = currentProfile || '键盘当前状态';
  // 与键盘是否一致: 醒目的状态徽章 + 键盘区描边 + 写入按钮提示 (三处同步)
  const state = appliedUnknown ? 'unknown' : (n || md) ? 'diff' : 'ok';
  const what = [n ? `${n} 处按键` : '', md ? '宏库' : ''].filter(Boolean).join(' + ');
  const badge = $('sync-badge');
  badge.className = 'sync-badge ' + state;
  badge.textContent = state === 'unknown' ? '⚠ 键盘状态未知'
    : state === 'diff' ? '● 与键盘不同'
    : '✓ 与键盘一致';
  badge.title = state === 'unknown' ? '下次写入将全量下发' : state === 'diff' ? `${what}待写入` : '草稿与键盘里实际生效的配置相同';
  $('dirty-hint').textContent = draftDirty() ? '● 草稿有未保存修改' : '';
  $('dirty-hint').className = 'dirty-hint' + (draftDirty() ? ' warn' : '');
  $('tab-macro-count').textContent = macroLib.length ? String(macroLib.length) : '';
}
// 状态栏: 每个操作都更新; 成功提示 6 秒后褪成普通色, 避免旧消息一直"亮着"像是当前状态
let statusTimer = null;
function setStatus(msg, cls) {
  const el = $('status-text');
  el.textContent = msg;
  el.className = cls || '';
  clearTimeout(statusTimer);
  if (cls === 'ok') statusTimer = setTimeout(() => { el.className = ''; }, 6000);
}

// ---- 通用应用内弹窗 (Electron 不支持 prompt/confirm) ----
function askDialog({ title, bodyHTML = '', input = null, okText = '确定', danger = false }) {
  return new Promise(resolve => {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = bodyHTML;
    $('modal-input-row').hidden = !input;
    $('modal-input').value = input ? (input.value || '') : '';
    $('modal-ok').textContent = okText;
    $('modal-ok').classList.toggle('danger', danger);
    $('modal').hidden = false;
    if (input) setTimeout(() => $('modal-input').focus(), 0);
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
      else if (e.key === 'Enter' && input && document.activeElement === $('modal-input')) { e.preventDefault(); ok(); }
    };
    const done = v => { $('modal').hidden = true; $('modal-ok').onclick = $('modal-cancel').onclick = null; document.removeEventListener('keydown', onKey, true); resolve(v); };
    const cancel = () => done(input ? null : false);
    const ok = () => done(input ? ($('modal-input').value.trim() || null) : true);
    document.addEventListener('keydown', onKey, true);
    $('modal-cancel').onclick = cancel;
    $('modal-ok').onclick = ok;
  });
}

// ---- 帮助/救援页 ----
$('btn-help').addEventListener('click', () => { $('help').hidden = false; });
$('help-close').addEventListener('click', () => { $('help').hidden = true; });
$('help').addEventListener('click', e => { if (e.target === $('help')) $('help').hidden = true; });

// ---- 下发确认 ----
const keyNameByCell = new Map(KEYBOARD.filter(k => k.cell != null).map(k => [k.cell, shortName(k)]));
const keyByCell = new Map(KEYBOARD.filter(k => k.cell != null).map(k => [k.cell, k]));
const FN_CELL = 96;
$('apply-btn').addEventListener('click', async () => {
  if (busy) return;
  const diff = diffList();
  if (!diff.length && !libDirty() && !appliedUnknown) return;
  const actLabel = o => o.action === 'disable' ? '禁用' : o.action === 'default' ? '恢复默认'
    : ({ remap: '改键→', mouse: '鼠标→', media: '多媒体→', combo: '连击→', macro: '宏→' })[o.action] + (o.target || '') +
      (o.action === 'macro' && o.mode === 1 ? ` (播放${o.loop}次)` : o.action === 'macro' && o.mode === 2 ? ' (再按键时停止)' : '');
  // 修复审查 #19: 推断/未校准格号与 Fn 键单独警示
  const unverified = diff.filter(o => { const k = keyByCell.get(o.cell); return k && k.conf !== 'v' && o.change === 'set'; });
  const fnTouched = diff.some(o => o.cell === FN_CELL && o.change === 'set');
  const body = (appliedUnknown ? '<div class="chg warn">键盘当前状态未知, 本次将<b>全量写入</b>当前配置的全部按键与宏库。</div>' : '') +
    diff.map(o => {
      const k = keyByCell.get(o.cell);
      const warn = k && k.conf !== 'v' && o.change === 'set' ? ' <span class="warn">⚠ 推断格号</span>' : '';
      return `<div class="chg">#${o.cell} ${esc(keyNameByCell.get(o.cell) || '未知键')} → ${esc(actLabel(o))}${warn}</div>`;
    }).join('') +
    (libDirty() ? `<div class="chg">${appliedMacros === undefined ? '同步宏库' : '宏库更新'}: 共 ${macroLib.length} 个宏, 将写入键盘 (全局, 所有配置档共用)</div>` : '') +
    (unverified.length ? `<p class="warn">⚠ ${unverified.length} 个键的格号是按行规律推断的, 尚未实测, 可能作用到别的键。写入后请逐个试按确认。</p>` : '') +
    (fnTouched ? '<p class="warn">⚠ 你修改了 Fn 键: 禁用或改键后将失去整个 Fn 层 (含 Fn 组合功能), 只能用本工具恢复。</p>' : '') +
    '<p style="margin-top:10px">下发期间请勿拔线或操作键盘。</p>';
  const title = appliedUnknown ? '确认全量写入键盘' : `确认写入键盘 (${diff.length} 处变更${libDirty() ? ' + 宏库' : ''})`;
  if (!await askDialog({ title, bodyHTML: body, okText: '确认写入键盘', danger: true })) return;
  await runApply(config, '正在下发…请勿触碰键盘/线缆', r => {
    applied = JSON.parse(JSON.stringify(config));
    appliedMacros = JSON.parse(JSON.stringify(macroLib));
    setStatus(`下发成功: ${r.full ? '全量写入 ' : ''}${r.changed} 个键已更新${r.macros ? ' · 宏库已同步' : ''}`, 'ok');
  });
});

// 下发公共流程: busy 锁 + 结果处理 (失败时同步"状态未知")
async function runApply(cfg, pendingMsg, onOk) {
  busy = true; markDirty();
  setStatus(pendingMsg);
  // 写入耗时: 只改键约 1 秒, 带宏库约 2~3 秒; 设备异常时可能等到超时。显示计时, 避免误以为卡死去拔线
  const t0 = Date.now();
  const el = document.createElement('span'); el.id = 'apply-elapsed';
  $('status-text').append('  ', el);
  const tick = setInterval(() => { el.textContent = `已用 ${Math.round((Date.now() - t0) / 1000)} 秒`; }, 500);
  let r;
  try { r = await window.api.applyConfig(cfg); }
  catch (e) { r = { ok: false, error: e.message }; }
  clearInterval(tick);
  busy = false;
  if (r.ok) { appliedUnknown = false; await onOk(r); }
  else {
    if (r.unknown) appliedUnknown = true;
    if (r.stuck) device = { ...device, suspectBusy: true };
    setStatus('下发中止: ' + r.error + (r.unknown ? ' — 键盘状态已标记为未知, 下次将全量写入' : ''), 'err');
  }
  markDirty();
  return r;
}

// ---- 一键还原 (恢复出厂设置) ----
$('btn-factory').addEventListener('click', async () => {
  if (busy) return;
  if (!await confirmDiscard('一键还原')) return;
  if (!await askDialog({ title: '一键还原', bodyHTML: '将清除键盘上<b>所有</b>改键与禁用, 恢复出厂默认并立即写入。已保存的配置档不受影响。下发期间请勿拔线或操作键盘。', okText: '确认还原', danger: true })) return;
  const factory = await window.api.factory();
  await runApply(factory, '正在恢复出厂…请勿触碰键盘/线缆', async () => {
    applied = JSON.parse(JSON.stringify(factory));
    appliedMacros = JSON.parse(JSON.stringify(macroLib)); // 一键还原不清宏库(设备全局), 与老软件一致
    loadConfig(JSON.parse(JSON.stringify(applied)), null);
    await refreshProfiles();
    setStatus('已恢复出厂设置', 'ok');
  });
});

// ---- 标记键盘状态未知 (用过老软件/换过电脑后, 本地记录不可信) ----
$('btn-mark-unknown').addEventListener('click', async () => {
  if (!await askDialog({ title: '标记键盘状态未知?', bodyHTML: '适用于: 用老软件改过键盘、换了电脑、或怀疑本工具记录的"键盘当前状态"不准。<br>标记后, 下次"写入到键盘"会把当前配置的全部按键和宏库<b>全量</b>写入, 不再只写差异。', okText: '标记为未知' })) return;
  await window.api.markUnknown();
  await loadAppliedDoc();
  markDirty();
  setStatus('已标记键盘状态未知: 下次写入将全量下发', 'ok');
});

// ---- 配置档 ----
// getApplied 现在返回 {config, macros}; 统一经 loadAppliedDoc 刷新 applied/appliedMacros
async function loadAppliedDoc() {
  const d = await window.api.getApplied();
  applied = d.config; appliedMacros = d.macros; appliedUnknown = !!d.unknown;
  if (d.unknown) setStatus('键盘当前状态未知' + (d.reason ? ` (${d.reason})` : '') + ': 下次写入将全量下发', 'err');
  return applied;
}
async function refreshProfiles() {
  const list = await window.api.listProfiles();
  const ul = $('profile-list');
  ul.innerHTML = '';
  const items = ['__applied__', ...list];
  for (const name of items) {
    const li = document.createElement('li');
    li.textContent = name === '__applied__' ? '⌨ 键盘当前状态' : name;
    if (name === currentProfile || (name === '__applied__' && currentProfile === null)) li.classList.add('active');
    li.addEventListener('click', async () => {
      if (name === currentProfile || (name === '__applied__' && currentProfile === null)) return;
      if (!await confirmDiscard('切换配置档')) return;
      if (name === '__applied__') loadConfig(JSON.parse(JSON.stringify(await loadAppliedDoc())), null);
      else loadConfig(await window.api.loadProfile(name), name);
    });
    ul.appendChild(li);
  }
}
function loadConfig(cfg, name, { keepDirty = false } = {}) {
  config = cfg;
  currentProfile = name;
  if (!keepDirty) savedSnapshot = JSON.stringify(cfg.overrides || []);
  document.querySelectorAll('#profile-list li').forEach(li => li.classList.toggle('active', li.textContent === (name || '⌨ 键盘当前状态')));
  refreshAllFaces();
  markDirty();
}
async function saveAsNew(initCfg, title) {
  const name = await askDialog({ title, input: { value: (initCfg.name && initCfg.name !== '出厂默认' ? initCfg.name : '我的配置') }, okText: '保存' });
  if (!name) return;
  const cfg = JSON.parse(JSON.stringify(initCfg)); cfg.name = name;
  try {
    await window.api.saveProfile(cfg);
    currentProfile = name;
    config = cfg;
    savedSnapshot = JSON.stringify(cfg.overrides);
    await refreshProfiles();
    markDirty();
    setStatus(`已保存: ${name}`, 'ok');
  } catch (e) { setStatus('保存失败: ' + e.message, 'err'); }
}
$('btn-new').addEventListener('click', async () => {
  if (!await confirmDiscard('新建配置档')) return;
  const factory = await window.api.factory();
  const name = await askDialog({ title: '新建配置档 (基于出厂默认)', input: { value: '我的配置' }, okText: '创建' });
  if (!name) return;
  factory.name = name;
  try {
    await window.api.saveProfile(factory);
    loadConfig(factory, name);
    await refreshProfiles();
    setStatus(`已新建: ${name} (尚未下发)`, 'ok');
  } catch (e) { setStatus('新建失败: ' + e.message, 'err'); }
});
$('btn-saveas').addEventListener('click', () => saveAsNew(config, '另存为新配置档'));
$('btn-save').addEventListener('click', async () => {
  if (!currentProfile) return saveAsNew(config, '保存为新配置档');
  const cfg = JSON.parse(JSON.stringify(config)); cfg.name = currentProfile;
  try { await window.api.saveProfile(cfg); savedSnapshot = JSON.stringify(cfg.overrides); markDirty(); setStatus(`已保存: ${currentProfile}`, 'ok'); }
  catch (e) { setStatus('保存失败: ' + e.message, 'err'); }
});
$('btn-del').addEventListener('click', async () => {
  if (!currentProfile) { setStatus('“键盘当前状态”是只读视图, 无需删除'); return; }
  if (!await askDialog({ title: `删除配置档「${currentProfile}」?`, bodyHTML: '仅删除存档, 不影响键盘上已生效的配置。', okText: '删除', danger: true })) return;
  try {
    await window.api.removeProfile(currentProfile);
    currentProfile = null;
    await refreshProfiles();
    loadConfig(JSON.parse(JSON.stringify(applied)), null);
    setStatus('已删除', 'ok');
  } catch (e) { setStatus('删除失败: ' + e.message, 'err'); }
});
$('btn-export').addEventListener('click', () => window.api.exportProfile(config));
$('btn-import').addEventListener('click', async () => {
  if (!await confirmDiscard('导入配置档')) return;
  const r = await window.api.importProfile();
  if (!r) return;
  if (!r.config) return setStatus('导入失败: ' + r.error, 'err');
  // 导入内容尚未保存: 作为未保存草稿载入 (快照置空, 切换时会提示)
  loadConfig(r.config, null);
  savedSnapshot = '__imported__';
  markDirty();
  setStatus(r.badName ? `导入成功, 但${r.error} — 保存时请重新命名` : '导入成功 (未保存, 可另存为)', r.badName ? 'err' : 'ok');
});

// ---- 宏库 ----
function populateMacroPick() {
  const sel = $('macro-pick'), cur = sel.value;
  sel.innerHTML = '<option value="">选择宏槽…</option>';
  for (const m of macroLib) {
    const o = document.createElement('option');
    o.value = String(m.slot); o.textContent = `槽 ${m.slot} · ${m.name}`;
    sel.appendChild(o);
  }
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
}
const mmLabelOf = hid => {
  const mh = Object.values(MOD_HID).find(v => v[0] === hid);
  if (mh) return mh[1];
  const c = Object.values(CODE_MAP).find(v => v.hid === hid);
  return c ? c.label : '0x' + hid.toString(16);
};
const macMgr = $('mac-mgr');
let mmSel = null, mmDraft = [], mmRec = null, mmInsCapturing = false;
// 步骤草稿行: {kind:'key', hid, label, down, delay} | {kind:'mouse', button, label, down, delay} | {kind:'delay', ms}
// (延时行是编辑期概念, 保存时合并进前一事件的 delay — 与老软件 gkdb "3,N" 行语义一致)
const stepToRow = s => s.wait != null
  ? { kind: 'delay', ms: s.wait | 0 }
  : s.mouse
  ? { kind: 'mouse', button: s.mouse, down: !!s.down, delay: s.delay | 0, label: MOUSE_LABEL[s.mouse] || s.mouse }
  : { kind: 'key', hid: s.hid, down: !!s.down, delay: s.delay | 0, label: mmLabelOf(s.hid) };
const mmSetInsEnabled = on => { for (const id of ['mac-ins-mouse', 'mac-ins-key', 'mac-ins-delay', 'mac-clear', 'mac-save', 'mac-del']) $(id).disabled = !on; if (on) mmRenderList(); };

// 延时上限: 与老软件一致 (8 位数字, 99999999ms); 合并后的等待上限放宽, 由编码器拆成多条记录
const MAX_DELAY = 99999999;
// 宏在键盘里的占用 (与 protocol.buildMacroSegments 同一公式)。数据区 400..1024 (已实测的最大段 17 块)
const MAC_POOL_BYTES = 624;
const delayRecs = ms => Math.ceil((ms || 0) / 0x0FFFFFFF);
const stepsBytes = steps => steps.length ? 8 + steps.reduce((n, st) => n + (st.wait != null ? 4 * delayRecs(st.wait) : 4 + 4 * delayRecs(st.delay)), 0) : 0;
// 草稿行 -> 步骤 (与老软件一致: 事件自带"之后等待"; 单独插入的延时行各自成为一条 {wait} 记录); 首行是延时时返回 null
function draftToSteps(rows) {
  const out = [];
  for (const r of rows) {
    if (r.kind === 'delay') { if (!out.length) return null; out.push({ wait: Math.max(1, Math.min(MAX_DELAY, Math.round(r.ms || 0))) }); }
    else out.push({ delay: Math.max(0, Math.min(MAX_DELAY, Math.round(r.delay || 0))) });
  }
  return out;
}
const fmtMs = ms => ms >= 1000 ? (ms / 1000).toFixed(ms >= 10000 ? 1 : 2).replace(/\.?0+$/, '') + ' s' : ms + ' ms';
const macroDuration = steps => steps.reduce((t, st) => t + (st.wait != null ? st.wait : (st.delay || 0)), 0);
const boundCount = slot => ((config && config.overrides) || []).filter(o => o.action === 'macro' && o.slot === slot).length;

function mmRenderList() {
  const ul = $('mac-slots');
  ul.innerHTML = '';
  const items = macroLib.map(m => ({ slot: m.slot, name: m.name, steps: m.steps, saved: true }));
  if (mmSel != null && !macroLib.some(m => m.slot === mmSel)) items.push({ slot: mmSel, name: $('mac-name').value.trim() || '新宏 (未保存)', steps: [], saved: false });
  items.sort((a, b) => a.slot - b.slot);
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty-li'; li.textContent = '还没有宏';
    ul.appendChild(li);
  }
  for (const m of items) {
    const li = document.createElement('li');
    if (m.slot === mmSel) li.classList.add('active');
    if (!m.saved) li.classList.add('unsaved');
    const no = document.createElement('span'); no.className = 'slot-no'; no.textContent = m.slot;
    const nm = document.createElement('span'); nm.className = 'm-name'; nm.textContent = m.name;
    const meta = document.createElement('span'); meta.className = 'm-meta';
    if (m.saved) {
      const b = boundCount(m.slot);
      meta.textContent = `${m.steps.length} 步 · ${fmtMs(macroDuration(m.steps))}`;
      if (b) { const sp = document.createElement('span'); sp.className = 'bound'; sp.textContent = ` · 绑定 ${b} 键`; meta.appendChild(sp); }
    } else meta.textContent = '编辑中';
    li.append(no, nm, meta);
    li.addEventListener('click', () => { if (m.slot !== mmSel && !mmRec) mmEdit(m.slot); });
    ul.appendChild(li);
  }
  const has = mmSel != null;
  $('mac-empty').hidden = has; $('mac-editor').hidden = !has;
  if (has) $('mac-slot-tag').textContent = `槽 ${mmSel}`;
  $('mac-del').disabled = !!mmRec || !(has && macroLib.some(m => m.slot === mmSel));
  mmUpdateMeter();
}
function mmUpdateMeter() {
  const others = macroLib.filter(m => m.slot !== mmSel).reduce((n, m) => n + stepsBytes(m.steps), 0);
  const cur = mmSel == null ? 0 : stepsBytes(draftToSteps(mmDraft) || []);
  const used = others + cur;
  $('mac-meter-text').textContent = `${used} / ${MAC_POOL_BYTES} B`;
  $('mac-meter-bar').style.width = Math.min(100, used / MAC_POOL_BYTES * 100) + '%';
  $('mac-meter-bar').classList.toggle('full', used > MAC_POOL_BYTES);
  return used;
}
function mmRenderSteps() {
  const tb = $('mac-steps').tBodies[0];
  tb.innerHTML = '';
  const rec = !!mmRec; // 录制中锁定表格编辑, 与实时录入互斥
  if (!mmDraft.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.className = 'empty'; td.colSpan = 7;
    td.textContent = rec ? '正在录制… 在键盘上按键' : '还没有步骤 — 点"开始录制"在键盘上打一遍, 或用"+ 按键 / 鼠标 / 延时"手动添加';
    tr.appendChild(td); tb.appendChild(tr);
  }
  const last = mmDraft.length - 1;
  let t = 0;
  mmDraft.forEach((st, i) => {
    const tr = document.createElement('tr');
    const isDelay = st.kind === 'delay';
    tr.className = isDelay ? 'row-delay' : (st.down ? 'ev-down' : 'ev-up');
    const cell = cls => { const td = document.createElement('td'); if (cls) td.className = cls; tr.appendChild(td); return td; };
    const delB = document.createElement('button'); delB.textContent = '✕'; delB.title = '删除这一步'; delB.disabled = rec;
    delB.addEventListener('click', () => { mmDraft.splice(i, 1); mmRenderSteps(); });
    cell('del-cell').appendChild(delB);
    cell('idx').textContent = i + 1;
    const pill = document.createElement('span');
    pill.className = 'pill ' + (isDelay ? 'delay' : st.down ? 'down' : 'up');
    pill.textContent = isDelay ? '⏱ 延时' : st.down ? '↓ 按下' : '↑ 释放';
    cell('ev').appendChild(pill);
    const kc = cell('k');
    if (!isDelay) { const cap = document.createElement('span'); cap.className = 'kcap' + (st.kind === 'mouse' ? ' mouse' : ''); cap.textContent = st.label; kc.appendChild(cap); }
    const dl = cell('dl');
    const inp = document.createElement('input');
    inp.className = 'dl'; inp.type = 'number'; inp.min = '0'; inp.max = String(MAX_DELAY); inp.step = '10';
    inp.value = isDelay ? st.ms : st.delay; inp.disabled = rec;
    inp.addEventListener('change', e => {
      const v = Math.max(0, Math.min(MAX_DELAY, Math.round(Number(e.target.value) || 0)));
      if (isDelay) st.ms = v || 1; else st.delay = v;
      mmRenderSteps();
    });
    const unit = document.createElement('span'); unit.className = 'unit'; unit.textContent = 'ms';
    dl.append(inp, unit);
    cell('t').textContent = isDelay ? '' : '@ ' + fmtMs(t);
    t += isDelay ? st.ms : st.delay;
    const ops = cell('ops');
    const btn = (txt, title, dis, fn, cls) => {
      const b = document.createElement('button'); b.textContent = txt; b.title = title; b.disabled = rec || dis;
      if (cls) b.className = cls;
      b.addEventListener('click', fn); ops.appendChild(b);
    };
    const move = to => { const row = mmDraft.splice(i, 1)[0]; mmDraft.splice(to, 0, row); mmRenderSteps(); };
    btn('⤒', '移到顶部', i === 0, () => move(0));
    btn('↑', '上移', i === 0, () => move(i - 1));
    btn('↓', '下移', i === last, () => move(i + 1));
    btn('⤓', '移到底部', i === last, () => move(mmDraft.length - 1));
    tb.appendChild(tr);
  });
  // 汇总: 步数 / 总时长 / 占用
  const steps = draftToSteps(mmDraft);
  const sum = $('mac-summary');
  sum.innerHTML = '';
  const add = (label, val, bad) => { const sp = document.createElement('span'); if (bad) sp.className = 'bad'; sp.append(label + ' '); const b = document.createElement('b'); b.textContent = val; sp.appendChild(b); sum.appendChild(sp); };
  const evs = mmDraft.filter(r => r.kind !== 'delay').length;
  add('事件', String(evs));
  add('总时长', fmtMs(t));
  if (steps) add('本宏占用', stepsBytes(steps) + ' B');
  else add('', '第一行不能是延时', true);
  const used = mmUpdateMeter();
  if (used > MAC_POOL_BYTES) add('', `宏库超出 ${used - MAC_POOL_BYTES} B, 将无法保存`, true);
}
function mmEdit(slot) {
  mmStopRec();
  mmSel = slot;
  const m = slot == null ? null : macroLib.find(x => x.slot === slot);
  mmDraft = m ? m.steps.map(stepToRow) : [];
  $('mac-name').value = m ? m.name : '';
  mmRenderList(); mmRenderSteps();
}
// 录制中: 每个按键事件都实时重算整表 (含到下一事件的间隔), 同步显示
function mmLive() {
  const ev = mmRec.events;
  mmDraft = ev.map((e, i) => ({ kind: 'key', hid: e.hid, label: e.label, down: e.down, delay: Math.min(MAX_DELAY, i + 1 < ev.length ? ev[i + 1].t - e.t : 0) }));
  mmRenderSteps();
  const wrap = $('mac-steps-wrap');
  wrap.scrollTop = wrap.scrollHeight;
}
// 修复审查 #25: 去掉开头孤立的"释放"(录制前就按着的键), 为没松开的键补"释放"(录制中切走窗口丢了 keyup)
function mmNormalizeEvents(ev, stopT) {
  const down = new Set(), out = [];
  for (const e of ev) {
    if (e.down) { if (down.has(e.hid)) continue; down.add(e.hid); out.push(e); }
    else if (down.has(e.hid)) { down.delete(e.hid); out.push(e); }
  }
  for (const hid of down) { const d = out.filter(e => e.hid === hid).pop(); out.push({ hid, label: d.label, down: false, t: stopT }); }
  return out;
}
window.addEventListener('blur', () => { if (mmRec) { mmStopRec(); setStatus('窗口失去焦点, 已自动停止录制 (未松开的键已补"释放")', 'err'); } });
function mmStopRec() {
  if (!mmRec) return;
  const stopT = Date.now(), ev = mmNormalizeEvents(mmRec.events, stopT);
  mmRec = null;
  $('mac-rec').classList.remove('recording');
  $('mac-rec').querySelector('span').textContent = '开始录制';
  mmSetInsEnabled(true);
  if (ev.length) {
    mmDraft = ev.map((e, i) => ({
      kind: 'key', hid: e.hid, label: e.label, down: e.down,
      delay: Math.min(MAX_DELAY, i + 1 < ev.length ? ev[i + 1].t - e.t : Math.max(0, stopT - e.t))
    }));
    setStatus(`录制完成: ${ev.length} 个事件`, 'ok');
  }
  mmRenderSteps();
}
// ---- 视图切换: 按键映射 | 宏库 ----
let curView = 'keys';
function showView(v) {
  if (v === curView) return;
  if (curView === 'macro') mmStopRec();
  curView = v;
  $('view-keys').hidden = v !== 'keys';
  macMgr.hidden = v !== 'macro';
  document.querySelectorAll('#tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
  if (v === 'macro') {
    if (mmSel == null && macroLib.length) mmEdit(macroLib[0].slot);
    else { mmRenderList(); mmRenderSteps(); }
  } else {
    populateMacroPick(); refreshAllFaces(); markDirty();
  }
}
document.querySelectorAll('#tabs .tab').forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));
$('btn-mac-lib').addEventListener('click', () => {
  const v = $('macro-pick').value;
  showView('macro');
  if (v !== '' && Number(v) !== mmSel) mmEdit(Number(v));
});
$('mac-name').addEventListener('input', () => { if (mmSel != null && !macroLib.some(m => m.slot === mmSel)) mmRenderList(); });
$('mac-clear').addEventListener('click', async () => {
  if (!mmDraft.length || mmRec) return;
  if (!await askDialog({ title: '清空所有步骤?', bodyHTML: '只清空编辑中的草稿, 点"保存宏"前不会影响宏库。', okText: '清空', danger: true })) return;
  mmDraft = []; mmRenderSteps();
});
// ---- 配置档弹出层 ----
const profilesPop = $('profiles-pop');
$('btn-profiles').addEventListener('click', e => { e.stopPropagation(); profilesPop.hidden = !profilesPop.hidden; });
document.addEventListener('click', e => {
  if (profilesPop.hidden) return;
  if (profilesPop.contains(e.target) && !e.target.closest('li, button')) return;
  if ($('btn-profiles').contains(e.target)) return;
  profilesPop.hidden = true;
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !profilesPop.hidden) profilesPop.hidden = true; });
$('mac-new').addEventListener('click', () => {
  const used = new Set(macroLib.map(m => m.slot));
  let slot = -1;
  for (let i = 0; i < 100; i++) if (!used.has(i)) { slot = i; break; }
  if (slot < 0) return setStatus('100 个宏槽已满', 'err');
  mmEdit(slot);
  $('mac-name').value = '';
  $('mac-name').focus();
});
$('mac-rec').addEventListener('click', () => {
  if (mmRec) return mmStopRec();
  mmRec = { events: [] };
  mmDraft = [];
  mmSetInsEnabled(false);
  $('mac-rec').classList.add('recording');
  $('mac-rec').querySelector('span').textContent = '停止录制';
  $('mac-rec').blur();
  mmRenderSteps();
});
// ---- 手动插入: 鼠标事件 / 按键 / 延时 ----
$('mac-ins-mouse').addEventListener('change', e => {
  const v = e.target.value;
  e.target.selectedIndex = 0;
  if (!v || mmRec) return;
  const [button, down] = v.split('|');
  const wheel = button.startsWith('wheel');
  mmDraft.push({ kind: 'mouse', button, down: wheel || down === '1', delay: wheel || down !== '1' ? 10 : 50, label: MOUSE_LABEL[button] });
  mmRenderSteps();
  setStatus(`已插入: ${MOUSE_LABEL[button]} — 可用 ↑↓ 调整位置`, 'ok');
});
$('mac-ins-key').addEventListener('click', () => {
  if (mmRec) return;
  mmInsCapturing = true;
  $('mac-ins-capture').focus();
  setStatus('插入键: 请按下要插入的键 (将插入一对 按下+释放)', 'ok');
});
$('mac-ins-capture').addEventListener('blur', () => {
  if (mmInsCapturing) { mmInsCapturing = false; setStatus('已取消插入键录入', ''); }
});
$('mac-ins-delay').addEventListener('click', async () => {
  if (mmRec) return;
  const v = await askDialog({ title: '插入延时 (毫秒)', input: { value: '100' }, okText: '插入' });
  if (v == null) return;
  const ms = Math.round(Number(v));
  if (!Number.isFinite(ms) || ms < 1 || ms > MAX_DELAY) return setStatus(`延时要填 1~${MAX_DELAY} 之间的毫秒数`, 'err');
  mmDraft.push({ kind: 'delay', ms });
  mmRenderSteps();
});
$('mac-save').addEventListener('click', async () => {
  if (mmSel == null) return setStatus('请先"新建宏"或选择一个槽', 'err');
  mmStopRec();
  if (!mmDraft.length) return setStatus('宏还没有步骤, 请先录制', 'err');
  const name = $('mac-name').value.trim() || `宏${mmSel}`;
  // 落库模型 = 线协议模型: 事件 + 它的"之后等待"; 单独插入的延时行保存为 {wait} 步骤, 每行一条延时记录 (与老软件逐字节一致)
  const steps = [];
  for (const r of mmDraft) {
    const delay = Math.max(0, Math.min(MAX_DELAY, Math.round(r.delay || 0)));
    if (r.kind === 'delay') {
      if (!steps.length) return setStatus('第一行不能是延时 — 等待必须跟在某个按键/鼠标事件之后', 'err');
      steps.push({ wait: Math.max(1, Math.min(MAX_DELAY, Math.round(r.ms || 0))) });
    } else if (r.kind === 'mouse') {
      steps.push({ mouse: r.button, down: r.down ? 1 : 0, delay });
    } else {
      steps.push({ hid: r.hid, down: r.down ? 1 : 0, delay });
    }
  }
  const nextLib = [...macroLib.filter(x => x.slot !== mmSel), { slot: mmSel, name, steps }].sort((a, b) => a.slot - b.slot);
  // 修复审查 #21: 保存前就用协议层编码检查容量/合法性, 不等到下发才报溢出
  const chk = await window.api.checkMacros(nextLib);
  if (!chk.ok) return setStatus('宏未保存: ' + chk.error + ' — 请删减步骤或删除不用的宏', 'err');
  try {
    await window.api.saveMacros(nextLib);
  } catch (e) { return setStatus('保存宏库失败: ' + e.message, 'err'); }
  macroLib = nextLib;
  mmDraft = steps.map(stepToRow);
  populateMacroPick(); mmRenderList(); mmRenderSteps(); markDirty();
  setStatus(`宏「${name}」已保存到槽 ${mmSel} — 点底部"写入到键盘"才会生效`, 'ok');
});
$('mac-del').addEventListener('click', async () => {
  if (mmSel == null) return;
  const m = macroLib.find(x => x.slot === mmSel);
  if (!m) return;
  const bound = (config.overrides || []).filter(o => o.action === 'macro' && o.slot === mmSel);
  const extra = bound.length
    ? `<br><br>当前草稿里有 <b>${bound.length}</b> 个键 (${bound.map(o => keyNameByCell.get(o.cell) || '格' + o.cell).join(', ')}) 绑定了该宏, 删除后这些键将恢复默认功能。`
    : '';
  if (!await askDialog({ title: `删除槽 ${mmSel}「${m.name}」?`, bodyHTML: '删除宏库中该槽的数据, 点"写入到键盘"后在键盘上生效。' + extra, okText: '删除', danger: true })) return;
  for (const o of bound) {
    const i = config.overrides.indexOf(o);
    if (i >= 0) config.overrides.splice(i, 1);
  }
  const deleted = mmSel;
  const nextLib = macroLib.filter(x => x.slot !== deleted);
  try { await window.api.saveMacros(nextLib); }
  catch (e) { return setStatus('删除失败: ' + e.message, 'err'); }
  macroLib = nextLib;
  mmSel = macroLib.length ? macroLib[0].slot : null;
  mmEdit(mmSel);
  populateMacroPick(); refreshAllFaces(); markDirty();
  setStatus(`已删除槽 ${deleted}`, 'ok');
});

// ---- 设备状态 ----
function renderDevice(s) {
  device = s;
  const badge = $('device-badge');
  badge.classList.remove('on', 'boot', 'off');
  if (!s.present) {
    badge.classList.add('off');
    badge.querySelector('.txt').textContent = s.error || '未检测到 GM108 (请插好键盘)';
    $('fw-ver').textContent = '';
  } else if (s.mode === 'boot') {
    badge.classList.add('boot');
    badge.querySelector('.txt').textContent = 'BOOT 救援模式 — 请用官方固件工具重刷';
    $('fw-ver').textContent = '';
  } else if (s.suspectBusy) {
    badge.classList.add('boot');
    badge.querySelector('.txt').textContent = '上次下发超时 — 请拔插键盘后再操作';
  } else {
    badge.classList.add('on');
    badge.querySelector('.txt').textContent = (s.product || 'GANSS GM108') + ' 已连接';
    // 本通道读不到版本(应答恒全零), 读不到就整个不显示。下发中绝不查询 (修复审查 #17)
    if (!busy) window.api.getFirmwareVersion().then(v => { $('fw-ver').textContent = v ? '固件 ' + v : ''; });
  }
  markDirty();
}
window.api.onDeviceChanged(renderDevice);
// 下发超过 30s: 主进程不会强杀 HID 线程 (防止把设备留在半截会话), 这里只做提示
window.api.onApplyPending(() => {
  const el = $('apply-elapsed');
  setStatus('键盘应答较慢, 仍在等待… 请勿拔线; 软件不会中途打断写入, 最长约 2 分钟后给出结果', 'err');
  if (el) $('status-text').append('  ', el);
});

// ---- 启动 ----
window.addEventListener('error', e => setStatus('界面脚本错误: ' + e.message + ' @' + (e.lineno || '?'), 'err'));
(async () => {
  macroLib = await window.api.listMacros();
  await loadAppliedDoc();
  config = JSON.parse(JSON.stringify(applied));
  savedSnapshot = JSON.stringify(config.overrides);
  populateMacroPick();
  renderKeyboard();
  await refreshProfiles();
  renderDevice(await window.api.getDeviceStatus());
})();
