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
let currentProfile = null;  // 侧栏选中的档名
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
  $('insp-title').textContent = shortName(k);
  $('insp-cell').innerHTML = editable
    ? `格号(KeyIndex): <b>${k.cell}</b>`
    : '<span class="conf-q">格号未定, 本期不可编辑 (校准后开放)</span>';
  const act = editable ? actionOf(k.cell) : 'default';
  fnSel = ['default', 'remap', 'mouse', 'combo', 'media', 'disable'].includes(act) ? act : 'default';
  const ov = (config.overrides || []).find(o => o.cell === k.cell);
  captured = act === 'remap' && ov ? normOv(ov) : null;
  renderRemapSlots();
  mousePick = act === 'mouse' && ov ? { button: ov.button, target: ov.target } : null;
  $('mouse-pick').value = mousePick ? mousePick.button : '';
  mediaPick = act === 'media' && ov ? { usage: ov.usage, target: ov.target } : null;
  $('media-pick').value = mediaPick ? String(mediaPick.usage) : '';
  comboCap = act === 'combo' && ov ? { keys: ov.keys.slice(), labels: ov.target.split(' + '), target: ov.target } : null;
  renderComboSlots();
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
  }
  if (act === 'default') { if (idx >= 0) config.overrides.splice(idx, 1); }
  else if (idx >= 0) config.overrides[idx] = entry;
  else config.overrides.push(entry);
  refreshKeyFace(selKey);
  markDirty();
});

// ---- 状态栏 / 差异 ----
function markDirty() {
  const n = diffList().length;
  $('diff-summary').textContent = n ? `待下发变更: ${n} 处` : '';
  $('apply-btn').disabled = !(n && device.present && device.mode === 'normal');
  $('btn-factory').disabled = !(device.present && device.mode === 'normal');
  $('dirty-hint').textContent = (currentProfile ? `当前档: ${currentProfile}` : '未保存的新配置') +
    (JSON.stringify(config.overrides) !== JSON.stringify((applied || { overrides: [] }).overrides) ? ' (与键盘已应用状态不同)' : '');
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
  if (!diff.length) return;
  const body = diff.map(o =>
    `<div class="chg">#${o.cell} ${keyNameByCell.get(o.cell) || '未知键'} → ${o.action === 'disable' ? '禁用' : o.action === 'default' ? '恢复默认' : ({ remap: '改键→', mouse: '鼠标→', media: '多媒体→', combo: '连击→' })[o.action] + (o.target || '')}</div>`
  ).join('') + '<p style="margin-top:10px">下发期间请勿拔线或操作键盘。</p>';
  if (!await askDialog({ title: `确认写入键盘 (${diff.length} 处变更)`, bodyHTML: body, okText: '确认写入键盘', danger: true })) return;
  $('apply-btn').disabled = true;
  setStatus('正在下发…请勿触碰键盘/线缆');
  const r = await window.api.applyConfig(config);
  if (r.ok) {
    applied = JSON.parse(JSON.stringify(config));
    setStatus(`下发成功: ${r.changed} 个键已更新`, 'ok');
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
      if (name === '__applied__') loadConfig(await window.api.getApplied(), null);
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
  applied = await window.api.getApplied();
  config = JSON.parse(JSON.stringify(applied));
  renderKeyboard();
  await refreshProfiles();
  renderDevice(await window.api.getDeviceStatus());
})();
