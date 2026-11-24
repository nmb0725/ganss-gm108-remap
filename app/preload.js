const { contextBridge, ipcRenderer } = require('electron');

// 事件订阅统一返回"取消订阅"函数 (修复审查 #13)
const subscribe = (ch, map) => (cb) => {
  const h = (_e, ...a) => cb(...map(a));
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

contextBridge.exposeInMainWorld('api', {
  getDeviceStatus: () => ipcRenderer.invoke('device:get-status'),
  onDeviceChanged: subscribe('device:changed', a => [a[0]]),
  getFirmwareVersion: () => ipcRenderer.invoke('device:version'),

  listProfiles: () => ipcRenderer.invoke('cfg:list'),
  loadProfile: (name) => ipcRenderer.invoke('cfg:load', name),
  saveProfile: (cfg) => ipcRenderer.invoke('cfg:save', cfg),
  removeProfile: (name) => ipcRenderer.invoke('cfg:remove', name),
  factory: () => ipcRenderer.invoke('cfg:factory'),
  getApplied: () => ipcRenderer.invoke('cfg:applied'),
  markUnknown: () => ipcRenderer.invoke('cfg:mark-unknown'),
  exportProfile: (cfg) => ipcRenderer.invoke('cfg:export', cfg),
  importProfile: () => ipcRenderer.invoke('cfg:import'),

  applyConfig: (cfg, opts) => ipcRenderer.invoke('keymap:apply', cfg, opts || {}),
  onApplyPending: subscribe('apply:pending', () => []),

  listMacros: () => ipcRenderer.invoke('macro:list'),
  saveMacros: (slots) => ipcRenderer.invoke('macro:save', slots),
  checkMacros: (slots) => ipcRenderer.invoke('macro:check', slots)
});
