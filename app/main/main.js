const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const { findGm108, startWatcher } = require('./device-watcher');
const { ConfigStore, MacroStore, factoryDefault } = require('./config-store');
const { buildKeymap, buildMacroSegments } = require('./protocol');

// 单实例锁: 防止两个实例同时操作键盘
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let stopWatcher = null;
let store = null;
let macroStore = null;
let appliedFile = null;
let applying = false;

// HID 阻塞调用一律进 worker 线程, 主进程事件循环不冻结 (界面不再发白)
function runHidWorker(op, devPath, extra = {}, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const w = new Worker(path.join(__dirname, 'hid-worker.js'));
    const id = op + Date.now();
    const done = (r) => { clearTimeout(timer); try { w.terminate(); } catch {} resolve(r); };
    const timer = setTimeout(() => done({ ok: false, error: 'HID 工作线程超时' }), timeoutMs);
    w.on('error', e => done({ ok: false, error: 'HID 工作线程错误: ' + e.message }));
    w.on('message', m => { if (m.id === id) done(m); });
    w.postMessage({ id, op, path: devPath, ...extra });
  });
}

function readAppliedDoc() {
  try { return JSON.parse(fs.readFileSync(appliedFile, 'utf8')); } catch { return { config: factoryDefault() }; }
}
function readApplied() { return readAppliedDoc().config || factoryDefault(); }

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 680,
    title: 'GANSS GM108 改键工具',
    backgroundColor: '#16181d',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  store = new ConfigStore(path.join(app.getPath('userData'), 'profiles'));
  macroStore = new MacroStore(path.join(app.getPath('userData'), 'macros.json'));
  appliedFile = path.join(app.getPath('userData'), 'applied.json');
  createWindow();
  stopWatcher = startWatcher(status => {
    if (win && !win.isDestroyed()) win.webContents.send('device:changed', status);
  });
});

app.on('window-all-closed', () => {
  if (stopWatcher) stopWatcher();
  app.quit();
});

// ---- 设备 ----
ipcMain.handle('device:get-status', () => findGm108());
ipcMain.handle('device:version', async () => {
  const s = findGm108();
  if (!s.present || s.mode !== 'normal') return null;
  const r = await runHidWorker('version', s.path, {}, 5000);
  return r.ok ? r.result : null;
});

// ---- 配置档 ----
ipcMain.handle('cfg:list', () => store.list());
ipcMain.handle('cfg:load', (_e, name) => store.load(name));
ipcMain.handle('cfg:save', (_e, cfg) => { store.save(cfg); return true; });
ipcMain.handle('cfg:remove', (_e, name) => { store.remove(name); return true; });
ipcMain.handle('cfg:factory', () => factoryDefault());
ipcMain.handle('cfg:applied', () => { const d = readAppliedDoc(); return { config: d.config || factoryDefault(), macros: d.macros }; });

// ---- 宏库 (设备全局, 与配置档无关) ----
ipcMain.handle('macro:list', () => macroStore.load());
ipcMain.handle('macro:save', (_e, slots) => { macroStore.save(slots); return true; });
ipcMain.handle('cfg:export', async (_e, cfg) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: '导出配置档', defaultPath: (cfg.name || 'ganss-config') + '.json',
    filters: [{ name: 'GM108 配置', extensions: ['json'] }]
  });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, store.exportText(cfg));
  return true;
});
ipcMain.handle('cfg:import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: '导入配置档', filters: [{ name: 'GM108 配置', extensions: ['json'] }], properties: ['openFile']
  });
  if (canceled || !filePaths.length) return null;
  try {
    const cfg = store.importText(fs.readFileSync(filePaths[0], 'utf8'));
    return { config: cfg };
  } catch (e) { return { error: e.message }; }
});

// ---- 下发 (安全流程) ----
ipcMain.handle('keymap:apply', async (_e, cfg) => {
  if (applying) return { ok: false, error: '已有下发在进行' };
  // 变更 = 当前配置 vs 键盘已生效状态 (readApplied)。"改回默认"也算变更。
  const prevDoc = readAppliedDoc();
  const prev = new Map((readApplied().overrides || []).filter(o => o.action !== 'default').map(o => [o.cell, o.action]));
  const cur = new Map((cfg.overrides || []).filter(o => o.action !== 'default').map(o => [o.cell, o.action]));
  let changed = 0;
  for (const [c, a] of cur) if (prev.get(c) !== a) changed++;
  for (const c of prev.keys()) if (!cur.has(c)) changed++;
  // 宏库变更 (设备全局段 04 17/15)。老 applied.json 无 macros 字段 => 未知设备状态, 仅在库非空/有绑定时才补写
  const lib = macroStore.load();
  const hasBinding = (cfg.overrides || []).some(o => o.action === 'macro');
  const macrosChanged = prevDoc.macros === undefined
    ? (lib.length > 0 || hasBinding)
    : JSON.stringify(lib) !== JSON.stringify(prevDoc.macros);
  if (!changed && !macrosChanged) return { ok: false, error: '没有需要下发的变更' };
  const s = findGm108();
  if (s.mode === 'boot') return { ok: false, error: '键盘处于 BOOT 救援模式, 禁止下发' };
  if (!s.present) return { ok: false, error: '未检测到键盘' };
  let seg, macroSeg = null;
  try {
    seg = buildKeymap(cfg);
    if (macrosChanged) macroSeg = buildMacroSegments(lib);
  } catch (e) { return { ok: false, error: e.message }; }
  applying = true;
  try {
    const r = await runHidWorker('apply', s.path, {
      segHex: seg.toString('hex'),
      macro15Hex: macroSeg && macroSeg.seg15.toString('hex'),
      macro17Hex: macroSeg && macroSeg.seg17.toString('hex')
    });
    if (!r.ok) return { ok: false, error: r.error };
    fs.writeFileSync(appliedFile, JSON.stringify({ at: Date.now(), config: cfg, macros: lib }));
    return { ok: true, changed, macros: !!macroSeg };
  } finally {
    applying = false;
  }
});
