// 对比抓包日志中两个"配置下载会话"的字节差异
// 用法: node diff.js <cap.log> [会话A序号] [会话B序号]   (默认: 倒数第二和最后一个会话)
const fs = require('fs');

const file = process.argv[2];
if (!file) { console.error('用法: node diff.js <cap.log> [A] [B]'); process.exit(1); }

const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
// 解析 SET 包: "HH:MM:SS.mmm SET len=64 ret=1 [hex...]"
const pkts = [];
for (const ln of lines) {
  const m = ln.match(/^(\S+)\s+SET (?:h=\S+ )?len=(\d+) ret=(-?\d+) \[([0-9a-f ]*)\]/);
  if (m) pkts.push({ t: m[1], ms: toMs(m[1]), len: +m[2], ret: +m[3], hex: m[4].trim() });
}
function toMs(t) {
  const [h, mi, rest] = t.split(':');
  const [s, ms] = rest.split('.');
  return ((+h * 60 + +mi) * 60 + +s) * 1000 + +ms;
}

// 按 >2s 间隔切分会话
const sessions = [];
for (const p of pkts) {
  const last = sessions[sessions.length - 1];
  if (!last || p.ms - last.lastMs > 2000) sessions.push({ start: p.t, pkts: [], lastMs: p.ms });
  sessions[sessions.length - 1].pkts.push(p);
  sessions[sessions.length - 1].lastMs = p.ms;
}

console.log(`共 ${sessions.length} 个会话:`);
sessions.forEach((s, i) => console.log(`  #${i} @${s.start} ${s.pkts.length}包`));

let a = sessions.length - 2, b = sessions.length - 1;
if (process.argv[3] !== undefined) a = +process.argv[3];
if (process.argv[4] !== undefined) b = +process.argv[4];
if (a < 0 || b >= sessions.length) { console.error('会话序号越界'); process.exit(1); }

const sa = sessions[a], sb = sessions[b];
console.log(`\n=== 对比 #${a}(${sa.start}) vs #${b}(${sb.start}) ===`);
const n = Math.max(sa.pkts.length, sb.pkts.length);
for (let i = 0; i < n; i++) {
  const pa = sa.pkts[i], pb = sb.pkts[i];
  if (!pa || !pb) { console.log(`包${i}: 仅一侧存在 A=${pa ? pa.hex.slice(0, 30) + '…' : '-'} B=${pb ? pb.hex.slice(0, 30) + '…' : '-'}`); continue; }
  if (pa.hex === pb.hex) { console.log(`包${i}: 相同  [${pa.hex.slice(0, 26)}…]`); continue; }
  const ba = pa.hex.split(' '), bb = pb.hex.split(' ');
  const diffs = [];
  for (let j = 0; j < Math.max(ba.length, bb.length); j++) if (ba[j] !== bb[j]) diffs.push(`[${j}]${ba[j] || '--'}->${bb[j] || '--'}`);
  console.log(`包${i}: 差异${diffs.length}处 ${pa.hex === pb.hex ? '' : '(长度' + ba.length + '/' + bb.length + ')'}  ${diffs.slice(0, 40).join(', ')}${diffs.length > 40 ? ' …' : ''}`);
}
