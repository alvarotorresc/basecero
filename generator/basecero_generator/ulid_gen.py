import os, time

_B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

def _enc(value, length):
    out = []
    for _ in range(length):
        out.append(_B32[value & 31])
        value >>= 5
    return "".join(reversed(out))

def ulid(now_ms=None):
    t = int(time.time() * 1000) if now_ms is None else now_ms
    rand = int.from_bytes(os.urandom(10), "big")
    return _enc(t, 10) + _enc(rand, 16)
