import os, shutil, zlib, hashlib, struct, collections, math
F = r"l:\git\ganss\firmware"
E = os.path.join(F, "extracted")
PE = os.path.join(F, "_pe")

# verify hex against the stored CRC in the embedded zip
zipdata = open(os.path.join(E, "RCDATA_#4011_#0.bin"), 'rb').read()
off = 0
while True:
    i = zipdata.find(b'PK\x03\x04', off)
    if i < 0: break
    crc, csize, usize, nlen, elen = struct.unpack_from('<IIIHH', zipdata, i+14)
    name = zipdata[i+30:i+30+nlen].decode('latin1')
    if 'FWFiles' in name:
        st = i+30+nlen+elen
        comp = zipdata[st:st+csize]
        raw = zlib.decompress(comp, -15)
        print("zip entry %s usize=%d storedCRC=%08X actualCRC=%08X match=%s" % (name, usize, crc, zlib.crc32(raw), crc == (zlib.crc32(raw) & 0xFFFFFFFF)))
        open(os.path.join(E, "SN32F240B_32.hex"), 'wb').write(raw)
    off = i+4

# move config evidence
for f in ("UISettings.ini", "UISettings_02.ini"):
    shutil.copy2(os.path.join(PE, "Settings", f), os.path.join(E, f))
shutil.move(os.path.join(E, "RCDATA_#4000_#0.bin"), os.path.join(E, "RCDATA4000_ISPboot_SN32F24xB_64KB.bin"))
for junk in ["RCDATA_#4007_#0.bin","RCDATA_#4008_#0.bin","RCDATA_#4009_#0.bin","RCDATA_#4010_#0.bin",
             "RCDATA_#4011_#0.bin","RCDATA_#4012_#0.bin","RCDATA_#4013_#0.bin","RCDATA_#4014_#0.bin",
             "SN32F240B_32_trimmed.bin"]:
    p = os.path.join(E, junk)
    if os.path.exists(p): os.remove(p)
shutil.rmtree(PE)

print("\n%-42s %8s %s" % ("file", "size", "sha256 / first16"))
for f in sorted(os.listdir(E)):
    p = os.path.join(E, f); b = open(p,'rb').read()
    c = collections.Counter(b); n = len(b)
    H = -sum((x/n)*math.log2(x/n) for x in c.values()) if n else 0
    print("%-42s %8d %s\n   entropy=%.3f first16=%s" % (f, n, hashlib.sha256(b).hexdigest(), H, b[:16].hex(' ')))
