import struct, collections, math, zlib, hashlib, os, re, sys

EXE = r"l:\git\ganss\firmware\GM108_Keyboard_V1.16_0304_firmware.exe"
d = open(EXE, 'rb').read()
print("size", len(d), "crc32", hex(zlib.crc32(d)), "md5", hashlib.md5(d).hexdigest())
e_lfanew = struct.unpack_from('<I', d, 0x3C)[0]
mach, nsec, ts = struct.unpack_from('<HHI', d, e_lfanew+4)
sizeopt, chars = struct.unpack_from('<HH', d, e_lfanew+20)
print("PE@0x%X machine %04X nsec %d time 0x%X sizeopt %d chars %04X" % (e_lfanew, mach, nsec, ts, sizeopt, chars))
opt = e_lfanew + 24
magic, = struct.unpack_from('<H', d, opt)
ent, = struct.unpack_from('<I', d, opt+16)
ib, sa, fa = struct.unpack_from('<III', d, opt+28)
nro, = struct.unpack_from('<I', d, opt+92)
ddoff = opt + 96
import datetime
print("PE32 magic %04X entry %08X imagebase %08X secalign %d filealign %d nro %d linkerver %d.%d buildtime 0x%X" % (
    magic, ent, ib, sa, fa, nro, d[opt+2], d[opt+3], ts))
names = ["EXPORT","IMPORT","RESOURCE","EXCEPTION","CERT","BASERELOC","DEBUG","ARCH","GLOBALPTR","TLS","LOAD_CONFIG","BOUND_IMP","IAT","DELAY","CLR","RES"]
dd = []
for i in range(min(nro, 16)):
    rva, sz = struct.unpack_from('<II', d, ddoff + i*8)
    dd.append((rva, sz))
    if sz: print("  DD[%02d] %-11s rva=%08X size=%08X" % (i, names[i], rva, sz))
dd += [(0,0)]*(16-len(dd))

secs = []
soff = opt + sizeopt
def r2o(rva):
    for s in secs:
        if s[2] <= rva < s[2] + max(s[3], s[4]):
            return s[1] + (rva - s[2])
    return None
print("--- sections ---")
for i in range(nsec):
    o = soff + i*40
    name = d[o:o+8].rstrip(b'\x00').decode('latin1')
    vsz, va, rawsz, rawptr = struct.unpack_from('<IIII', d, o+8)
    sc, = struct.unpack_from('<I', d, o+36)
    secs.append((name, rawptr, va, rawsz, vsz))
    seg = d[rawptr:rawptr+rawsz]
    H = 0
    if seg:
        c = collections.Counter(seg); n=len(seg)
        H = -sum((x/n)*math.log2(x/n) for x in c.values())
    print("  %-8s off=0x%08X rawsz=%7d va=%08X vsz=%7d chars=%08X entropy=%.2f" % (name, rawptr, rawsz, va, vsz, sc, H))
print("end of last section: 0x%X  filesize 0x%X  overlay=%d" % (secs[-1][1]+secs[-1][3], len(d), len(d)-(secs[-1][1]+secs[-1][3])))

# certificate
crva, csz = dd[4]
if csz:
    print("--- CERT fileoff=0x%X size=%d type=%d ---" % (crva, csz, struct.unpack_from('<I', d, crva+8)[0]))
    print("   head:", d[crva:crva+16].hex(' '))
    pk = d.find(b'\x30\x82', crva)
    print("   pkcs7 @0x%X, contains:" % pk)
    for m in re.finditer(rb'[ -~]{6,}', d[crva:crva+csz]):
        print("     ", m.group().decode()[:120])

# imports
irva, isz = dd[1]
io = r2o(irva)
print("--- imports ---")
dlls=[]
for k in range(64):
    entb = d[io:io+20]
    oft, t, fc, namerva, ft = struct.unpack('<IIIII', entb)
    if namerva == 0 and oft == 0 and ft == 0: break
    no = r2o(namerva)
    nm = d[no:d.index(b'\x00', no)].decode('latin1')
    thrunk = oft if oft else ft
    to = r2o(thrunk)
    funcs = []
    while to:
        v, = struct.unpack_from('<I', d, to); to += 4
        if v == 0 or (v & 0x80000000): break
        fo = r2o(v & 0x7FFFFFFF)
        if fo is None: break
        funcs.append(d[fo+2:d.index(b'\x00', fo+2)].decode('latin1'))
    dlls.append((nm, funcs))
    print("  %s (%d): %s" % (nm, len(funcs), ", ".join(funcs)))
    io += 20

# delay imports
drva, dsz2 = dd[13]
doff2 = r2o(drva)
if dsz2:
    print("--- delay imports ---")
    for k in range(16):
        o = doff2 + k*32
        a1, namerva, iova, bva, lva, sup = struct.unpack_from('<IIIIII', d, o)
        if namerva == 0: break
        no = r2o(namerva)
        print("  ", d[no:d.index(b'\x00', no)].decode('latin1'))

# resources
print("--- resources ---")
rrva, rsz = dd[2]
ro = r2o(rrva)
TYPES = {1:'CURSOR',2:'BITMAP',3:'ICON',4:'MENU',5:'DIALOG',6:'STRING',7:'FONTDIR',8:'FONT',9:'ACCELERATOR',10:'RCDATA',14:'GROUP_ICON',16:'VERSION',24:'MANIFEST'}
leaves=[]
def rd(off, level, path):
    named, ident = struct.unpack_from('<HH', d, off+12)
    ch = named + ident; idict = off + 16
    for i in range(ch):
        e = idict + i*8
        nv, = struct.unpack_from('<I', d, e)
        if nv & 0x80000000:
            so = ro + (nv & 0x7FFFFFFF); ln = struct.unpack_from('<H', d, so)[0]
            label = d[so+2:so+2+ln*2].decode('utf-16-le','replace')
        else:
            label = TYPES.get(nv, "#%d" % nv) if level == 0 else "#%d" % nv
        n2, = struct.unpack_from('<I', d, e+4)
        if level < 2 and (n2 & 0x80000000):
            sub = ro + (n2 & 0x7FFFFFFF)
            if sub is None: print("  BADSUB", path, label); continue
            rd(sub, level+1, path+(label,))
        else:
            de = ro + n2
            doff, dsz, c, codep = struct.unpack_from('<IIII', d, de)
            fo = r2o(doff)
            leaves.append((fo, dsz, "/".join(map(str, path+(label,)))))
if rsz:
    rd(ro, 0, ())
for fo, dsz, p in sorted(leaves, key=lambda x:-x[1])[:40]:
    seg = d[fo:fo+dsz]
    c = collections.Counter(seg); n = max(len(seg),1)
    H = -sum((x/n)*math.log2(x/n) for x in c.values()) if seg else 0
    print("  %-45s off=0x%08X size=%7d entropy=%.2f head=%s" % (p, fo, dsz, H, seg[:8].hex(' ')))
print("TOTAL resource leaves:", len(leaves), "bytes:", sum(x[1] for x in leaves))
open(r"l:\git\ganss\probe\resources.txt","w").write("\n".join("0x%X %d %s"%(a,b,c) for a,b,c in sorted(leaves)))
