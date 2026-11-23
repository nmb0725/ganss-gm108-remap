// 精简核对: 只看 Profile1 的 8? 禁用记录 + 与上次的差异
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Program Files/GM108 Keyboard/GamingKeyboard.gkdb', { readOnly: true });
const rows = db.prepare("select KeyIndex, Definition from KeyCustomization where ProfileName='Profile1' and Definition like '8?%' order by KeyIndex+0").all();
console.log('Profile1 禁用记录:', rows.map(r => `${r.KeyIndex}=${r.Definition}`).join(' ') || '(无)');
db.close();
