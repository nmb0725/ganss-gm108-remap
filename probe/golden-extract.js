// 从 golden_default.log 提取所有键位段(04 11)会话 -> app/test/fixtures/
// 分类: 全零块=golden-default; 仅 cell92(块5@48)=05 03 的=golden-disable-win; 其余=golden-other-N
const fs = require('fs');
const path = require('path');
const lines = fs.readFileSync(path.join(__dirname, 'golden_default.log'), 'utf8').split(/\r?\n/);
const RE = /^(\d\d):(\d\d):(\d\d)\.(\d\d\d) (SET|GET) h=(0x[0-9a-f]+) len=(\d+) ret=(\d) \[([0-9a-f ]+)\]$/i;
const evs = [];
for (const l of lines) {
  const m = RE.exec(l);
  if (!m) continue;
  evs.push({ op: m[5], h: m[6], hex: m[9].trim().replace(/\s+/g, '') });
}
const sessions = [];
for (let hi = 0; hi < evs.length; hi++) {
  const H = evs[hi];
  if (H.op !== 'SET' || !H.hex.startsWith('000411')) continue;
  let nblk = 0; // 块数 = 04 11 之后第一个非零字节
  for (let i = 6; i < 40; i += 2) { const v = parseInt(H.hex.slice(i, i + 2), 16); if (v) { nblk = v; break; } }
  const same = evs.slice(hi + 1).filter(e => e.h === H.h);
  const blocks = [];
  let trailer = null;
  for (const e of same) {
    if (e.op !== 'SET') continue;
    if (e.hex.startsWith('0004')) { trailer = e.hex; break; }
    if (blocks.length >= nblk) break;
    blocks.push(e.hex.slice(2)); // 去报告ID, 存纯64B
  }
  if (blocks.length !== nblk || !trailer) continue;
  // 同 handle 从 04 ab 到收尾包的完整事件流(含 GET 应答, 供 FakeDev 复现)
  let si = hi;
  while (si > 0 && !(evs[si].op === 'SET' && evs[si].hex.startsWith('0004ab') && evs[si].h === H.h)) si--;
  const steps = [];
  for (let k = si; k <= hi + 1 + same.length && k < evs.length; k++) {
    if (evs[k].h !== H.h) continue;
    steps.push({ op: evs[k].op, hex: evs[k].hex });
    if (k > hi && evs[k].op === 'SET' && evs[k].hex === trailer) break;
  }
  sessions.push({ header: H.hex, blocks, trailer, steps });
}
console.log('04 11 会话数:', sessions.length);
const dest = path.join(__dirname, '..', 'app', 'test', 'fixtures');
fs.mkdirSync(dest, { recursive: true });
let other = 0;
for (const s of sessions) {
  const flat = s.blocks.join('');
  const diff = [];
  for (let i = 0; i < 640; i++) {
    const v = parseInt(flat.slice(i * 2, i * 2 + 2), 16);
    const isTail = i === 638 ? v === 0xaa : i === 639 ? v === 0x55 : v === 0;
    if (!isTail) diff.push(`${i >> 6}:${i & 63}=${v.toString(16)}`);
  }
  let name, tag = '';
  if (diff.length === 2 && diff.includes('5:48=5') && diff.includes('5:49=3')) name = 'golden-disable-win';
  else if (!diff.length) name = 'golden-default';
  else { name = 'golden-other-' + (++other); tag = ' 差异: ' + diff.join(' '); }
  console.log('会话 ->', name, '(差异', diff.length + ')', tag);
  fs.writeFileSync(path.join(dest, name + '.json'), JSON.stringify(s, null, 1));
}
