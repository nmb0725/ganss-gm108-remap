// 从抓包 log 提取所有 04 11 键位段落, 打印指定 cell 的 4 字节格
// 用法: node remap-decode.js [log] [cell1,cell2,...]   默认 cap_remap.log 78..84
const fs = require('fs');
const lines = fs.readFileSync(process.argv[2] || 'cap_remap.log', 'utf8').split('\n');
const CELLS = process.argv[3] ? process.argv[3].split(',').map(Number) : Array.from({ length: 7 }, (_, i) => 78 + i);
const sets = []; // {idx, payload:Buffer}
for (const ln of lines) {
  const m = ln.match(/SET h=\S+ len=(\d+) ret=\d+ \[([0-9a-f ]+)\]/);
  if (!m) continue;
  sets.push(Buffer.from(m[2].trim().split(/ +/).map(x => parseInt(x, 16))));
}
let n = 0;
for (let i = 0; i < sets.length; i++) {
  const s = sets[i];
  if (!(s[1] === 0x04 && s[2] === 0x11)) continue;
  const blocks = [];
  for (let j = i + 1; j < sets.length && blocks.length < 10; j++) {
    const b = sets[j];
    if (b[1] === 0x04 && b.length === 65) break; // 撞见别的命令 => 会话断裂
    blocks.push(b.subarray(1, 65));
  }
  if (blocks.length !== 10) { console.log(`会话#${++n} @包${i}: 只凑到 ${blocks.length} 块, 跳过`); continue; }
  const seg = Buffer.concat(blocks);
  console.log(`会话#${++n} @包${i}: aa55尾=${seg[638].toString(16)}${seg[639].toString(16)} 非零字节数=${[...seg].filter(x => x).length}`);
  for (const c of CELLS) {
    const at = c * 4;
    console.log(`  cell ${c}: ${seg.subarray(at, at + 4).toString('hex')}`);
  }
  i += blocks.length;
}
if (!n) console.log('没找到 04 11 会话');
