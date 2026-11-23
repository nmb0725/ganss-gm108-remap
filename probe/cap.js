// GM108 HID 抓包: frida spawn 老软件, hook hid.dll 的 HidD_SetFeature/GetFeature
// 用法: node cap.js            启动并抓取, Ctrl+C 结束
//       回车 可在日志中打一个 MARK 标记(方便圈出操作时刻)
const frida = require('frida');
const fs = require('fs');
const readline = require('readline');

const EXE = process.env.GM108_EXE || 'C:\\Program Files\\GM108 Keyboard\\GM108 Keyboard.exe';
const OUT = process.argv[2] || 'cap_' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.log';

const agent = `
function getMod(name){ try { return Process.getModuleByName(name); } catch(e){ return null; } }
function hooked(){ return (globalThis.__h = globalThis.__h || {}); }

function install(){
  const hid = getMod('hid.dll');
  if(!hid) return false;
  const H = hooked();

  // hook CreateFileW (kernel32 + kernelbase): 记录设备路径 -> 句柄
  for(const modName of ['kernel32.dll', 'kernelbase.dll']){
    const key = 'CreateFileW@' + modName;
    if(H[key]) continue;
    const m = getMod(modName);
    const a = m && m.findExportByName('CreateFileW');
    if(!a) continue;
    H[key] = true;
    Interceptor.attach(a, {
      onEnter(args){
        try { this.path = args[0].readUtf16String(); } catch(e){ this.path = null; }
        this.acc = args[1]; this.share = args[2]; this.disp = args[4]; this.flags = args[5];
      },
      onLeave(ret){
        const p = this.path || '';
        if(/mi_03/i.test(p))
          send({info: 'OPEN handle=' + ret + ' acc=0x' + this.acc + ' share=0x' + this.share +
                      ' disp=0x' + this.disp + ' flags=0x' + this.flags + ' ' + p});
      }
    });
    send({info: 'HOOKED CreateFileW@' + modName});
  }

  const targets = [
    ['HidD_SetFeature', 'SET'],
    ['HidD_GetFeature', 'GET'],
    ['HidD_SetOutputReport', 'OUT'],
    ['HidD_GetInputReport', 'INP']
  ];
  for(const [name, tag] of targets){
    if(H[name]) continue;
    let addr = null;
    try { addr = hid.findExportByName(name); } catch(e){}
    if(!addr) continue;
    H[name] = true;
    Interceptor.attach(addr, {
      onEnter(args){ this.h = args[0]; this.buf = args[1]; this.len = args[2].toUInt32(); this.tag = tag; },
      onLeave(ret){
        let hex = '<err>';
        try {
          const b = this.buf.readByteArray(this.len);
          hex = b ? Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join(' ') : '<null>';
        } catch(e){ hex = '<err:' + e.message + ' ptr=' + this.buf + '>'; }
        send({api:name, tag:this.tag, len:this.len, ret:ret.toInt32(),
              handle: String(this.h), hex});
      }
    });
    send({info:'HOOKED ' + name});
  }
  return Object.keys(H).length > 0;
}

if(!install()){
  const t = setInterval(() => { if(install()) clearInterval(t); }, 100);
}
`;

function ts() {
  const d = new Date();
  return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

(async () => {
  const log = fs.createWriteStream(OUT, { flags: 'a' });
  const put = (line) => { const s = ts() + ' ' + line; console.log(s); log.write(s + '\n'); };

  // attach 模式: node cap.js <out.log> --attach <pid>   (挂到已在运行的实例, 单实例软件 spawn 会被接管时必须用它)
  const attachIdx = process.argv.indexOf('--attach');
  if (attachIdx > 0) {
    const pid = Number(process.argv[attachIdx + 1]);
    put('#### attach pid=' + pid + ' -> ' + OUT);
    const session = await frida.attach(pid);
    const script = await session.createScript(agent);
    const onMsg = (m) => {
      if (m.type === 'send') {
        const p = m.payload;
        if (p.info) put(p.info);
        else put(`${p.tag} h=${p.handle} len=${p.len} ret=${p.ret} [${p.hex}]`);
      } else console.error('frida:', m);
    };
    if (script.message && script.message.connect) script.message.connect(onMsg);
    else script.on('message', onMsg);
    await script.load();
    put('#### attached (回车=MARK, Ctrl+C 结束)');
    readline.createInterface({ input: process.stdin, output: process.stdout })
      .on('line', () => put('#### MARK <<<< 操作标记'));
    setInterval(() => {}, 1000);
    process.on('SIGINT', async () => { put('#### end'); process.exit(0); });
    return;
  }

  put('#### start spawn ' + EXE + '  -> ' + OUT);

  let pid;
  const extraArgv = process.env.SPAWN_ARGV ? JSON.parse(process.env.SPAWN_ARGV) : null;
  try {
    if (extraArgv) {
      pid = await frida.spawn(EXE, extraArgv);
    } else {
      try {
        pid = await frida.spawn(EXE);
      } catch (e1) {
        pid = await frida.spawn({ path: EXE, argv: [EXE] });
      }
    }
  } catch (e) {
    console.error('spawn 失败:', e.message);
    console.error('如果老软件要求管理员权限, 请用管理员终端手动跑: node cap.js');
    process.exit(1);
  }
  const session = await frida.attach(pid);
  const script = await session.createScript(agent);
  const onMsg = (m) => {
    if (m.type === 'send') {
      const p = m.payload;
      if (p.info) put(p.info);
      else put(`${p.tag} h=${p.handle} len=${p.len} ret=${p.ret} [${p.hex}]`);
    } else console.error('frida:', m);
  };
  if (script.message && script.message.connect) script.message.connect(onMsg);
  else script.on('message', onMsg);
  await script.load();
  await frida.resume(pid);
  put('#### attached pid=' + pid + '  (回车=MARK, Ctrl+C 结束)');

  readline.createInterface({ input: process.stdin, output: process.stdout })
    .on('line', () => put('#### MARK <<<< 操作标记'));
  setInterval(() => {}, 1000); // stdin 关闭时保持进程存活

  process.on('SIGINT', async () => { put('#### end'); process.exit(0); });
})().catch(e => { console.error(e); process.exit(1); });
