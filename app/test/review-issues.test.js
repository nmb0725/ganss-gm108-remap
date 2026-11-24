'use strict';
// 代码审查问题回归测试 (2026-11-24 修复文档)。断言"正确行为": 任一失败 = 问题复发。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const P = require('../main/protocol');

// ---------- #1 宏绑定写在本格 cell*4, 不碰任何其他字节 ----------
test('#1 cell19 改键 + cell20 宏: 两格各自字节正确, 互不影响', () => {
  const seg = P.buildKeymap({ overrides: [
    { cell: 19, action: 'remap', hid: 0x04 },
    { cell: 20, action: 'macro', slot: 1, mode: 0 }
  ] });
  assert.strictEqual(seg.subarray(76, 80).toString('hex'), '02000400');
  assert.strictEqual(seg.subarray(80, 84).toString('hex'), '06010000');
});

test('#1b 每一格单独绑宏: 只有 cell*4..+3 非零 (其余除 aa55 全零)', () => {
  for (let k = P.MIN_CELL; k <= P.MAX_CELL; k++) {
    const seg = P.buildKeymap({ overrides: [{ cell: k, action: 'macro', slot: 7, mode: 1, loop: 9 }] });
    for (let i = 0; i < 638; i++) {
      const inCell = i >= k * 4 && i < k * 4 + 4;
      if (!inCell && seg[i]) assert.fail(`cell ${k}: 偏移 ${i} 被写入 ${seg[i]}`);
    }
    assert.strictEqual(seg.subarray(k * 4, k * 4 + 4).toString('hex'), '06070109', `cell ${k}`);
  }
});

test('#1c protocol 不再导出 bindPos', () => {
  assert.strictEqual(P.bindPos, undefined);
});

// ---------- #2 滞留应答 / 状态位 ----------
function fakeTransport(getImpl) {
  const { HidTransport } = require('../main/hid-transport');
  const t = new HidTransport('fake');
  t.sent = [];
  t.dev = {
    sendFeatureReport: (p) => { t.sent.push(Buffer.from(p)); },
    getFeatureReport: () => getImpl(t),
    close: () => {}
  };
  return t;
}
const NO_SLEEP = { sleep: async () => {} };
const healthyReply = t => { const last = t.sent[t.sent.length - 1]; const r = Buffer.alloc(65); r[1] = last[1]; r[2] = last[2]; r[4] = 1; return [...r]; };

test('#2 设备只回显 SET 内容时, 写会话必须在 preflight 熔断', async () => {
  const t = fakeTransport(t => [...t.sent[t.sent.length - 1]]);
  await assert.rejects(P.runKeymapSession(t, P.buildKeymap({ overrides: [] }), NO_SLEEP), e => e.step === 'preflight');
  assert.strictEqual(t.sent.length, 1, '熔断后不得再发包');
});

test('#2b 滞留 1 次后返回真应答: 传输层重读拿到真应答, 会话成功', async () => {
  let n = 0;
  const t = fakeTransport(t => (n++ % 2 === 0 ? [...t.sent[t.sent.length - 1]] : healthyReply(t)));
  const r = await P.runKeymapSession(t, P.buildKeymap({ overrides: [] }), NO_SLEEP);
  assert.ok(r.ok);
});

test('#2c 写路径应答 [4]=ff (非 01) 必须熔断 (begin 步)', async () => {
  const t = fakeTransport(t => { const r = healthyReply(t); if (t.sent[t.sent.length - 1][2] === 0xab) r[4] = 0xff; return r; });
  await assert.rejects(P.runKeymapSession(t, P.buildKeymap({ overrides: [] }), NO_SLEEP), e => e.step === 'begin' && /状态位/.test(e.message));
});

test('#2d 心跳 [4]=ff 一次后恢复 01: 重试放行; 连续 3 次: 熔断', async () => {
  let hb = 0;
  const t = fakeTransport(t => { const r = healthyReply(t); if (t.sent[t.sent.length - 1][2] === 0x18 && hb++ === 0) r[4] = 0xff; return r; });
  assert.ok((await P.runKeymapSession(t, P.buildKeymap({ overrides: [] }), NO_SLEEP)).ok);
  const t2 = fakeTransport(t => { const r = healthyReply(t); if (t.sent[t.sent.length - 1][2] === 0x18) r[4] = 0xff; return r; });
  await assert.rejects(P.runKeymapSession(t2, P.buildKeymap({ overrides: [] }), NO_SLEEP), e => e.step === 'preflight');
  assert.strictEqual(t2.sent.length, 3, '心跳最多 3 次, 不进入写阶段');
});

test('#2e 金样会话里真实的应答全部能通过校验 (防误熔断)', () => {
  const G = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'golden-default.json'), 'utf8'));
  const steps = G.steps || [];
  let checked = 0;
  for (let i = 0; i + 1 < steps.length; i++) {
    const a = steps[i], b = steps[i + 1];
    if (a.op !== 'SET' || b.op !== 'GET' || !a.hex.startsWith('0004')) continue;
    const cmd = parseInt(a.hex.slice(4, 6), 16);
    const r = Buffer.from(b.hex, 'hex');
    P.verifyResp(r, cmd, 'golden', { alive: cmd !== 0x18 });
    checked++;
  }
  if (steps.length) assert.ok(checked > 0, '金样里没有可校验的 SET/GET 对');
});

// ---------- #8 导入校验 ----------
test('#8 导入: 非法 cell/action 在导入时就报错; 非法 name 抛 BAD_NAME', () => {
  const { ConfigStore } = require('../main/config-store');
  const s = new ConfigStore(fs.mkdtempSync(path.join(os.tmpdir(), 'gm108-')));
  assert.throws(() => s.importText(JSON.stringify({ schema: 1, name: 'ok', overrides: [{ cell: 999, action: 'disable' }] })), /越界/);
  assert.throws(() => s.importText(JSON.stringify({ schema: 1, name: 'ok', overrides: [{ cell: 5, action: 'boom' }] })), /未知动作/);
  assert.throws(() => s.importText(JSON.stringify({ schema: 1, name: 'ok', overrides: [{ cell: 5, action: 'disable' }, { cell: 5, action: 'disable' }] })), /重复/);
  assert.throws(() => s.importText(JSON.stringify({ schema: 1, name: '../evil', overrides: [] })), e => e.code === 'BAD_NAME');
  assert.throws(() => s.importText('not json'), /JSON/);
  const ok = s.importText(JSON.stringify({ schema: 1, name: '正常', overrides: [{ cell: 92, action: 'disable' }] }));
  assert.strictEqual(ok.name, '正常');
});

// ---------- #9 entrySig 单一实现 ----------
test('#9 渲染层与主进程使用同一份 entrySig', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
  assert.ok(/const entrySig = window\.entrySig;/.test(src), '渲染层应使用 window.entrySig');
  assert.ok(!/=> o\.action === 'remap' \? `r:/.test(src), '渲染层不应再保留副本');
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.ok(html.indexOf('entry-sig.js') > -1 && html.indexOf('entry-sig.js') < html.indexOf('app.js'), 'index.html 必须先加载 entry-sig.js');
  assert.strictEqual(P.entrySig, require('../renderer/entry-sig').entrySig);
});

// ---------- #10 #11 #12 打包与测试脚本 ----------
test('#10-12 package.json: --publish never / 跑全部测试 / 版本与 allowScripts 一致', () => {
  const pkg = require('../package.json');
  assert.match(pkg.scripts.dist, /--publish never/);
  assert.ok(!/\\/.test(pkg.scripts.test), 'test 脚本不应含反斜杠');
  for (const f of fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js'))) assert.ok(pkg.scripts.test.includes(f), `npm test 未包含 ${f}`);
  assert.ok(pkg.allowScripts[`node-hid@${pkg.dependencies['node-hid']}`], 'node-hid 版本应与 allowScripts 一致');
});

// ---------- #22 字母键 hid ----------
test('#22 keyboard-layout: 26 个字母键 hid = 4..29', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'keyboard-layout.js'), 'utf8');
  const win = {};
  new Function('window', src)(win);
  for (let c = 65; c <= 90; c++) {
    const L = String.fromCharCode(c);
    const k = win.KEYBOARD.find(x => x.l === L);
    assert.ok(k, `缺少键 ${L}`);
    assert.strictEqual(k.hid, 4 + c - 65, `键 ${L}`);
  }
});
