import sys, collections, math, os, zlib, hashlib

path = r"l:\git\ganss\firmware\_pe\Settings\FWFiles\SN32F240B_32.hex"
raw = open(path, 'rb').read()
lines = raw.splitlines()
print("file size", len(raw), "lines", len(lines))
recs = collections.Counter()
mem = {}
base = 0
badck = 0
nonhex = 0
maxline = 0
for ln in lines:
    if not ln.strip():
        continue
    s = ln.decode('ascii', 'replace').strip()
    if not s.startswith(':'):
        nonhex += 1
        if nonhex < 5: print("NONHEX:", repr(s[:60]))
        continue
    maxline = max(maxline, len(s))
    try:
        d = bytes.fromhex(s[1:])
    except Exception as e:
        print("BADHEX", repr(s)); continue
    n = d[0]; addr = (d[1] << 8) | d[2]; typ = d[3]
    data = d[4:4 + n]
    ck = (~ (sum(d[:-1])) + 1) & 0xFF
    if ck != d[-1] or len(d) != n + 5:
        badck += 1
    recs[typ] += 1
    if typ == 0:
        a = base + addr
        for i, b in enumerate(data):
            mem[a + i] = b
    elif typ == 1:
        recs['EOF'] += 1
    elif typ == 2:
        base = ((data[0] << 8) | data[1]) << 4
    elif typ == 4:
        base = ((data[0] << 8) | data[1]) << 16
        print("  ext-addr(04) -> base %08X" % base)
    elif typ == 5:
        print("  start-addr(05) = %08X" % int.from_bytes(data, 'big'))

print("record types:", dict(recs), "badchecksum:", badck, "nonhex lines:", nonhex, "max line len:", maxline)
addrs = sorted(mem)
print("addr range: %08X - %08X  span=%d  defined=%d" % (addrs[0], addrs[-1], addrs[-1]-addrs[0]+1, len(mem)))
prev = None; gaps = []
for a in addrs:
    if prev is not None and a != prev + 1:
        gaps.append((prev + 1, a - 1, a - prev - 1))
    prev = a
print("num gaps:", len(gaps))
for g in gaps[:30]:
    print("  gap %08X..%08X len=%d fill=%02X" % (g[0], g[1], g[2], mem.get(g[0], 0)))

lo = addrs[0]; hi = addrs[-1]
size = hi - lo + 1
img = bytearray(b'\xff' * size)
for a, b in mem.items():
    img[a - lo] = b
os.makedirs(r"l:\git\ganss\firmware\extracted", exist_ok=True)
out = r"l:\git\ganss\firmware\extracted\SN32F240B_32.bin"
open(out, 'wb').write(bytes(img))
print("WROTE", out, "base %08X size %d" % (lo, size))
cnt = collections.Counter(img)
H = -sum((c/size)*math.log2(c/size) for c in cnt.values())
print("entropy %.4f bits/byte" % H)
print("ff %d (%.2f%%)  00 %d (%.2f%%)" % (cnt[0xff], 100*cnt[0xff]/size, cnt[0], 100*cnt[0]/size))
print("first16", ' '.join('%02x' % b for b in img[:16]))
print("--- vector table (LE words @0..0x3C) ---")
for off in range(0, 0x40, 4):
    print("  %04X = %08X" % (off, int.from_bytes(img[off:off+4], 'little')))
print("--- last 32 bytes @%08X ---" % (hi-31))
print(' '.join('%02x' % b for b in img[-32:]))
print("crc32(bin)", hex(zlib.crc32(bytes(img))))
print("md5", hashlib.md5(bytes(img)).hexdigest())
print("sha256", hashlib.sha256(bytes(img)).hexdigest())
# trimmed variant: cut trailing FF
lastnz = len(img) - 1
while lastnz > 0 and img[lastnz] == 0xFF:
    lastnz -= 1
print("last non-FF offset %d (0x%X), trimmed size %d" % (lastnz, lastnz, lastnz+1))
open(r"l:\git\ganss\firmware\extracted\SN32F240B_32_trimmed.bin", 'wb').write(bytes(img[:lastnz+1]))
