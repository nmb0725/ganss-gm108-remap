// 查看指定格号在指定 Profile 的原始 Definition 值 (默认 Profile1)
const { DatabaseSync } = require('node:sqlite');
const profile = process.argv[2] || 'Profile1';
const cells = (process.argv[3] || '36,37,53,54,57,58').split(',').map(Number);
const db = new DatabaseSync('C:/Program Files/GM108 Keyboard/GamingKeyboard.gkdb', { readOnly: true });
const ps = db.prepare('select * from ProfileSummary').all();
console.log('ProfileSummary:', JSON.stringify(ps));
const st = db.prepare('select KeyIndex, Definition from KeyCustomization where ProfileName=? and KeyIndex in (' + cells.join(',') + ') order by KeyIndex').all(profile);
for (const r of st) console.log(`${profile} ${r.KeyIndex} = ${JSON.stringify(r.Definition)}`);
db.close();
