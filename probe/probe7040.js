// 探测 0C45:7040 身份: 老协议应答? ISP bootrom?
const H = require('node-hid');
const d = H.devices().find(x => x.vendorId === 0x0c45 && x.productId === 0x7040);
if (!d) { console.log('找不到 0C45:7040'); process.exit(1); }
console.log('打开:', d.path);
const dev = new H.HID(d.path);
const hex = b => Buffer.from(b).toString('hex').replace(/(..)/g, '$1 ').trim();
const tryGet = (id, len) => {
  try { return hex(dev.getFeatureReport(id, len)); } catch (e) { return 'ERR:' + e.message; }
};
const trySet = buf => {
  try { dev.sendFeatureReport(Buffer.from(buf)); return 'SET-OK'; } catch (e) { return 'ERR:' + e.message; }
};
// 1. 老协议心跳 GET 04 18
console.log('GET 04 18 :', tryGet(0x04, 65));
console.log('SET 04 18 :', trySet([0x00, 0x04, 0x18, 0, 0, 0, 0]));
console.log('GET 04 18b:', tryGet(0x04, 65));
// 2. 裸 GET 常见报告 ID
for (const id of [0x00, 0x01, 0x02, 0x05]) console.log('GET 0x' + id.toString(16).padStart(2, '0') + ':', tryGet(id, 65));
// 3. 读输入报告
try { const r = dev.readTimeout(300); console.log('INPUT:', hex(r)); } catch (e) { console.log('INPUT: ERR ' + e.message); }
// 4. Sonix ISP 常见握手探测: 0xEF / 0xFF 命令窗口
console.log('GET 0xEF  :', tryGet(0xEF, 65));
console.log('GET 0xFF  :', tryGet(0xFF, 65));
dev.close();
