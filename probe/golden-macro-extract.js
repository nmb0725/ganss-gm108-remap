// 从 golden_default.log 提取宏相关段会话 (04 15 宏库 / 04 17 槽数 / 04 f0 提交) -> app/test/fixtures/golden-macro.json
const fs = require('fs');
const path = require('path');
const lines = fs.readFileSync(path.join(__dirname, 'golden_default.log'), 'utf8').split(/\r?\n/);
const RE = /^\d\d:\d\d:\d\d\.\d\d\d (SET|GET) h=(0x[0-9a-f]+) len=(\d+) ret=(\d) \[([0-9a-f ]+)\]$/i;
const evs = [];
for (const l of lines) {
  const m = RE.exec(l);
  if (m) evs.push({ op: m[1], h: m[2], hex: m[5].trim().replace(/\s+/g, '') });
}
// 会话 = 头包(00 04 <cmd> ...块数@载荷第8字节) 后同 handle 的连续非 04 数据块
function extract(cmd) {
  const out = [];
  for (let i = 0; i < evs.length; i++) {
    const H = evs[i];
    if (H.op !== 'SET' || !H.hex.startsWith('0004' + cmd)) continue;
    let nblk = 0;
    for (let k = 6; k < 40; k += 2) { const v = parseInt(H.hex.slice(k, k + 2), 16); if (v) { nblk = v; break; } }
    const blocks = [];
    for (const e of evs.slice(i + 1)) {
      if (e.h !== H.h) continue;
      if (e.op !== 'SET') continue;
      if (e.hex.startsWith('0004')) break;
      if (blocks.length >= nblk) break;
      blocks.push(e.hex.slice(2)); // 去报告ID 存纯64B
    }
    if (blocks.length === nblk) out.push({ header: H.hex, blocks });
  }
  return out;
}
const s15 = extract('15'), s17 = extract('17');
const f0 = evs.find(e => e.op === 'SET' && e.hex.startsWith('0004f0'));
console.log('04 15 会话数:', s15.length, ' 04 17 会话数:', s17.length, ' f0:', f0 && f0.hex);
if (s15.length === 2 && s15[0].header === s15[1].header && JSON.stringify(s15[0].blocks) === JSON.stringify(s15[1].blocks))
  console.log('两次 15 会话逐字节相同 ✓');
if (s17.length === 2 && JSON.stringify(s17[0].blocks) === JSON.stringify(s17[1].blocks))
  console.log('两次 17 会话逐字节相同 ✓');
const fx = { header15: s15[0].header, blocks15: s15[0].blocks, header17: s17[0].header, blocks17: s17[0].blocks, f0: f0.hex };
const dest = path.join(__dirname, '..', 'app', 'test', 'fixtures', 'golden-macro.json');
fs.writeFileSync(dest, JSON.stringify(fx, null, 1));
console.log('->', dest);
