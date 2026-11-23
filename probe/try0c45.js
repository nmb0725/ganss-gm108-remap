// 枚举 0c45:8006 的所有 HID 接口并逐个测 GET/SET feature (04 18 心跳)
const HID = require('node-hid');
const devs = HID.devices().filter(d => d.vendorId === 0x0c45 && d.productId === 0x8006);
const hex = b => Buffer.from(b).toString('hex').replace(/(.{2})/g, '$1 ').trim();
console.log('找到', devs.length, '个接口');
for (const d of devs) {
  console.log('\n=== usagePage=0x' + d.usagePage.toString(16), 'usage=0x' + d.usage.toString(16), '|', d.product);
  console.log('   ', d.path);
  let dev;
  try { dev = new HID.HID(d.path); } catch (e) { console.log('  open 失败:', e.message); continue; }
  try {
    const r = Buffer.from(dev.getFeatureReport(0x00, 64));
    console.log('  GET =>', hex(r.slice(0, 12)));
  } catch (e) { console.log('  GET 失败:', e.message.split(':')[0]); }
  try {
    const p = Buffer.alloc(65); p[1] = 0x04; p[2] = 0x18;
    dev.sendFeatureReport(p);
    console.log('  SET 0418 OK');
    const r = Buffer.from(dev.getFeatureReport(0x00, 64));
    console.log('  回读 =>', hex(r.slice(0, 12)));
  } catch (e) { console.log('  SET 失败:', e.message.split(':')[0]); }
  dev.close();
}
