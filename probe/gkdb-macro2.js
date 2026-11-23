// 宏逆向第二步: 宏三张表的完整内容
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Program Files/GM108 Keyboard/GamingKeyboard.gkdb', { readOnly: true });
for (const t of ['MacroSummary', 'FWMacroSummary', 'MacroStep']) {
  console.log(`== ${t}`);
  for (const r of db.prepare(`select * from "${t}" order by rowid`).all()) console.log(JSON.stringify(r));
}
// 键位表里引用宏的 3? 记录
console.log('== KeyCustomization 中的 3?/1? 记录');
for (const r of db.prepare("select ProfileName, KeyIndex, Definition from KeyCustomization where Definition not like '0?%' order by ProfileName, KeyIndex+0").all()) console.log(JSON.stringify(r));
db.close();
