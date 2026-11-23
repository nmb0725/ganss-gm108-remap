const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getDeviceStatus: () => ipcRenderer.invoke('device:get-status'),
  onDeviceChanged: (cb) => ipcRenderer.on('device:changed', (_e, s) => cb(s)),
  getFirmwareVersion: () => ipcRenderer.invoke('device:version'),

  listProfiles: () => ipcRenderer.invoke('cfg:list'),
  loadProfile: (name) => ipcRenderer.invoke('cfg:load', name),
  saveProfile: (cfg) => ipcRenderer.invoke('cfg:save', cfg),
  removeProfile: (name) => ipcRenderer.invoke('cfg:remove', name),
  factory: () => ipcRenderer.invoke('cfg:factory'),
  getApplied: () => ipcRenderer.invoke('cfg:applied'),
  exportProfile: (cfg) => ipcRenderer.invoke('cfg:export', cfg),
  importProfile: () => ipcRenderer.invoke('cfg:import'),

  applyConfig: (cfg) => ipcRenderer.invoke('keymap:apply', cfg),

  listMacros: () => ipcRenderer.invoke('macro:list'),
  saveMacros: (slots) => ipcRenderer.invoke('macro:save', slots)
});
