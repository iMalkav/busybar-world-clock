"""Recreate this application's original pixel icons and synthesized PCM sounds."""
from pathlib import Path
import math
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]
PATTERN = ['00111100', '01011010', '10011001', '11111111', '11111111', '10011001', '01011010', '00111100']
COLOR = (149, 102, 114)
SOUNDS = []

def png(width, height, pixels):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    rows = b''.join(b'\0' + bytes(pixels[y * width * 4:(y + 1) * width * 4]) for y in range(height))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))

def generate():
    target = ROOT / 'src/appmeta'
    target.mkdir(parents=True, exist_ok=True)
    for size, name in [(8, 'icon_front_8x8.png'), (11, 'icon_back_11x11.png')]:
        pixels = []
        offset = (size - 8) // 2
        for y in range(size):
            for x in range(size):
                sx, sy = x - offset, y - offset
                on = 0 <= sx < 8 and 0 <= sy < 8 and PATTERN[sy][sx] == '1'
                rgb = COLOR if size == 8 else (255, 255, 255)
                pixels.extend((*rgb, 255) if on else (0, 0, 0, 0))
        (target / name).write_bytes(png(size, size, pixels))
    frequencies = {'notify': (660, .18), 'tick': (880, .035), 'accent': (1320, .045),
                   'chime': (523.25, .24), 'pop': (440, .06), 'bell': (1046.5, .25)}
    for name in SOUNDS:
        frequency, seconds = frequencies[name]
        count = int(seconds * 44100)
        samples = []
        for i in range(count):
            t = i / 44100
            envelope = min(1, i / 120) * math.exp(-t * (16 if name in ('tick', 'pop') else 9))
            sample = math.sin(2 * math.pi * frequency * t) + .2 * math.sin(2 * math.pi * frequency * 2 * t)
            samples.append(struct.pack('<h', round(max(-1, min(1, sample * envelope * .35)) * 32767)))
        folder = ROOT / 'src/sounds'
        folder.mkdir(parents=True, exist_ok=True)
        (folder / (name + '.snd')).write_bytes(b''.join(samples))

if __name__ == '__main__':
    generate()
