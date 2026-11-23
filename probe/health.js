// 只读体检: 心跳+版本, 不做任何 SET 写操作(心跳04 18除外,它无副作用)
const HID = require('node-hid');
const d = HID.devices().find(x => x.vendorId === 0x0c45 && x.productId === 0x8006 && /mi_00/i.test(x.path));
if (!d) { console.log('找不到 0c45:8006 (键盘正常态身份)。当前 0c45 设备:'); HID.devices().filter(x=>x.vendorId===0x0c45).forEach(x=>console.log(' ', x.productId.toString(16), x.path)); process.exit(1); }
const dev = new HID.HID(d.path);
const hex = b => Buffer.from(b).toString('hex').replace(/(..)/g, '$1 ').trim();
const set = bytes => { const b = Buffer.alloc(65); Buffer.from(bytes).copy(b, 1); dev.sendFeatureReport(b); };
const get = () => hex(dev.getFeatureReport(0x00, 65));
set([0x04, 0x18]); console.log('心跳 GET :', get());
set([0x04, 0x02]); console.log('状态 GET :', get());
set([0x04, 0x05]); console.log('信息 GET :', get());
set([0x04, 0x18]); console.log('心跳 GET2:', get());
dev.close();
