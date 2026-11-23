'use strict';
// HID 工作线程: 所有阻塞式 node-hid 调用都在这里跑, 防止卡死主进程导致界面发白。
// 协议逻辑/熔断规则全部复用 main/protocol.js (纯函数, 可在 worker 里安全运行)。
const { parentPort } = require('worker_threads');
const { HidTransport } = require('./hid-transport');
const { runKeymapSession, readFirmwareVersion } = require('./protocol');

function fail(e) { return { ok: false, error: e.message || String(e) }; }

parentPort.on('message', async (msg) => {
  const t = new HidTransport(msg.path);
  try {
    t.open();
    if (msg.op === 'version') {
      parentPort.postMessage({ id: msg.id, ok: true, result: readFirmwareVersion(t) });
    } else if (msg.op === 'apply') {
      const r = await runKeymapSession(t, Buffer.from(msg.segHex, 'hex'));
      parentPort.postMessage({ id: msg.id, ok: true, result: r });
    } else {
      parentPort.postMessage({ id: msg.id, ok: false, error: '未知操作: ' + msg.op });
    }
  } catch (e) {
    parentPort.postMessage({ id: msg.id, ...fail(e) });
  } finally {
    t.close();
  }
});
