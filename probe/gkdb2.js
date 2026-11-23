// 验证: KeyIndex 与报文坐标(4字节/格)的映射 + Definition 编码
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Program Files/GM108 Keyboard/GamingKeyboard.gkdb', { readOnly: true });

const profiles = db.prepare('select * from ProfileSummary').all();
console.log('Profiles:', JSON.stringify(profiles));

// 非默认(Definition 非空/非0)的行
const rows = db.prepare("select ProfileName, KeyIndex, Definition from KeyCustomization where Definition is not null and Definition <> '' and Definition <> '0' order by ProfileName, KeyIndex").all();
console.log('非默认键条目:', rows.length);
console.log(rows.slice(0, 40).map(r => `${r.ProfileName}#${r.KeyIndex} => ${r.Definition}`).join('\n'));

// KeyIndex 范围
const rng = db.prepare('select min(KeyIndex) a, max(KeyIndex) b, count(distinct KeyIndex) c from KeyCustomization').get();
console.log('KeyIndex 范围:', JSON.stringify(rng));

// 坐标换算验证: 左Win 实测=块5偏移48 => 全局字节368 => 格92; F 实测=块3偏移44 => 236 => 格59
console.log('\n假设 格=KeyIndex: 左Win 应为 KeyIndex 92, F 应为 KeyIndex 59');
for (const k of [92, 59]) {
  const r = db.prepare('select ProfileName, Definition from KeyCustomization where KeyIndex=?').all(k);
  console.log('KeyIndex', k, JSON.stringify(r));
}
db.close();
