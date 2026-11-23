// 宏编码解码: 对齐 gkdb 的 MacroStep 与 04 15 段的字节, 推导记录格式
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// 1. 提取 cap_remap.log 第一个 04 15 会话
function extract(file, cmd) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const sessions = []; let cur = null, mode = false;
  for (const ln of lines) {
    const m = ln.match(/SET h=\S+ len=65 ret=1 \[([0-9a-f]{2}(?: [0-9a-f]{2})*)\]/);
    if (!m) continue;
    const b = m[1].split(' ').map(x => parseInt(x, 16));
    if (b[1] === 4 && b[2] === cmd) { cur = { header: b.slice(1), blocks: [] }; sessions.push(cur); mode = true; continue; }
    if (mode && cur) { if (b[1] === 4) { mode = false; continue; } cur.blocks.push(Buffer.from(b.slice(1, 65))); }
  }
  return sessions;
}
const s15 = extract('probe/cap_remap.log', 0x15)[0];
const s17 = extract('probe/cap_remap.log', 0x17)[0];
const data = Buffer.concat(s15.blocks);
console.log('04 15 总长', data.length);
console.log('04 17 块0:', s17 ? s17.blocks[0].toString('hex').replace(/(..)/g, '$1 ').trim() : '(无)');

const ptrs = [];
for (let i = 0; i < 10; i++) ptrs.push(data.readUInt32LE(i * 4));
console.log('指针表:', ptrs);

// 2. 读 DB 宏
const db = new DatabaseSync('C:/Program Files/GM108 Keyboard/GamingKeyboard.gkdb', { readOnly: true });
const macros = db.prepare('select * from MacroSummary').all();
for (let i = 0; i < macros.length; i++) {
  const name = macros[i].Name;
  const steps = db.prepare('select StepIndex, Step from MacroStep where Name=? order by StepIndex+0').all(name);
  console.log(`\n槽${i} "${name}" ptr=0x${ptrs[i].toString(16)} (${ptrs[i]}) 步=${steps.length}`);
  console.log('DB:', steps.map(s => s.Step.trim()).join(' | '));
  // 从指针位置起打印 8 字节一行, 步数*8+缓冲
  const p = ptrs[i];
  for (let o = p; o < Math.min(p + steps.length * 8 + 16, data.length); o += 8) {
    console.log(`  @${o}: ${data.slice(o, o + 8).toString('hex').replace(/(..)/g, '$1 ').trim()}`);
  }
}
db.close();
