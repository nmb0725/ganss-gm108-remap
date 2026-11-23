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

test('宏段头包与金样一致 (15: 13块, 17: 1块)', () => {
  const mk = c => { const b = Buffer.alloc(65); Buffer.from(c).copy(b, 1); return b.toString('hex'); };
  assert.strictEqual(mk(P.CMD.macroHeader), GOLDEN_MACRO.header15);
  assert.strictEqual(mk(P.CMD.macroCount), GOLDEN_MACRO.header17);
});

test('宏绑定: 键位格 = 06 <槽号> 00 00 (金样锚 ctrl5 → 06 05)', () => {
  const seg = P.buildKeymap({ overrides: [{ cell: 40, action: 'macro', slot: 5, target: 'ctrl5' }] });
  assert.strictEqual(seg.subarray(40 * 4, 40 * 4 + 4).toString('hex'), '06050000');
  assert.throws(() => P.buildKeymap({ overrides: [{ cell: 40, action: 'macro', slot: 100 }] }), /槽号无效/);
});

test('宏库构建校验: 槽号/步骤/间隔/溢出 拒绝', () => {
  assert.throws(() => P.buildMacroSegments([{ slot: 100, steps: [S(4, 1, 0)] }]), /槽号越界/);
  assert.throws(() => P.buildMacroSegments([{ slot: 1, steps: [S(4, 1, 0)] }, { slot: 1, steps: [S(5, 1, 0)] }]), /槽号重复/);
  assert.throws(() => P.buildMacroSegments([{ slot: 2, steps: [] }]), /没有步骤/);
  assert.throws(() => P.buildMacroSegments([{ slot: 2, steps: [S(0, 1, 0)] }]), /键无效/);
  assert.throws(() => P.buildMacroSegments([{ slot: 2, steps: [S(4, 1, 65536)] }]), /间隔无效/);
  const big = [{ slot: 0, steps: Array(60).fill(S(4, 1, 100)) }];
  assert.throws(() => P.buildMacroSegments(big), /溢出/);
});

test('空宏库: 15段全零+aa55, 17段计数0', () => {
  const { seg15, seg17 } = P.buildMacroSegments([]);
  assert.strictEqual(seg15.length, 832);
  assert.strictEqual(seg15.subarray(0, 830).every(b => !b), true);
  assert.strictEqual(seg15.readUInt16LE(830), 0x55aa);
  assert.strictEqual(seg17[0], 0);
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

test('宏库存档: MacroStore 读写/缺省空', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ganss-macro-'));
  const ms = new CS.MacroStore(path.join(dir, 'macros.json'));
  assert.deepStrictEqual(ms.load(), []); // 文件不存在 => 空库
  ms.save(MACRO_LIB);
  assert.deepStrictEqual(ms.load(), MACRO_LIB);
});
