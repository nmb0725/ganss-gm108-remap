'use strict';
// 协议层单测: 金样逐字节复现 + 会话时序 + 熔断行为。node --test test/
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const P = require('../main/protocol');
const CS = require('../main/config-store');

const fix = n => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'));
const GOLDEN_DEFAULT = fix('golden-default.json');
const GOLDEN_DISABLE = fix('golden-disable-win.json');
const blocksHex = buf => {
  const out = [];
  for (let i = 0; i < 10; i++) out.push(buf.subarray(i * 64, (i + 1) * 64).toString('hex'));
  return out;
};

test('全默认配置的键位段必须逐字节复现金样会话', () => {
  assert.deepStrictEqual(blocksHex(P.buildKeymap(CS.factoryDefault())), GOLDEN_DEFAULT.blocks);
});

test('禁用左Win(cell 92) 必须复现老软件抓包 (块5@48=05 03)', () => {
  const cfg = { schema: 1, name: 't', overrides: [{ cell: 92, action: 'disable' }] };
  assert.deepStrictEqual(blocksHex(P.buildKeymap(cfg)), GOLDEN_DISABLE.blocks);
});

test('04 11 头包与金样一致', () => {
  const want = Buffer.from(GOLDEN_DEFAULT.header, 'hex'); // 含报告ID 00 的完整 65B
  const got = Buffer.alloc(65);
  Buffer.from(P.CMD.keymapHeader).copy(got, 1); // 模拟 transport 封包
  assert.ok(got.equals(want), '头包差异');
});

test('改键: wire = 02 00 <hid> 00 (实测锚: 菜单键cell97→A(4) = 02000400, cap_remap2.log 会话#4)', () => {
  const seg = P.buildKeymap({ overrides: [{ cell: 97, action: 'remap', target: '菜单键→A', hid: 4 }] });
  assert.strictEqual(seg.subarray(97 * 4, 97 * 4 + 4).toString('hex'), '02000400');
  const seg2 = P.buildKeymap({ overrides: [{ cell: 79, action: 'remap', target: 'N→Z', hid: 29 }] });
  assert.strictEqual(seg2.subarray(79 * 4, 79 * 4 + 4).toString('hex'), '02001d00');
});

test('改键: 修饰键走标准 HID 修饰位 (实测锚 cap_modifier*.log)', () => {
  const cases = [
    [113, 225, '02020000'], // ScrLk→左Shift: 1<<(0xE1-0xE0)=0x02
    [115, 226, '02040000'], // →左Alt 0x04
    [116, 227, '02080000'], // Ins→左Win 0x08
    [95, 228, '02100000'],  // 右Alt→右Ctrl 0x10
    [117, 229, '02200000'], // Home→右Shift 0x20
    [118, 230, '02400000'], // PgUp→右Alt 0x40
    [91, 224, '02010000'],  // →左Ctrl 0x01 (位表推断, 其余7位全实测)
    [120, 44, '02002c00'],  // End→空格 usage 0x2C
    [121, 82, '02005200'],  // PgDn→↑ usage 0x52
    [119, 101, '02006500']  // Del→菜单 usage 0x65
  ];
  for (const [cell, hid, want] of cases) {
    const seg = P.buildKeymap({ overrides: [{ cell, action: 'remap', target: 't', hid }] });
    assert.strictEqual(seg.subarray(cell * 4, cell * 4 + 4).toString('hex'), want, `cell${cell} hid${hid}`);
  }
});

test('改键: 组合键与纯修饰键新格式 {mod,hid} (组合位为线格式扩展, 未经抓包)', () => {
  const cases = [
    [56, { mod: 0x01, hid: 4 }, '02010400'],   // Ctrl+A
    [57, { mod: 0x02, hid: 62 }, '02023e00'],  // Shift+F5 (F5 usage=0x3E)
    [58, { mod: 0x05, hid: 76 }, '02054c00'],  // Ctrl+Alt+Del
    [59, { mod: 0x10 }, '02100000'],           // 纯右Ctrl (新写法)
    [60, { mod: 0x08, hid: 44 }, '02082c00']   // Win+空格
  ];
  for (const [cell, o, want] of cases) {
    const seg = P.buildKeymap({ overrides: [{ cell, action: 'remap', target: 't', ...o }] });
    assert.strictEqual(seg.subarray(cell * 4, cell * 4 + 4).toString('hex'), want, `cell${cell}`);
  }
});

test('改键: 目标缺失/越界拒绝下发', () => {
  assert.throws(() => P.buildKeymap({ overrides: [{ cell: 56, action: 'remap', target: 57 }] }), /为空/);
  assert.throws(() => P.buildKeymap({ overrides: [{ cell: 56, action: 'remap', hid: 0 }] }), /无效/);
  assert.throws(() => P.buildKeymap({ overrides: [{ cell: 56, action: 'remap', hid: 256 }] }), /无效/);
  assert.throws(() => P.buildKeymap({ overrides: [{ cell: 56, action: 'remap', mod: 256 }] }), /修饰位无效/);
});

test('鼠标/多媒体/连击: 实测锚 (cap_features.log 2026-11-23)', () => {
  const cases = [
    [{ cell: 113, action: 'mouse', button: 'left' }, '01010100'],        // ScrLk=鼠标左
    [{ cell: 97, action: 'mouse', button: 'right' }, '01010200'],        // 鼠标右
    [{ cell: 97, action: 'mouse', button: 'middle' }, '01010400'],       // 鼠标中
    [{ cell: 116, action: 'mouse', button: 'back' }, '01010800'],        // 后退
    [{ cell: 119, action: 'mouse', button: 'forward' }, '01011000'],     // 前进
    [{ cell: 95, action: 'mouse', button: 'wheel-up' }, '01030100'],     // 滚轮上
    [{ cell: 98, action: 'mouse', button: 'wheel-down' }, '0103ff00'],   // 滚轮下
    [{ cell: 112, action: 'media', usage: 0xea }, '03ea0000'],           // 音量-
    [{ cell: 15, action: 'combo', keys: [4, 5, 6] }, '07040506']         // 连击 A B C
  ];
  for (const [o, want] of cases) {
    const seg = P.buildKeymap({ overrides: [o] });
    assert.strictEqual(seg.subarray(o.cell * 4, o.cell * 4 + 4).toString('hex'), want, JSON.stringify(o));
  }
});

test('鼠标/多媒体/连击: 非法参数拒绝下发', () => {
  assert.throws(() => P.buildKeymap({ overrides: [{ cell: 90, action: 'mouse', button: 'nope' }] }), /鼠标功能无效/);
  assert.throws(() => P.buildKeymap({ overrides: [{ cell: 90, action: 'media', usage: 0 }] }), /usage 无效/);
  assert.throws(() => P.buildKeymap({ overrides: [{ cell: 90, action: 'combo', keys: [] }] }), /1\.\.3/);
  assert.throws(() => P.buildKeymap({ overrides: [{ cell: 90, action: 'combo', keys: [4, 5, 6, 7] }] }), /1\.\.3/);
});

test('格号越界拒绝', () => {
  for (const c of [0, 144, 159]) assert.throws(() => P.buildKeymap({ overrides: [{ cell: c, action: 'disable' }] }), /越界/);
});

// ---- FakeDev: 模拟设备 (healthy/noresp/garbage/halfdead) ----
class FakeDev {
  constructor(mode = 'healthy') { this.mode = mode; this.sent = []; this.closed = false; }
  set(b) { this.sent.push(Buffer.from(b)); }
  get() {
    const last = this.sent[this.sent.length - 1];
    if (this.mode === 'noresp') return null;
    if (this.mode === 'garbage') return Buffer.alloc(65);
    const alive = this.mode === 'halfdead' ? 0 : 1;
    const r = Buffer.alloc(65);
    r[1] = last[0]; r[2] = last[1]; r[4] = alive;
    if (last[1] === 0x11) r[9] = 10;
    if (last[1] === 0x02) { r[5] = 0x5c; r[6] = 0x03; }
    return r;
  }
  close() { this.closed = true; }
}

const RNG = () => Buffer.alloc(64, 0x77);
const NO_SLEEP = async () => {};

test('健康设备: 会话下发时序 (16 个 SET, 全部走 verify)', async () => {
  const dev = new FakeDev();
  const r = await P.runKeymapSession(dev, P.buildKeymap(CS.factoryDefault()), { sleep: NO_SLEEP, rng: RNG });
  assert.ok(r.ok);
  assert.strictEqual(dev.sent.length, 17); // hb ab rand 02 11 + 10块 + 02 hb
  const tag = i => dev.sent[i][1]; // 命令字节 (数据块为 0x00)
  assert.deepStrictEqual([tag(0), tag(1), tag(3), tag(4), tag(15), tag(16)], [0x18, 0xab, 0x02, 0x11, 0x02, 0x18]);
  assert.strictEqual(dev.sent[2].length, 64);            // 随机挑战块
  for (let i = 5; i < 15; i++) assert.strictEqual(tag(i), 0x00); // 10 个数据块
  assert.deepStrictEqual(blocksHex(Buffer.concat(dev.sent.slice(5, 15))), GOLDEN_DEFAULT.blocks);
});

test('熔断: 无应答 => preflight 即止, 之前只发过 1 包', async () => {
  const dev = new FakeDev('noresp');
  await assert.rejects(P.runKeymapSession(dev, P.buildKeymap(CS.factoryDefault()), { sleep: NO_SLEEP, rng: RNG }),
    e => e.name === 'ProtocolAbort' && e.step === 'preflight');
  assert.strictEqual(dev.sent.length, 1);
  assert.ok(dev.closed, '必须已 close 设备');
});

test('熔断: 应答全零垃圾 => 拒绝进入写阶段', async () => {
  const dev = new FakeDev('garbage');
  await assert.rejects(P.runKeymapSession(dev, P.buildKeymap(CS.factoryDefault()), { sleep: NO_SLEEP, rng: RNG }),
    e => e.step === 'preflight');
  assert.strictEqual(dev.sent.length, 1);
});

test('熔断: 应答不回显命令(乱码) => preflight 即止', async () => {
  class JunkDev extends FakeDev {
    get() { if (this.mode === 'junk') { const r = Buffer.alloc(65); r[1] = 0x99; return r; } return super.get(); }
  }
  const dev = new JunkDev('junk');
  await assert.rejects(P.runKeymapSession(dev, P.buildKeymap(CS.factoryDefault()), { sleep: NO_SLEEP, rng: RNG }),
    e => /回显异常/.test(e.message));
  assert.strictEqual(dev.sent.length, 1);
});

test('心跳应答无回显(真死机) => preflight 即止', async () => {
  class DeadEcho extends FakeDev {
    get() { const r = Buffer.alloc(65); return this.mode === 'hbdead' && this.sent.length === 1 ? r : super.get(); }
  }
  const dev = new DeadEcho('hbdead');
  await assert.rejects(P.runKeymapSession(dev, P.buildKeymap(CS.factoryDefault()), { sleep: NO_SLEEP, rng: RNG }),
    e => e.step === 'preflight');
  assert.strictEqual(dev.sent.length, 1);
});

// ---- 配置存档 ----
test('配置档: 保存/读取/列表/导入导出 + 差异计算', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ganss-cfg-'));
  const store = new CS.ConfigStore(dir);
  let cfg = CS.factoryDefault('我的配置');
  CS.setCell(cfg, 92, 'disable');
  CS.setCell(cfg, 55, 'disable');
  CS.setCell(cfg, 55, 'default'); // 撤销
  store.save(cfg);
  assert.deepStrictEqual(store.list(), ['我的配置']);
  const back = store.load('我的配置');
  assert.deepStrictEqual(back.overrides, [{ cell: 92, action: 'disable' }]);
  assert.strictEqual(CS.computeDiff(back).length, 1);
  const round = store.importText(store.exportText(back));
  assert.deepStrictEqual(round, back);
  assert.throws(() => store.importText('{"schema":99}'), /不兼容/);
});

// ---- 宏 ----
const GOLDEN_MACRO = fix('golden-macro.json');
// 金样宏库 = 老软件 gkdb 的 10 个宏 (VK→HID usage 换算; DB 里 GROUPR 尾部失效的 3,3000 行不计, 与 StepCount=5 一致)
const S = (hid, down, delay) => ({ hid, down, delay });
const MACRO_LIB = [
  { slot: 0, name: 'eee', steps: [S(0x08, 1, 0), S(0x08, 0, 180)] },
  { slot: 1, name: 'ctrrrl1', steps: [S(0xe0, 1, 34), S(0x1e, 1, 210), S(0xe0, 0, 24), S(0x1e, 0, 0)] },
  { slot: 2, name: 'ctrl2', steps: [S(0xe0, 1, 35), S(0x1f, 1, 173), S(0x1f, 0, 7), S(0xe0, 0, 0)] },
  { slot: 3, name: 'ctrl3', steps: [S(0xe0, 1, 28), S(0x20, 1, 95), S(0x20, 0, 28), S(0xe0, 0, 0)] },
  { slot: 4, name: 'ctrl4', steps: [S(0xe0, 1, 38), S(0x21, 1, 84), S(0x21, 0, 9), S(0xe0, 0, 0)] },
  { slot: 5, name: 'ctrl5', steps: [S(0xe0, 1, 10), S(0x22, 1, 84), S(0x22, 0, 11), S(0xe0, 0, 0)] },
  { slot: 6, name: '6soundstart', steps: [S(0x2b, 1, 5), S(0x2b, 0, 900), S(0x14, 1, 5), S(0x14, 0, 1600), S(0x35, 1, 5), S(0x35, 0, 900), S(0x2b, 1, 5), S(0x2b, 0, 0)] },
  { slot: 7, name: 'GROUPR', steps: [S(0xe0, 1, 100), S(0x15, 1, 50), S(0x15, 0, 0)] },
  { slot: 8, name: 'Groupr1', steps: [S(0xe4, 1, 100), S(0x15, 1, 50), S(0x15, 0, 0)] },
  { slot: 9, name: 'RRR holding', steps: [S(0x15, 1, 1000), S(0x15, 0, 1000), S(0x15, 1, 1000), S(0x15, 0, 0)] }
];
const macroBlocks = buf => {
  const out = [];
  for (let i = 0; i < 13; i++) out.push(buf.subarray(i * 64, (i + 1) * 64).toString('hex'));
  return out;
};

test('宏库段: 10 个金样宏必须逐字节复现老软件 04 15 / 04 17 段', () => {
  const { seg15, seg17 } = P.buildMacroSegments(MACRO_LIB);
  assert.deepStrictEqual(macroBlocks(seg15), GOLDEN_MACRO.blocks15);
  assert.strictEqual(seg17.toString('hex'), GOLDEN_MACRO.blocks17[0]);
});

// 把抓到的 04 15 段解码成宏库 (事件后第一条延时并入该事件的 delay, 其余延时为独立 {wait} 步骤)
const MOUSE_BY_BIT = { 1: 'left', 2: 'right', 4: 'middle', 8: 'back', 16: 'forward' };
function decodeMacroSeg(seg) {
  const lib = [];
  for (let slot = 0; slot < 100; slot++) {
    const p = seg.readUInt32LE(slot * 4);
    if (!p) continue;
    const n = seg.readUInt32LE(p), steps = [];
    for (let k = 0; k < n; k++) {
      const r = seg.readUInt32LE(p + 8 + 4 * k), t = r >>> 28, code = (r >>> 16) & 0xff;
      const prev = steps[steps.length - 1];
      if (t === 5) {
        const ms = r & 0x0fffffff;
        if (prev && prev.wait == null && prev.delay === 0) prev.delay = ms; else steps.push({ wait: ms });
      } else if (t === 0xb || t === 3) steps.push({ hid: code, down: t === 0xb ? 1 : 0, delay: 0 });
      else if (t === 9 || t === 1) steps.push({ mouse: MOUSE_BY_BIT[code], down: t === 9 ? 1 : 0, delay: 0 });
      else if (t === 2) steps.push({ mouse: code === 0xff ? 'wheel-down' : 'wheel-up', down: 1, delay: 0 });
      else throw new Error('未知记录类型 ' + r.toString(16));
    }
    lib.push({ slot, name: 's' + slot, steps });
  }
  return lib;
}

test('宏库段: cap_m_size.log 12 个状态 (9..17 块, 槽号不连续, 连续延时) 逐字节复现', () => {
  const G = fix('golden-macro-size.json');
  assert.strictEqual(G.segments.length, 12);
  for (const g of G.segments) {
    const want = Buffer.from(g.hex, 'hex');
    const { seg15, seg17, blocks } = P.buildMacroSegments(decodeMacroSeg(want));
    assert.strictEqual(blocks, g.blocks);
    assert.ok(seg15.equals(want), `块数 ${g.blocks} 的状态与抓包不一致`);
    assert.strictEqual(seg17[0], 0x0a);
  }
});

test('宏段块数 = ceil(数据末尾/64)+1; 超过实测上限拒绝', () => {
  assert.strictEqual(P.macroBlocksFor(576), 10); // 边界: 恰好 64 的倍数 (cap_m_size.log)
  assert.strictEqual(P.macroBlocksFor(760), 13);
  assert.strictEqual(P.macroBlocksFor(1016), 17);
  assert.throws(() => P.buildMacroSegments([{ slot: 0, steps: Array(80).fill(S(4, 1, 100)) }]), /溢出/);
});

test('宏段头包与金样一致 (15: 13块, 17: 1块)', () => {
  const mk = c => { const b = Buffer.alloc(65); Buffer.from(c).copy(b, 1); return b.toString('hex'); };
  assert.strictEqual(mk(P.macroHeaderFor(13)), GOLDEN_MACRO.header15);
  assert.strictEqual(mk(P.CMD.macroCount), GOLDEN_MACRO.header17);
});

test('宏绑定: 位于 cell*4, 4字节 = 06 <槽> <mode> <次数> (cap_bindmap*.log 完整 64B 解析; 旧 bindPos 为解析 bug)', () => {
  const seg = P.buildKeymap({ overrides: [{ cell: 40, action: 'macro', slot: 5, target: 'ctrl5' }] });
  assert.strictEqual(seg.subarray(160, 164).toString('hex'), '06050000'); // mode0=播放一次
  assert.strictEqual(seg.subarray(156, 160).toString('hex'), '00000000'); // 前一格不受影响
  // 三模式 (cap_mouse_mode.log): mode1 后跟 1..255 次数; mode2=再按键时停止
  const s1 = P.buildKeymap({ overrides: [{ cell: 1, action: 'macro', slot: 3, mode: 1, loop: 200 }] });
  assert.strictEqual(s1.subarray(4, 8).toString('hex'), '060301c8');
  const s2 = P.buildKeymap({ overrides: [{ cell: 1, action: 'macro', slot: 3, mode: 2 }] });
  assert.strictEqual(s2.subarray(4, 8).toString('hex'), '06030200');
  // 同一格出现两条 => 拒绝 (旧实现"绑定覆盖格字节"的排序 hack 已删除)
  assert.throws(() => P.buildKeymap({ overrides: [{ cell: 16, action: 'macro', slot: 2 }, { cell: 16, action: 'disable' }] }), /格号重复/);
  assert.throws(() => P.buildKeymap({ overrides: [{ cell: 40, action: 'macro', slot: 100 }] }), /槽号无效/);
  assert.throws(() => P.buildKeymap({ overrides: [{ cell: 40, action: 'macro', slot: 1, mode: 3 }] }), /播放模式无效/);
  assert.throws(() => P.buildKeymap({ overrides: [{ cell: 40, action: 'macro', slot: 1, mode: 1, loop: 0 }] }), /循环次数无效/);
  assert.throws(() => P.buildKeymap({ overrides: [{ cell: 40, action: 'macro', slot: 1, mode: 1, loop: 256 }] }), /循环次数无效/);
});

test('宏绑定金样: cap_bindmap5.log 42 个绑定必须逐字节复现 (golden-bindmap.json)', () => {
  const G = fix('golden-bindmap.json');
  const want = Buffer.from(G.blocks.join(''), 'hex');
  const overrides = [];
  for (let c = 1; c <= 143; c++) {
    const q = want.subarray(c * 4, c * 4 + 4);
    if (!q.some(b => b)) continue;
    assert.strictEqual(q[0], 0x06, `格 ${c} 不是宏绑定记录: ${q.toString('hex')}`);
    overrides.push({ cell: c, action: 'macro', slot: q[1], mode: q[2], ...(q[2] === 1 ? { loop: q[3] } : {}) });
  }
  assert.strictEqual(overrides.length, 42);
  assert.ok(P.buildKeymap({ overrides }).equals(want), '与金样不一致');
});

test('宏库构建校验: 槽号/步骤/间隔/溢出 拒绝', () => {
  assert.throws(() => P.buildMacroSegments([{ slot: 100, steps: [S(4, 1, 0)] }]), /槽号越界/);
  assert.throws(() => P.buildMacroSegments([{ slot: 1, steps: [S(4, 1, 0)] }, { slot: 1, steps: [S(5, 1, 0)] }]), /槽号重复/);
  assert.throws(() => P.buildMacroSegments([{ slot: 2, steps: [] }]), /没有步骤/);
  assert.throws(() => P.buildMacroSegments([{ slot: 2, steps: [S(0, 1, 0)] }]), /键无效/);
  assert.throws(() => P.buildMacroSegments([{ slot: 2, steps: [S(4, 1, 1000000000)] }]), /间隔无效/);
  const big = [{ slot: 0, steps: Array(80).fill(S(4, 1, 100)) }];
  assert.throws(() => P.buildMacroSegments(big), /溢出/);
});

test('空宏库: 8 块 (512B) 全零 + aa55, 04 17 首字节 0x0a (cap_m_size.log 末段 14:07:48 实测)', () => {
  const { seg15, seg17, blocks } = P.buildMacroSegments([]);
  assert.strictEqual(blocks, 8);
  assert.strictEqual(seg15.length, 512);
  assert.strictEqual(seg15.subarray(0, 510).every(b => !b), true);
  assert.strictEqual(seg15.readUInt16LE(510), 0x55aa);
  assert.strictEqual(seg17[0], 0x0a);
});

test('宏写入会话时序: hb f0 | 17会话(6 SET) | 15会话(18 SET) | hb; f0 无 GET', async () => {
  class CountDev extends FakeDev { constructor() { super(); this.gets = 0; } get() { this.gets++; return super.get(); } }
  const dev = new CountDev();
  const { seg15, seg17 } = P.buildMacroSegments(MACRO_LIB);
  const r = await P.runMacroWriteSession(dev, seg15, seg17, { sleep: NO_SLEEP, rng: RNG });
  assert.ok(r.ok);
  assert.strictEqual(dev.sent.length, 27); // 1 + 6 + 18 + 1 + 1... hb(1) f0(1) s17(ab rand 02 17 blk 02 =6) s15(ab rand 02 15 13blk 02 =18) hb(1)
  const tag = i => dev.sent[i][1];
  assert.deepStrictEqual([tag(0), tag(1), tag(2), tag(4), tag(5), tag(7), tag(8), tag(10), tag(11), tag(25), tag(26)],
    [0x18, 0xf0, 0xab, 0x02, 0x17, 0x02, 0xab, 0x02, 0x15, 0x02, 0x18]);
  assert.strictEqual(dev.sent[6].toString('hex'), GOLDEN_MACRO.blocks17[0]); // 17 数据块
  assert.deepStrictEqual(macroBlocks(Buffer.concat(dev.sent.slice(12, 25))), GOLDEN_MACRO.blocks15);
  assert.strictEqual(dev.gets, 10); // f0 不读: 1 + 4 + 4 + 1
});

test('宏会话熔断: 无应答 => preflight 即止', async () => {
  const dev = new FakeDev('noresp');
  const { seg15, seg17 } = P.buildMacroSegments(MACRO_LIB);
  await assert.rejects(P.runMacroWriteSession(dev, seg15, seg17, { sleep: NO_SLEEP, rng: RNG }),
    e => e.name === 'ProtocolAbort' && e.step === 'preflight');
  assert.strictEqual(dev.sent.length, 1);
  assert.ok(dev.closed);
});

test('宏段鼠标事件: 与键事件同构 <位> <cmd> <lo> <hi> [00 50 00 00] (cap_mouse_macro.log 槽10 完整解析)', () => {
  const M = (mouse, down, delay = 5) => ({ mouse, down, delay });
  // 槽10 金样(完整 64B 解析)从"左键松开"起的事件流; 开头的"左键按下"在老软件里带了两段延时, 本工具合并延时, 故从第 2 个事件起比对
  const CAP = '000001100500005000000290050000500000021005000050000004900500005000000410050000500000089005000050' +
    '000008100500005000001090050000500000101005000050000001200500005000' + '00ff2005000050';
  const steps = [M('left', 0), M('right', 1), M('right', 0), M('middle', 1), M('middle', 0),
    M('back', 1), M('back', 0), M('forward', 1), M('forward', 0), M('wheel-up', 1), M('wheel-down', 1)];
  const { seg15 } = P.buildMacroSegments([{ slot: 0, name: 'mouse', steps }]);
  assert.strictEqual(seg15.readUInt32LE(400), 22); // 11 事件 + 11 延时
  assert.strictEqual(seg15.subarray(408, 408 + CAP.length / 2).toString('hex'), CAP);
  // 键/鼠混排: A按下(04 b0) 鼠标左键按下 松开, 无延时
  const { seg15: mix } = P.buildMacroSegments([{ slot: 0, name: 'x', steps: [S(0x04, 1, 0), { mouse: 'left', down: 1, delay: 0 }, { mouse: 'left', down: 0, delay: 0 }] }]);
  assert.strictEqual(mix.subarray(400, 422).toString('hex'), '03000000' + '00'.repeat(6) + '04b00000' + '01900000' + '0110' + '0000');
  assert.throws(() => P.buildMacroSegments([{ slot: 0, steps: [{ mouse: 'nope', down: 1, delay: 0 }] }]), /鼠标步骤无效/);
  assert.throws(() => P.buildMacroSegments([{ slot: 0, steps: [{ mouse: 'left', down: 1, delay: 1000000000 }] }]), /间隔无效/);
});

test('entrySig: 参数级变更可辨 (换目标/换槽号=变更, 仅改名=非变更)', () => {
  const S = P.entrySig;
  assert.notStrictEqual(S({ cell: 1, action: 'remap', mod: 0, hid: 4 }), S({ cell: 1, action: 'remap', mod: 0, hid: 5 }));
  assert.notStrictEqual(S({ cell: 1, action: 'remap', mod: 0, hid: 4 }), S({ cell: 1, action: 'remap', mod: 8, hid: 4 }));
  assert.notStrictEqual(S({ cell: 1, action: 'macro', slot: 0, target: '宏A' }), S({ cell: 1, action: 'macro', slot: 1, target: '宏A' }));
  assert.strictEqual(S({ cell: 1, action: 'macro', slot: 0, target: '宏A' }), S({ cell: 1, action: 'macro', slot: 0, target: '宏A改名' }));
  assert.notStrictEqual(S({ cell: 1, action: 'macro', slot: 0, mode: 0 }), S({ cell: 1, action: 'macro', slot: 0, mode: 1, loop: 5 }));
  assert.notStrictEqual(S({ cell: 1, action: 'macro', slot: 0, mode: 1, loop: 5 }), S({ cell: 1, action: 'macro', slot: 0, mode: 1, loop: 6 }));
  assert.strictEqual(S({ cell: 1, action: 'macro', slot: 0, mode: 0, loop: 5 }), S({ cell: 1, action: 'macro', slot: 0, mode: 0 })); // 非多次模式 loop 不算变更
  assert.strictEqual(S({ cell: 1, action: 'macro', slot: 0 }), S({ cell: 1, action: 'macro', slot: 0, mode: 0 })); // 缺省=mode0
  assert.notStrictEqual(S({ cell: 1, action: 'mouse', button: 'left' }), S({ cell: 1, action: 'mouse', button: 'right' }));
  assert.notStrictEqual(S({ cell: 1, action: 'media', usage: 233 }), S({ cell: 1, action: 'media', usage: 234 }));
  assert.notStrictEqual(S({ cell: 1, action: 'combo', keys: [4, 5] }), S({ cell: 1, action: 'combo', keys: [4, 6] }));
  assert.strictEqual(S({ cell: 1, action: 'disable' }), S({ cell: 2, action: 'disable' }));
});

test('宏库存档: MacroStore 读写/缺省空', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ganss-macro-'));
  const ms = new CS.MacroStore(path.join(dir, 'macros.json'));
  assert.deepStrictEqual(ms.load(), []); // 文件不存在 => 空库
  ms.save(MACRO_LIB);
  assert.deepStrictEqual(ms.load(), MACRO_LIB);
});

test('宏延时记录: u32LE = 0x50000000 | ms, 支持 >65535 (cap_m_delay2.log 槽11 实测)', () => {
  // 老软件 DLY 宏: A Dn, Delay 500, A Up, Delay 65536, Delay 1000000, Delay 99999999
  //   => 06000000 00000000 | 000004b0 f4010050 00000430 00000150 40420f50 ffe0f555
  const CAP = '0600000000000000' + '000004b0' + 'f4010050' + '00000430' + '00000150' + '40420f50' + 'ffe0f555';
  // 本工具每步只有一个"之后等待", 连续延时用多个 0 时长事件无法表达, 故分段验证每种长度的编码
  const one = ms => P.buildMacroSegments([{ slot: 0, steps: [S(0x04, 1, ms)] }]).seg15.subarray(408, 416).toString('hex');
  assert.strictEqual(one(500), '000004b0' + 'f4010050');
  assert.strictEqual(one(65536), '000004b0' + '00000150');
  assert.strictEqual(one(1000000), '000004b0' + '40420f50');
  assert.strictEqual(one(99999999), '000004b0' + 'ffe0f555');
  // 前半段 (A Dn 500, A Up 65536) 逐字节等于抓包
  const { seg15 } = P.buildMacroSegments([{ slot: 0, steps: [S(0x04, 1, 500), S(0x04, 0, 65536)] }]);
  assert.strictEqual(seg15.subarray(400, 424).toString('hex'), '0400000000000000' + CAP.slice(16, 48));
  // 超过单条上限 0x0FFFFFFF 时拆成多条
  const big = P.buildMacroSegments([{ slot: 0, steps: [S(0x04, 1, 0x0FFFFFFF + 5)] }]).seg15;
  assert.strictEqual(big.readUInt32LE(400), 3);
  assert.strictEqual(big.subarray(412, 420).toString('hex'), 'ffffff5f' + '05000050');
});

test('宏修饰键: 左Shift e1 / 左Alt e2 / 左Win e3 / 右Shift e5 / 右Alt e6 (cap_m_mods.log 槽12 实测)', () => {
  const st = [[0xe1, 1, 61], [0xe1, 0, 1445], [0xe2, 1, 90], [0xe2, 0, 1498], [0xe3, 1, 61], [0xe3, 0, 2668],
    [0xe5, 1, 61], [0xe5, 0, 1582], [0xe6, 1, 62], [0xe6, 0, 0]].map(([h, d, ms]) => S(h, d, ms));
  const CAP = ['0000e1b0', '3d000050', '0000e130', 'a5050050', '0000e2b0', '5a000050', '0000e230', 'da050050',
    '0000e3b0', '3d000050', '0000e330', '6c0a0050', '0000e5b0', '3d000050', '0000e530', '2e060050', '0000e6b0', '3e000050', '0000e630'];
  const { seg15 } = P.buildMacroSegments([{ slot: 0, name: 'MODS', steps: st }]);
  assert.strictEqual(seg15.subarray(400, 408 + CAP.length * 4).toString('hex'), '13000000' + '00000000' + CAP.join(''));
});

test('改键: 界面传来的 mod=0 (普通键 / 快捷键预设) 合法, 等同无修饰', () => {
  // 界面捕捉普通键时写 mod:0; 旧校验要求 1..255, 会让普通改键在保存/写入时报"修饰位无效"
  const seg = P.buildKeymap({ overrides: [{ cell: 97, action: 'remap', mod: 0, hid: 4, target: 'A' }, { cell: 113, action: 'remap', mod: 0, hid: 0x47, target: '亮度 −' }] });
  assert.strictEqual(seg.subarray(97 * 4, 97 * 4 + 4).toString('hex'), '02000400');
  assert.strictEqual(seg.subarray(113 * 4, 113 * 4 + 4).toString('hex'), '02004700');
  const mac = P.buildKeymap({ overrides: [{ cell: 97, action: 'remap', mod: 10, hid: 33, target: 'Cmd + Shift + 4' }] });
  assert.strictEqual(mac.subarray(97 * 4, 97 * 4 + 4).toString('hex'), '020a2100');
  assert.throws(() => P.buildKeymap({ overrides: [{ cell: 97, action: 'remap', mod: 0 }] }), /为空/);
});
