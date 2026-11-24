'use strict';
// 下发决策与"键盘已生效状态"(applied.json) 存取。从 main.js 抽出以便单测。修复审查 #4 / #5。
const fs = require('fs');
const { factoryDefault } = require('./config-store');
const { entrySig } = require('../renderer/entry-sig');

// 读 applied.json:
//   不存在 (首次使用)     => { config: 出厂, macros: undefined, unknown: false }
//   损坏 / 被标记未知     => { config: 出厂, macros: undefined, unknown: true }  —— 绝不把损坏静默当成"出厂默认"
function readAppliedDoc(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return { config: factoryDefault(), macros: undefined, unknown: false };
    return { config: factoryDefault(), macros: undefined, unknown: true, reason: '读取失败: ' + e.message };
  }
  try {
    const d = JSON.parse(raw);
    if (d.unknown) return { config: factoryDefault(), macros: undefined, unknown: true, reason: d.reason || '已标记为未知' };
    return { config: d.config || factoryDefault(), macros: d.macros, unknown: false };
  } catch (e) {
    return { config: factoryDefault(), macros: undefined, unknown: true, reason: 'applied.json 损坏' };
  }
}

// 原子写 (先 .tmp 再 rename)
function writeAppliedDoc(file, doc) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(doc));
  fs.renameSync(file + '.tmp', file);
}

function markUnknown(file, reason) {
  writeAppliedDoc(file, { at: Date.now(), unknown: true, reason });
}

// 计算本次要下发什么。
//   prevDoc.unknown 或 force => 全量: 键位段必写, 宏库必写 (状态未知时不能信任差异)
function planApply({ cfg, prevDoc, lib, force = false }) {
  const full = !!(force || prevDoc.unknown);
  const live = list => (list || []).filter(o => o.action !== 'default');
  const prev = new Map(live(prevDoc.config && prevDoc.config.overrides).map(o => [o.cell, entrySig(o)]));
  const cur = new Map(live(cfg.overrides).map(o => [o.cell, entrySig(o)]));
  let changed = 0;
  if (full) changed = cur.size;
  else {
    for (const [c, a] of cur) if (prev.get(c) !== a) changed++;
    for (const c of prev.keys()) if (!cur.has(c)) changed++;
  }
  const hasBinding = (cfg.overrides || []).some(o => o.action === 'macro');
  const macrosChanged = full
    ? true
    : prevDoc.macros === undefined
      ? (lib.length > 0 || hasBinding)
      : JSON.stringify(lib) !== JSON.stringify(prevDoc.macros);
  const nothing = !full && !changed && !macrosChanged;
  return { full, changed, macrosChanged, nothing };
}

// 下发结果 => 应写入 applied.json 的内容
//   成功                     => 新基线
//   失败但写会话可能已动过设备 => 标记未知 (下次自动全量)。preflight 阶段失败 = 一个写报文都没发, 保留原基线
function appliedAfter({ result, cfg, lib, prevDoc }) {
  if (result.ok) return { at: Date.now(), config: cfg, macros: lib };
  const touched = result.stuck || result.keymapMaybeApplied || (result.step && result.step !== 'preflight') || !result.step;
  if (!touched) return null; // 不改
  return { at: Date.now(), unknown: true, reason: result.stuck ? '上次下发超时' : result.keymapMaybeApplied ? '上次下发只完成键位段' : '上次下发中途中止' };
}

module.exports = { readAppliedDoc, writeAppliedDoc, markUnknown, planApply, appliedAfter };
