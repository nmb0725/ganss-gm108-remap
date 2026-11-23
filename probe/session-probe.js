// 只读探测 (不发 04 ab / 04 11 / 数据块, 无任何会话/写入动作):
// 像老软件那样连续心跳+状态轮询, 观察 18/02 应答 [4] 位是否随"主机持续在线"变 01
const HID = require('node-hid');
const d = HID.devices().find(x => x.vendorId === 0x0c45 && x.productId === 0x8006 && /mi_00/i.test(x.path));
if (!d) { console.error('找不到 0c45:8006 mi_00'); process.exit(1); }
const dev = new HID.HID(d.path);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const set = bytes => { const b = Buffer.alloc(65); Buffer.from(bytes).copy(b, 1); dev.sendFeatureReport(b); };
const get = () => { try { return Buffer.from(dev.getFeatureReport(0x00, 65)); } catch { return null; } };
(async () => {
  for (let i = 0; i < 15; i++) {
    set([0x04, 0x18]);
    const r18 = get();
    set([0x04, 0x02]);
    const r02 = get();
    console.log(`#${String(i + 1).padStart(2)}  18:[4]=${r18 ? r18[4].toString(16) : '无应答'}  02:[4]=${r02 ? r02[4].toString(16) : '无应答'}  02尾8: ${r02 ? Buffer.from(r02.subarray(1, 9)).toString('hex') : '-'}`);
    await sleep(400);
  }
  dev.close();
})().catch(e => { console.error('失败:', e.message); try { dev.close(); } catch {} process.exit(1); });
