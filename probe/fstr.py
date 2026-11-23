import re, sys
for path in [r"l:\git\ganss\firmware\extracted\SN32F240B_32.bin",
             r"l:\git\ganss\firmware\extracted\RCDATA_#4000_#0.bin"]:
    d = open(path, 'rb').read()
    print("="*80); print(path, len(d))
    out = []
    for m in re.finditer(rb'[\x20-\x7e]{5,}', d):
        out.append((m.start(), 'A', m.group().decode('latin1')))
    for m in re.finditer(rb'(?:[\x20-\x7e]\x00){4,}', d):
        out.append((m.start(), 'U', m.group().decode('utf-16-le')))
    out.sort()
    for o, k, s in out:
        print("  %06X %s %s" % (o, k, s))
