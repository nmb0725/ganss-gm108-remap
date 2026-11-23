// 查 Profile1 非默认条目 + 全库禁用记录
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Program Files/GM108 Keyboard/GamingKeyboard.gkdb', { readOnly: true });
const rows = db.prepare(
  "select ProfileName,KeyIndex,Definition from KeyCustomization where Definition like '8%' order by ProfileName, KeyIndex"
).all();
for (const r of rows) console.log(r.ProfileName + '#' + r.KeyIndex + '=' + r.Definition);
console.log('共', rows.length, '条');
db.close();
