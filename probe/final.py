import re, collections, math, struct
EXE = r"l:\git\ganss\firmware\GM108_Keyboard_V1.16_0304_firmware.exe"
d = open(EXE, 'rb').read()
print("### installer/packer sentinels")
for pat in [b'Nullsoft', b'NSIS', b'Nullsoft Inst', b'Inno Setup', b'jr.InnoSetup', b'7z-ZSFX', b'MZ\x90\x00\x03\x00', b'UPX!', b'ASPack', b'Themida', b'.enigma', b'PECompact', b'MPRESS', b' Petite', b'BOFH', b'Aspack', b'WLH', b'vbox', b'x96Set', b'SelfExtracting', b'autoit']:
    hs = [m.start() for m in re.finditer(re.escape(pat), d)]
    if hs: print("  FOUND", pat, ["0x%X" % h for h in hs[:6]])
print("  (nothing printed above = none found)")
print("  DOS stub text:", d[0x4D:0x100].split(b'\x00')[0])
print("  section names:", [s for s in re.findall(rb'\.(text|rdata|data|rsrc|idata|reloc|debug|tls|rsrc)\x00', d[:0x400])])

print("### VERSION resource")
v = d[0x1D0C90:0x1D0C90+412]
for m in re.finditer(rb'(?:[\x20-\x7e]\x00){3,}', v):
    print("   ", m.group().decode('utf-16-le'))
print("  raw:", v[:64].hex(' '))
print("### MANIFEST")
print(d[0x1D0E2C:0x1D0E2C+346].decode('utf-8', 'replace'))
print("### per-1KB entropy of FW / BOOT")
for nm, p in [("FW", r"l:\git\ganss\firmware\extracted\SN32F240B_32.bin"), ("BOOT", r"l:\git\ganss\firmware\extracted\RCDATA_#4000_#0.bin")]:
    b = open(p, 'rb').read()
    row = []
    for i in range(0, len(b), 0x1000):
        seg = b[i:i+0x1000]; c = collections.Counter(seg)
        row.append("%.2f" % -sum((x/len(seg))*math.log2(x/len(seg)) for x in c.values()))
    print("  %s:" % nm, " ".join(row))
