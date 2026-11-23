// 提取日志中最后一次"配置下载会话"的 10 个数据块里所有非零字节
// 用法: node cells.js <log>
const fs = require('fs');
const lines = fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/);
const sets = [];
for (const ln of lines) {
  const m = ln.match(/SET (?:h=\S+ )?len=65 ret=\d+ \[([0-9a-f ]+)\]/);
  if (m) sets.push(m[1].trim().split(/\s+/));
}
// 找最后一次 04 ab 的位置, 取之后的 SET 包
let start = -1;
for (let i = sets.length - 1; i >= 0; i--) {
  if (sets[i][1] === '04' && sets[i][2] === 'ab') { start = i; break; }
}
if (start < 0) { console.log('没找到下载会话'); process.exit(1); }
// 会话内数据包: 首字节(报告ID后)不是 04 的, 去掉随机块(第一个), 数据块即 0..9
const nonCmd = sets.slice(start).filter(b => b[1] !== '04');
const data = nonCmd.slice(1); // 第 0 个是随机块
console.log('数据块数:', data.length);
for (let bi = 0; bi < data.length; bi++) {
  const b = data[bi];
  for (let j = 1; j < b.length; j++) {   // b[0]=报告ID 00; 偏移 = j-1
    if (b[j] !== '00') console.log(`块${bi} 偏移${j - 1} = ${b[j]}`);
  }
}
