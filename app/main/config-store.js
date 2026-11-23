'use strict';
// 配置档存档: <dir>/<name>.json, schema 版本化。出厂模板=全默认(空 overrides)。
const fs = require('fs');
const path = require('path');

const SCHEMA = 1;
const NAME_RE = /^[0-9A-Za-z_\u4e00-\u9fa5-]{1,32}$/;

function factoryDefault(name = '出厂默认') {
  return { schema: SCHEMA, name, overrides: [] };
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
    if (config.schema !== SCHEMA) throw new Error('内部错误: schema 不符');
    const file = this._file(config.name);
    fs.writeFileSync(file + '.tmp', JSON.stringify(config, null, 1));
    fs.renameSync(file + '.tmp', file); // 原子替换, 避免半写
    return file;
  }

  remove(name) { fs.unlinkSync(this._file(name)); }

  // 导出/导入用
  exportText(config) { return JSON.stringify(config, null, 1); }
  importText(text) {
    const raw = JSON.parse(text);
    if (raw.schema !== SCHEMA) throw new Error(`导入文件 schema 版本 ${raw.schema} 不兼容`);
    if (!Array.isArray(raw.overrides)) throw new Error('导入文件缺 overrides');
    return raw;
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

module.exports = { SCHEMA, ConfigStore, factoryDefault, computeDiff, setCell };
