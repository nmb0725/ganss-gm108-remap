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

const actionOf = cell => ((config && config.overrides) || []).find(o => o.cell === cell)?.action || 'default';
// 待下发变更 = 当前编辑 vs 键盘已生效(applied)。"改回默认"也是一处变更!
const diffList = () => {
  const ap = new Map(((applied && applied.overrides) || []).filter(o => o.action !== 'default').map(o => [o.cell, o.action]));
  const cu = new Map(config.overrides.filter(o => o.action !== 'default').map(o => [o.cell, o]));
  const out = [];
  for (const [cell, o] of cu) if (ap.get(cell) !== o.action) out.push({ ...o, change: 'set' });
  for (const cell of ap.keys()) if (!cu.has(cell)) out.push({ cell, action: 'default', change: 'revert' });
  return out;
};

// ---- SVG 键盘 ----
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
    const s = document.createElementNS(SVGNS, 'text');
    s.setAttribute('class', 'sub');
    s.setAttribute('x', k.x * U + w / 2);
    g.appendChild(s);
    if (k.conf === '?') g.classList.add('unc');
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
  g.classList.toggle('dis', act === 'disable');
  g.classList.toggle('remap', act !== 'default' && act !== 'disable');
  const main = g.querySelector('text.main');
  const sub = g.querySelector('text.sub');
  const cy = k.y * U + 4 + ((k.h || 1) * U - 4) / 2;
  let subStr = '';
  if (act === 'disable') main.textContent = '✕';
  else if (act !== 'default') { main.textContent = k.l; subStr = ov.target || ''; }
  else { main.textContent = k.l; if (k.conf === '?') subStr = '?'; }
  sub.textContent = subStr;
  main.setAttribute('y', cy - (subStr ? 6 : 0));
  sub.setAttribute('y', cy + 10);
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
function renderFnPanel() {
  document.querySelectorAll('#fn-grid .fn-card').forEach(c => c.classList.toggle('active', c.dataset.fn === fnSel));
  $('fn-remap').hidden = fnSel !== 'remap';
  $('fn-mouse').hidden = fnSel !== 'mouse';
  $('fn-combo').hidden = fnSel !== 'combo';
  $('fn-macro').hidden = fnSel !== 'macro';
  $('fn-media').hidden = fnSel !== 'media';
}
// Windows 快捷键预设 = 同一套 02 <修饰位> <usage> 00 线格式, 记录后与键盘功能共用应用逻辑
$('win-preset').addEventListener('change', e => {
  const v = e.target.value;
  if (!v) return;
  const [mod, hid, target] = v.split('|');
  captured = { mod: Number(mod), hid: Number(hid), target, mods: Number(mod), keyLabel: target.split(' + ').pop() };
  renderRemapSlots();
  setStatus('已选 Windows 快捷键: ' + target + ' — 点"应用"加入草稿', 'ok');
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
  if (mmRec) { // 宏录制模式: 吞掉所有键, 只记事件
    e.preventDefault(); e.stopPropagation();
    if (e.repeat) return;
    const mh = MOD_HID[e.code];
    const t = mh ? { hid: mh[0], label: mh[1] } : CODE_MAP[e.code];
    if (t) mmRec.events.push({ hid: t.hid, label: t.label, down: true, t: Date.now() });
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
  capBox.blur(); // 结束捕捉并回填
}, true);
// 修饰键全部抬手: 若期间没按过主键, 目标就是这组修饰键本身 (如 Caps→右Ctrl)
document.addEventListener('keyup', e => {
  if (mmRec) { // 宏录制: 记录释放时刻
    e.preventDefault(); e.stopPropagation();
    const mh = MOD_HID[e.code];
    const t = mh ? { hid: mh[0], label: mh[1] } : CODE_MAP[e.code];
    if (t) mmRec.events.push({ hid: t.hid, label: t.label, down: false, t: Date.now() });
    return;
  }
  if (!capturing || !MOD_BIT[e.code]) return;
  e.preventDefault(); e.stopPropagation();
  liveMod &= ~MOD_BIT[e.code];
  if (liveMod || captured) return;
  if (pressedMod) {
    captured = { mod: pressedMod, mods: 0, hid: null, keyLabel: modsLabel(pressedMod), target: modsLabel(pressedMod) };
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
  if (!editable) setStatus(shortName(k) + ': 该键格号未定, 本期不可编辑', 'err');
  const act = editable ? actionOf(k.cell) : 'default';
  fnSel = ['default', 'remap', 'mouse', 'combo', 'macro', 'media', 'disable'].includes(act) ? act : 'default';
  const ov = (config.overrides || []).find(o => o.cell === k.cell);
  captured = act === 'remap' && ov ? normOv(ov) : null;
  renderRemapSlots();
  mousePick = act === 'mouse' && ov ? { button: ov.button, target: ov.target } : null;
  $('mouse-pick').value = mousePick ? mousePick.button : '';
  mediaPick = act === 'media' && ov ? { usage: ov.usage, target: ov.target } : null;
  $('media-pick').value = mediaPick ? String(mediaPick.usage) : '';
  comboCap = act === 'combo' && ov ? { keys: ov.keys.slice(), labels: ov.target.split(' + '), target: ov.target } : null;
  renderComboSlots();
  populateMacroPick();
  $('macro-pick').value = act === 'macro' && ov ? String(ov.slot) : '';
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
  } else if (act === 'combo') {
    if (!comboCap || !comboCap.keys.length) { setStatus('请先在输入框依次按下 1~3 个键', 'err'); return; }
    entry = { cell: selKey.cell, action: 'combo', keys: comboCap.keys, target: comboCap.target };
  } else if (act === 'macro') {
    const v = $('macro-pick').value;
    if (v === '') { setStatus('请先选择一个宏槽 (可点"管理宏库…"新建)', 'err'); return; }
    const m = macroLib.find(x => x.slot === Number(v));
    entry = { cell: selKey.cell, action: 'macro', slot: Number(v), target: (m && m.name) || ('槽' + v) };
  }
  if (act === 'default') { if (idx >= 0) config.overrides.splice(idx, 1); }
  else if (idx >= 0) config.overrides[idx] = entry;
  else config.overrides.push(entry);
  refreshKeyFace(selKey);
  markDirty();
});

// ---- 状态栏 / 差异 ----
// 宏库是设备全局的: 与"已下发宏库"不同就是一次待下发变更 (老档无 macros 字段时, 仅本地库非空算变更)
const libDirty = () => appliedMacros === undefined
  ? macroLib.length > 0
  : JSON.stringify(macroLib) !== JSON.stringify(appliedMacros || []);
function markDirty() {
  const n = diffList().length, md = libDirty();
  $('diff-summary').textContent =
    (n ? `待下发变更: ${n} 处` : '') + (md ? (n ? ' + ' : '待下发变更: ') + `宏库 (${macroLib.length} 个宏)` : '');
  $('apply-btn').disabled = !((n || md) && device.present && device.mode === 'normal');
  $('btn-factory').disabled = !(device.present && device.mode === 'normal');
  $('dirty-hint').textContent = (currentProfile ? `当前档: ${currentProfile}` : '未保存的新配置') +
    (JSON.stringify(config.overrides) !== JSON.stringify((applied || { overrides: [] }).overrides) || md ? ' (与键盘已应用状态不同)' : '');
}
function setStatus(msg, cls) {
  const el = $('status-text');
  el.textContent = msg;
  el.className = cls || '';
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
    const done = v => { $('modal').hidden = true; $('modal-ok').onclick = $('modal-cancel').onclick = null; resolve(v); };
    $('modal-cancel').onclick = () => done(input ? null : false);
    $('modal-ok').onclick = () => done(input ? ($('modal-input').value.trim() || null) : true);
  });
}

// ---- 帮助/救援页 ----
$('btn-help').addEventListener('click', () => { $('help').hidden = false; });
$('help-close').addEventListener('click', () => { $('help').hidden = true; });
$('help').addEventListener('click', e => { if (e.target === $('help')) $('help').hidden = true; });

// ---- 下发确认 ----
const keyNameByCell = new Map(KEYBOARD.filter(k => k.cell != null).map(k => [k.cell, shortName(k)]));
$('apply-btn').addEventListener('click', async () => {
  const diff = diffList();
  if (!diff.length && !libDirty()) return;
  const body = diff.map(o =>
    `<div class="chg">#${o.cell} ${keyNameByCell.get(o.cell) || '未知键'} → ${o.action === 'disable' ? '禁用' : o.action === 'default' ? '恢复默认' : ({ remap: '改键→', mouse: '鼠标→', media: '多媒体→', combo: '连击→', macro: '宏→' })[o.action] + (o.target || '')}</div>`
  ).join('') +
    (libDirty() ? `<div class="chg">宏库更新: 共 ${macroLib.length} 个宏, 将同步写入键盘 (全局, 所有配置档共用)</div>` : '') +
    '<p style="margin-top:10px">下发期间请勿拔线或操作键盘。</p>';
  if (!await askDialog({ title: `确认写入键盘 (${diff.length} 处变更${libDirty() ? ' + 宏库' : ''})`, bodyHTML: body, okText: '确认写入键盘', danger: true })) return;
  $('apply-btn').disabled = true;
  setStatus('正在下发…请勿触碰键盘/线缆');
  const r = await window.api.applyConfig(config);
  if (r.ok) {
    applied = JSON.parse(JSON.stringify(config));
    appliedMacros = JSON.parse(JSON.stringify(macroLib));
    setStatus(`下发成功: ${r.changed} 个键已更新${r.macros ? ' · 宏库已同步' : ''}`, 'ok');
  } else {
    setStatus('下发中止: ' + r.error, 'err');
  }
  markDirty();
});

// ---- 一键还原 (恢复出厂设置) ----
$('btn-factory').addEventListener('click', async () => {
  if (!await askDialog({ title: '一键还原', bodyHTML: '将清除键盘上<b>所有</b>改键与禁用, 恢复出厂默认并立即写入。已保存的配置档不受影响。下发期间请勿拔线或操作键盘。', okText: '确认还原', danger: true })) return;
  $('btn-factory').disabled = true;
  $('apply-btn').disabled = true;
  setStatus('正在恢复出厂…请勿触碰键盘/线缆');
  const factory = await window.api.factory();
  const r = await window.api.applyConfig(factory);
  if (r.ok) {
    applied = JSON.parse(JSON.stringify(factory));
    appliedMacros = JSON.parse(JSON.stringify(macroLib)); // 一键还原不清宏库(设备全局), 与老软件一致
    loadConfig(JSON.parse(JSON.stringify(applied)), null);
    await refreshProfiles();
    setStatus('已恢复出厂设置', 'ok');
  } else {
    setStatus('下发中止: ' + r.error, 'err');
    markDirty();
    $('btn-factory').disabled = !(device.present && device.mode === 'normal');
  }
});

// ---- 配置档 ----
// getApplied 现在返回 {config, macros}; 统一经 loadAppliedDoc 刷新 applied/appliedMacros
async function loadAppliedDoc() {
  const d = await window.api.getApplied();
  applied = d.config; appliedMacros = d.macros;
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
      if (name === '__applied__') loadConfig(JSON.parse(JSON.stringify(await loadAppliedDoc())), null);
      else loadConfig(await window.api.loadProfile(name), name);
    });
    ul.appendChild(li);
  }
}
function loadConfig(cfg, name) {
  config = cfg;
  currentProfile = name;
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
    await refreshProfiles();
    markDirty();
    setStatus(`已保存: ${name}`, 'ok');
  } catch (e) { setStatus('保存失败: ' + e.message, 'err'); }
}
$('btn-new').addEventListener('click', async () => {
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
  try { await window.api.saveProfile(cfg); setStatus(`已保存: ${currentProfile}`, 'ok'); }
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
  const r = await window.api.importProfile();
  if (!r) return;
  if (r.error) return setStatus('导入失败: ' + r.error, 'err');
  loadConfig(r.config, null);
  setStatus('导入成功 (未保存, 可另存为)', 'ok');
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
let mmSel = null, mmDraft = [], mmRec = null;

function mmRenderList() {
  const sel = $('mac-slots');
  sel.innerHTML = '';
  for (const m of macroLib) {
    const o = document.createElement('option');
    o.value = String(m.slot); o.textContent = `槽 ${m.slot} · ${m.name} (${m.steps.length} 步)`;
    sel.appendChild(o);
  }
  if (mmSel != null && !macroLib.some(m => m.slot === mmSel)) {
    const o = document.createElement('option');
    o.value = String(mmSel); o.textContent = `槽 ${mmSel} · (未保存)`;
    sel.appendChild(o);
  }
  sel.value = mmSel == null ? '' : String(mmSel);
  $('mac-del').disabled = !(mmSel != null && macroLib.some(m => m.slot === mmSel));
}
function mmRenderSteps() {
  const tb = $('mac-steps').tBodies[0];
  tb.innerHTML = '';
  if (!mmDraft.length) {
    tb.innerHTML = '<tr><td class="empty" colspan="4">还没有步骤 — 点"开始录制", 在键盘上打一遍即可</td></tr>';
    return;
  }
  mmDraft.forEach((s, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="k"></td><td class="${s.down ? 'ev-down' : 'ev-up'}">${s.down ? '按下' : '释放'}</td>` +
      `<td><input class="dl" type="number" min="0" max="65535" step="10" value="${s.delay}"> ms</td>` +
      `<td><button class="del" data-i="${i}">✕</button></td>`;
    tr.querySelector('.k').textContent = s.label;
    tr.querySelector('input.dl').addEventListener('change', e => {
      mmDraft[i].delay = Math.max(0, Math.min(65535, Math.round(Number(e.target.value) || 0)));
      e.target.value = mmDraft[i].delay;
    });
    tb.appendChild(tr);
  });
  tb.querySelectorAll('.del').forEach(b => b.addEventListener('click', () => { mmDraft.splice(Number(b.dataset.i), 1); mmRenderSteps(); }));
}
function mmEdit(slot) {
  mmStopRec();
  mmSel = slot;
  const m = slot == null ? null : macroLib.find(x => x.slot === slot);
  mmDraft = m ? m.steps.map(s => ({ hid: s.hid, down: !!s.down, delay: s.delay, label: mmLabelOf(s.hid) })) : [];
  $('mac-name').value = m ? m.name : '';
  mmRenderList(); mmRenderSteps();
}
function mmStopRec() {
  if (!mmRec) return;
  const stopT = Date.now(), ev = mmRec.events;
  mmRec = null;
  $('mac-rec').classList.remove('recording');
  $('mac-rec').textContent = '● 开始录制';
  if (ev.length) {
    mmDraft = ev.map((e, i) => ({
      hid: e.hid, label: e.label, down: e.down,
      delay: Math.min(65535, i + 1 < ev.length ? ev[i + 1].t - e.t : Math.max(0, stopT - e.t))
    }));
    setStatus(`录制完成: ${ev.length} 个事件`, 'ok');
  }
  mmRenderSteps();
}
$('btn-mac-lib').addEventListener('click', () => {
  macMgr.hidden = false;
  mmEdit(macroLib.length ? macroLib[0].slot : null);
});
$('mac-close').addEventListener('click', () => { mmStopRec(); macMgr.hidden = true; });
macMgr.addEventListener('click', e => { if (e.target === macMgr) { mmStopRec(); macMgr.hidden = true; } });
$('mac-slots').addEventListener('change', e => { if (e.target.value !== '') mmEdit(Number(e.target.value)); });
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
  $('mac-rec').classList.add('recording');
  $('mac-rec').textContent = '■ 停止录制';
  $('mac-rec').blur();
  mmRenderSteps();
});
$('mac-save').addEventListener('click', async () => {
  if (mmSel == null) return setStatus('请先"新建宏"或选择一个槽', 'err');
  mmStopRec();
  if (!mmDraft.length) return setStatus('宏还没有步骤, 请先录制', 'err');
  const name = $('mac-name').value.trim() || `宏${mmSel}`;
  const steps = mmDraft.map(s => ({ hid: s.hid, down: s.down ? 1 : 0, delay: Math.max(0, Math.min(65535, Math.round(s.delay || 0))) }));
  macroLib = [...macroLib.filter(x => x.slot !== mmSel), { slot: mmSel, name, steps }].sort((a, b) => a.slot - b.slot);
  mmDraft = steps.map(s => ({ hid: s.hid, down: !!s.down, delay: s.delay, label: mmLabelOf(s.hid) }));
  try {
    await window.api.saveMacros(macroLib);
  } catch (e) { return setStatus('保存宏库失败: ' + e.message, 'err'); }
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
  macroLib = macroLib.filter(x => x.slot !== mmSel);
  await window.api.saveMacros(macroLib);
  mmSel = macroLib.length ? macroLib[0].slot : null;
  mmEdit(mmSel);
  populateMacroPick(); refreshAllFaces(); markDirty();
  setStatus(`已删除槽 ${mmSel}`, 'ok');
});

// ---- 设备状态 ----
function renderDevice(s) {
  device = s;
  const badge = $('device-badge');
  badge.classList.remove('on', 'boot', 'off');
  if (!s.present) {
    badge.classList.add('off');
    badge.textContent = s.error || '未检测到 GM108 (请插好键盘)';
    $('fw-ver').textContent = '';
  } else if (s.mode === 'boot') {
    badge.classList.add('boot');
    badge.textContent = 'BOOT 救援模式 — 请用官方固件工具重刷';
    $('fw-ver').textContent = '';
  } else {
    badge.classList.add('on');
    badge.textContent = (s.product || 'GANSS GM108') + ' 已连接';
    // 本通道读不到版本(应答恒全零), 读不到就整个不显示
    window.api.getFirmwareVersion().then(v => { $('fw-ver').textContent = v ? '固件 ' + v : ''; });
  }
  markDirty();
}
window.api.onDeviceChanged(renderDevice);

// ---- 启动 ----
window.addEventListener('error', e => setStatus('界面脚本错误: ' + e.message + ' @' + (e.lineno || '?'), 'err'));
(async () => {
  macroLib = await window.api.listMacros();
  await loadAppliedDoc();
  config = JSON.parse(JSON.stringify(applied));
  populateMacroPick();
  renderKeyboard();
  await refreshProfiles();
  renderDevice(await window.api.getDeviceStatus());
})();
