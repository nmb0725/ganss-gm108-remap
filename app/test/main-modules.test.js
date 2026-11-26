'use strict';
// 主进程可测模块: worker 调度 (#3/#4) 与下发决策/applied.json (#4/#5)。不依赖 Electron / node-hid。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');
const { createWorkerRunner } = require('../main/worker-runner');
const __SRC_OR_FS = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const A = require('../main/apply-service');

// ---- 假 Worker: behavior(w, msg) 决定如何响应 ----
function fakeWorkerCtor(behavior) {
  const made = [];
  class FakeWorker extends EventEmitter {
    constructor() { super(); this.terminated = false; made.push(this); }
    postMessage(msg) { setImmediate(() => behavior(this, msg)); }
    terminate() { this.terminated = true; return Promise.resolve(0); }
  }
  FakeWorker.made = made;
  return FakeWorker;
}

test('#3 worker 只 exit 不发消息 => 立即失败, 不永久挂起', async () => {
  const W = fakeWorkerCtor(w => w.emit('exit', 1));
  const run = createWorkerRunner({ WorkerCtor: W, workerFile: 'x' });
  const r = await run('apply', 'p', {});
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /已结束而没有任何结果/);
});

test('#3 apply 永不响应 => 软超时只提示, 硬上限后 stuck (但不 terminate, 见 #Mac 用例)', async () => {
  let pending = 0;
  const W = fakeWorkerCtor(() => {});
  const run = createWorkerRunner({ WorkerCtor: W, workerFile: 'x', onPending: () => pending++, softMs: 10, hardMs: 40 });
  const r = await run('apply', 'p', {});
  assert.strictEqual(r.stuck, true);
  assert.strictEqual(pending, 1, '软超时应提示一次');
  assert.ok(!W.made[0].terminated, '硬上限也不能 terminate: 打不断 native 调用, 只会让整个进程 abort');
  assert.strictEqual((await run('apply', 'p', {})).wedged, true, '卡死的 worker 未退出前应拒绝新写入');
});

test('#Mac 非 apply 操作超时 => 失败但不 terminate (terminate 打不断卡在 native 调用里的线程, 会让整个进程 abort)', async () => {
  const W = fakeWorkerCtor(() => {});
  const run = createWorkerRunner({ WorkerCtor: W, workerFile: 'x' });
  const r = await run('version', 'p', {}, 20);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.abandoned, true);
  assert.ok(!W.made[0].terminated, '只读操作超时绝不能 terminate worker');
});

test('#Mac HID 操作串行: 有操作在跑时 skipIfBusy 直接跳过, 前一个退出后才能派下一个', async () => {
  const W = fakeWorkerCtor((w, m) => setImmediate(() => {
    w.emit('message', { id: m.id, ok: true, result: 'v' });
    setImmediate(() => w.emit('exit', 0));
  }));
  const run = createWorkerRunner({ WorkerCtor: W, workerFile: 'x' });
  const a = run('version', 'p', {}, 1000);
  const b = run('version', 'p', {}, 1000, { skipIfBusy: true });
  assert.strictEqual((await b).skipped, true, '被跳过时不应起第二个 worker');
  assert.strictEqual(W.made.length, 1);
  assert.strictEqual((await a).ok, true);
  assert.strictEqual((await run('version', 'p', {}, 1000)).ok, true, '前一个退出后应能继续');
  assert.strictEqual(W.made.length, 2);
});

test('#Mac 并发调用必须串行: 上一个 worker 退出前不得创建下一个', async () => {
  let releaseA;
  const gateA = new Promise(r => { releaseA = r; });
  const W = fakeWorkerCtor((w, m) => {
    const finish = () => { w.emit('message', { id: m.id, ok: true, result: 'v' }); w.emit('exit', 0); };
    if (m.serial === 'a') gateA.then(finish); else setImmediate(finish);
  });
  const run = createWorkerRunner({ WorkerCtor: W, workerFile: 'x' });
  const a = run('version', 'p', { serial: 'a' }, 2000);
  const b = run('version', 'p', { serial: 'b' }, 2000);
  await new Promise(r => setImmediate(r));
  assert.strictEqual(W.made.length, 1, 'A 的 worker 还没退出, B 不能创建第二个 (并发打开设备会 abort)');
  releaseA();
  assert.strictEqual((await a).ok, true);
  assert.strictEqual((await b).ok, true);
  assert.strictEqual(W.made.length, 2);
});

test('#Mac 只读超时后迟到返回 => worker 退出, 后续写入仍可执行 (队列不能永久卡死)', async () => {
  let n = 0, lateReturn;
  const W = fakeWorkerCtor((w, m) => {
    n++;
    const finish = () => { w.emit('message', { id: m.id, ok: true, result: 'v' }); w.emit('exit', 0); };
    if (n === 1) lateReturn = finish; else setImmediate(finish);
  });
  const run = createWorkerRunner({ WorkerCtor: W, workerFile: 'x' });
  assert.strictEqual((await run('version', 'p', {}, 20)).abandoned, true, '只读超时应标记 abandoned');
  const stuck = await run('apply', 'p', {}, 200);
  assert.strictEqual(stuck.wedged, true, '有 worker 卡住时写入应立即失败, 不排队等死');
  lateReturn();                                   // 卡住的 native 调用后来返回了
  assert.strictEqual((await run('apply', 'p', {}, 200)).ok, true, 'worker 退出后队列必须恢复');
});

test('#Mac 排队期间前一个操作变成 wedged => 排队超时提示"拔插重启"而不是"稍后重试"', async () => {
  let late;
  const W = fakeWorkerCtor((w, m) => {
    if (m.hang) late = () => { w.emit('message', { id: m.id, ok: true }); w.emit('exit', 0); };
    else setImmediate(() => { w.emit('message', { id: m.id, ok: true }); w.emit('exit', 0); });
  });
  const run = createWorkerRunner({ WorkerCtor: W, workerFile: 'x', queueMs: 60 });
  const a = run('version', 'p', { hang: true }, 20);   // 20ms 后超时 => wedged, worker 不退出
  await new Promise(r => setImmediate(r));             // 此时 a 仍在跑, b 会进队列而不是被 wedged 挡住
  const rb = await run('version', 'p', {}, 20);
  assert.strictEqual(rb.wedged, true, '排队期间前一个操作卡死 => 应给出 wedged 提示');
  assert.match(rb.error, /拔插键盘后重启/, '"稍后重试"对 wedged 没有意义');
  late();
});

test('#Mac 排队超时 => 限时返回失败, 前面的操作不结束时界面不会永远"写入中"', async () => {
  const W = fakeWorkerCtor(() => {});              // 永不返回, 占住队列
  const run = createWorkerRunner({ WorkerCtor: W, workerFile: 'x', queueMs: 20 });
  run('version', 'p', {}, 60000);                  // 长时间占着 (未超时)
  await new Promise(r => setImmediate(r));
  const t0 = Date.now();
  const r = await run('apply', 'p', {}, 60000);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /排队/);
  assert.ok(Date.now() - t0 < 400, '应在排队超时后返回, 不能等 apply 自己的超时');
});

test('#4 进度消息 keymap-ok 后宏失败 => keymapMaybeApplied=true', async () => {
  const W = fakeWorkerCtor((w, m) => {
    w.emit('message', { id: m.id, progress: 'keymap-ok' });
    w.emit('message', { id: m.id, ok: false, error: '[preflight] 宏会话无应答', step: 'preflight' });
  });
  const run = createWorkerRunner({ WorkerCtor: W, workerFile: 'x' });
  const r = await run('apply', 'p', {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.keymapMaybeApplied, true);
});

test('#3 正常完成后迟到的 exit 被忽略', async () => {
  const W = fakeWorkerCtor((w, m) => { w.emit('message', { id: m.id, ok: true, result: 1 }); w.emit('exit', 0); });
  const run = createWorkerRunner({ WorkerCtor: W, workerFile: 'x' });
  const r = await run('apply', 'p', {});
  assert.strictEqual(r.ok, true);
});

// ---- applied.json ----
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gm108-applied-')), 'applied.json');

test('#5 applied.json: 不存在=首次(非未知); 损坏=未知; 原子写后可读回', () => {
  const f = tmpFile();
  assert.strictEqual(A.readAppliedDoc(f).unknown, false);
  fs.writeFileSync(f, '{broken');
  const d = A.readAppliedDoc(f);
  assert.strictEqual(d.unknown, true);
  assert.deepStrictEqual(d.config.overrides, []);
  A.writeAppliedDoc(f, { config: { schema: 1, name: 'x', overrides: [{ cell: 92, action: 'disable' }] }, macros: [] });
  assert.ok(!fs.existsSync(f + '.tmp'));
  assert.strictEqual(A.readAppliedDoc(f).config.overrides.length, 1);
  A.markUnknown(f, 'test');
  assert.strictEqual(A.readAppliedDoc(f).unknown, true);
});

test('#5 planApply: 状态未知 => 全量 (键位+宏库), 不会报"没有需要下发的变更"', () => {
  const cfg = { schema: 1, name: 'x', overrides: [] };
  const p = A.planApply({ cfg, prevDoc: { unknown: true, config: cfg }, lib: [] });
  assert.strictEqual(p.full, true);
  assert.strictEqual(p.nothing, false);
  assert.strictEqual(p.macrosChanged, true);
  const p2 = A.planApply({ cfg, prevDoc: { unknown: false, config: cfg, macros: [] }, lib: [] });
  assert.strictEqual(p2.nothing, true);
  const p3 = A.planApply({ cfg, prevDoc: { unknown: false, config: cfg, macros: [] }, lib: [], force: true });
  assert.strictEqual(p3.full, true);
});

test('#5 planApply: 差异计算 (改目标=变更, 改回默认=变更, 仅改名=非变更)', () => {
  const prev = { unknown: false, macros: [], config: { overrides: [{ cell: 1, action: 'remap', hid: 4, target: 'A' }, { cell: 2, action: 'disable' }] } };
  const cfg = { overrides: [{ cell: 1, action: 'remap', hid: 4, target: '改名' }, { cell: 3, action: 'disable' }] };
  const p = A.planApply({ cfg, prevDoc: prev, lib: [] });
  assert.strictEqual(p.changed, 2); // cell2 恢复默认 + cell3 新禁用
});

test('#4 appliedAfter: 成功=新基线; preflight 失败=不改; 其他失败/超时/部分成功=标记未知', () => {
  const cfg = { overrides: [] }, lib = [];
  assert.deepStrictEqual(A.appliedAfter({ result: { ok: true }, cfg, lib }).config, cfg);
  assert.strictEqual(A.appliedAfter({ result: { ok: false, step: 'preflight' }, cfg, lib }), null);
  assert.strictEqual(A.appliedAfter({ result: { ok: false, step: 'status2' }, cfg, lib }).unknown, true);
  assert.strictEqual(A.appliedAfter({ result: { ok: false, stuck: true }, cfg, lib }).unknown, true);
  assert.strictEqual(A.appliedAfter({ result: { ok: false, step: 'preflight', keymapMaybeApplied: true }, cfg, lib }).unknown, true);
});

test('#8 validateConfig requireName:false 允许下发"键盘当前状态"视图', () => {
  const { validateConfig } = require('../main/config-store');
  assert.doesNotThrow(() => validateConfig({ schema: 1, name: '出厂默认', overrides: [] }));
  assert.doesNotThrow(() => validateConfig({ schema: 1, overrides: [] }, { requireName: false }));
  assert.throws(() => validateConfig({ schema: 1, overrides: [] }), e => e.code === 'BAD_NAME');
  // combo 缺 target 时补齐 (#20)
  const c = validateConfig({ schema: 1, name: 'x', overrides: [{ cell: 5, action: 'combo', keys: [4, 5] }] });
  assert.strictEqual(typeof c.overrides[0].target, 'string');
});

// ---- 设备监视 (卡顿修复): 异步、单航班、不阻塞主线程 ----
const { createDeviceMonitor } = require('../main/device-watcher');
const GM = { vendorId: 0x0c45, productId: 0x8006, path: '\\\\?\\hid#vid_0c45&pid_8006&mi_00#x\\kbd' };

test('设备监视: 并发 refresh 只枚举一次 (单航班), current() 不触发枚举', async () => {
  let calls = 0, release;
  const hid = { devicesAsync: () => { calls++; return new Promise(r => { release = () => r([GM]); }); } };
  const m = createDeviceMonitor({ hid });
  assert.strictEqual(m.current().pending, true);
  const a = m.refresh(), b = m.refresh(), c = m.refresh();
  assert.strictEqual(calls, 1, '同一时刻只能有一次枚举');
  release();
  const [ra, rb, rc] = await Promise.all([a, b, c]);
  assert.strictEqual(ra.mode, 'normal'); assert.strictEqual(rb, ra); assert.strictEqual(rc, ra);
  assert.strictEqual(m.current().mode, 'normal');
  assert.strictEqual(calls, 1);
  const d = m.refresh();
  assert.strictEqual(calls, 2, '上一次完成后才会发起下一次');
  release(); await d;
});

test('设备监视: 只在状态变化时回调; 枚举异常 => 未连接; 慢枚举记日志', async () => {
  const seq = [[GM], [GM], [], 'err'];
  let i = 0, t = 0;
  const hid = { devicesAsync: async () => { const v = seq[i++]; t += 400; if (v === 'err') throw new Error('x'); return v; } };
  const logs = [], changes = [];
  const m = createDeviceMonitor({ hid, log: x => logs.push(x), now: () => t });
  m.start(st => changes.push(st.present ? st.mode : st.error ? 'error' : 'absent'));
  m.stop(); // 不用定时器, 手动驱动
  for (let k = 0; k < 4; k++) await m.refresh();
  assert.deepStrictEqual(changes, ['normal', 'absent', 'error']);
  assert.strictEqual(m.current().error, 'HID 枚举失败');
  assert.ok(logs.some(l => /枚举较慢/.test(l)), '超过阈值应记日志');
});

test('设备监视: 主进程不再调用同步 HID.devices()', () => {
  const src = __SRC_OR_FS('main/device-watcher.js');
  const code = src.replace(/\/\/.*$/gm, '');
  assert.ok(/devicesAsync/.test(code));
  assert.ok(!/=>\s*classify\(hid\.devices\(\)\)|classify\(HID\.devices\(\)\)/.test(code), '不应在主线程同步枚举');
});

test('classify: 两个 usagePage1/usage6 接口时按 interface===0 选 (Mac 实机会出现两个, 枚举顺序不保证)', () => {
  const iface0 = { vendorId: 0x0c45, productId: 0x8006, usagePage: 1, usage: 6, interface: 0, path: 'DevSrvsID:4294967451' };
  const iface1 = { vendorId: 0x0c45, productId: 0x8006, usagePage: 1, usage: 6, interface: 1, path: 'DevSrvsID:4295064307' };
  for (const list of [[iface1, iface0], [iface0, iface1]]) {
    assert.strictEqual(classify(list, 'darwin').path, 'DevSrvsID:4294967451');
  }
  // macOS 上 node-hid 可能给不出 interface (全 -1) => 不能因此认不出设备, 退回 usage 判断
  const noIface = GM_IFACES.map(d => ({ ...d, interface: -1 }));
  assert.strictEqual(classify(noIface, 'darwin').path, GM_IFACES[0].path);
});
// ---- 跨平台接口挑选 (macOS 打包: 路径里没有 mi_00) ----
const { classify } = require('../main/device-watcher');
const GM_IFACES = [
  { vendorId: 0x0c45, productId: 0x8006, usagePage: 1, usage: 6, path: 'IOService:/.../AppleUserHIDEventDriver/Keyboard@0/IOHIDUserDevice', product: 'GM108 Keyboard' },
  { vendorId: 0x0c45, productId: 0x8006, usagePage: 1, usage: 2, path: 'IOService:/.../Mouse@1/IOHIDUserDevice' },
  { vendorId: 0x0c45, productId: 0x8006, usagePage: 12, usage: 0, path: 'IOService:/.../Consumer@2/IOHIDUserDevice' },
  { vendorId: 0x0c45, productId: 0x8006, usagePage: 65535, usage: 1, path: 'IOService:/.../Vendor@3/IOHIDUserDevice' }
];

test('classify: win32 仍按 mi_00 + kbd 选接口 (实测路径)', () => {
  const winList = [
    { vendorId: 0x0c45, productId: 0x8006, path: '\\\\?\\HID#VID_0C45&PID_8006&MI_01#1\\{g}' },
    { vendorId: 0x0c45, productId: 0x8006, path: '\\\\?\\HID#VID_0C45&PID_8006&MI_00#8\\{g}' },
    { vendorId: 0x0c45, productId: 0x8006, path: '\\\\?\\HID#VID_0C45&PID_8006&MI_00#8\\{g}\\kbd' }
  ];
  assert.strictEqual(classify(winList, 'win32').path, winList[2].path);
  // Windows 上没有 mi_00 时不得退回别的接口
  assert.strictEqual(classify([GM_IFACES[2]], 'win32').present, false);
});

test('classify: darwin/linux 按 usagePage=1 & usage=6 选键盘接口', () => {
  for (const p of ['darwin', 'linux']) {
    const r = classify(GM_IFACES, p);
    assert.strictEqual(r.present, true, p);
    assert.strictEqual(r.path, GM_IFACES[0].path, p);
  }
  // 没有 usage=6 时退回 usagePage=1
  assert.strictEqual(classify(GM_IFACES.slice(1), 'darwin').path, GM_IFACES[1].path);
  // 只有非键盘接口也至少能报"已连接" (不至于完全认不出键盘)
  assert.strictEqual(classify([GM_IFACES[3]], 'darwin').present, true);
});

test('classify: BOOT 模式优先, 与平台无关', () => {
  const list = [{ vendorId: 0x0c45, productId: 0x7040, path: 'IOService:/boot' }, GM_IFACES[0]];
  assert.strictEqual(classify(list, 'darwin').mode, 'boot');
  assert.strictEqual(classify(list, 'win32').mode, 'boot');
});
