// 读 Profile1 全部禁用索引
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Program Files/GM108 Keyboard/GamingKeyboard.gkdb', { readOnly: true });
const rows = db.prepare(
  "select KeyIndex from KeyCustomization where ProfileName='Profile1' and Definition like '8%' order by KeyIndex"
).all();
console.log('禁用索引:', rows.map(r => r.KeyIndex).join(','));
db.close();
