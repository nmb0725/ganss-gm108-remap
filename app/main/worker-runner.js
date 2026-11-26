'use strict';
// HID worker 调度 (从 main.js 抽出, 可注入 Worker 构造器以便单测)。修复审查 #3 / #4。
//
// 规则:
//  - 任何操作超时都只结束等待, 绝不 terminate worker (terminate 打不断阻塞在 native 同步调用里的线程,
//    会把整个进程带走)。worker 回到 JS 层送来迟到结果时才 terminate, 见下方 macOS 崩溃说明。
//  - 有 worker 超时后仍未退出 => wedged; 此期间新操作直接返回失败, 提示拔插键盘后重启工具。
//  - apply: 软超时 (默认 30s) 只发 onPending 提示; 硬上限 (默认 120s) 结束等待并返回 { stuck:true },
//           调用方必须把设备标记为"疑似占用", 直到观察到键盘拔插才允许再次下发。
//  - worker 崩溃/退出而没发结果 (exit 事件) => 立即失败, 不再永久挂起。
//  - worker 可发进度消息 { id, progress:'keymap-ok' }: 结果里带 keymapMaybeApplied, 供调用方判断部分成功。
//    "键位会话返回成功"不等于"已落盘"(按键设置不发 04 f0, 与老软件"采用"一致, 11-24 已定不做该实验),
//    所以命名为 MaybeApplied。
//  - 所有操作串行, 排队也有上限 (queueMs): 见 runHidWorker 上方的 macOS 崩溃说明。
const path = require('path');

// queueMs: 排队上限。必须大于排在写入前面的只读操作超时 (device:version 现在是 5s),
// 否则读版本还没结束/超时, 排队中的写入就先超时了。调大读版本超时时记得同步调大这里。
function createWorkerRunner({ WorkerCtor, workerFile, onPending, softMs = 30000, hardMs = 120000, queueMs = 15000 } = {}) {
  WorkerCtor = WorkerCtor || require('worker_threads').Worker;
  workerFile = workerFile || path.join(__dirname, 'hid-worker.js');

  // 为什么要这么绕 (macOS 实测, 崩溃报告 Electron-2026-11-26-182636.ips):
  // 非独占打开键盘接口时 IOHIDLib 会先同步调用 IOHIDRequestAccess 等系统应答, 键盘刚重举时可能长等;
  // 多个 worker 同时打开设备 => 全堵在 node-hid 的进程级打开锁上排队, 谁超时谁被 terminate,
  // 而 terminate 打不断阻塞在 native 调用里的线程 => 整个进程 abort()。写盘工具绝不能这样死。
  // 三条规矩:
  //   1. 串行: 后一个操作必须等前一个 worker 真正退出 (exitGate) 才开始, 不并发打开设备;
  //   2. 超时一律不 terminate: native 调用回来、worker 回到 JS 层后, 收到迟到结果时才 terminate (安全);
  //   3. 卡住期间 (wedged) 新操作直接失败并提示拔插重启, 排队也设有上限 (queueMs), 不让界面无限"写入中"。
  let chain = Promise.resolve();
  let pending = 0;   // 排队中 + 执行中的操作数
  let wedged = false; // 有 worker 超时后仍未退出 (卡在 native 调用里)

  return function runHidWorker(op, devPath, extra = {}, timeoutMs = softMs, { skipIfBusy = false } = {}) {
    if (wedged) {
      return Promise.resolve({ ok: false, wedged: true, error: '上一次 HID 操作仍未结束 (卡在系统调用里), 请拔插键盘后重启本工具' });
    }
    if (skipIfBusy && pending > 0) return Promise.resolve({ ok: false, skipped: true });

    const startOnce = () => new Promise((resolve) => {
      const w = new WorkerCtor(workerFile);
      const id = op + Date.now() + Math.random().toString(16).slice(2, 6);
      let settled = false, keymapMaybeApplied = false;
      const timers = [];
      let releaseExit;
      const exitGate = new Promise(r => { releaseExit = r; });
      const done = (r, terminate = true) => {
        if (settled) return;
        settled = true;
        timers.forEach(clearTimeout);
        if (terminate) { try { w.terminate(); } catch {} } else wedged = true;
        resolve({ r: op === 'apply' ? { ...r, keymapMaybeApplied } : r, exitGate });
      };
      if (op === 'apply') {
        timers.push(setTimeout(() => { if (onPending) onPending(); }, timeoutMs));
        // 硬上限同样不 terminate: 打不断 native 调用, 只会把整个进程带走。main.js 的 suspectDeviceBusy 会拦住后续写入。
        timers.push(setTimeout(() => done({
          ok: false, stuck: true,
          error: `下发超过 ${Math.round(hardMs / 1000)} 秒无结果。请勿立即重试: 先拔插键盘, 确认能正常打字后再操作`
        }, false), hardMs));
      } else {
        timers.push(setTimeout(() => done({
          ok: false, abandoned: true,
          error: 'HID 操作超时且无法安全中断 (macOS 上多是在等系统 HID 授权应答)。请拔插键盘后重启本工具'
        }, false), timeoutMs));
      }
      w.on('error', e => done({ ok: false, error: 'HID 工作线程错误: ' + e.message }));
      w.on('exit', () => {
        // 超时后 worker 现在才退出 => 正常收尾, 不报"意外退出"
        if (!settled) done({ ok: false, error: 'HID 工作线程已结束而没有任何结果, 请拔插键盘后重试' }, false);
        wedged = false;
        releaseExit();
      });
      w.on('message', m => {
        if (!m || m.id !== id) return;
        if (m.progress === 'keymap-ok') { keymapMaybeApplied = true; return; }
        // 超时后才回来的结果: 此时 native 调用已经返回, worker 回到 JS 层, terminate 是安全的
        if (settled) { try { w.terminate(); } catch {} return; }
        done(m);
      });
      w.postMessage({ id, op, path: devPath, ...extra });
    });

    pending++;
    let giveResult;
    const result = new Promise(r => { giveResult = r; });
    let queuedOut = false;
    const queueTimer = setTimeout(() => {
      queuedOut = true;
      // 排在已 wedged 的 worker 后面时, "稍后重试"是没用的 (wedged 只能重启解除), 提示要说准
      giveResult(wedged
        ? { ok: false, wedged: true, error: '上一次 HID 操作仍未结束 (卡在系统调用里), 请拔插键盘后重启本工具' }
        : { ok: false, error: `HID 设备忙, 排队超过 ${Math.round(queueMs / 1000)} 秒还没轮到, 请稍后重试` });
    }, queueMs);
    const prev = chain;
    chain = (async () => {
      try { await prev; } catch {}
      clearTimeout(queueTimer);
      if (queuedOut) return;             // 排队期间已被判超时 => 绝不再去打开设备
      try {
        const { r, exitGate } = await startOnce();
        giveResult(r);
        await exitGate;
      } catch (e) {
        giveResult({ ok: false, error: 'HID 调度失败: ' + ((e && e.message) || e) });
      }
    })().finally(() => { pending--; });
    return result;
  };
}

module.exports = { createWorkerRunner };
