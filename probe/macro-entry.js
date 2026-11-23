// 按入口(指针)对齐打印每个宏条目, 附带 DB 步骤对照
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
function extract(file, cmd) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const sessions = []; let cur = null, mode = false;
  for (const ln of lines) {
    const m = ln.match(/SET h=\S+ len=65 ret=1 \[([0-9a-f]{2}(?: [0-9a-f]{2})*)\]/);
    if (!m) continue;
    const b = m[1].split(' ').map(x => parseInt(x, 16));
    if (b[1] === 4 && b[2] === cmd) { cur = { blocks: [] }; sessions.push(cur); mode = true; continue; }
    if (mode && cur) { if (b[1] === 4) { mode = false; continue; } cur.blocks.push(Buffer.from(b.slice(1, 65))); }
  }
  return sessions;
}
const data = Buffer.concat(extract('probe/cap_remap.log', 0x15)[0].blocks);
const ptrs = []; for (let i = 0; i < 100; i++) ptrs.push(data.readUInt32LE(i * 4));
const used = ptrs.map((p, i) => ({ p, i })).filter(x => x.p);
const db = new DatabaseSync('C:/Program Files/GM108 Keyboard/GamingKeyboard.gkdb', { readOnly: true });
const macros = db.prepare('select * from MacroSummary').all();
used.forEach((u, n) => {
  const end = n + 1 < used.length ? used[n + 1].p : 832;
  const name = macros[u.i] ? macros[u.i].Name : '?';
  console.log(`\n### 槽${u.i} "${name}" 入口=${u.p} 长度=${end - u.p}`);
  console.log('DB: ' + db.prepare('select Step from MacroStep where Name=? order by StepIndex+0').all(name).map(r => r.Step.trim()).join(' | '));
  for (let o = u.p; o < end; o += 8) console.log(`  +${String(o - u.p).padStart(2, '0')}: ${data.slice(o, Math.min(o + 8, end)).toString('hex').replace(/(..)/g, '$1 ').trim()}`);
});
db.close();
