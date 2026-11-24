// 2026-11-24 修复: 旧正则要求每字节后跟空格, 丢掉了每个报文的最后 1 字节(每块只剩 63B), 导致 bindPos 公式与鼠标宏模型错位
// 把 slot10 区域按 4 字节词打印, 并尝试用模型重建 DB(12事件+延时5) 序列做比对
const fs = require('fs');
const file = process.argv[2] || 'probe/cap_mouse_macro.log';
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
let last = null, cur = null, mode = false;
for (const ln of lines) {
  const m = ln.match(/SET h=\S+ len=65 ret=1 \[00 ((?:[0-9a-f]{2} ?)+)\]/);
  if (!m) continue;
  const b = m[1].trim().split(' ').map((x) => parseInt(x, 16));
  if (b[0] === 4 && b[1] === 0x15) { cur = { blocks: [] }; last = cur; mode = true; continue; }
  if (mode && cur) { if (b[0] === 4) { mode = false; continue; } cur.blocks.push(Buffer.from(b.slice(0, 64))); }
}
const seg = Buffer.concat(last.blocks);
const BTN = { 0: 0x01, 1: 0x02, 2: 0x04, 3: 0x08, 4: 0x10 };
// DB 序列: idx,down; wheel(5) down0=up down1=down
const dbs = [[0,0],[0,1],[1,0],[1,1],[2,0],[2,1],[3,0],[3,1],[4,0],[4,1],[5,0],[5,1]];
function evBytes(idx, down) {
  if (idx === 5) return down === 0 ? [0x01, 0x20] : [0xff, 0x20];
  return [BTN[idx], down === 0 ? 0x90 : 0x10];
}
// 从 772 开始按词打印
for (let o = 768; o <= 871; o += 4) {
  console.log(String(o).padStart(4), seg[o].toString(16).padStart(2,'0'), seg[o+1].toString(16).padStart(2,'0'), seg[o+2].toString(16).padStart(2,'0'), seg[o+3].toString(16).padStart(2,'0'));
}
// 尝试模型: event=[00 00 btn cmd], delay=[lo hi 00 50]
function build(modelStart) {
  const out = [];
  for (let i = 0; i < dbs.length; i++) {
    out.push(0x00, 0x00, ...evBytes(dbs[i][0], dbs[i][1]));
    out.push(0x05, 0x00, 0x00, 0x50); // delay 5
  }
  return Buffer.from(out);
}
console.log('\n从772起期望:', build(772).toString('hex'));
console.log('实抓772起 :', seg.subarray(772, 772+96).toString('hex'));
