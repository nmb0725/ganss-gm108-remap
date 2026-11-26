# GANSS GM108 改键工具 / GM108 Remap Tool

**中文** | [English](#english)

---

## 中文

GANSS GM108 机械键盘的开源改键 / 键位配置工具。基于 Electron + node-hid, 免安装, 不常驻后台。改动写入键盘固件, 断电或换电脑后配置依然保留。

**为什么做这个工具**: 官方配置软件只提供 Windows 版本, 在 macOS 上根本装不上也跑不起来 —— 用 Mac 的人拿到这块键盘就只能按 Fn 组合盲切, 改键、录宏、禁用按键全都没法做。本工具就是为补上这个缺口而写的: **Windows 和 macOS 都能用**, 界面和功能完全一样。配置存在键盘里而不是电脑里, 所以在一台机器上写好的配置, 换到另一台机器插上就是一样的效果。

> ⚠️ 本工具通过 USB HID 向键盘固件写入配置。虽然内置多重安全熔断, 但修改固件配置始终有风险, 请先阅读[故障与救援](#故障与救援)。本工具与 GANSS 官方无关。
>
> ⚠️ **当前开发版 (2026-11-24) 尚未完成实机验证**, 宏绑定和鼠标宏的编码在这一版做了较大修正。验证完成前, 请只在自己的键盘上试用。

### 功能

- **按键映射**: 按真实布局点键, 可设为默认 / 键盘功能 (改键或带 Ctrl、Alt、Shift、Win 的组合键) / 鼠标 / 宏 / 连击 / 多媒体 / 系统快捷键 (Windows、macOS) / 禁用。改过的键按功能着色。
- **直接映射组合键**: 可以把一个键直接设成 Ctrl+A、Win+Shift+S 等组合键。官方老软件的单键映射不支持组合键, 只能录宏代替。(已实机确认可用。)
- **macOS 功能键**: 预设屏幕亮度、推出、调度中心、启动台、地球键, 以及 Spotlight、截图、锁屏等常用 Mac 快捷键 (老软件没有)。部分项目待在 Mac 上实机确认。
- **宏库**: 录制按键序列, 逐条调整"之后等待"和顺序, 可手动插入按键、鼠标事件、延时 (最长 99999999 ms); 显示总时长和占用空间。宏存放在键盘里, 所有配置档共用。
- **配置档**: 新建 / 保存 / 另存为 / 删除 / 导入 / 导出 (JSON)。
- **草稿 → 写入**: 界面上的修改只是草稿, 点"写入到键盘"才真正写入; 写入前列出所有变更。
- **一键还原**: 清除键盘上所有改键与禁用, 写回出厂默认。
- **安全熔断**: 写入前探测心跳; 会话中任何一步应答异常立即中止, 不再发送后续报文。写入中途失败时把"键盘当前状态"标记为未知, 下次自动全量写入。
- 浅色 / 深色主题。

### 运行

需要 Node.js (含 npm)。

```bash
cd app
npm install
npm test                         # 离线单测, 不碰键盘
npm start                        # 开发运行
npm run dist                     # 打包, 产物: app/dist/*-portable.exe
```

> 部分 Windows 电脑上 Chromium 沙箱无法启动, 程序会一打开就闪退。本工具只在 Windows 上关闭沙箱 (`--no-sandbox`), 打包后的 `win-unpacked\` 可以直接运行。界面只加载本地文件, 关闭沙箱的影响很小; macOS / Linux 上仍保留沙箱。
>
> npm 下载 Electron 二进制若被拦截, 可设置镜像: `set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`

#### macOS

```bash
cd app
npm install
npm run dist:mac                 # 打包 arm64 + x64; 也可用 GitHub Actions 手动跑 "Build macOS app"
```

装好后首次运行要做两件事, 否则点"写入到键盘"会报 `0xE00002C1` 而中止:

1. 去掉下载带来的隔离属性 (从 GitHub 下的 zip 一定带): `xattr -dr com.apple.quarantine "/Applications/GANSS GM108 Remap.app"`
2. 授权 **输入监控** (Input Monitoring): macOS 12 及更早 → "系统偏好设置 → 安全性与隐私 → 隐私 → 输入监控"; macOS 13 及以后 → "系统设置 → 隐私与安全性 → 输入监控"。点 `+` 添加本 App 并勾选, 然后**完全退出本工具再重开** (授权必须重启进程才生效)。
   原因: 键位段命令走的 `usagePage 1 / usage 6` 键盘接口正被系统键盘驱动使用, 打开它属于特权操作。

> CI 产物是 ad-hoc 签名 (未做公证), 系统按签名指纹记账, **重新打包/覆盖安装后这个勾选可能失效, 需要重新勾一次**。

### 发布 (不需要在本地编译)

Windows 与 macOS 的发行包都由 GitHub 云上的机器构建并发布到 Releases, 本地只需要推一个 tag:

```bash
cd app && npm version 0.1.1 --no-git-tag-version && cd ..
git commit -am "release: 0.1.1" && git push
git tag v0.1.1 && git push --tags          # 触发 .github/workflows/release.yml
```

产物在仓库的 **Releases** 页下载: `*-portable.exe`、`*-mac-arm64.zip`、`*-mac-x64.zip`。
tag 与 `app/package.json` 里的版本号不一致时构建会直接失败 (防忘记改版本号)。
发版前想人工先验一遍, 可以手动跑 "Build macOS app" —— 它只把包放到 Actions 的 Artifacts, 不发 Release。

### 使用流程

1. 关闭 GANSS 官方老配置软件 (它会独占键盘), 插好键盘, 打开本工具。顶栏应显示绿色的"GANSS GM108 已连接"。
2. 在"按键映射"页点击键盘上的键, 在右侧面板选功能, 点"应用到草稿"。底部显示"待下发变更 N 处"。
3. 需要宏时: 切到"宏库"页 → 新建 → 录制或手动插入 → 保存宏; 再回到"按键映射", 把它绑到某个键上。
4. 确认无误后点右下角"写入到键盘"→ 确认。写入期间**勿拔线、勿按键**, 状态栏会显示已用秒数。
5. 想全部还原: 点顶栏"一键还原"。
6. 用老软件改过键盘、或换了电脑后: 打开"帮助 / 救援", 点"标记键盘状态未知", 下次写入会全量下发。

### 工作原理

键盘主控为 SONiX SN32F240B (ARM Cortex-M0)。配置以 HID Feature Report 写入:

- 命令通道: `VID_0C45&PID_8006` 的 mi_00 键盘接口 (macOS 上即 `IOUSBHostInterface@0`, `usagePage 1 / usage 6`, 带 64 字节 Feature 报告 0x00)。
- 写会话: `04 ab` 握手 → 随机挑战块 → `04 02` 状态 → 段头 `04 <段号>` (含块数) → N×64B 数据块 → `04 02` 收尾, 前后各一次 `04 18` 心跳。每一步都校验应答。
- 键位段 (`04 11`): 640 字节, 每格 4 字节, 位于 `格号 × 4`。改键 = `02 <修饰位> <HID usage> 00`, 禁用 = `05 03 00 00`, 宏绑定 = `06 <槽> <模式> <次数>`。
- 宏库段 (`04 15`): 100 个槽的指针表 + 宏数据, 每步 4 字节 (按键 / 鼠标 / 延时), 段长随宏的多少变化。
- 协议由对官方老软件抓包逆向得到, 各种编码均与抓包逐字节比对过。

`probe/` 目录保留了逆向与抓包脚本 (`cap.js` 用 frida 抓老软件的 HID 通信), 供学习参考。

### 故障与救援

- **检测不到设备**: 关闭官方老配置软件后重插 USB。
- **写入中止 (红字熔断)**: 拔插 USB, 确认键盘能正常打字后再重试; 反复失败请不要强行写入。熔断能大幅降低写坏键盘的风险, 但不能百分之百保证。
- **键盘完全无反应 (灯全灭)**: 需开壳用 K3-BOOT 触点进入刷固件模式, 再用**官方**刷写工具重刷固件。具体步骤见应用内"帮助 / 救援"页。
  - 官方刷写工具随本仓库提供: [`firmware/GM108_Keyboard_V1.16_0304_firmware.exe`](firmware/GM108_Keyboard_V1.16_0304_firmware.exe) (原版 OEM 工具, 版权归 GANSS / SONiX 所有; `firmware/` 内另有原包与固件提取分析产物, 仅供救援与研究)。**请另行备份该 exe。**
  - ⚠️ 严禁用第三方烧录器直接刷 `.bin`, 官方刷写含传输加密, 第三方刷入会变砖。

### 许可

[MIT](LICENSE)

---

## English

An open-source key remapping tool for the **GANSS GM108** mechanical keyboard, built on Electron + node-hid. No installation and no background process. Changes are written to the keyboard firmware and persist across reboots and computers.

**Why this exists**: the official configuration software is Windows-only — it cannot be installed or run on macOS at all, so Mac users of this keyboard were stuck with the Fn shortcuts and had no way to remap keys, record macros or disable keys. This tool closes that gap: it runs on **both Windows and macOS** with the same interface and features. The configuration lives in the keyboard rather than on the computer, so a profile written from either machine behaves identically on the other.

> ⚠️ This tool writes configuration to the keyboard firmware over USB HID. Despite built-in safety circuit-breakers, this always carries risk. Read [Troubleshooting & Recovery](#troubleshooting--recovery) first. Not affiliated with GANSS.
>
> ⚠️ **The current development build (2026-11-24) has not finished on-device verification.** The encoding of macro bindings and mouse macros was substantially corrected in this build. Until verification is done, only try it on your own keyboard.

### Features

- **Key mapping**: click keys on a true-to-life layout and set them to default, a key or combo (with Ctrl/Alt/Shift/Win), mouse, macro, multi-key sequence, media key, a Windows/macOS system shortcut, or disabled. Modified keys are colour-coded by function.
- **Direct combo mapping**: map a single key straight to a combo such as Ctrl+A or Win+Shift+S. The official legacy software cannot do this in its key mapping and only offers recording a macro instead. (Confirmed working on the device.)
- **macOS function keys**: presets for display brightness, Eject, Mission Control, Launchpad and the Globe key, plus common Mac shortcuts such as Spotlight, screenshots and lock screen (not in the legacy software). Some are still to be confirmed on a Mac.
- **Macro library**: record key sequences, adjust each step's wait and order, insert keys, mouse events and delays (up to 99,999,999 ms); shows total duration and storage used. Macros are stored in the keyboard and shared by all profiles.
- **Profiles**: new / save / save-as / delete / import / export (JSON).
- **Draft → write**: edits are drafts until you click **Write to keyboard**; all changes are listed for confirmation first.
- **One-click restore**: clears all remaps and disables and writes factory defaults.
- **Circuit-breaker safety**: probes the heartbeat before writing and aborts immediately on any abnormal response. If a write fails midway, the keyboard state is marked unknown and the next write is a full write.
- Light and dark themes.

### Run

Requires Node.js (with npm).

```bash
cd app
npm install
npm test                         # offline unit tests, does not touch the keyboard
npm start                        # development run
npm run dist                     # build; output: app/dist/*-portable.exe
```

> On some Windows machines the Chromium sandbox fails to start and the app exits immediately. The app disables the sandbox on Windows only (`--no-sandbox`), so the packaged `win-unpacked\` folder can be run directly. The UI only loads local files, so the impact is small; macOS / Linux keep the sandbox.

#### macOS

```bash
cd app
npm install
npm run dist:mac                 # builds arm64 + x64; or run the "Build macOS app" workflow on GitHub
```

Before the first successful write, macOS needs two things, otherwise it aborts with `0xE00002C1`:

1. Drop the quarantine attribute that comes with a downloaded zip: `xattr -dr com.apple.quarantine "/Applications/GANSS GM108 Remap.app"`
2. Grant **Input Monitoring** (System Settings → Privacy & Security → Input Monitoring), add this app, then **quit it completely and reopen** — the permission only applies to a new process. Reason: the keymap command channel is the `usagePage 1 / usage 6` keyboard interface, which the system keyboard driver is already using, so opening it is a privileged operation.

> CI artifacts are ad-hoc signed (not notarised), and macOS records the permission against the signature — after a rebuild or reinstall the checkbox may need to be ticked again.

### Workflow

1. Close the legacy GANSS software (it holds the keyboard exclusively), plug in the keyboard and launch the tool. The top bar should show a green "GANSS GM108 connected".
2. On the **Key mapping** page, click a key, choose a function in the right panel and click **Apply to draft**. The bottom bar shows the number of pending changes.
3. For macros: switch to the **Macro library** page → New → record or insert steps → Save; then go back and bind the macro to a key.
4. Click **Write to keyboard** → confirm. **Do not unplug or press keys while writing**; the status bar shows elapsed seconds.
5. To revert everything: click **One-click restore** in the top bar.
6. After using the legacy software or switching computers: open **Help / Recovery** and click **Mark keyboard state unknown**, so the next write is a full write.

### How it works

The keyboard uses a SONiX SN32F240B (ARM Cortex-M0). Configuration is written via HID Feature Reports:

- Command channel: the mi_00 keyboard interface of `VID_0C45&PID_8006`.
- Write session: `04 ab` handshake → random challenge block → `04 02` status → section header `04 <section>` (with block count) → N×64B data blocks → `04 02`, with a `04 18` heartbeat before and after. Every step's reply is verified.
- Keymap section (`04 11`): 640 bytes, 4 bytes per key at `index × 4`. Remap = `02 <modifiers> <HID usage> 00`, disable = `05 03 00 00`, macro binding = `06 <slot> <mode> <count>`.
- Macro section (`04 15`): a 100-slot pointer table plus macro data, 4 bytes per step (key / mouse / delay); its length depends on how many macros there are.
- The protocol was reverse-engineered from captures of the official software, and every encoding has been compared byte-for-byte with captures.

### Troubleshooting & Recovery

- **Device not detected**: close the legacy GANSS software, then replug USB.
- **Write aborted (red circuit-breaker message)**: replug USB, confirm the keyboard types normally, then retry. Don't force repeated writes. The circuit-breaker greatly reduces the risk of a bad write but cannot guarantee it.
- **Keyboard completely dead (all lights off)**: open the case, enter bootloader mode via the K3-BOOT test point, then reflash with the **official** tool. See the in-app Help / Recovery page.
  - The official flashing tool ships with this repository: [`firmware/GM108_Keyboard_V1.16_0304_firmware.exe`](firmware/GM108_Keyboard_V1.16_0304_firmware.exe) (unmodified OEM tool; copyright GANSS / SONiX). Back it up separately.
  - ⚠️ Never flash a `.bin` with a third-party programmer; the official flash uses transfer encryption and third-party flashing will brick the board.

### License

[MIT](LICENSE)
