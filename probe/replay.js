// 脱离老软件, 用 node-hid 直接重放"配置下载"整帧报文
// 用法: node replay.js disable            -> 禁用左Win (块5@48 = 05 03)
//       node replay.js restore            -> 全默认 (全零)
//       node replay.js set 3:44 6:8 ...   -> 禁用指定坐标的键 (块:偏移)
const HID = require('node-hid');

const MODE = process.argv[2];
const CELLS = process.argv.slice(3).map(s => s.split(':').map(Number));
if (!['disable', 'restore', 'set'].includes(MODE) || (MODE === 'set' && !CELLS.length)) {
  console.error('用法: node replay.js disable|restore|set 块:偏移 ...');
  process.exit(1);
}

// 命令通道: 正常态 0c45:8006 MI_00; 救援态(K3-BOOT) 0c45:7040
const devInfo = HID.devices().find(d => d.vendorId === 0x0c45 && (d.productId === 0x8006 && /mi_00/i.test(d.path) || d.productId === 0x7040));
if (!devInfo) { console.error('找不到 GM108 命令通道'); process.exit(1); }
console.log('打开:', devInfo.product, '|', devInfo.path);
const dev = new HID.HID(devInfo.path);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const hex = b => Buffer.from(b).toString('hex').replace(/(.{2})/g, '$1 ').trim();

// 65 字节缓冲: [0]=报告ID 0x00, 后 64 字节负载
function pkt(bytes) {
  const b = Buffer.alloc(65);
  Buffer.from(bytes).copy(b, 1);
  return b;
}
function send(name, bytes) {
  const p = pkt(bytes);
  dev.sendFeatureReport(p);
  console.log('SET', name.padEnd(8), hex(p));
}
function get(name) {
  try {
    const r = Buffer.from(dev.getFeatureReport(0x00, 65));
    console.log('GET', name.padEnd(8), hex(r));
    return r;
  } catch (e) { console.log('GET', name.padEnd(8), '(跳过:', e.message.split(':')[0] + ')'); return null; }
}

const P_AB   = [0x04, 0xab];
const P_02   = [0x04, 0x02];
const P_11   = [0x04, 0x11, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0a];
const P_18   = [0x04, 0x18];

(async () => {
  // 0. 暖机心跳
  for (let i = 0; i < 3; i++) { send('hb' + i, P_18); get('hb'); await sleep(700); }
  // 1. 握手
  send('ab', P_AB);           get('ab');
  // 2. 随机挑战块 (64 字节随机)
  const rnd = [0x00, ...require('crypto').randomBytes(64)];
  send('rand', rnd);
  // 3. 02 (设备返回4字节状态)
  send('02', P_02);           get('02');
  // 4. 配置头
  send('11', P_11);           get('11');
  await sleep(80);
  // 5. 10 个数据块
  const blocks = Array.from({ length: 10 }, () => new Array(64).fill(0));
  const targets = MODE === 'disable' ? [[5, 48]] : MODE === 'set' ? CELLS : [];
  for (const [b, o] of targets) { blocks[b][o] = 0x05; blocks[b][o + 1] = 0x03; }
  blocks[9][62] = 0xaa; blocks[9][63] = 0x55;   // 结束标记
  for (let i = 0; i < blocks.length; i++) { send('blk' + i, blocks[i]); await sleep(12); }
  // 6. 收尾
  send('02', P_02);           get('02');
  send('18', P_18);
  for (let i = 0; i < 2; i++) { send('tb' + i, P_18); await sleep(700); }
  console.log('\n#### 已下发', MODE === 'restore' ? '恢复默认' : '禁用: ' + targets.map(t => t.join(':')).join(', '), '- 请按键测试验证');
  dev.close();
})().catch(e => { console.error('失败:', e.message); try { dev.close(); } catch {} process.exit(1); });
