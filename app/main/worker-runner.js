'use strict';
// HID worker 调度 (从 main.js 抽出, 可注入 Worker 构造器以便单测)。修复审查 #3 / #4。
//
// 规则:
//  - 普通操作 (version 等): 超时 => terminate + 失败。
//  - apply: 软超时 (默认 30s) 只发 onPending 提示, 不打断写会话;
//           硬上限 (默认 120s) => 结束等待并 terminate, 返回 { stuck:true }。调用方必须把设备标记为"疑似占用",
//           直到观察到键盘拔插才允许再次下发 (terminate 打断不了阻塞在 native 同步调用里的线程)。
//  - worker 崩溃/退出而没发结果 (exit 事件) => 立即失败, 不再永久挂起。
//  - worker 可发进度消息 { id, progress:'keymap-ok' }: 结果里带 keymapMaybeApplied, 供调用方判断部分成功。
//    "键位会话返回成功"不等于"已落盘"(仅改键时从不发 04 f0, 待实机实验确认), 所以命名为 MaybeApplied。
//  - 所有操作串行 (单航班), 且只读操作超时不 terminate worker: 见 runHidWorker 上方的 macOS 崩溃说明。
const path = require('path');

function createWorkerRunner({ WorkerCtor, workerFile, onPending, softMs = 30000, hardMs = 120000 } = {}) {
  WorkerCtor = WorkerCtor || require('worker_threads').Worker;
  workerFile = workerFile || path.join(__dirname, 'hid-worker.js');

  // 单航班: 同一时刻只允许一个 HID worker。
  // macOS 实测 (2026-11-26 崩溃报告): 非独占打开键盘接口时, IOHIDLib 会先同步调用 IOHIDRequestAccess
  // 等系统应答, 键盘刚重举时这一等可能很久; 此时若再派 worker 去打开设备, 它们全堵在 node-hid 的
  // 进程级打开锁上排队, 谁超时谁被 terminate, 而 terminate 打不断阻塞在 native 调用里的线程 => 整个进程 abort()。
  // 所以: (1) 串行, 不并发打开设备; (2) 只读操作超时不 terminate, 宁可让后面排队等着, 也不能 abort 掉写盘工具。
  let chain = Promise.resolve();
  let busy = false;

  return function runHidWorker(op, devPath, extra = {}, timeoutMs = softMs, { skipIfBusy = false } = {}) {
    if (busy && skipIfBusy) return Promise.resolve({ ok: false, skipped: true });
    // startOnce 在"有结果"时就 resolve, 但同时交出 exitGate; 队列要等 worker 真正退出才放行下一个操作,
    // 否则上一个还卡在 native 打开调用里, 下一个又来打开设备, 就重现上面那幅排队 + abort 的现场。
    const startOnce = () => new Promise((resolve) => {
      const w = new WorkerCtor(workerFile);
      const id = op + Date.now() + Math.random().toString(16).slice(2, 6);
      let settled = false, keymapMaybeApplied = false;
      const timers = [];
      let releaseExit;
      const exitGate = new Promise(r => { releaseExit = r; });
      // terminate=false: 只读操作超时后留着 worker (它可能正卡在 native 调用里), 不能 terminate
      const done = (r, terminate = true) => {
        if (settled) return;
        settled = true;
        timers.forEach(clearTimeout);
        if (terminate) { try { w.terminate(); } catch {} }
        resolve({ r: op === 'apply' ? { ...r, keymapMaybeApplied } : r, exitGate });
      };
      if (op === 'apply') {
        timers.push(setTimeout(() => { if (onPending) onPending(); }, timeoutMs));
        timers.push(setTimeout(() => done({
          ok: false, stuck: true,
          error: `下发超过 ${Math.round(hardMs / 1000)} 秒无结果。请勿立即重试: 先拔插键盘, 确认能正常打字后再操作`
        }), hardMs));
      } else {
        timers.push(setTimeout(() => done({
          ok: false, abandoned: true,
          error: 'HID 操作超时且无法安全中断 (macOS 上多是在等系统 HID 授权应答)。请拔插键盘后重启本工具'
        }, false), timeoutMs));
      }
      w.on('error', e => done({ ok: false, error: 'HID 工作线程错误: ' + e.message }));
      w.on('exit', code => {
        // 只读操作超时后 worker 现在才退出 => 属正常收尾, 不报"意外退出"
        if (!settled) done({ ok: false, error: `HID 工作线程意外退出 (code ${code}), 请拔插键盘后重试` }, false);
        releaseExit();
      });
      w.on('message', m => {
        if (!m || m.id !== id) return;
        if (m.progress === 'keymap-ok') { keymapMaybeApplied = true; return; }
        done(m);
      });
      w.postMessage({ id, op, path: devPath, ...extra });
    });

    let giveResult;
    const result = new Promise(r => { giveResult = r; });
    chain = (async () => {
      busy = true;
      try {
        const { r, exitGate } = await startOnce();
        giveResult(r);
        await exitGate;
      } catch (e) {
        giveResult({ ok: false, error: 'HID 调度失败: ' + ((e && e.message) || e) });
      } finally {
        busy = false;
      }
    })();
    return result;
  };
}

module.exports = { createWorkerRunner };
