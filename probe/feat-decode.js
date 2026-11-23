// 解码 cap_features.log: 重建每次下载会话的数据段, 打印指定格号的 4 字节
// 用法: node feat-decode.js [cells=...]
const fs = require('fs');
const CELLS = (process.argv[2] || '113,103,97,95,98,14,15,109,112,13,116,119').split(',').map(Number);
const log = fs.readFileSync(__dirname + '/cap_features.log', 'utf8').split('\n');
const hex2buf = h => Buffer.from(h.trim().split(/\s+/).map(x => parseInt(x, 16)));

const sessions = [];
let pending = null; // {cmd, need, blocks}
for (const line of log) {
  const m = line.match(/ SET h=\S+ len=(\d+) ret=(-?\d+) \[([0-9a-f ]*)\]/);
  if (!m) continue;
  const p = hex2buf(m[3]);
  if (p.length < 65) continue;
  const q = p.subarray(1); // 去报告ID
  if (pending) {
    pending.blocks.push(Buffer.from(q));
    if (pending.blocks.length === pending.need) { sessions.push(pending); pending = null; }
    continue;
  }
  if (q[0] === 0x04 && (q[1] === 0x11 || q[1] === 0x13)) pending = { cmd: q[1], need: q[8], blocks: [] };
}
console.log('sessions:');
for (const s of sessions) console.log(`  cmd=04${s.cmd.toString(16)} blocks=${s.blocks.length}`);
const kms = sessions.filter(s => s.cmd === 0x11);
if (!kms.length) { console.log('no keymap session'); process.exit(0); }
const NAME = { 113: 'ScrLk=鼠标左', 103: 'Pause=鼠标右', 97: '菜单=鼠标中', 95: '右Alt=滚轮上', 98: '右Ctrl=滚轮下', 14: 'V+=宏ABC', 15: 'V-=连击ABC', 109: '自定=启动程序', 112: 'PrtSc=多媒体', 13: 'F12=Win+D', 116: 'Ins=鼠标后退', 119: 'Del=鼠标前进' };
// 灯光/扩展段 (04 13) 对比: 最后一个 vs 第一个
const lights = sessions.filter(s => s.cmd === 0x13);
if (lights.length) {
  const a = Buffer.concat(lights[0].blocks);
  const b = Buffer.concat(lights[lights.length - 1].blocks);
  console.log(`\n04 13 段: ${lights.length} 次, 首个/末个 diff 区间:`);
  let start = -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) !== (b[i] || 0);
    if (d && start < 0) start = i;
    if (!d && start >= 0) { console.log(`  ${start}..${i - 1}: old=${a.subarray(Math.max(0, start - 4), i).toString('hex')} new=${b.subarray(Math.max(0, start - 4), i).toString('hex')}`); start = -1; }
  }
  if (start >= 0) console.log(`  ${start}..: new=${b.subarray(start, Math.min(b.length, start + 64)).toString('hex')}`);
  console.log('\n末次 0413 段 4字节分组(非零):');
  const g = [];
  for (let i = 0; i + 4 <= b.length; i += 4) { const t = b.subarray(i, i + 4); if (t.some(x => x)) g.push(`${i}:${t.toString('hex')}`); }
  console.log('  ' + g.join(' '));
}
kms.forEach((km, si) => {
  const seg = Buffer.concat(km.blocks);
  const nz = [];
  for (let c = 1; c <= 143; c++) {
    const b = seg.subarray(c * 4, c * 4 + 4);
    if (b.some(x => x)) nz.push(`${c}[${NAME[c] || ''}]=${b.toString('hex')}`);
  }
  console.log(`\nkeymap session #${si + 1}/${kms.length} 非零格 (${nz.length}):\n  ` + nz.join('\n  '));
});
