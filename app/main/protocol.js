'use strict';
// GM108 键位段(04 11)协议层: 纯函数 + 会话编排。不直接碰 HID, 设备由 transport 注入。
// 金样基线: test/fixtures/golden-*.json (由 probe/golden-extract.js 从老软件抓包提取)
const crypto = require('crypto');

const SEG_BYTES = 640;      // 10 块 x 64B
const N_BLOCKS = 10;
const BLOCK_BYTES = 64;
const MIN_CELL = 1, MAX_CELL = 143; // gkdb 证实有效 KeyIndex 范围; cell*4+4 <= 576 < 638, 不与 aa55 冲突
const DISABLE_BYTES = Buffer.from([0x05, 0x03, 0x00, 0x00]);

// 宏库段(04 15): 13块x64B=832B。布局(金样 golden_default.log 逐字节证实):
//   [0,400)   100 x u32LE 指针表(槽0..99, 值=数据区字节偏移, 0=未用)
//   [400,830) 数据区, 各宏入口按槽号升序紧密拼接
//   每入口 = count_u32LE + 6x00 + 事件流;  count = Σ(1 + (delay>0 ? 1 : 0))
//   事件 = <usage> <b0按下/30释放> <delay_u16LE>; delay>0 追加 00 50, 非末条再补 00 00 (整条8B)
//   [830,832) aa 55
const MACRO_SLOTS = 100;
const MACRO_POOL = 400;
const MACRO_SEG_BYTES = 832;
const MACRO_BLOCKS = 13;
const MAX_DELAY_MS = 65535;

const CMD = {
  hb: [0x04, 0x18],
  begin: [0x04, 0xab],
  status: [0x04, 0x02],
  keymapHeader: [0x04, 0x11, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, N_BLOCKS], // 金样: 6 个填充零, 块数在第 8 字节
  macroHeader: [0x04, 0x15, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, MACRO_BLOCKS],
  macroCount: [0x04, 0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 1],
  commit: [0x04, 0xf0] // 金样: 13段与17段之间发射一次, 无 GET (发射后不管)
};

class ProtocolAbort extends Error {
  constructor(step, reason) {
    super(`[${step}] ${reason}`);
    this.name = 'ProtocolAbort';
    this.step = step;
  }
}

// 配置对象 -> 640B 键位段. 配置形如 { overrides: [{cell, action, target}] }
function buildKeymap(config) {
  const buf = Buffer.alloc(SEG_BYTES);
  for (const o of (config && config.overrides) || []) {
    const cell = o.cell | 0;
    if (cell < MIN_CELL || cell > MAX_CELL) throw new ProtocolAbort('build', `格号越界: ${cell}`);
    if (o.action === 'default') continue;
    const at = cell * 4;
    if (o.action === 'disable') DISABLE_BYTES.copy(buf, at);
    else if (o.action === 'remap') {
      // 线格式(抓包解码, cap_modifier.log + cap_modifier3.log): 4字节 = 02 <修饰位> <HID usage> 00
      //   实测锚: 单普通键 byte[2]=usage (空格=02002c00, ↑=02005200, 菜单=02006500, A=02000400)
      //           单修饰键 byte[1]=1<<(usage-0xE0) (右Ctrl=02100000, 左Shift=02020000 等 10/10 吻合)
      //   组合键(两位同时非零, 如 Ctrl+A = 02 01 04 00)按 HID 语义自然扩展, 未经抓包证实, 错码只会错键
      let mod = 0, usage = 0;
      if (o.mod != null) {
        if (!Number.isInteger(o.mod) || o.mod < 1 || o.mod > 0xff) throw new ProtocolAbort('build', `改键目标修饰位无效: ${o.mod} (需 1..255)`);
        mod = o.mod;
      }
      if (o.hid != null) {
        if (Number.isInteger(o.hid) && o.hid >= 1 && o.hid <= 0xdf) usage = o.hid;
        // 兼容旧档: 纯修饰键用 hid=0xE0..0xE7 表示
        else if (Number.isInteger(o.hid) && o.hid >= 0xe0 && o.hid <= 0xe7 && !mod) mod = 1 << (o.hid - 0xe0);
        else throw new ProtocolAbort('build', `改键目标无效: hid=${o.hid} mod=${o.mod} (usage 需 1..223)`);
      }
      if (!mod && !usage) throw new ProtocolAbort('build', '改键目标为空 (需 mod 或 hid)');
      buf[at] = 0x02; buf[at + 1] = mod; buf[at + 2] = usage;
    }
    // 鼠标功能(cap_features.log 实测锚): 按键=01 01 <位> 00, 滚轮=01 03 <delta> 00
    else if (o.action === 'mouse') {
      const BTN = { left: 0x01, right: 0x02, middle: 0x04, back: 0x08, forward: 0x10 };
      if (BTN[o.button]) { buf[at] = 0x01; buf[at + 1] = 0x01; buf[at + 2] = BTN[o.button]; }
      else if (o.button === 'wheel-up') { buf[at] = 0x01; buf[at + 1] = 0x03; buf[at + 2] = 0x01; }
      else if (o.button === 'wheel-down') { buf[at] = 0x01; buf[at + 1] = 0x03; buf[at + 2] = 0xff; }
      else throw new ProtocolAbort('build', `鼠标功能无效: ${o.button}`);
    }
    // 多媒体键(实测锚 PrtSc=03 ea 00 00 = 音量-): 03 <usage低> <usage高> 00 (HID Consumer 页)
    else if (o.action === 'media') {
      if (!Number.isInteger(o.usage) || o.usage < 1 || o.usage > 0xffff) throw new ProtocolAbort('build', `多媒体 usage 无效: ${o.usage}`);
      buf[at] = 0x03; buf[at + 1] = o.usage & 0xff; buf[at + 2] = (o.usage >> 8) & 0xff;
    }
    // 连击键/组合序列(实测锚 V-=07 04 05 06 = A B C): 07 <键1> <键2> <键3>, 1..3 个 HID usage (修饰键 E0..E7 可作单格)
    else if (o.action === 'combo') {
      const keys = Array.isArray(o.keys) ? o.keys : [];
      if (keys.length < 1 || keys.length > 3) throw new ProtocolAbort('build', `连击键需 1..3 个键: ${JSON.stringify(o.keys)}`);
      buf[at] = 0x07;
      keys.forEach((k, i) => {
        if (!Number.isInteger(k) || k < 1 || (k > 0xdf && (k < 0xe0 || k > 0xe7))) throw new ProtocolAbort('build', `连击键无效: ${k}`);
        buf[at + 1 + i] = k;
      });
    }
    // 宏绑定(金样锚: FWMacro 槽5 的宏绑到键 = 06 05 00 00): 06 <槽号> 00 00
    else if (o.action === 'macro') {
      if (!Number.isInteger(o.slot) || o.slot < 0 || o.slot >= MACRO_SLOTS) throw new ProtocolAbort('build', `宏槽号无效: ${o.slot} (需 0..99)`);
      buf[at] = 0x06; buf[at + 1] = o.slot;
    }
    else throw new ProtocolAbort('build', `未知动作: ${o.action}`);
  }
  buf[638] = 0xaa; buf[639] = 0x55;
  return buf;
}

function splitBlocks(seg, n = N_BLOCKS, total = SEG_BYTES) {
  if (seg.length !== total) throw new ProtocolAbort('build', `段长度 ${seg.length} != ${total}`);
  const out = [];
  for (let i = 0; i < n; i++) out.push(Buffer.from(seg.subarray(i * BLOCK_BYTES, (i + 1) * BLOCK_BYTES)));
  return out;
}

// 宏库 [{slot, name, steps:[{hid, down, delay}]}] -> { seg15(832B), seg17(64B) }
// steps = 按下/释放事件序列, delay = 该事件之后的等待毫秒(0..65535)。宏名仅本工具展示用, 不上线。
function buildMacroSegments(library) {
  const seg = Buffer.alloc(MACRO_SEG_BYTES);
  const sorted = [...(library || [])].sort((a, b) => (a.slot | 0) - (b.slot | 0));
  const seen = new Set();
  let pool = MACRO_POOL;
  for (const m of sorted) {
    if (!Number.isInteger(m.slot) || m.slot < 0 || m.slot >= MACRO_SLOTS) throw new ProtocolAbort('macro', `槽号越界: ${m.slot} (需 0..99)`);
    if (seen.has(m.slot)) throw new ProtocolAbort('macro', `槽号重复: ${m.slot}`);
    seen.add(m.slot);
    const steps = Array.isArray(m.steps) ? m.steps : [];
    if (!steps.length) throw new ProtocolAbort('macro', `槽 ${m.slot} "${m.name || ''}" 没有步骤`);
    let count = 0, entryLen = 10;
    for (const s of steps) {
      if (!Number.isInteger(s.hid) || s.hid < 1 || (s.hid > 0xdf && (s.hid < 0xe0 || s.hid > 0xe7))) throw new ProtocolAbort('macro', `槽 ${m.slot} 键无效: ${s.hid}`);
      if (!Number.isInteger(s.delay) || s.delay < 0 || s.delay > MAX_DELAY_MS) throw new ProtocolAbort('macro', `槽 ${m.slot} 间隔无效 (需 0..${MAX_DELAY_MS}ms): ${s.delay}`);
      count += 1 + (s.delay > 0 ? 1 : 0);
      entryLen += 4 + (s.delay > 0 ? 4 : 0);
    }
    entryLen -= 2; // 金样: 入口尾部 2 个零字节被截断(末条 d0 => 2B, 末条 d>0 => 6B)
    if (pool + entryLen > MACRO_SEG_BYTES - 2) throw new ProtocolAbort('macro', `宏数据区溢出: 槽 ${m.slot} 需 ${entryLen}B, 仅剩 ${MACRO_SEG_BYTES - 2 - pool}B`);
    seg.writeUInt32LE(pool, m.slot * 4);
    let o = pool;
    seg.writeUInt32LE(count, o); o += 10; // count + 6 零
    for (const s of steps) {
      seg[o] = s.hid; seg[o + 1] = s.down ? 0xb0 : 0x30; seg.writeUInt16LE(s.delay, o + 2); o += 4;
      if (s.delay > 0) { seg[o] = 0x00; seg[o + 1] = 0x50; seg[o + 2] = 0; seg[o + 3] = 0; o += 4; }
    }
    while (o > pool + 10 && seg[o - 1] === 0x00) o--; // 截尾零 (cmd/usage 恒非零, 不会截过界)
    pool = o;
  }
  seg[MACRO_SEG_BYTES - 2] = 0xaa; seg[MACRO_SEG_BYTES - 1] = 0x55;
  const seg17 = Buffer.alloc(BLOCK_BYTES);
  seg17[0] = seen.size; // 金样: 10 个宏 => 0x0a
  seg17[62] = 0xaa; seg17[63] = 0x55;
  return { seg15: seg, seg17 };
}

const briefHex = r => Buffer.from(r.subarray(0, 8)).toString('hex').replace(/(..)/g, '$1 ');
// 应答校验: 唯一硬性要求 = 回显 04 <cmd>。
// 实测(2026-11-23 健康键盘只读轮询): 应答[4]字节在 00/ff/01 间随机波动, 不是存活位, 不得作为闸门。
// 变砖事故的病灶是"应答全零/无应答", 全零过不了回显检查 => 回显即足以熔断。
function verifyResp(r, cmdByte, step) {
  if (!r) throw new ProtocolAbort(step, '设备无应答 (GET 失败/超时), 已熔断');
  if (r.length < 3) throw new ProtocolAbort(step, `应答过短 (${r.length}B: ${briefHex(r)}), 已熔断`);
  if (r[1] !== 0x04 || r[2] !== cmdByte) throw new ProtocolAbort(step, `应答回显异常 (实际: ${briefHex(r)}…), 已熔断`);
  return r;
}

// 会话编排。dev 需提供 set(bytes64)/get()->Buffer|null/close()。任一 verify 失败立即抛出, 之后 transport 拒绝再发。
// 单段写会话 (金样时序): ab → 随机块(不读) → 02 → 头(块数)+数据块 → 02
async function runSegmentSession(dev, header, cmdByte, blocks, opts = {}) {
  const sleep = opts.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const rng = opts.rng || (n => crypto.randomBytes(n));
  const step = async (name, fn) => { try { return await fn(); } catch (e) { try { dev.close(); } catch {} throw e; } };

  await step('begin', async () => {
    dev.set(Buffer.from(CMD.begin));
    verifyResp(dev.get(), 0xab, 'begin');
  });
  await step('challenge', async () => { dev.set(rng(BLOCK_BYTES)); });
  await step('status1', async () => {
    dev.set(Buffer.from(CMD.status));
    verifyResp(dev.get(), 0x02, 'status1');
  });
  await step('header', async () => {
    dev.set(Buffer.from(header));
    verifyResp(dev.get(), cmdByte, 'header');
  });
  // 数据块 (线上协议此处无逐包应答, 老软件 12ms 间隔)
  await step('blocks', async () => {
    for (const b of blocks) { dev.set(b); await sleep(12); }
  });
  // 收尾状态 (比老软件多一次 verify, 确认写后会话设备仍活)
  await step('status2', async () => {
    dev.set(Buffer.from(CMD.status));
    verifyResp(dev.get(), 0x02, 'status2');
  });
}

async function runKeymapSession(dev, seg, opts = {}) {
  const step = async (name, fn) => { try { return await fn(); } catch (e) { try { dev.close(); } catch {} throw e; } };
  // 0. 预检心跳: 设备不应答就绝不进入写会话 (变砖事故教训)
  await step('preflight', async () => {
    dev.set(Buffer.from(CMD.hb));
    verifyResp(dev.get(), 0x18, 'preflight');
  });
  await runSegmentSession(dev, CMD.keymapHeader, 0x11, splitBlocks(seg), opts);
  await step('final-hb', async () => {
    dev.set(Buffer.from(CMD.hb));
    verifyResp(dev.get(), 0x18, 'final-hb');
  });
  return { ok: true, bytes: SEG_BYTES };
}

// 宏写入会话 (金样时序: f0(无GET) → 17段会话 → 15段会话)。在键位段会话之后调用。
async function runMacroWriteSession(dev, seg15, seg17, opts = {}) {
  const step = async (name, fn) => { try { return await fn(); } catch (e) { try { dev.close(); } catch {} throw e; } };
  await step('preflight', async () => {
    dev.set(Buffer.from(CMD.hb));
    verifyResp(dev.get(), 0x18, 'preflight');
  });
  await step('commit', async () => { dev.set(Buffer.from(CMD.commit)); }); // 发射后不管, 金样此处无 GET
  await runSegmentSession(dev, CMD.macroCount, 0x17, [Buffer.from(seg17)], opts);
  await runSegmentSession(dev, CMD.macroHeader, 0x15, splitBlocks(seg15, MACRO_BLOCKS, MACRO_SEG_BYTES), opts);
  await step('final-hb', async () => {
    dev.set(Buffer.from(CMD.hb));
    verifyResp(dev.get(), 0x18, 'final-hb');
  });
  return { ok: true, bytes: MACRO_SEG_BYTES + BLOCK_BYTES };
}

// 心跳延迟探测 (ms), 设备异常返回 null
function probeHeartbeat(dev) {
  const t0 = Date.now();
  try {
    dev.set(Buffer.from(CMD.hb));
    const r = dev.get();
    if (!r || r[1] !== 0x04 || r[2] !== 0x18) return null;
    return Date.now() - t0;
  } catch { return null; }
}

// 固件版本 (GET 04 02 应答: [5],[6] 为版本字节)
function readFirmwareVersion(dev) {
  dev.set(Buffer.from(CMD.status));
  const r = verifyResp(dev.get(), 0x02, 'version');
  if (r.length < 7) return null;
  if (!r[5] && !r[6]) return null; // 实测: mi_00 接口不上报版本(全零), 交由 UI 显示"未知"
  return `${r[5]}.${r[6]}`;
}

module.exports = {
  SEG_BYTES, N_BLOCKS, BLOCK_BYTES, MIN_CELL, MAX_CELL,
  MACRO_SLOTS, MACRO_SEG_BYTES, MACRO_BLOCKS, MAX_DELAY_MS,
  CMD, ProtocolAbort, buildKeymap, buildMacroSegments, splitBlocks, verifyResp,
  runKeymapSession, runMacroWriteSession, probeHeartbeat, readFirmwareVersion
};
