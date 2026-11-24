'use strict';
// GM108 键位段(04 11)协议层: 纯函数 + 会话编排。不直接碰 HID, 设备由 transport 注入。
// 金样基线: test/fixtures/golden-*.json (由 probe/golden-extract.js 从老软件抓包提取)
const crypto = require('crypto');
const { entrySig } = require('../renderer/entry-sig');

const SEG_BYTES = 640;      // 10 块 x 64B
const N_BLOCKS = 10;
const BLOCK_BYTES = 64;
const MIN_CELL = 1, MAX_CELL = 143; // gkdb 证实有效 KeyIndex 范围; cell*4+4 <= 576 < 638, 不与 aa55 冲突
const DISABLE_BYTES = Buffer.from([0x05, 0x03, 0x00, 0x00]);

// 宏库段(04 15): 块数可变 = ceil(数据末尾/64) + 1 (cap_m_size.log 12 个状态 9..17 块全部吻合, 含末尾=576 的边界)。
//   段尾 2 字节恒为 aa 55。布局(金样 golden_default.log + cap_m_size.log 逐字节证实):
//   [0,400)   100 x u32LE 指针表(槽0..99, 值=数据区字节偏移, 0=未用)
//   [400,末尾) 数据区, 各宏入口按槽号升序紧密拼接 (槽号可以不连续, 未用槽指针=0)
//   每入口 = count_u32LE + 4x00 + count 条 4 字节记录 (u32LE, 高 4 位 = 类型)
//     按键   0xB/0x3 : 00 00 <usage> <b0 按下 / 30 弹起>
//     鼠标   0x9/0x1/0x2: 00 00 <位> <90 按下 / 10 松开 / 20 滚轮>
//     延时   0x5     : 低 28 位 = 毫秒 (lo mid hi 5x), 例 500=f4 01 00 50, 99999999=ff e0 f5 55
//   (2026-11-24 cap_m_delay2.log + 槽9截图证实; 旧注释"事件+delay_u16+00 50"是同一字节流的错位分帧, 且只支持 ≤65535ms)
//   [段长-2, 段长) aa 55
const MACRO_SLOTS = 100;
const MACRO_POOL = 400;
// 宏段(04 15)内鼠标事件位: 左1 右2 中4 后退8 前进16; 滚轮上=01 下=ff (cap_mouse_macro.log 槽10 锚)
const MACRO_MOUSE = { left: 0x01, right: 0x02, middle: 0x04, back: 0x08, forward: 0x10, 'wheel-up': 0x01, 'wheel-down': 0xff };
const MACRO_SEG_BYTES = 832;   // 金样 (10 个宏) 的段长, 仅供参考; 实际段长由 macroBlocksFor() 决定
const MACRO_BLOCKS = 13;
// 实测过的最大段: 17 块 (1088B, 数据末尾 1016)。键盘实际容量未知, 先限制在实测范围内, 超出拒绝写入
const MACRO_MAX_BLOCKS = 17;
const macroBlocksFor = end => Math.ceil(end / BLOCK_BYTES) + 1;
const MACRO_DATA_END_MAX = (MACRO_MAX_BLOCKS - 1) * BLOCK_BYTES; // 1024
// 04 17 段第 1 字节: 1..13 个宏时恒为 0x0a (cap_m_size.log 13 次"情景模式→确定"全部如此), 不是宏数量
const MACRO17_BYTE0 = 0x0a;
// 单条延时记录可表示 0x0FFFFFFF ms; 老软件界面上限 99999999 (8 位)。更长的等待由编码器拆成多条记录
const DELAY_REC_MAX = 0x0FFFFFFF;
const MAX_DELAY_MS = 999999999;

const CMD = {
  hb: [0x04, 0x18],
  begin: [0x04, 0xab],
  status: [0x04, 0x02],
  keymapHeader: [0x04, 0x11, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, N_BLOCKS], // 金样: 6 个填充零, 块数在第 8 字节
  macroHeader: [0x04, 0x15, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, MACRO_BLOCKS], // 块数位按段长改写, 见 macroHeaderFor()
  macroCount: [0x04, 0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 1],
  commit: [0x04, 0xf0] // 金样: 13段与17段之间发射一次, 无 GET (发射后不管)
};

const macroHeaderFor = blocks => { const h = CMD.macroHeader.slice(); h[8] = blocks; return h; };

class ProtocolAbort extends Error {
  constructor(step, reason) {
    super(`[${step}] ${reason}`);
    this.name = 'ProtocolAbort';
    this.step = step;
  }
}

// 宏绑定与其他动作一样就是该格自己的 4 字节 (cell*4)。
// 旧实现的 bindPos(K)=4K-floor(K/16) 是抓包解析脚本 bug 的产物: probe/bindtable.js 的正则丢掉了每个 65B 报文
// 的最后 1 字节(每块只剩 63B), 把真实偏移 64*blk+j 映射成 63*blk+j。完整 64B 解析后 cap_bindmap*.log 全部
// 宏绑定记录都落在 4 的整数倍 (见 test/fixtures/golden-bindmap.json)。修复审查 #1。

// 配置对象 -> 640B 键位段. 配置形如 { overrides: [{cell, action, target}] }
function buildKeymap(config) {
  const buf = Buffer.alloc(SEG_BYTES);
  const ovr = (config && config.overrides) || [];
  const seen = new Set();
  for (const o of ovr) {
    const cell = o.cell | 0;
    if (!Number.isInteger(o.cell) || cell < MIN_CELL || cell > MAX_CELL) throw new ProtocolAbort('build', `格号越界: ${o.cell}`);
    if (seen.has(cell)) throw new ProtocolAbort('build', `格号重复: ${cell}`);
    seen.add(cell);
    if (o.action === 'default') continue;
    const at = cell * 4;
    if (o.action === 'disable') DISABLE_BYTES.copy(buf, at);
    else if (o.action === 'remap') {
      // 线格式(抓包解码, cap_modifier.log + cap_modifier3.log): 4字节 = 02 <修饰位> <HID usage> 00
      //   实测锚: 单普通键 byte[2]=usage (空格=02002c00, ↑=02005200, 菜单=02006500, A=02000400)
      //           单修饰键 byte[1]=1<<(usage-0xE0) (右Ctrl=02100000, 左Shift=02020000 等 10/10 吻合)
      //   组合键(两位同时非零, 如 Ctrl+A = 02 01 04 00): 老软件不支持故无法抓包; 2026-11-24 用户实机确认可用
      let mod = 0, usage = 0;
      if (o.mod != null) {
        if (!Number.isInteger(o.mod) || o.mod < 0 || o.mod > 0xff) throw new ProtocolAbort('build', `改键目标修饰位无效: ${o.mod} (需 0..255)`);
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
    // 宏绑定(cap_bindmap*.log 完整解析 + cap_mouse_mode 三模式): 4字节 = 06 <槽> <mode> <次数>, 位于 cell*4
    //   mode: 0=播放一次, 1=播放多次(第4字节=1..255), 2=再按键时停止
    else if (o.action === 'macro') {
      if (!Number.isInteger(o.slot) || o.slot < 0 || o.slot >= MACRO_SLOTS) throw new ProtocolAbort('build', `宏槽号无效: ${o.slot} (需 0..99)`);
      const mode = o.mode == null ? 0 : o.mode;
      if (mode !== 0 && mode !== 1 && mode !== 2) throw new ProtocolAbort('build', `宏播放模式无效: ${o.mode} (需 0/1/2)`);
      buf[at] = 0x06; buf[at + 1] = o.slot; buf[at + 2] = mode;
      if (mode === 1) {
        if (!Number.isInteger(o.loop) || o.loop < 1 || o.loop > 255) throw new ProtocolAbort('build', `宏循环次数无效: ${o.loop} (需 1..255)`);
        buf[at + 3] = o.loop;
      }
    }
    else throw new ProtocolAbort('build', `未知动作: ${o.action}`);
  }
  buf[638] = 0xaa; buf[639] = 0x55;
  return buf;
}

// entrySig: 见 renderer/entry-sig.js (主进程/渲染层共用)

function splitBlocks(seg, n = N_BLOCKS, total = SEG_BYTES) {
  if (seg.length !== total) throw new ProtocolAbort('build', `段长度 ${seg.length} != ${total}`);
  const out = [];
  for (let i = 0; i < n; i++) out.push(Buffer.from(seg.subarray(i * BLOCK_BYTES, (i + 1) * BLOCK_BYTES)));
  return out;
}

// 宏库 [{slot, name, steps:[{hid|mouse, down, delay} | {wait}]}] -> { seg15 (变长, 块数=ceil(末尾/64)+1), seg17 (64B), blocks }
// steps = 按下/释放事件序列, delay = 该事件之后的等待毫秒(0..999999999, 编码器按需拆成多条延时记录)。宏名仅本工具展示用, 不上线。
function buildMacroSegments(library) {
  const seg = Buffer.alloc(MACRO_MAX_BLOCKS * BLOCK_BYTES); // 先按上限分配, 最后截到实际块数
  const sorted = [...(library || [])].sort((a, b) => (a.slot | 0) - (b.slot | 0));
  const seen = new Set();
  let pool = MACRO_POOL;
  for (const m of sorted) {
    if (!Number.isInteger(m.slot) || m.slot < 0 || m.slot >= MACRO_SLOTS) throw new ProtocolAbort('macro', `槽号越界: ${m.slot} (需 0..99)`);
    if (seen.has(m.slot)) throw new ProtocolAbort('macro', `槽号重复: ${m.slot}`);
    seen.add(m.slot);
    const steps = Array.isArray(m.steps) ? m.steps : [];
    if (!steps.length) throw new ProtocolAbort('macro', `槽 ${m.slot} "${m.name || ''}" 没有步骤`);
    const recs = [];
    const pushDelay = ms => {
      // 延时记录: u32LE = 0x50000000 | ms; 超过单条上限时拆成多条
      for (let d = ms; d > 0;) {
        const c = Math.min(d, DELAY_REC_MAX);
        recs.push([c & 0xff, (c >> 8) & 0xff, (c >> 16) & 0xff, 0x50 | ((c >>> 24) & 0x0f)]);
        d -= c;
      }
    };
    for (const s of steps) {
      // 独立延时步骤 {wait: ms}: 对应老软件里单独插入的"延时"行, 每行一条记录 (连续多行也各占一条)
      if (s.wait != null) {
        if (!Number.isInteger(s.wait) || s.wait < 1 || s.wait > MAX_DELAY_MS) throw new ProtocolAbort('macro', `槽 ${m.slot} 延时无效 (需 1..${MAX_DELAY_MS}ms): ${s.wait}`);
        pushDelay(s.wait);
        continue;
      }
      if (s.mouse) { if (!MACRO_MOUSE[s.mouse]) throw new ProtocolAbort('macro', `槽 ${m.slot} 鼠标步骤无效: ${s.mouse}`); }
      else if (!Number.isInteger(s.hid) || s.hid < 1 || (s.hid > 0xdf && (s.hid < 0xe0 || s.hid > 0xe7))) throw new ProtocolAbort('macro', `槽 ${m.slot} 键无效: ${s.hid}`);
      if (!Number.isInteger(s.delay) || s.delay < 0 || s.delay > MAX_DELAY_MS) throw new ProtocolAbort('macro', `槽 ${m.slot} 间隔无效 (需 0..${MAX_DELAY_MS}ms): ${s.delay}`);
      // 事件记录: 00 00 <码> <cmd>
      if (s.mouse) recs.push([0, 0, MACRO_MOUSE[s.mouse] & 0xff, s.mouse === 'wheel-up' || s.mouse === 'wheel-down' ? 0x20 : s.down ? 0x90 : 0x10]);
      else recs.push([0, 0, s.hid, s.down ? 0xb0 : 0x30]);
      pushDelay(s.delay);
    }
    const entryLen = 8 + recs.length * 4;
    if (pool + entryLen > MACRO_DATA_END_MAX) throw new ProtocolAbort('macro', `宏数据区溢出: 槽 ${m.slot} 需 ${entryLen}B, 仅剩 ${MACRO_DATA_END_MAX - pool}B (已实测的最大宏库约 ${MACRO_DATA_END_MAX - MACRO_POOL}B)`);
    seg.writeUInt32LE(pool, m.slot * 4);
    seg.writeUInt32LE(recs.length, pool);
    let o = pool + 8;
    for (const r of recs) { seg[o] = r[0]; seg[o + 1] = r[1]; seg[o + 2] = r[2]; seg[o + 3] = r[3]; o += 4; }
    pool = o;
  }
  const blocks = macroBlocksFor(pool);
  const out = Buffer.from(seg.subarray(0, blocks * BLOCK_BYTES));
  out[out.length - 2] = 0xaa; out[out.length - 1] = 0x55;
  const seg17 = Buffer.alloc(BLOCK_BYTES);
  seg17[0] = MACRO17_BYTE0; // 1..13 个宏实测恒为 0x0a (旧实现写宏数量, 11 个以上时与老软件不同)
  seg17[62] = 0xaa; seg17[63] = 0x55;
  return { seg15: out, seg17, blocks };
}

const briefHex = r => Buffer.from(r.subarray(0, 8)).toString('hex').replace(/(..)/g, '$1 ');
// 应答校验: 基本要求 = 回显 04 <cmd> (全零/无应答过不了这一关, 即变砖事故的病灶)。
// 写路径(ab/02/11/13/15/17/19)另加 alive=true: 应答[4] 必须为 0x01。
//   注意 (2026-11-24 更正): 早先"[4] 在 00/ff/01 间随机波动, 不是存活位, 不得作为闸门"的结论来自只读命令 04 05
//   (241 个样本中仅 3 次为 01), 推广到写路径是错的; 不要再据此回滚 alive 校验。
//   依据 (probe/*.log 全量重算): 写路径命令 600+ 个真应答 [4] 全部为 01; [4] 随机波动只出现在只读命令 04 05 上。
//   传输层把"与 SET 原样相同的滞留报告"判成 null, 但万一漏网, 原样回显的 [4] 是 00, 这里也会熔断 (修复审查 #2)。
function verifyResp(r, cmdByte, step, opts = {}) {
  if (!r) throw new ProtocolAbort(step, '设备无应答 (GET 失败/超时), 已熔断');
  if (r.length < 5) throw new ProtocolAbort(step, `应答过短 (${r.length}B: ${briefHex(r)}), 已熔断`);
  if (r[1] !== 0x04 || r[2] !== cmdByte) throw new ProtocolAbort(step, `应答回显异常 (实际: ${briefHex(r)}…), 已熔断`);
  if (opts.alive && r[4] !== 0x01) throw new ProtocolAbort(step, `应答状态位异常 ([4]=${r[4].toString(16).padStart(2, '0')}, 期望 01), 已熔断`);
  return r;
}

// 心跳: 回显正确但 [4]!=01 时允许重试 (日志中健康键盘心跳偶发 [4]=00, 2/275), 最多 3 次; 无回显立即熔断
async function heartbeat(dev, step, sleep) {
  for (let i = 0; ; i++) {
    dev.set(Buffer.from(CMD.hb));
    const r = verifyResp(dev.get(), 0x18, step);
    if (r[4] === 0x01) return r;
    if (i >= 2) throw new ProtocolAbort(step, `心跳状态位连续 3 次异常 ([4]=${r[4].toString(16).padStart(2, '0')}), 已熔断`);
    await sleep(10);
  }
}

// 会话编排。dev 需提供 set(bytes64)/get()->Buffer|null/close()。任一 verify 失败立即抛出, 之后 transport 拒绝再发。
// 单段写会话 (金样时序): ab → 随机块(不读) → 02 → 头(块数)+数据块 → 02
async function runSegmentSession(dev, header, cmdByte, blocks, opts = {}) {
  const sleep = opts.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const rng = opts.rng || (n => crypto.randomBytes(n));
  const step = async (name, fn) => { try { return await fn(); } catch (e) { try { dev.close(); } catch {} throw e; } };

  await step('begin', async () => {
    dev.set(Buffer.from(CMD.begin));
    verifyResp(dev.get(), 0xab, 'begin', { alive: true });
  });
  await step('challenge', async () => { dev.set(rng(BLOCK_BYTES)); });
  await step('status1', async () => {
    dev.set(Buffer.from(CMD.status));
    verifyResp(dev.get(), 0x02, 'status1', { alive: true });
  });
  await step('header', async () => {
    dev.set(Buffer.from(header));
    verifyResp(dev.get(), cmdByte, 'header', { alive: true });
  });
  // 数据块 (线上协议此处无逐包应答, 老软件 12ms 间隔)
  await step('blocks', async () => {
    for (const b of blocks) { dev.set(b); await sleep(12); }
  });
  // 收尾状态 (比老软件多一次 verify, 确认写后会话设备仍活)
  await step('status2', async () => {
    dev.set(Buffer.from(CMD.status));
    verifyResp(dev.get(), 0x02, 'status2', { alive: true });
  });
}

async function runKeymapSession(dev, seg, opts = {}) {
  const sleep = opts.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const step = async (name, fn) => { try { return await fn(); } catch (e) { try { dev.close(); } catch {} throw e; } };
  // 0. 预检心跳: 设备不应答就绝不进入写会话 (变砖事故教训)
  await step('preflight', () => heartbeat(dev, 'preflight', sleep));
  await runSegmentSession(dev, CMD.keymapHeader, 0x11, splitBlocks(seg), opts);
  await step('final-hb', () => heartbeat(dev, 'final-hb', sleep));
  return { ok: true, bytes: SEG_BYTES };
}

// 宏写入会话 (金样时序: f0(无GET) → 17段会话 → 15段会话)。在键位段会话之后调用。
async function runMacroWriteSession(dev, seg15, seg17, opts = {}) {
  const sleep = opts.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const step = async (name, fn) => { try { return await fn(); } catch (e) { try { dev.close(); } catch {} throw e; } };
  await step('preflight', () => heartbeat(dev, 'preflight', sleep));
  await step('commit', async () => { dev.set(Buffer.from(CMD.commit)); }); // 发射后不管, 金样此处无 GET
  await runSegmentSession(dev, CMD.macroCount, 0x17, [Buffer.from(seg17)], opts);
  const n = seg15.length / BLOCK_BYTES;
  if (!Number.isInteger(n) || n < 2 || n > MACRO_MAX_BLOCKS) throw new ProtocolAbort('macro', `宏段长度异常: ${seg15.length}B`);
  await runSegmentSession(dev, macroHeaderFor(n), 0x15, splitBlocks(seg15, n, n * BLOCK_BYTES), opts);
  await step('final-hb', () => heartbeat(dev, 'final-hb', sleep));
  return { ok: true, bytes: seg15.length + BLOCK_BYTES };
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

// 固件版本 (04 02 应答: [5],[6] 为版本字节)。不传 alive: 只读用途, 且 mi_00 接口此处版本字节全零
function readFirmwareVersion(dev) {
  dev.set(Buffer.from(CMD.status));
  const r = verifyResp(dev.get(), 0x02, 'version');
  if (r.length < 7) return null;
  if (!r[5] && !r[6]) return null; // 实测: mi_00 接口不上报版本(全零), 交由 UI 显示"未知"
  return `${r[5]}.${r[6]}`;
}

module.exports = {
  SEG_BYTES, N_BLOCKS, BLOCK_BYTES, MIN_CELL, MAX_CELL,
  MACRO_SLOTS, MACRO_SEG_BYTES, MACRO_BLOCKS, MACRO_MAX_BLOCKS, MACRO_DATA_END_MAX, MAX_DELAY_MS, macroBlocksFor, macroHeaderFor,
  CMD, ProtocolAbort, buildKeymap, buildMacroSegments, splitBlocks, verifyResp, entrySig, MACRO_MOUSE,
  runKeymapSession, runMacroWriteSession, probeHeartbeat, readFirmwareVersion
};
