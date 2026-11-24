'use strict';
// 配置档存档: <dir>/<name>.json, schema 版本化。出厂模板=全默认(空 overrides)。
const fs = require('fs');
const path = require('path');

const SCHEMA = 1;
const NAME_RE = /^[0-9A-Za-z_\u4e00-\u9fa5-]{1,32}$/;

const ACTIONS = ['default', 'disable', 'remap', 'mouse', 'media', 'combo', 'macro'];

function factoryDefault(name = '出厂默认') {
  return { schema: SCHEMA, name, overrides: [] };
}

// 配置档完整校验 (修复审查 #8): 导入/保存/下发三处共用。非法即抛错, 绝不静默改名或修补。
//   opts.requireName=false: 下发路径不要求 name 合法 (例如"键盘当前状态"视图)
function validateConfig(c, opts = {}) {
  const requireName = opts.requireName !== false;
  if (!c || typeof c !== 'object') throw new Error('配置档内容不是对象');
  if (c.schema !== SCHEMA) throw new Error(`配置档 schema 版本 ${c.schema} 与当前 ${SCHEMA} 不兼容`);
  if (requireName && (typeof c.name !== 'string' || !NAME_RE.test(c.name))) {
    const e = new Error(`配置档名非法: ${JSON.stringify(c.name)} (只允许中英文/数字/_/-, 1-32 字符)`);
    e.code = 'BAD_NAME';
    throw e;
  }
  if (!Array.isArray(c.overrides)) throw new Error('配置档缺 overrides 数组');
  const seen = new Set();
  for (const o of c.overrides) {
    if (!o || typeof o !== 'object') throw new Error('overrides 中有非对象条目');
    if (!Number.isInteger(o.cell) || o.cell < 1 || o.cell > 143) throw new Error(`格号越界: ${o.cell}`);
    if (seen.has(o.cell)) throw new Error(`格号重复: ${o.cell}`);
    seen.add(o.cell);
    if (!ACTIONS.includes(o.action)) throw new Error(`格 ${o.cell} 未知动作: ${o.action}`);
    if (o.target != null && typeof o.target !== 'string') throw new Error(`格 ${o.cell} target 必须是字符串`);
    if (o.action === 'combo' && o.target == null && Array.isArray(o.keys)) o.target = o.keys.map(k => '0x' + Number(k).toString(16)).join(' + ');
  }
  // 线协议编码终检 (槽号/模式/usage 等范围), 失败信息来自协议层
  require('./protocol').buildKeymap(c);
  return c;
}

class ConfigStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  _file(name) {
    if (!NAME_RE.test(name)) throw new Error('配置档名只允许中英文/数字/_/-, 1-32 字符');
    return path.join(this.dir, name + '.json');
  }

  list() {
    return fs.readdirSync(this.dir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
  }

  load(name) {
    const raw = JSON.parse(fs.readFileSync(this._file(name), 'utf8'));
    if (raw.schema !== SCHEMA) throw new Error(`配置档 schema 版本 ${raw.schema} 与当前 ${SCHEMA} 不兼容`);
    return raw;
  }

  save(config) {
    validateConfig(config);
    const file = this._file(config.name);
    fs.writeFileSync(file + '.tmp', JSON.stringify(config, null, 1));
    fs.renameSync(file + '.tmp', file); // 原子替换, 避免半写
    return file;
  }

  remove(name) { fs.unlinkSync(this._file(name)); }

  // #24: 哪些已保存的配置档绑定了某个宏槽 (删宏前提醒用; 读不了的档跳过)
  macroRefs(slot) {
    const out = [];
    for (const name of this.list()) {
      try {
        const c = this.load(name);
        if ((c.overrides || []).some(o => o.action === 'macro' && o.slot === slot)) out.push(name);
      } catch {}
    }
    return out;
  }

  // 导出/导入用
  exportText(config) { return JSON.stringify(config, null, 1); }
  importText(text) {
    let raw;
    try { raw = JSON.parse(text); } catch (e) { throw new Error('导入文件不是合法 JSON: ' + e.message); }
    return validateConfig(raw); // name 非法时抛 code=BAD_NAME, 由 UI 让用户改名后重试
  }
}

// 与出厂默认的差异 (要下发的格): action !== 'default' 的条目
function computeDiff(config) {
  return (config.overrides || []).filter(o => o.action && o.action !== 'default');
}

// 覆盖式写入 overrides 中某格
function setCell(config, cell, action, target) {
  config.overrides = config.overrides.filter(o => o.cell !== cell);
  if (action !== 'default') config.overrides.push(target != null ? { cell, action, target } : { cell, action });
  config.overrides.sort((a, b) => a.cell - b.cell);
  return config;
}

// 宏库: 设备全局(不随配置档走), 独立存档 <file> = [{slot, name, steps:[{hid|mouse, down, delay}]}]
const MACRO_SCHEMA = 1;
class MacroStore {
  constructor(file) { this.file = file; fs.mkdirSync(path.dirname(file), { recursive: true }); }
  load() {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    if (raw.schema !== MACRO_SCHEMA) throw new Error(`宏库 schema 版本 ${raw.schema} 与当前 ${MACRO_SCHEMA} 不兼容`);
    return Array.isArray(raw.slots) ? raw.slots : [];
  }
  save(slots) {
    fs.writeFileSync(this.file + '.tmp', JSON.stringify({ schema: MACRO_SCHEMA, slots }, null, 1));
    fs.renameSync(this.file + '.tmp', this.file);
    return this.file;
  }
}

module.exports = { SCHEMA, NAME_RE, ConfigStore, MacroStore, factoryDefault, validateConfig, computeDiff, setCell };
