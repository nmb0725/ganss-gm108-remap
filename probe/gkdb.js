// gkdb (SQLite) 结构探查
const { DatabaseSync } = require('node:sqlite');
const files = [
  'C:/Program Files/GM108 Keyboard/GamingKeyboard.gkdb',
  'C:/Program Files/GM108 Keyboard/RecoverSetting/GK/GamingKeyboard.gkdb'
];
for (const f of files) {
  console.log('=== ' + f);
  const db = new DatabaseSync(f, { readOnly: true });
  const tabs = db.prepare("select name,sql from sqlite_master where type='table'").all();
  for (const t of tabs) {
    let n = '?';
    try { n = db.prepare('select count(*) c from "' + t.name + '"').get().c; } catch (e) {}
    console.log('TABLE', t.name, 'rows=' + n);
    console.log('  ', (t.sql || '').replace(/\s+/g, ' ').slice(0, 400));
  }
  db.close();
}
