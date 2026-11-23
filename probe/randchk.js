// 提取所有会话的"随机握手块"(04 ab 之后的第一个非 04 开头块), 逐字节统计是否恒定
const fs = require('fs');
const files = process.argv.slice(2);
const blocks = [];
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  let pending = false;
  for (const ln of lines) {
    const m = ln.match(/SET (?:h=\S+ )?len=65 ret=\d+ \[([0-9a-f ]+)\]/);
    if (!m) continue;
    const h = m[1].trim().split(/\s+/);
    if (h[1] === '04' && h[2] === 'ab') { pending = true; continue; }
    if (pending) { blocks.push({ f, hex: h.join(' ') }); pending = false; }
  }
}
console.log('握手块数量:', blocks.length);
blocks.forEach(b => console.log(' ', b.f, b.hex));
// 逐字节: 统计每列出现次数最多的值及其频率
const n = blocks[0].hex.length / 3 + 1;
let constCnt = 0;
const cols = [];
for (let i = 0; i < n; i++) {
  const vals = blocks.map(b => b.hex.substr(i * 3, 2));
  const freq = {};
  vals.forEach(v => freq[v] = (freq[v] || 0) + 1);
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
  cols.push(top[1] === blocks.length ? top[0] : '..');
  if (top[1] === blocks.length) constCnt++;
}
console.log('\n恒定列数: ' + constCnt + '/' + n);
console.log('模式 (恒定列显示该字节):');
for (let r = 0; r < n; r += 16) console.log('  ' + cols.slice(r, r + 16).join(' '));
