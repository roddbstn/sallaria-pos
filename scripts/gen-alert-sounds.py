#!/usr/bin/env python3
"""주문 알림음 생성 — 벨 + 안내 음성.

    python3 scripts/gen-alert-sounds.py

scripts/voice-src/ 의 벨과 녹음 원본을 합쳐서
src/assets/sounds/alert-*.mp3 를 만든다.

왜 스크립트인가
---------------
오디오 편집기에서 한 번 붙이고 끝내면, 음성을 다시 녹음할 때마다 그 작업을 손으로
반복해야 한다. 그러다 세 파일의 벨 위치나 음량이 어긋나면 "배달만 소리가 작은데?"
가 되고, 원인을 찾을 방법이 없다. 여기서 만들면 세 개가 늘 같은 벨, 같은 타이밍이다.

벨은 **합성하지 않는다.** 처음엔 종소리를 코드로 합성했는데, 기존 기본음
(order-alert.mp3)에 이미 쓰고 있던 벨이 따로 있었다. 소리가 달라져서 바로 들통났다.
그 벨을 bell.mp3 로 가져와 그대로 쓴다.

기존 기본음을 역산해서 맞춘 값
------------------------------
order-alert.mp3 와 bell.mp3 를 샘플 단위로 비교했더니:
  · 0.00s ~ 1.20s  두 파일이 **동일**했다 (차이 RMS -80dB = mp3 재인코딩 노이즈)
  · 1.20s 에서 음성이 시작된다 (차이 RMS 가 -84dB → -31dB 로 솟는다)
그래서 VOICE_START = 1.20. 벨을 자르지 않고 그 뒤 울림이 음성 아래에 깔린다 —
그 구간의 벨은 이미 -31dB 이하라 음성을 가리지 않는다.

필요한 것: ffmpeg (brew install ffmpeg)
"""

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC_DIR = os.path.join(HERE, 'voice-src')
OUT_DIR = os.path.join(ROOT, 'src', 'assets', 'sounds')

BELL = os.path.join(SRC_DIR, 'bell.mp3')

# 녹음 원본 → 내보낼 이름. sound.ts 의 FILE_OF 와 같은 이름이어야 한다.
TARGETS = [
    ('delivery.mp3', 'alert-delivery.mp3'),
    ('takeout.mp3',  'alert-takeout.mp3'),
    ('dinein.mp3',   'alert-dinein.mp3'),
]

# 음성이 시작되는 시각(ms). 위 "역산" 참고 — 기존 기본음과 같은 타이밍이다.
VOICE_START_MS = 1200

# 출력 포맷은 기존 기본음과 같게 맞춘다.
# 벨이 **진짜 스테레오**다 — L 과 R 이 5.5dB 다르고 L-R 이 L 자신과 비슷한 크기다.
# 모노로 합치면 소리가 바뀌므로 스테레오를 유지한다.
# 12kHz 위 에너지는 -52dB 라 48kHz 가 과하지는 않지만, 원본 그대로 두는 게 안전하다.
SR = 48000
CHANNELS = 2

# VBR V0. 고정 비트레이트와 재인코딩 충실도를 재어보고 골랐다 —
# 벨 구간(0~1.20s)을 원본 bell.mp3 와 비교한 오차:
#     128k  -38.3 dB   57KB
#     192k  -43.6 dB   86KB
#     V0    -57.9 dB   71KB   ← 이것
#     256k  -64.0 dB  114KB
# 기존 order-alert.mp3 가 -54.0 dB 였으니 V0 면 그보다 충실하고 256k 보다 작다.
# 번들에 base64 로 들어가므로 크기도 봐야 한다.
ENCODE = ['-q:a', '0']


def run(cmd: list[str]) -> None:
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f'실패: {" ".join(cmd[:4])} …\n{r.stderr[-800:]}')


def probe(path: str, entries: str) -> str:
    r = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', entries,
         '-of', 'default=noprint_wrappers=1:nokey=1', path],
        capture_output=True, text=True)
    return r.stdout.strip()


def main() -> None:
    if subprocess.run(['which', 'ffmpeg'], capture_output=True).returncode != 0:
        sys.exit('ffmpeg 이 필요해요: brew install ffmpeg')
    if not os.path.exists(BELL):
        sys.exit(f'벨이 없어요: {BELL}')

    os.makedirs(OUT_DIR, exist_ok=True)
    print(f'벨: {os.path.basename(BELL)} ({probe(BELL, "format=duration")[:5]}s)')
    print(f'음성 시작: {VOICE_START_MS}ms\n')

    for src_name, out_name in TARGETS:
        src = os.path.join(SRC_DIR, src_name)
        if not os.path.exists(src):
            sys.exit(f'원본이 없어요: {src}')

        out = os.path.join(OUT_DIR, out_name)
        # amix 는 기본적으로 입력 수로 나눠서 음량을 **절반으로 깎는다.**
        # normalize=0 을 빼면 세 파일이 전부 6dB 작아진다.
        # duration=longest — 벨(2.0s)보다 음성 끝(1.2+2.3s)이 뒤라 음성 기준으로 간다.
        flt = (
            f'[0:a]aformat=sample_rates={SR}:channel_layouts=stereo[bell];'
            f'[1:a]aformat=sample_rates={SR}:channel_layouts=stereo,'
            f'adelay={VOICE_START_MS}|{VOICE_START_MS}[voice];'
            f'[bell][voice]amix=inputs=2:duration=longest:normalize=0[a]'
        )
        run(['ffmpeg', '-v', 'error', '-y',
             '-i', BELL, '-i', src,
             '-filter_complex', flt, '-map', '[a]',
             '-ar', str(SR), '-ac', str(CHANNELS), *ENCODE,
             out])

        dur = probe(out, 'format=duration')
        size = os.path.getsize(out)
        print(f'  {out_name:22s} ← 벨 + {src_name:14s} {float(dur):.2f}s  {size:,} bytes')

    print('\n완료. 설정 > 기타 설정 > 주문 종류별 알림음 에서 들어보세요.')


if __name__ == '__main__':
    main()
