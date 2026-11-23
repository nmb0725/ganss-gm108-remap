import struct, collections, math, zlib, hashlib, os, re

EXE = r"l:\git\ganss\firmware\GM108_Keyboard_V1.16_0304_firmware.exe"
d = open(EXE, 'rb').read()
e_lfanew = struct.unpack_from('<I', d, 0x3C)[0]
nsec, = struct.unpack_from('<H', d, e_lfanew+6)
sizeopt, = struct.unpack_from('<H', d, e_lfanew+20)
opt = e_lfanew + 24
nro, = struct.unpack_from('<I', d, opt+92)
ddoff = opt+96
secs=[]
soff = opt+sizeopt
for i in range(nsec):
    o = soff+i*40
    name = d[o:o+8].rstrip(b'\x00').decode('latin1')
    vsz, va, rawsz, rawptr = struct.unpack_from('<IIII', d, o+8)
    secs.append((name, rawptr, va, rawsz, vsz))
def r2o(rva):
    for s in secs:
        if s[2] <= rva < s[2]+max(s[3], s[4]): return s[1]+(rva-s[2])
rrva, rsz = struct.unpack_from('<II', d, ddoff+16)
ro = r2o(rrva)
leaves=[]
TYPES={10:'RCDATA',16:'VERSION',24:'MANIFEST',5:'DIALOG',6:'STRING',2:'BITMAP',3:'ICON',14:'GROUP_ICON',1:'CURSOR',4:'MENU'}
def rd(off, level, path):
    named, ident = struct.unpack_from('<HH', d, off+12)
    for i in range(named+ident):
        e = off+16+i*8
        nv, = struct.unpack_from('<I', d, e)
        if nv & 0x80000000:
            so = ro+(nv & 0x7FFFFFFF); ln = struct.unpack_from('<H', d, so)[0]
            label = d[so+2:so+2+ln*2].decode('utf-16-le','replace')
        else:
            label = TYPES.get(nv, "#%d"%nv) if level==0 else "#%d"%nv
        n2, = struct.unpack_from('<I', d, e+4)
        if level<2 and (n2 & 0x80000000):
            rd(ro+(n2 & 0x7FFFFFFF), level+1, path+(label,))
        else:
            doff, dsz, c, cp = struct.unpack_from('<IIII', d, ro+n2)
            leaves.append((r2o(doff), dsz, "/".join(map(str, path+(label,)))))
rd(ro, 0, ())

OUT = r"l:\git\ganss\firmware\extracted"
os.makedirs(OUT, exist_ok=True)
for fo, dsz, p in leaves:
    if not p.startswith("RCDATA"): continue
    seg = d[fo:fo+dsz]
    safe = p.replace('/','_')
    fp = os.path.join(OUT, safe + ".bin")
    open(fp,'wb').write(seg)
    cnt = collections.Counter(seg); n=len(seg)
    H = -sum((x/n)*math.log2(x/n) for x in cnt.values())
    print("== %s off=0x%X size=%d entropy=%.2f crc32=%s md5=%s" % (fp, fo, dsz, H, hex(zlib.crc32(seg)), hashlib.md5(seg).hexdigest()))
    print("   first64:", seg[:64].hex(' '))
    print("   last32 :", seg[-32:].hex(' '))
    print("   ff%%=%.1f 00%%=%.1f" % (100*cnt[0xff]/n, 100*cnt[0]/n))
    if seg[:4] == b'PK\x03\x04': print("   -> ZIP archive")
    print("   vector table words:")
    for off2 in range(0, 0x20, 4):
        print("     %04X=%08X" % (off2, int.from_bytes(seg[off2:off2+4],'little')))
