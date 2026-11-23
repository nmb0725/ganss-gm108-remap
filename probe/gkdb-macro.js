// 宏逆向第一步: 摸清 gkdb 里的宏存储结构 (只读, 不碰设备)
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Program Files/GM108 Keyboard/GamingKeyboard.gkdb', { readOnly: true });

const tables = db.prepare("select type, name, sql from sqlite_master where type in ('table','index')").all();
for (const t of tables) console.log(`-- ${t.name}\n${t.sql || ''}\n`);

for (const t of tables) {
  if (t.type !== 'table' || t.name.startsWith('sqlite_')) continue;
  try {
    const n = db.prepare(`select count(*) c from "${t.name}"`).get().c;
    console.log(`== ${t.name}: ${n} 行`);
    if (n && n <= 60) {
      for (const r of db.prepare(`select * from "${t.name}"`).all()) console.log(JSON.stringify(r));
    }
  } catch (e) { console.log(`== ${t.name}: 读取失败 ${e.message}`); }
}
db.close();
