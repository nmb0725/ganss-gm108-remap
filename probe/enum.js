// 枚举 HID 设备, 找 GM108 的命令通道 (vendor-defined collection)
// 用法: node enum.js            仅枚举
//       node enum.js --open     额外尝试打开候选设备并做只读 getFeatureReport
const HID = require('node-hid');

const devs = HID.devices();
const hex = (n, w = 4) => '0x' + n.toString(16).toUpperCase().padStart(w, '0');

console.log('idx  VID      PID      usagePage  usage    open?  product');
console.log('---  -------  -------  ---------  -------  -----  -------');
devs.forEach((d, i) => {
  console.log(
    String(i).padStart(4),
    hex(d.vendorId).padEnd(8),
    hex(d.productId).padEnd(8),
    hex(d.usagePage).padEnd(10),
    hex(d.usage).padEnd(8),
    '   -  ',
    d.product || '(unnamed)',
    '  [' + d.path.slice(0, 60) + '...]'
  );
});

// 候选: usagePage >= 0xFF00 (vendor-defined) 的键盘类设备
const cand = devs.filter(d => d.usagePage >= 0xff00 && d.vendorId === 0x24ae);
console.log('\nvendor-defined 候选:', cand.length);
cand.forEach(d => console.log('  ', hex(d.vendorId), hex(d.productId), '|', d.product, '| sn:', d.serialNumber || '-'));

if (process.argv[2] === '--open' && cand.length) {
  for (const d of cand) {
    console.log('\n--- 尝试打开:', d.product, d.path);
    try {
      const dev = new HID.HID(d.path);
      // 只读探测: feature report id 0x04 (老软件用 04 xx 报文)
      for (const rid of [0x04]) {
        try {
          const buf = dev.getFeatureReport(rid, 65);
          console.log(`  getFeatureReport(0x${rid.toString(16)}, 65) =>`, Buffer.from(buf).toString('hex'));
        } catch (e) {
          console.log(`  getFeatureReport(0x${rid.toString(16)}) 失败:`, e.message);
        }
      }
      dev.close();
      console.log('  open/close OK');
    } catch (e) {
      console.log('  打开失败:', e.message);
    }
  }
}
