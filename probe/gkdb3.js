// Definition 语义统计
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Program Files/GM108 Keyboard/GamingKeyboard.gkdb', { readOnly: true });
const rows = db.prepare('select ProfileName, KeyIndex, Definition from KeyCustomization').all();

const types = {};
for (const r of rows) {
  const [t, arg] = String(r.Definition).split('?');
  types[t] = types[t] || { n: 0, selfRef: 0, zeroArg: 0, otherRef: 0, ex: [] };
  const s = types[t]; s.n++;
  const a = +arg;
  if (a === r.KeyIndex) s.selfRef++;
  else if (a === 0) s.zeroArg++;
  else { s.otherRef++; if (s.ex.length < 8) s.ex.push(`${r.ProfileName}#${r.KeyIndex}->${a}`); }
}
console.log('类型分布:');
for (const [t, s] of Object.entries(types))
  console.log(`  type=${t} n=${s.n} 自引用=${s.selfRef} arg0=${s.zeroArg} 异键引用=${s.otherRef} 例:${s.ex.join(', ')}`);

// Profile1(当前激活)的全部非平凡条目
console.log('\nProfile1 非默认条目:');
const p1 = rows.filter(r => r.ProfileName === 'Profile1' && r.Definition !== `0?${r.KeyIndex}`);
console.log(p1.map(r => `#${r.KeyIndex}=${r.Definition}`).join('\n') || '(全部为 0?自身)');

// 全部类型非0的条目列表
console.log('\n非0类型全部条目:');
console.log(rows.filter(r => !String(r.Definition).startsWith('0?')).map(r => `${r.ProfileName}#${r.KeyIndex}=${r.Definition}`).join('\n'));
db.close();
