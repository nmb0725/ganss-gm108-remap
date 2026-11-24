// 2026-11-24 修复: 旧正则要求每字节后跟空格, 丢掉了每个报文的最后 1 字节(每块只剩 63B), 导致 bindPos 公式与鼠标宏模型错位
// 校验鼠标宏段: 提取日志中最后一个 04 15 SET 会话, dump 槽指针表 + 数据池字节
const fs = require('fs');
const file = process.argv[2] || 'probe/cap_mouse_macro.log';
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
let last = null, cur = null, mode = false;
for (const ln of lines) {
  const m = ln.match(/SET h=\S+ len=65 ret=1 \[00 ((?:[0-9a-f]{2} ?)+)\]/);
  if (!m) continue;
  const b = m[1].trim().split(' ').map((x) => parseInt(x, 16));
  if (b[0] === 4 && b[1] === 0x15) { cur = { blocks: [] }; last = cur; mode = true; continue; }
  if (mode && cur) {
    if (b[0] === 4) { mode = false; continue; }
    cur.blocks.push(Buffer.from(b.slice(0, 64)));
  }
}
if (!last) { console.log('未找到 04 15 SET 会话'); process.exit(1); }
console.log('块数 =', last.blocks.length);
const seg = Buffer.concat(last.blocks);
// 槽指针表 (100 x u32le): 打印非零槽
const ptrs = [];
for (let s = 0; s < 100; s++) { const p = seg.readUInt32LE(s * 4); if (p) ptrs.push(`${s}@${p}`); }
console.log('槽指针:', ptrs.join(' '));
// 数据池 400 起, 截到 aa55 尾
let end = seg.length - 2;
while (end > 400 && seg[end] === 0) end--;
console.log(`数据池 400..${end + 1} (尾标记 ${seg[830].toString(16)} ${seg[831].toString(16)}):`);
for (let o = 400; o <= end + 1; o += 16) {
  const hex = [];
  for (let k = o; k < Math.min(o + 16, end + 2); k++) hex.push(seg[k].toString(16).padStart(2, '0'));
  console.log(String(o).padStart(4), hex.join(' '));
}
