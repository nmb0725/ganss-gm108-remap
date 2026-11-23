# GANSS GM108 改键工具 / GM108 Remap Tool

**中文** | [English](#english)

---

## 中文

GANSS GM108 机械键盘的开源改键 / 键位配置工具。基于 Electron + node-hid，无需安装、无需常驻后台，改动一键写回键盘固件，断电换电脑配置依然保留。

> ⚠️ 本工具通过 USB HID 向键盘固件下发键位表。虽然内置多重安全熔断，但修改固件配置始终存在风险，请仔细阅读[故障与救援](#故障与救援)一节后再使用。本工具与 GANSS 官方无关。

### 功能

- **可视化键位编辑**：按真实键盘布局点击选键，支持改键、禁用、恢复默认。
- **组合键捕捉**：直接在输入框按下 `Ctrl+A`、`Win+空格` 等组合即可记录目标。
- **配置档管理**：新建 / 保存 / 另存为 / 删除 / 导入 / 导出（JSON），可维护多套方案。
- **草稿 → 下发模型**：面板上的修改只是草稿，确认后才真正写入键盘。
- **一键恢复出厂设置**：底部按钮清除所有改键与禁用，写回出厂默认。
- **安全熔断**：下发前探测设备心跳；会话中任何一步设备应答异常立即中止，绝不盲发后续报文。

### 运行

需要 Node.js（含 npm）。在 `app/` 目录：

```bash
cd app
npm install
npm start
```

打包为便携 exe（Windows）：

```bash
cd app
npm run dist        # 产物在 app/dist/ 下的 *-portable.exe
```

> npm 下载 Electron 二进制若被拦截，可设置镜像：
> `set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`

### 使用流程

1. 插入键盘并打开本工具，顶栏右侧应显示「GANSS GM108 已连接」。若识别失败，请先关闭 GANSS 官方老配置软件（它会独占设备）。
2. 点击键盘上的键 → 右侧选「默认功能 / 禁用此键 / 改键为」。改键时点击输入框按下目标键或组合键。
3. 点「应用」把改动加入草稿；底部显示「待下发变更 N 处」。
4. 确认无误后点「写入到键盘」→ 确认 → 下发期间**勿拔线、勿按键**。
5. 想全部还原：点底部「恢复出厂设置」。

### 工作原理

键盘固件主控为 SONiX SN32F240B（ARM Cortex-M0）。键位表以 HID Feature Report 下发：

- 命令通道：键盘的 `VID_0C45&PID_8006` 键盘身份接口（node-hid 可读写 Feature Report）。
- 会话时序：握手 `04 ab` → 随机挑战块 → 状态查询 → 键位段头 `04 11` → 10×64B 数据块 → 收尾。
- 键位表：640 字节，每键 4 字节一格，格号 = 物理 KeyIndex。改键 4 字节 = `02 <修饰位> <HID usage> 00`。
- 协议细节由对官方老配置软件抓包逆向得到，键位格号经逐键核对验证。

`probe/` 目录保留了逆向与抓包辅助脚本，供学习参考。

### 故障与救援

- **检测不到设备**：关闭官方老配置软件后重插 USB。
- **下发中止（红字熔断）**：重插 USB 重试，键盘不受影响。
- **键盘完全无反应（灯全灭）**：需开壳用 K3-BOOT 触点进入刷固件模式，再用**官方**刷写工具重刷固件。具体步骤见应用内「帮助 / 救援」页。
  - ⚠️ 官方刷写工具与固件为第三方版权文件，**未包含在本仓库**，请自行从可靠渠道备份。
  - ⚠️ 严禁用第三方烧录器直接刷 `.bin`，官方刷写含传输加密，第三方刷入会变砖。

### 许可

[MIT](LICENSE)

---

## English

An open-source key remapping / keymap configuration tool for the **GANSS GM108** mechanical keyboard. Built on Electron + node-hid. No installation, no background resident process — changes are written directly back to the keyboard firmware and persist across reboots and different computers.

> ⚠️ This tool sends keymap tables to the keyboard firmware over USB HID. Despite built-in safety circuit-breakers, writing firmware configuration always carries risk. Read [Troubleshooting & Recovery](#troubleshooting--recovery) before use. Not affiliated with GANSS.

### Features

- **Visual keymap editor** — click keys on a true-to-life layout; remap, disable, or restore defaults.
- **Combo capture** — press `Ctrl+A`, `Win+Space`, etc. directly in the capture box to record the target.
- **Profile management** — new / save / save-as / delete / import / export (JSON) for multiple setups.
- **Draft → apply model** — panel edits are drafts; nothing touches the keyboard until you apply.
- **One-click factory reset** — clears all remaps and disables, writes back factory defaults.
- **Circuit-breaker safety** — probes device heartbeat before writing; aborts the session immediately on any abnormal device response, never sending blind packets.

### Run

Requires Node.js (with npm). In `app/`:

```bash
cd app
npm install
npm start
```

Package a portable exe (Windows):

```bash
cd app
npm run dist        # output: app/dist/*-portable.exe
```

### Workflow

1. Plug in the keyboard and launch the tool; the top bar shows "GANSS GM108 connected". If not detected, close the legacy GANSS config software first (it occupies the device).
2. Click a key → choose Default / Disable / Remap. For remap, click the capture box and press the target key or combo.
3. Click **Apply** to add to the draft; the bottom shows "N pending changes".
4. Review, then **Write to keyboard** → confirm. **Do not unplug or press keys during the write.**
5. To revert everything: click **Restore factory defaults** at the bottom.

### How it works

The keyboard uses a SONiX SN32F240B (ARM Cortex-M0). The keymap is delivered via HID Feature Reports:

- Command channel: the keyboard's `VID_0C45&PID_8006` interface (readable/writable Feature Reports via node-hid).
- Session sequence: handshake `04 ab` → random challenge block → status → keymap header `04 11` → 10×64B data blocks → finalize.
- Keymap: 640 bytes, 4 bytes per key slot; slot index = physical KeyIndex. A remap slot is `02 <modifier bits> <HID usage> 00`.
- The protocol was reverse-engineered by capturing traffic from the official legacy software; key indices were verified key-by-key.

The `probe/` directory retains reverse-engineering and capture helper scripts for reference.

### Troubleshooting & Recovery

- **Device not detected**: close the legacy GANSS software, then replug USB.
- **Write aborted (red circuit-breaker message)**: replug USB and retry; the keyboard is unaffected.
- **Keyboard completely dead (all lights off)**: requires opening the case and entering bootloader mode via the K3-BOOT test point, then reflashing firmware with the **official** tool. See the in-app "Help / Recovery" page.
  - ⚠️ The official flashing tool and firmware are third-party copyrighted files and are **not included in this repository** — back them up yourself from a reliable source.
  - ⚠️ Never flash a `.bin` with a third-party programmer; the official flash involves transfer encryption and third-party flashing will brick the board.

### License

[MIT](LICENSE)
