import zlib, hashlib, os, collections, math
EXE = r"l:\git\ganss\firmware\GM108_Keyboard_V1.16_0304_firmware.exe"
d = open(EXE, 'rb').read()
boot = d[0x1AC378:0x1AC378+65536]
fw = open(r"l:\git\ganss\firmware\extracted\SN32F240B_32.bin", 'rb').read()
print("boot size", len(boot), "fw size", len(fw))
same = sum(1 for a, b in zip(boot, fw) if a == b)
print("identical bytes: %d/%d (%.2f%%)" % (same, len(fw), 100*same/len(fw)))
# first divergence
diff = [i for i in range(min(len(boot),len(fw))) if boot[i] != fw[i]]
print("num diff %d, first 10 diffs: %s" % (len(diff), ["0x%X" % i for i in diff[:10]]))
print("boot @0x1820:", boot[0x1820:0x1850].hex(' '))
print("exe  @0x1AD90:", d[0x1AD90:0x1ADC8].hex(' '))
print("fw   first64:", fw[:64].hex(' '))
print("boot first64:", boot[:64].hex(' '))
# high non-zero extent of boot
nz = max(i for i, b in enumerate(boot) if b != 0)
print("boot last non-zero offset 0x%X (%d)" % (nz, nz))
nzf = max(i for i, b in enumerate(fw) if b != 0xFF and b != 0)
print("fw  last interesting offset 0x%X" % nzf)
for nm, b in (("boot", boot), ("fw", fw)):
    nz2 = len(b)
    while nz2 > 0 and b[nz2-1] in (0, 0xFF): nz2 -= 1
    print("  %s trimmed(0/FF) len=0x%X (%d)" % (nm, nz2, nz2))

# 16-bit checksum candidates for '4C21'
def cands(name, b):
    res = {}
    res['sum8_mod65536'] = sum(b) & 0xFFFF
    s = 0
    for i in range(0, len(b)-1, 2):
        s += b[i] | (b[i+1] << 8)
    res['sum16le_mod65536'] = s & 0xFFFF
    s2 = 0
    for i in range(0, len(b)-1, 2):
        s2 = (s2 + (b[i] << 8) + b[i+1]) & 0xFFFF
    res['sum16be'] = s2
    res['sum8_not'] = (~sum(b)) & 0xFFFF
    res['xor16'] = 0
    x = 0
    for i in range(0, len(b)-1, 2):
        x ^= (b[i] | (b[i+1] << 8))
    res['xor16'] = x
    print(name, {k: hex(v) for k, v in res.items()})
cands("fw.bin", fw)
cands("boot(4000)", boot)
hexraw = open(r"l:\git\ganss\firmware\_pe\Settings\FWFiles\SN32F240B_32.hex", 'rb').read()
cands("hex-raw", hexraw)
