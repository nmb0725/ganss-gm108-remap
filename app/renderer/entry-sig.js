'use strict';
// 单格变更签名 (主进程 protocol.js 与渲染层 app.js 共用同一份实现, 修复审查 #9)。
// 只取影响线协议编码的字段: target 仅展示用, 宏改名不算变更。
// UMD: Node 下 module.exports; 浏览器下挂到 window.entrySig (由 index.html <script> 加载)。
(function (root) {
  function entrySig(o) {
    switch (o.action) {
      case 'remap': return `r:${o.mod | 0}:${o.hid == null ? '' : o.hid}`;
      case 'mouse': return `m:${o.button}`;
      case 'media': return `u:${o.usage}`;
      case 'combo': return `c:${(o.keys || []).join(',')}`;
      case 'macro': return `k:${o.slot}:${o.mode | 0}:${o.mode === 1 ? o.loop | 0 : 0}`;
      default: return String(o.action);
    }
  }
  if (typeof module === 'object' && module.exports) module.exports = { entrySig };
  else root.entrySig = entrySig;
})(typeof window !== 'undefined' ? window : globalThis);
