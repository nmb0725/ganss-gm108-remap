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
  assert.match(r.error, /意外退出/);
});

test('#3 apply 永不响应 => 软超时只提示, 硬上限后 stuck 并 terminate', async () => {
  let pending = 0;
  const W = fakeWorkerCtor(() => {});
  const run = createWorkerRunner({ WorkerCtor: W, workerFile: 'x', onPending: () => pending++, softMs: 10, hardMs: 40 });
  const r = await run('apply', 'p', {});
  assert.strictEqual(r.stuck, true);
  assert.strictEqual(pending, 1, '软超时应提示一次');
  assert.ok(W.made[0].terminated, '硬上限必须 terminate, 不留僵尸 worker');
});

test('#3 非 apply 操作超时 => 失败并 terminate', async () => {
  const W = fakeWorkerCtor(() => {});
  const run = createWorkerRunner({ WorkerCtor: W, workerFile: 'x' });
  const r = await run('version', 'p', {}, 20);
  assert.strictEqual(r.ok, false);
  assert.ok(W.made[0].terminated);
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
