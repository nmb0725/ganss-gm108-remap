// 提取指定日志里某个 04 段会话的 64 字节数据块, 两个日志做 diff
const fs = require('fs');
const [,, fileA, cmdHex, fileB] = process.argv;
function extract(file, cmd) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const sessions = [];
  let cur = null, mode = false;
  for (const ln of lines) {
    const m = ln.match(/SET h=\S+ len=65 ret=1 \[00 ((?:[0-9a-f]{2} )+)/);
    if (!m) continue;
    const b = m[1].trim().split(' ').map(x => parseInt(x, 16));
    if (b[0] === 4 && b[1] === cmd) { cur = { header: b.slice(0), blocks: [] }; sessions.push(cur); mode = true; continue; }
    if (mode && cur) {
      if (b[0] === 4) { mode = false; continue; }
      cur.blocks.push(Buffer.from(b.slice(0, 64)));
    }
  }
  return sessions;
}
const cmd = parseInt(cmdHex, 16);
const A = extract(fileA, cmd);
A.forEach((s, i) => {
  console.log(`## ${fileA} 会话#${i} 头=${s.header.map(x => x.toString(16).padStart(2, '0')).join(' ')} 块数=${s.blocks.length}`);
  s.blocks.forEach((blk, j) => console.log(`  [${j}] ${blk.toString('hex').replace(/(..)/g, '$1 ').trim()}`));
});
if (fileB) {
  const B = extract(fileB, cmd);
  console.log(`\n#### diff vs ${fileB}`);
  const a = A[0] ? A[0].blocks : [], b = B[0] ? B[0].blocks : [];
  for (let j = 0; j < Math.max(a.length, b.length); j++) {
    const x = a[j] ? a[j].toString('hex') : '(缺)', y = b[j] ? b[j].toString('hex') : '(缺)';
    if (x !== y) {
      console.log(`块${j} 不同:`);
      if (a[j] && b[j]) for (let k = 0; k < 64; k++) if (a[j][k] !== b[j][k]) console.log(`  偏移${k}: A=${a[j][k].toString(16)} B=${b[j][k].toString(16)}`);
      else { console.log('  A=', x); console.log('  B=', y); }
    }
  }
}
