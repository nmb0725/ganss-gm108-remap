// 全库快照: 所有表 + 所有 Profile 的非默认条目 (回收后复查残留)
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Program Files/GM108 Keyboard/GamingKeyboard.gkdb', { readOnly: true });
const tables = db.prepare("select name from sqlite_master where type='table'").all();
console.log('表:', tables.map(t => t.name).join(', '));
for (const t of tables) {
  const n = db.prepare(`select count(*) c from "${t.name}"`).get().c;
  console.log(`  ${t.name}: ${n} 行`);
}
const rows = db.prepare('select ProfileName, KeyIndex, Definition from KeyCustomization').all();
const nonDefault = rows.filter(r => String(r.Definition) !== `0?${r.KeyIndex}`);
console.log('\n全库非默认条目数:', nonDefault.length);
const byProfile = {};
for (const r of nonDefault) (byProfile[r.ProfileName] = byProfile[r.ProfileName] || []).push(`${r.KeyIndex}=${r.Definition}`);
for (const [p, list] of Object.entries(byProfile)) console.log(`${p} (${list.length}): ${list.join(' ')}`);
db.close();
