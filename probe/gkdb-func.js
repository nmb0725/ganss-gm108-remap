// gkdb: 活跃 Profile 的全部非默认记录 (本轮批量改键后)
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Program Files/GM108 Keyboard/GamingKeyboard.gkdb', { readOnly: true });
console.log('=== ProfileSummary ===');
for (const r of db.prepare('select Name, IsUsed, IsActive from ProfileSummary').all()) console.log(r.Name, 'IsUsed=' + r.IsUsed, 'IsActive=' + r.IsActive);
console.log('=== 非默认记录(所有 Profile) ===');
for (const r of db.prepare("select ProfileName, KeyIndex, Definition from KeyCustomization where Definition not in ('00000000') and Definition <> '' order by ProfileName, KeyIndex+0").all())
  console.log(`${r.ProfileName} #${r.KeyIndex} = ${r.Definition}`);
db.close();
