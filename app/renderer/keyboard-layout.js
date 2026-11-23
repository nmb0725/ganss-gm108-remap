// GM108 物理布局 (单位: 键宽=1) + 每键对应的 KeyIndex 格号
// conf: v=实测锚定 i=行规律推断 ?=未校准(禁用可能命中别的键, UI 必须警示)
// cell=null 的键本期不可编辑(格号完全没头绪, 等校准)
// 布局: 主区 0-15, 导航簇 x16-19, 小键盘 x20-24 (块间距 1)
// hid: 改键目标的 USB HID usage(page 07) 编码。wire 统一规则(probe/cap_modifier*.log 解码): 普通键 02 00 hid 00; 修饰键 02 (1<<(hid-0xE0)) 00 00
const HK = c => {
  if (/^[a-z]$/.test(c)) return 4 + c.charCodeAt(0) - 97;
  if (/^[1-9]$/.test(c)) return 29 + Number(c);
  return { '0': 39, '`': 53, '-': 45, '=': 46, '[': 47, ']': 48, '\\': 49, ';': 51, "'": 52, ',': 54, '.': 55, '/': 56 }[c];
};
window.KEYBOARD = [
  // 第0行 F区
  { l: 'Esc', cell: 1, conf: 'v', hid: 41, x: 0, y: 0 },
  ...[2, 3, 4, 5].map((c, i) => ({ l: 'F' + (i + 1), cell: c, conf: 'v', hid: 58 + i, x: 2 + i, y: 0 })),
  ...[6, 7, 8, 9].map((c, i) => ({ l: 'F' + (i + 5), cell: c, conf: 'v', hid: 62 + i, x: 6.5 + i, y: 0 })),
  ...[10, 11, 12, 13].map((c, i) => ({ l: 'F' + (i + 9), cell: c, conf: 'v', hid: 66 + i, x: 11 + i, y: 0 })),
  { l: 'PrtSc', cell: 112, conf: 'v', hid: 70, x: 16, y: 0, tip: 'PrtSc (老软件核对证实, 格号112)' },
  { l: 'ScrLk', cell: 113, conf: 'v', hid: 71, x: 17, y: 0, tip: 'ScrLk (老软件核对证实, 格号113)' },
  { l: 'Pause', cell: 103, conf: 'v', hid: 72, x: 18, y: 0 },
  // 小键盘上方 4 键 (GM108 无旋钮, 此处为媒体/自定义键)
  { l: 'V+', cell: 14, conf: 'v', x: 20, y: 0, tip: '音量增加 (老软件核对证实, 格号14)' },
  { l: 'V-', cell: 15, conf: 'v', x: 21, y: 0, tip: '音量减小 (老软件核对证实, 格号15)' },
  { l: '静', cell: 16, conf: 'v', x: 22, y: 0, tip: '静音 (老软件核对证实, 格号16)' },
  { l: '自定', cell: 109, conf: 'v', x: 23, y: 0, tip: '自定义键 (格号109, 排除法证实)' },
  // 第1行 数字行
  { l: '`', cell: 19, conf: 'v', hid: HK('`'), x: 0, y: 1 },
  ...[20, 21, 22, 23, 24, 25, 26, 27, 28, 29].map((c, i) => ({ l: String((i + 1) % 10), cell: c, conf: 'v', hid: HK(String((i + 1) % 10)), x: 1 + i, y: 1 })),
  { l: '-', cell: 30, conf: 'v', hid: HK('-'), x: 11, y: 1 },
  { l: '=', cell: 31, conf: 'v', hid: HK('='), x: 12, y: 1 },
  { l: '⌫', cell: 115, conf: 'v', hid: 42, x: 13, y: 1, w: 2, tip: 'Backspace' },
  { l: 'Ins', cell: 116, conf: 'v', hid: 73, x: 16, y: 1 },
  { l: 'Home', cell: 117, conf: 'v', hid: 74, x: 17, y: 1 },
  { l: 'PgUp', cell: 118, conf: 'v', hid: 75, x: 18, y: 1 },
  { l: 'Num', cell: 32, conf: 'v', hid: 83, x: 20, y: 1, tip: 'NumLock (老软件核对证实, 格号32)' },
  { l: '/', cell: 33, conf: 'i', hid: 84, x: 21, y: 1, tip: 'Num / (推断: 32/33/34=NumLock/Num//Num* 行带尾连号)' },
  { l: '*', cell: 34, conf: 'v', hid: 85, x: 22, y: 1, tip: 'Num * (老软件核对证实, 格号34; 114作废)' },
  { l: '-', cell: 122, conf: 'v', hid: 86, x: 23, y: 1, tip: 'Num - (老软件核对证实; 不是35)' },
  // 第2行
  { l: 'Tab', cell: 37, conf: 'v', hid: 43, x: 0, y: 2, w: 1.5, tip: 'Tab' },
  ...[38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49].map((c, i) => ({ l: 'QWERTYUIOP[]'[i], cell: c, conf: 'v', hid: HK('QWERTYUIOP[]'[i]), x: 1.5 + i, y: 2 })),
  { l: '\\', cell: 73, conf: 'v', hid: HK('\\'), x: 13.5, y: 2, w: 1.5, tip: '反斜杠 (校准一轮实测证实)' },
  { l: 'Del', cell: 119, conf: 'v', hid: 76, x: 16, y: 2 },
  { l: 'End', cell: 120, conf: 'v', hid: 77, x: 17, y: 2 },
  { l: 'PgDn', cell: 121, conf: 'v', hid: 78, x: 18, y: 2 },
  { l: '7', cell: 50, conf: 'v', hid: 95, x: 20, y: 2, tip: 'Num 7 (启用抽查证实, 格号50; 一轮32-34结论作废)' },
  { l: '8', cell: 51, conf: 'i', hid: 96, x: 21, y: 2, tip: 'Num 8 (推断)' },
  { l: '9', cell: 52, conf: 'i', hid: 97, x: 22, y: 2, tip: 'Num 9 (推断)' },
  { l: '+', cell: 123, conf: 'v', hid: 87, x: 23, y: 2, h: 2, tip: 'Num + (老软件核对证实; 不是88)' },
  // 第3行
  { l: 'Caps', cell: 55, conf: 'v', hid: 57, x: 0, y: 3, w: 1.75 },
  ...[56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66].map((c, i) => ({ l: 'ASDFGHJKL;\''[i], cell: c, conf: 'v', hid: HK('ASDFGHJKL;\''[i]), x: 1.75 + i, y: 3 })),
  { l: '⏎', cell: 85, conf: 'v', hid: 40, x: 12.75, y: 3, w: 2.25, tip: '主 Enter (老软件核对证实)' },
  { l: '4', cell: 68, conf: 'i', hid: 92, x: 20, y: 3, tip: 'Num 4 (推断)' },
  { l: '5', cell: 69, conf: 'i', hid: 93, x: 21, y: 3, tip: 'Num 5 (推断)' },
  { l: '6', cell: 70, conf: 'i', hid: 94, x: 22, y: 3, tip: 'Num 6 (推断)' },
  // 第4行
  { l: 'Shift', cell: 72, conf: 'v', hid: 225, x: 0, y: 4, w: 2.25, tip: '左 Shift (校准一轮实测证实)' },
  ...[74, 75, 76, 77, 78, 79, 80, 81, 82, 83].map((c, i) => ({ l: 'ZXCVBNM,./'[i], cell: c, conf: 'v', hid: HK('ZXCVBNM,./'[i]), x: 2.25 + i, y: 4 })),
  { l: 'Shift', cell: 84, conf: 'v', hid: 229, x: 12.25, y: 4, w: 2.75, tip: '右 Shift (校准一轮实测证实)' },
  { l: '↑', cell: 101, conf: 'v', hid: 82, x: 17, y: 4, tip: '上箭头 (老软件核对证实)' },
  { l: '1', cell: 86, conf: 'i', hid: 89, x: 20, y: 4, tip: 'Num 1 (推断; 32已被证实是NumLock, 一轮68-70=123结论作废)' },
  { l: '2', cell: 87, conf: 'i', hid: 90, x: 21, y: 4, tip: 'Num 2 (推断)' },
  { l: '3', cell: 88, conf: 'i', hid: 91, x: 22, y: 4, tip: 'Num 3 (推断)' },
  // 第5行
  { l: 'Ctrl', cell: 91, conf: 'v', hid: 224, x: 0, y: 5, w: 1.25, tip: '左 Ctrl (老软件核对证实)' },
  { l: 'Win', cell: 92, conf: 'v', hid: 227, x: 1.25, y: 5, w: 1.25, tip: '左 Win' },
  { l: 'Alt', cell: 93, conf: 'v', hid: 226, x: 2.5, y: 5, w: 1.25, tip: '左 Alt (校准一轮实测证实)' },
  { l: 'Space', cell: 94, conf: 'v', hid: 44, x: 3.75, y: 5, w: 6.25 },
  { l: 'Alt', cell: 95, conf: 'v', hid: 230, x: 10, y: 5, w: 1.25, tip: '右 Alt (校准一轮实测证实)' },
  { l: 'Fn', cell: 96, conf: 'v', x: 11.25, y: 5, w: 1.25, tip: 'Fn 功能键 (格号96已证实; 无标准HID编码, 不作改键目标; 禁用将失去整个FN层)' },
  { l: '≡', cell: 97, conf: 'v', hid: 101, x: 12.5, y: 5, w: 1.25, tip: '菜单键 (老软件核对证实; 不是96)' },
  { l: 'Ctrl', cell: 98, conf: 'v', hid: 228, x: 13.75, y: 5, w: 1.25, tip: '右 Ctrl (老软件核对证实; 不是97)' },
  { l: '←', cell: 99, conf: 'v', hid: 80, x: 16, y: 5, tip: '左箭头 (老软件核对证实)' },
  { l: '↓', cell: 100, conf: 'v', hid: 81, x: 17, y: 5, tip: '下箭头 (老软件核对证实; 不是99)' },
  { l: '→', cell: 102, conf: 'v', hid: 79, x: 18, y: 5, tip: '右箭头 (老软件核对证实)' },
  { l: '0', cell: 104, conf: 'v', hid: 98, x: 20, y: 5, w: 2, tip: 'Num 0 (老软件核对证实; 不是86)' },
  { l: '.', cell: 105, conf: 'v', hid: 99, x: 22, y: 5, tip: 'Num . (老软件核对证实; 不是87)' },
  { l: '⏎', cell: 106, conf: 'v', hid: 88, x: 23, y: 4, h: 2, tip: '小键盘 Enter' }
];
