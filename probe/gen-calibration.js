// 生成校准第一轮配置: 禁用所有 conf!=='v' 且 cell 已分配的键
global.window = {};
require('l:/git/ganss/app/renderer/keyboard-layout.js');
const fs = require('fs');
const uncertain = global.window.KEYBOARD.filter(k => k.cell != null && k.conf !== 'v');
const verified = global.window.KEYBOARD.filter(k => k.cell != null && k.conf === 'v');
const cells = [...new Set(uncertain.map(k => k.cell))].sort((a, b) => a - b);
const vcells = new Set(verified.map(k => k.cell));
for (const c of cells) if (vcells.has(c)) throw new Error('校准集与已验证格重叠: ' + c);
const cfg = {
  schema: 1,
  name: '校准第一轮-禁未验证键',
  overrides: cells.map(c => ({ cell: c, action: 'disable' }))
};
fs.writeFileSync('l:/git/ganss/app/data/calibration-round1.json', JSON.stringify(cfg, null, 1));
console.log('禁用格数:', cells.length);
console.log('格号:', cells.join(','));
console.log('涉及键:', uncertain.map(k => k.tip || k.l).join(' | '));
console.log('保持可用的已验证键:', verified.map(k => k.tip || k.l).join(' | '));
