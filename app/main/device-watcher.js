// 设备监听: 轮询 HID 枚举, 识别 GM108 正常态(0c45:8006 mi_00) / 救援态(0c45:7040)
// 只读枚举, 不打开设备。
//
// 2026-11-24 (14:15) 卡顿修复:
//   之前一版在主进程上每 1.5 秒同步调用 HID.devices()。Windows 上一次枚举要遍历并打开每个 HID 设备读字符串,
//   常见耗时几十到几百 ms, 碰到响应慢的设备 (蓝牙/被别的程序独占的设备) 可达数秒; Electron 主进程 = 窗口 UI 线程,
//   被同步枚举卡住时整个窗口失去响应, 表现为"间歇性卡死, 过一会恢复"。
//   现在: 枚举走 HID.devicesAsync() (libuv 线程池, 不阻塞主线程) + 单航班 (同一时刻最多一次枚举, 其余调用复用同一个结果),
//   所以不会出现两次 hid_enumerate 并发。
//   (更正: 12:31 那次改回同步, 理由写的是"异步并发枚举导致启动闪退"; 后来确认闪退是 Chromium 沙箱问题, 与枚举无关。)
//   可选 log 回调: 枚举超过 SLOW_MS 时调用 (诊断用; 15:16 卡顿已确认修复, 主进程不再传入)。
const HID = require('node-hid');

const TARGETS = {
  normal: { vendorId: 0x0c45, productId: 0x8006 },
  boot:   { vendorId: 0x0c45, productId: 0x7040 }
};
const SLOW_MS = 300;

function pickNormal(cands, platform) {
  if (platform === 'win32') {
    // Windows (实测): 只有 mi_00 那组接口支持 Feature 报告; 其中路径以 kbd 结尾的可用
    const w = cands.filter(d => /mi_00/i.test(d.path || ''));
    return w.find(d => /kbd$/i.test(d.path || '')) || w[0];
  }
  // macOS / Linux: 设备路径里没有 "mi_00" 这种 Windows 专有字符串, 只能按接口号 / usagePage 挑。
  // GM108 有两个接口都是 usagePage 1 / usage 6: 接口 0 (boot 键盘, 带 64B Feature 报告, 是本工具的命令通道)
  // 和接口 1 的 Col03 (全键无冲键盘, 没有 Feature 报告)。macOS 不保证枚举顺序, 所以先按接口号选, usage 只兜底。
  // 2026-11-26 Mac 实机 (macOS 12.7): 枚举确实出现两个 usagePage1/usage6 条目, 选中接口 0 时
  // open + GET feature report 0x00 有应答; 选中另一个则 GET 报 0xE0005000。node-hid 在 macOS 上是否
  // 给出 interface 字段仍待实机确认 (没给出时 find(interface===0) 自然落空, 行为与改前一致)。
  return cands.find(d => d.interface === 0)
    || cands.find(d => d.usagePage === 1 && d.usage === 6)
    || cands.find(d => d.usagePage === 1)
    || cands[0];
}

function classify(devices, platform = process.platform) {
  const boot = devices.find(d => d.vendorId === TARGETS.boot.vendorId && d.productId === TARGETS.boot.productId);
  if (boot) return { present: true, mode: 'boot', path: boot.path, product: boot.product || 'GM108 (BOOT)' };
  const cands = devices.filter(d => d.vendorId === TARGETS.normal.vendorId && d.productId === TARGETS.normal.productId);
  const dev = pickNormal(cands, platform);
  if (!dev) return { present: false };
  return { present: true, mode: 'normal', path: dev.path, product: dev.product || 'GANSS GM108', serial: dev.serialNumber || null };
}

// 设备监视器 (可注入 hid / log / 计时器, 便于单测)
//   refresh(): 单航班枚举, 返回最新状态; 正在枚举时直接复用同一个 Promise
//   current(): 最近一次结果 (不枚举, 立即返回)
//   start(onChange) / stop() / pause() / resume()
function createDeviceMonitor({ hid = HID, log = () => {}, intervalMs = 1500, now = () => Date.now() } = {}) {
  let inflight = null, last = { present: false, pending: true }, lastKey = null;
  let timer = null, stopped = true, paused = false, onChange = null;

  const enumerate = () => {
    // 优先异步 (不阻塞主线程); 旧版 node-hid 没有 devicesAsync 时退回同步
    if (typeof hid.devicesAsync === 'function') return hid.devicesAsync();
    return Promise.resolve().then(() => hid.devices());
  };

  function refresh() {
    if (inflight) return inflight;
    const t0 = now();
    inflight = enumerate()
      .then(list => classify(list || []))
      .catch(() => ({ present: false, error: 'HID 枚举失败' }))
      .then(st => {
        const ms = now() - t0;
        if (ms > SLOW_MS) log(`HID 枚举较慢: ${ms} ms`);
        last = st;
        const key = JSON.stringify(st);
        if (key !== lastKey) { lastKey = key; if (onChange) onChange(st); }
        return st;
      })
      .finally(() => { inflight = null; });
    return inflight;
  }

  const tick = async () => {
    if (stopped) return;
    if (!paused) await refresh();
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };

  return {
    refresh,
    current: () => last,
    start(cb) { onChange = cb; stopped = false; timer = setTimeout(tick, 0); return this; },
    stop() { stopped = true; clearTimeout(timer); },
    pause() { paused = true; },
    resume() { paused = false; }
  };
}

module.exports = { classify, createDeviceMonitor, SLOW_MS };
