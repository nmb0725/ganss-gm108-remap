// 逐个尝试 GM108 的每个 HID 接口: GET/SET feature (00 04 18) 看哪个接口接受
const HID = require('node-hid');
const devs = HID.devices().filter(d => d.vendorId === 0x24ae && d.productId === 0x2013);
const hex = b => Buffer.from(b).toString('hex').replace(/(.{2})/g, '$1 ').trim();

for (const d of devs) {
  console.log('\n===', d.product, '| usagePage=0x' + d.usagePage.toString(16), 'usage=0x' + d.usage.toString(16));
  console.log('   ', d.path);
  let dev;
  try { dev = new HID.HID(d.path); } catch (e) { console.log('  open 失败:', e.message); continue; }
  // GET 00 04 18
  try {
    const r = Buffer.from(dev.getFeatureReport(0x00, 64));
    console.log('  GET(0,64) =>', hex(r.slice(0, 12)));
  } catch (e) { console.log('  GET 失败:', e.message); }
  // SET 00 04 18 (心跳, 无害)
  try {
    const p = Buffer.alloc(65); p[1] = 0x04; p[2] = 0x18;
    dev.sendFeatureReport(p);
    console.log('  SET(0418) OK');
  } catch (e) { console.log('  SET 失败:', e.message); }
  dev.close();
}
