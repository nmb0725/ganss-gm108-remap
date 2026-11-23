import re, zlib, struct
EXE = r"l:\git\ganss\firmware\GM108_Keyboard_V1.16_0304_firmware.exe"
d = open(EXE, 'rb').read()
def find_all(pat, label, lim=12):
    hits = [m.start() for m in re.finditer(re.escape(pat), d)]
    hs = ["0x%X" % h for h in hits[:lim]]
    if len(hits) > lim: hs.append("...")
    print("%-34s %s -> %s" % (label, pat.hex(' '), hs))
    return hits

# CRC32 reflected table (poly EDB88320)
tbl = []
for i in range(256):
    c = i
    for _ in range(8):
        c = (c >> 1) ^ (0xEDB88320 if c & 1 else 0)
    tbl.append(c)
crc_tbl = b''.join(struct.pack('<I', x) for x in tbl)
find_all(crc_tbl[:32], "CRC32 tab(EDB88320)")
# normal MSB-first table
tbl2 = []
for i in range(256):
    c = i << 24
    for _ in range(8):
        c = ((c << 1) ^ 0x04C11DB7) & 0xFFFFFFFF if c & 0x80000000 else (c << 1) & 0xFFFFFFFF
    tbl2.append(c)
find_all(b''.join(struct.pack('>I', x) for x in tbl2)[:32], "CRC32 tab(04C11DB7 BE)")
find_all(struct.pack('<I', 0xEDB88320), "poly EDB88320 imm")
find_all(struct.pack('>I', 0xEDB88320), "poly EDB88320 BE")
find_all(struct.pack('<I', 0x04C11DB7), "poly 04C11DB7 imm")
find_all(struct.pack('<I', 0x80000000) if False else b'\x20\x83\xb8\xed', "poly EDB88320 LE bytes")
# CheckDeviceCmd from INI
find_all(bytes.fromhex("AA42895AFF7162CC"), "CheckDeviceCmd(AA42895AFF7162CC)")
find_all(bytes.fromhex("AA55A55AFF0033CC"), "default CheckDeviceCmd")
# common ISP header candidates
for h in ["55AA", "AA55", "A55A", "5AA5", "12345678"]:
    b = bytes.fromhex(h) if len(h) % 2 == 0 and re.fullmatch(r'[0-9A-F]+', h) else h.encode()
    find_all(b, "pattern %s" % h, 6)
# Intel HEX in exe?
print("--- ':10' hex-record-like lines inside exe (raw) ---")
c = len(re.findall(rb':[\dA-Fa-f]{10,}', d))
print("   count:", c)
# embedded zip / 7z / rar signatures
for sig, nm in [(b'PK\x03\x04','ZIP'), (b'7z\xbc\xaf\x27\x1c','7z'), (b'Rar!\x1a\x07','RAR'), (b'\x1f\x8b','gzip'), (b'BZh','bzip2'), (b'\xfd7zXZ','xz'), (b'MZ','MZ')]:
    hits=[m.start() for m in re.finditer(re.escape(sig), d)]
    print("sig %-6s count=%d %s" % (nm, len(hits), ["0x%X"%h for h in hits[:8]]))
