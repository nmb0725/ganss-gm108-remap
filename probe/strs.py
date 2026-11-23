import re, sys, os
EXE = r"l:\git\ganss\firmware\GM108_Keyboard_V1.16_0304_firmware.exe"
d = open(EXE, 'rb').read()
out = []
# ASCII strings >=4
for m in re.finditer(rb'[\x20-\x7e]{4,}', d):
    out.append((m.start(), 'A', m.group().decode('latin1')))
# UTF-16LE strings >=4 chars
for m in re.finditer(rb'(?:[\x20-\x7e]\x00){4,}', d):
    out.append((m.start(), 'U', m.group().decode('utf-16-le')))
out.sort()
with open(r"l:\git\ganss\probe\strings_all.txt", 'w', encoding='utf-8') as f:
    for o, k, s in out:
        f.write("%08X %s %s\n" % (o, k, s))
print("total strings:", len(out))
