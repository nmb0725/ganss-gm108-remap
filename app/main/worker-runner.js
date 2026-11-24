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
const path = require('path');

function createWorkerRunner({ WorkerCtor, workerFile, onPending, softMs = 30000, hardMs = 120000 } = {}) {
  WorkerCtor = WorkerCtor || require('worker_threads').Worker;
  workerFile = workerFile || path.join(__dirname, 'hid-worker.js');

  return function runHidWorker(op, devPath, extra = {}, timeoutMs = softMs) {
    return new Promise((resolve) => {
      const w = new WorkerCtor(workerFile);
      const id = op + Date.now() + Math.random().toString(16).slice(2, 6);
      let settled = false, keymapMaybeApplied = false;
      const timers = [];
      const done = (r) => {
        if (settled) return;
        settled = true;
        timers.forEach(clearTimeout);
        try { w.terminate(); } catch {}
        resolve(op === 'apply' ? { ...r, keymapMaybeApplied } : r);
      };
      if (op === 'apply') {
        timers.push(setTimeout(() => { if (onPending) onPending(); }, timeoutMs));
        timers.push(setTimeout(() => done({
          ok: false, stuck: true,
          error: `下发超过 ${Math.round(hardMs / 1000)} 秒无结果。请勿立即重试: 先拔插键盘, 确认能正常打字后再操作`
        }), hardMs));
      } else {
        timers.push(setTimeout(() => done({ ok: false, error: 'HID 工作线程超时' }), timeoutMs));
      }
      w.on('error', e => done({ ok: false, error: 'HID 工作线程错误: ' + e.message }));
      w.on('exit', code => done({ ok: false, error: `HID 工作线程意外退出 (code ${code}), 请拔插键盘后重试` }));
      w.on('message', m => {
        if (!m || m.id !== id) return;
        if (m.progress === 'keymap-ok') { keymapMaybeApplied = true; return; }
        done(m);
      });
      w.postMessage({ id, op, path: devPath, ...extra });
    });
  };
}

module.exports = { createWorkerRunner };
