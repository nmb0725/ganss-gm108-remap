'use strict';
// GM108 键位段(04 11)协议层: 纯函数 + 会话编排。不直接碰 HID, 设备由 transport 注入。
// 金样基线: test/fixtures/golden-*.json (由 probe/golden-extract.js 从老软件抓包提取)
const crypto = require('crypto');

const SEG_BYTES = 640;      // 10 块 x 64B
const N_BLOCKS = 10;
const BLOCK_BYTES = 64;
const MIN_CELL = 1, MAX_CELL = 143; // gkdb 证实有效 KeyIndex 范围; cell*4+4 <= 576 < 638, 不与 aa55 冲突
const DISABLE_BYTES = Buffer.from([0x05, 0x03, 0x00, 0x00]);

const CMD = {
  hb: [0x04, 0x18],
  begin: [0x04, 0xab],
  status: [0x04, 0x02],
  keymapHeader: [0x04, 0x11, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, N_BLOCKS] // 金样: 6 个填充零, 块数在第 8 字节
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
    else throw new ProtocolAbort('build', `未知动作: ${o.action}`);
  }
  buf[638] = 0xaa; buf[639] = 0x55;
  return buf;
}

function splitBlocks(seg) {
  if (seg.length !== SEG_BYTES) throw new ProtocolAbort('build', `键位段长度 ${seg.length} != ${SEG_BYTES}`);
  const out = [];
  for (let i = 0; i < N_BLOCKS; i++) out.push(Buffer.from(seg.subarray(i * BLOCK_BYTES, (i + 1) * BLOCK_BYTES)));
  return out;
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
async function runKeymapSession(dev, seg, opts = {}) {
  const sleep = opts.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const rng = opts.rng || (n => crypto.randomBytes(n));
  const blocks = splitBlocks(seg);
  const step = async (name, fn) => { try { return await fn(); } catch (e) { try { dev.close(); } catch {} throw e; } };

  // 0. 预检心跳: 设备不应答就绝不进入写会话 (变砖事故教训)
  await step('preflight', async () => {
    dev.set(Buffer.from(CMD.hb));
    verifyResp(dev.get(), 0x18, 'preflight');
  });
  // 1. 握手
  await step('begin', async () => {
    dev.set(Buffer.from(CMD.begin));
    verifyResp(dev.get(), 0xab, 'begin');
  });
  // 2. 随机挑战块 (老软件行为: 发后不读)
  await step('challenge', async () => { dev.set(rng(BLOCK_BYTES)); });
  // 3. 状态查询 (设备回 4 字节状态)
  await step('status1', async () => {
    dev.set(Buffer.from(CMD.status));
    verifyResp(dev.get(), 0x02, 'status1');
  });
  // 4. 键位段头
  await step('header', async () => {
    dev.set(Buffer.from(CMD.keymapHeader));
    verifyResp(dev.get(), 0x11, 'header');
  });
  // 5. 数据块 (线上协议此处无逐包应答, 老软件 12ms 间隔)
  await step('blocks', async () => {
    for (const b of blocks) { dev.set(b); await sleep(12); }
  });
  // 6. 收尾状态 (比老软件多一次 verify, 确认写后会话设备仍活)
  await step('status2', async () => {
    dev.set(Buffer.from(CMD.status));
    verifyResp(dev.get(), 0x02, 'status2');
  });
  await step('final-hb', async () => {
    dev.set(Buffer.from(CMD.hb));
    verifyResp(dev.get(), 0x18, 'final-hb');
  });
  return { ok: true, bytes: SEG_BYTES };
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

module.exports = { SEG_BYTES, N_BLOCKS, BLOCK_BYTES, MIN_CELL, MAX_CELL, CMD, ProtocolAbort, buildKeymap, splitBlocks, verifyResp, runKeymapSession, probeHeartbeat, readFirmwareVersion };
