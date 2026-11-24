const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// 关闭 Chromium 子进程沙箱 (2026-11-24 用户要求, 便于直接运行 win-unpacked\ 里的程序):
//   在这台电脑上从 L: 盘启动时沙箱起不来, GPU / 渲染进程一启动就退出, 表现为闪退。
//   必须在 app ready 之前调用。风险评估: 界面只加载本地文件 (CSP default-src 'self'),
//   contextIsolation 开启、nodeIntegration 关闭, 不加载任何网页, 关闭沙箱的影响很小。
app.commandLine.appendSwitch('no-sandbox');

// 通过环境变量 GM108_DISABLE_GPU=1 关闭硬件加速 (界面只有 SVG, 关掉无影响)
if (process.env.GM108_DISABLE_GPU === '1' || process.argv.includes('--disable-gpu')) {
  app.disableHardwareAcceleration();
}

const { createDeviceMonitor } = require('./device-watcher');
const { ConfigStore, MacroStore, factoryDefault, validateConfig } = require('./config-store');
const { buildKeymap, buildMacroSegments } = require('./protocol');
const { createWorkerRunner } = require('./worker-runner');
const { readAppliedDoc, writeAppliedDoc, markUnknown, planApply, appliedAfter } = require('./apply-service');

// 单实例锁: 防止两个实例同时操作键盘 (修复审查 #6: quit 是异步的, 必须立即退出, 不能继续注册 IPC)
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win = null;
// 设备监视: 异步单航班枚举, 不阻塞主线程 (主线程卡住 = 整个窗口失去响应)
const watcher = createDeviceMonitor();
const findGm108 = () => watcher.refresh();
let store = null;
let macroStore = null;
let appliedFile = null;
let applying = false;
// 下发硬超时后: worker 可能仍阻塞在 native 调用里占着设备句柄。直到观察到键盘拔插才允许再次打开设备 (修复审查 #3)
let suspectDeviceBusy = false;
let sawUnplugSinceSuspect = false;

const send = (ch, ...a) => { if (win && !win.isDestroyed()) win.webContents.send(ch, ...a); };

// HID 阻塞调用一律进 worker 线程, 主进程事件循环不冻结
const runHidWorker = createWorkerRunner({ onPending: () => send('apply:pending') });

function createWindow() {
  // 默认尺寸按屏幕可用区域收缩 (高 DPI 缩放下 1080p 只有约 720 逻辑像素高, 固定 860 会被裁掉底部)
  const wa = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1360, wa.width - 40),
    height: Math.min(780, wa.height - 40), // 键盘功能面板内容变少后, 默认窗口高度从 900 下调
    minWidth: 1000,
    minHeight: 560,
    center: true,
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

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(() => {
  store = new ConfigStore(path.join(app.getPath('userData'), 'profiles'));
  macroStore = new MacroStore(path.join(app.getPath('userData'), 'macros.json'));
  appliedFile = path.join(app.getPath('userData'), 'applied.json');
  createWindow();
  watcher.start(status => {
    if (suspectDeviceBusy) {
      if (!status.present) sawUnplugSinceSuspect = true;
      else if (sawUnplugSinceSuspect) { suspectDeviceBusy = false; sawUnplugSinceSuspect = false; }
    }
    send('device:changed', { ...status, suspectBusy: suspectDeviceBusy });
  });
});

app.on('window-all-closed', () => {
  watcher.stop();
  app.quit();
});

// ---- 设备 ----
// 渲染层查询状态: 优先返回缓存, 不额外触发枚举 (还没有结果时才等第一次枚举)
ipcMain.handle('device:get-status', async () => {
  const cur = watcher.current();
  const st = cur.pending ? await watcher.refresh() : cur;
  return { ...st, suspectBusy: suspectDeviceBusy };
});
ipcMain.handle('device:version', async () => {
  // 修复审查 #17: 下发中/疑似占用时绝不另开 worker 打开设备 (否则 04 02 可能插进写会话)
  if (applying || suspectDeviceBusy) return null;
  const s = await findGm108();
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
ipcMain.handle('cfg:applied', () => {
  const d = readAppliedDoc(appliedFile);
  return { config: d.config, macros: d.macros, unknown: d.unknown, reason: d.reason };
});
// 修复审查 5.2: 用过老软件/换过电脑 => 本地基线不可信, 手动标记未知, 下次自动全量下发
ipcMain.handle('cfg:mark-unknown', () => { markUnknown(appliedFile, '用户手动标记'); return true; });

// ---- 宏库 (设备全局, 与配置档无关) ----
ipcMain.handle('macro:list', () => macroStore.load());
ipcMain.handle('macro:save', (_e, slots) => { macroStore.save(slots); return true; });
ipcMain.handle('macro:refs', (_e, slot) => store.macroRefs(slot));
// 修复审查 #21: 保存前用协议层同一套编码检查容量/合法性
ipcMain.handle('macro:check', (_e, slots) => {
  try { buildMacroSegments(slots); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
});
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
  const text = fs.readFileSync(filePaths[0], 'utf8');
  try {
    return { config: store.importText(text) };
  } catch (e) {
    // 修复审查 #8: 名称非法不静默改名, 其余内容合法则交给 UI 让用户重新命名
    if (e.code === 'BAD_NAME') {
      try { return { config: validateConfig(JSON.parse(text), { requireName: false }), badName: true, error: e.message }; }
      catch (e2) { return { error: e2.message }; }
    }
    return { error: e.message };
  }
});

// ---- 下发 (安全流程) ----
ipcMain.handle('keymap:apply', async (_e, cfg, opts = {}) => {
  if (applying) return { ok: false, error: '已有下发在进行' };
  if (suspectDeviceBusy) return { ok: false, error: '上次下发超时, 键盘可能仍被占用。请拔插键盘后再试' };
  try { validateConfig(cfg, { requireName: false }); } catch (e) { return { ok: false, error: e.message }; }
  const prevDoc = readAppliedDoc(appliedFile);
  let lib;
  try { lib = macroStore.load(); } catch (e) { return { ok: false, error: '宏库读取失败: ' + e.message }; }
  const plan = planApply({ cfg, prevDoc, lib, force: !!opts.force });
  if (plan.nothing) return { ok: false, error: '没有需要下发的变更' };
  const s = await findGm108();
  if (s.mode === 'boot') return { ok: false, error: '键盘处于 BOOT 救援模式, 禁止下发' };
  if (!s.present) return { ok: false, error: '未检测到键盘' };
  // 宏库是全局的、配置档可导入导出 => 可能出现绑定指向空槽, 下发前拦截
  const libSlots = new Set(lib.map(m => m.slot));
  const badBind = (cfg.overrides || []).find(o => o.action === 'macro' && !libSlots.has(o.slot | 0));
  if (badBind) return { ok: false, error: `格 ${badBind.cell} 绑定的宏槽 ${badBind.slot} 在宏库中不存在, 请先"管理宏库…"新建该槽或把该键改绑/恢复默认` };
  let seg, macroSeg = null;
  try {
    seg = buildKeymap(cfg);
    if (plan.macrosChanged) macroSeg = buildMacroSegments(lib);
  } catch (e) { return { ok: false, error: e.message }; }
  applying = true;
  watcher.pause();
  try {
    const r = await runHidWorker('apply', s.path, {
      segHex: seg.toString('hex'),
      macro15Hex: macroSeg && macroSeg.seg15.toString('hex'),
      macro17Hex: macroSeg && macroSeg.seg17.toString('hex')
    });
    if (r.stuck) { suspectDeviceBusy = true; sawUnplugSinceSuspect = false; }
    const doc = appliedAfter({ result: r, cfg, lib, prevDoc });
    if (doc) { try { writeAppliedDoc(appliedFile, doc); } catch {} }
    if (!r.ok) return { ok: false, error: r.error, stuck: !!r.stuck, unknown: !!(doc && doc.unknown) };
    return { ok: true, changed: plan.changed, macros: !!macroSeg, full: plan.full };
  } finally {
    applying = false;
    watcher.resume();
  }
});
