// 设备监听: 轮询 HID 枚举, 识别 GM108 正常态(0c45:8006 mi_00) / 救援态(0c45:7040)
// 只读枚举, 不打开设备。打开设备与 GET 校验在 M2 hid-transport 实现。
const HID = require('node-hid');

const TARGETS = {
  normal: { vendorId: 0x0c45, productId: 0x8006 },
  boot:   { vendorId: 0x0c45, productId: 0x7040 }
};

function findGm108() {
  let devices = [];
  try { devices = HID.devices(); } catch { return { present: false, error: 'HID 枚举失败' }; }
  const boot = devices.find(d => d.vendorId === TARGETS.boot.vendorId && d.productId === TARGETS.boot.productId);
  if (boot) return { present: true, mode: 'boot', path: boot.path, product: boot.product || 'GM108 (BOOT)' };
  // kbd 结尾的路径是实测可用接口; 若同时出现多条, 优先 kbd
  const cands = devices.filter(d => d.vendorId === TARGETS.normal.vendorId && d.productId === TARGETS.normal.productId && /mi_00/i.test(d.path || ''));
  const dev = cands.find(d => /kbd$/i.test(d.path || '')) || cands[0];
  if (!dev) return { present: false };
  return { present: true, mode: 'normal', path: dev.path, product: dev.product || 'GANSS GM108', serial: dev.serialNumber || null };
}

// 间隔轮询, 状态变化才回调
function startWatcher(onChange, intervalMs = 1500) {
  let last = null;
  const timer = setInterval(() => {
    const cur = findGm108();
    const key = JSON.stringify(cur);
    if (key !== last) { last = key; onChange(cur); }
  }, intervalMs);
  const initial = findGm108();
  last = JSON.stringify(initial);
  onChange(initial);
  return () => clearInterval(timer);
}

module.exports = { findGm108, startWatcher };
