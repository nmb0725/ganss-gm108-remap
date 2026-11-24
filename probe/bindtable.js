// 2026-11-24 修复: 旧正则要求每字节后跟空格, 丢掉了每个报文的最后 1 字节(每块只剩 63B), 导致 bindPos 公式与鼠标宏模型错位
// 汇总所有宏绑定抓包: 按 gkdb Profile1 实际绑定清单,DB升序↔记录字节升序 配对, 输出 f(K)=4K-s 表
// 用法: node probe/bindtable.js probe/cap_bindmap5.log
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const file = process.argv[2];
const db = new DatabaseSync('C:/Program Files/GM108 Keyboard/GamingKeyboard.gkdb', { readOnly: true });
const keys = db.prepare("select KeyIndex from KeyCustomization where ProfileName='Profile1' and Definition like '3?%' order by KeyIndex+0").all().map(r => r.KeyIndex);
db.close();
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
let cur = null, mode = false; const sessions = [];
for (const ln of lines) {
  const m = ln.match(/SET h=\S+ len=65 ret=1 \[00 ((?:[0-9a-f]{2} ?)+)\]/);
  if (!m) continue;
  const b = m[1].trim().split(' ').map(x => parseInt(x, 16));
  if (b[0] === 4 && b[1] === 0x11) { cur = { blocks: [] }; sessions.push(cur); mode = true; continue; }
  if (mode && cur) { if (b[0] === 4) { mode = false; continue; } cur.blocks.push(Buffer.from(b.slice(0, 64))); }
}
const seg = Buffer.concat(sessions[sessions.length - 1].blocks);
const pos = [];
for (let o = 1; o < seg.length - 2; o++) if (seg[o] === 0x06 && seg[o + 1] === 0x0a && seg[o + 2] <= 2) pos.push(o);
console.log('DB绑定数', keys.length, '记录数', pos.length, '锚221/445:', pos.includes(221) && pos.includes(445));
const rows = keys.map((k, i) => ({ K: k, f: pos[i], s: pos[i] != null ? 4 * k - pos[i] : null }));
let mono = true, prevS = -1;
for (const r of rows) { if (r.s == null || r.s < prevS) mono = false; prevS = r.s == null ? prevS : r.s; }
console.log('s单调且完整:', mono);
console.log(rows.map(r => `K${r.K}:f=${r.f},s=${r.s}`).join('\n'));
