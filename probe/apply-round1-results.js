// 把校准第一轮结论写进 keymap-table.json
const fs = require('fs');
const p = 'l:/git/ganss/app/data/keymap-table.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
const t = j.table;
const V = n => ({ name: n, status: 'verified' });
// 一轮实测: 禁用后确实死亡 => 格号与键名绑定证实
for (let i = 3; i <= 12; i++) t[i] = V('F' + i);
t[14] = V('PrtSc'); t[15] = V('ScrLk');
t[32] = V('Num7'); t[33] = V('Num8'); t[34] = V('Num9');
t[50] = V('Num4'); t[51] = V('Num5'); t[52] = V('Num6');
t[65] = V(';'); t[66] = V("'"); t[73] = V('\\');
t[68] = V('Num1'); t[69] = V('Num2'); t[70] = V('Num3');
t[72] = V('LShift'); t[84] = V('RShift');
for (const [i, n] of [[76,'C'],[77,'V'],[78,'B'],[79,'N'],[80,'M'],[81,','],[82,'.'],[83,'/']]) t[i] = V(n);
t[113] = V('Num/'); t[114] = V('Num*');
t[116] = V('Ins'); t[117] = V('Home'); t[118] = V('PageUp');
t[120] = V('End'); t[121] = V('PageDown');
t[95] = V('右Alt');
t[93] = V('左Alt'); // 一轮实测: 禁93左Alt死而左Ctrl存活 => 93=左Alt, 左Ctrl另有其格
// 被推翻的猜测
t[35] = { name: '?不是Num-', status: 'unknown' };
t[36] = { name: '?不是Tab(Tab存活)', status: 'unknown' };
t[67] = { name: '?不是主Enter(主Enter存活)', status: 'unknown' };
t[86] = { name: '?不是Num0(Num0存活)', status: 'unknown' };
t[87] = { name: '?不是Num.(Num.存活)', status: 'unknown' };
t[88] = { name: '?不是Num+(Num+存活)', status: 'unknown' };
for (const i of [98, 99, 100, 101]) t[i] = { name: '?一轮禁用后疑似箭头仍存活,二轮复核', status: 'unknown' };
t[106] = V('小键盘Enter'); // 不在禁用集, 存活符合预期
j._notes.push('校准一轮(2026-11-23)钉死43格; 左Ctrl/主Enter/Tab/Num-+0. 真身在剩余 unknown 池中, 见 calibration-round2');
fs.writeFileSync(p, JSON.stringify(j, null, 2));
console.log('已更新. verified 格数:', Object.values(t).filter(x => x.status === 'verified').length);
