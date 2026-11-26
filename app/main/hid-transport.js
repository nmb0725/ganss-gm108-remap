'use strict';
// node-hid 传输层: 65 字节 Feature 报告封装 + 熔断闸。
// 规则: 任何 GET 异常 => kill() 永久封死本实例, 之后所有 set/get 直接抛错, 直到上层 close 重建。
const HID = require('node-hid');

// 同步等待 (只在 HID worker 线程里调用)
function busyWait(ms) { const t = Date.now(); while (Date.now() - t < ms) { /* spin */ } }

class CircuitBreak extends Error {
  constructor(reason) { super(`CIRCUIT_BREAK: ${reason}`); this.name = 'CircuitBreak'; }
}

// macOS 必须非独占打开 (实测 2026-11-26, macOS 12.7 + node-hid 3.4 / hidapi 0.15):
// node-hid 默认以 kIOHIDOptionsTypeSeizeDevice (独占) 打开设备, 而键盘接口正被系统键盘驱动使用,
// 独占打开属于特权操作 => (0xE00002C1) kIOReturnNotPrivileged "privilege violation", 界面表现为"下发中止"。
// 传 { nonExclusive: true } 改成 kIOHIDOptionsTypeNone 后即可正常打开并读写 Feature 报告 (已实机确认 GET 0x00 有应答)。
// 该选项只在 __APPLE__ 分支生效, Windows/Linux 行为不变。
function openDevice(devPath) {
  return process.platform === 'darwin'
    ? new HID.HID(devPath, { nonExclusive: true })
    : new HID.HID(devPath);
}

// 打开失败时补一句可操作的提示 (保留原文, 便于按错误码检索)。
// 走到这里说明上面的 nonExclusive 已经生效仍失败, 剩下的常见原因是系统"输入监控"权限没给
// (tccd 日志里这个检查是 kTCCServiceListenEvent, 授权对象是启动本工具的 App)。
function openHint(e) {
  const raw = (e && e.message) || String(e);
  if (process.platform === 'darwin' && /0xE00002C1/i.test(raw)) {
    return raw + ' —— macOS 拒绝了打开请求。若非独占打开已生效, 请到 系统偏好设置 → 安全性与隐私 → 隐私 → 输入监控, '
      + '勾选启动本工具的 App (打包 App 就勾 GANSS GM108 Remap), 然后完全退出该 App 再重新打开。';
  }
  return raw;
}

class HidTransport {
  constructor(devPath) {
    this.path = devPath;
    this.dev = null;
    this.dead = false;
  }

  open() {
    if (this.dead) throw new CircuitBreak('实例已熔断, 请重新打开设备');
    try {
      this.dev = openDevice(this.path);
    } catch (e) {
      throw new Error(openHint(e));
    }
    return this;
  }

  // bytes: <=64B 负载, 前补报告 ID 0x00 成 65B
  set(bytes) {
    if (this.dead) throw new CircuitBreak('已熔断, 拒绝继续下发');
    const p = Buffer.alloc(65);
    Buffer.from(bytes).copy(p, 1);
    try { this.dev.sendFeatureReport(p); }
    catch (e) { this.dead = true; throw new CircuitBreak('SET 失败: ' + e.message); }
    this.lastSet = p;
  }

  // 返回 Buffer(65) 或 null (异常吞掉交由上层 verify 熔断; 不 kill, 保留调用方自行决定)
  // Windows 上设备对"非空闲期"的 GET 可能先返回一条陈旧滞留报告(内容与刚发的 SET 逐字节相同)。
  // 读到与最近 SET 完全相同的缓冲 => 判为滞留, 短暂等待后重读; 连续 3 次都是原样回显 => 视为无应答(null),
  // 交由上层熔断。旧实现只重读 1 次且第二次照单全收, 会让"只会回显"的死设备骗过回显校验 (修复审查 #2)。
  get() {
    if (this.dead) throw new CircuitBreak('已熔断, 拒绝继续读取');
    try {
      for (let i = 0; i < 3; i++) {
        const r = Buffer.from(this.dev.getFeatureReport(0x00, 65));
        if (!(this.lastSet && r.length === this.lastSet.length && r.equals(this.lastSet))) return r;
        busyWait(3); // worker 线程内同步等待几 ms, 不影响主进程
      }
      return null;
    } catch { return null; }
  }

  close() {
    try { if (this.dev) this.dev.close(); } catch {}
    this.dev = null;
  }
}

module.exports = { HidTransport, CircuitBreak };
