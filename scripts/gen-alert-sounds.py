#!/usr/bin/env python3
"""주문 알림음 생성 — 벨 + 안내 음성.

    python3 scripts/gen-alert-sounds.py

scripts/voice-src/*.mp3 (녹음 원본) 앞에 종소리를 붙여서
src/assets/sounds/alert-*.mp3 를 만든다.

왜 스크립트인가
---------------
벨을 오디오 편집기에서 한 번 붙이고 끝내면, 음성을 다시 녹음할 때마다 그 작업을
손으로 반복해야 한다. 그러다 세 파일의 벨 길이나 음량이 어긋나면 "배달만 소리가
작은데?" 가 되고, 원인을 찾을 방법이 없다. 여기서 만들면 세 개가 늘 같은 벨을 쓴다.

벨을 합성하는 이유는 더 단순하다 — 라이선스를 따질 샘플이 없고, 길이·음높이·감쇠를
숫자로 적어둘 수 있다. 바꾸고 싶으면 아래 상수만 고치고 다시 돌리면 된다.

필요한 것: ffmpeg (brew install ffmpeg). numpy 는 필요 없다.
"""

import math
import os
import struct
import subprocess
import sys
import tempfile
import wave

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
VOICE_DIR = os.path.join(HERE, 'voice-src')
OUT_DIR = os.path.join(ROOT, 'src', 'assets', 'sounds')

# 녹음 원본 → 내보낼 이름. sound.ts 의 FILE_OF 와 같은 이름이어야 한다.
TARGETS = [
    ('delivery.mp3', 'alert-delivery.mp3'),
    ('takeout.mp3',  'alert-takeout.mp3'),
    ('dinein.mp3',   'alert-dinein.mp3'),
]

# 음성 원본이 24kHz 모노다. 벨도 같이 맞춰서 재샘플링을 피한다.
SR = 24000

# ── 벨 설계 ──────────────────────────────────────────────────────────────────
#
# 두 음을 겹쳐 올려 친다(C6 → F6, 완전4도). 올라가는 음형이 "뭔가 도착했다"로
# 읽히고, 내려가는 음형은 "끝났다"로 읽힌다 — 새 주문이니 올라가야 한다.
#
# 종소리는 배음이 정수배가 아니다(비조화). 정수배로 쌓으면 오르간이나 삑 소리가
# 되고 종으로 안 들린다. 아래 비율은 관형 종(tubular bell)에서 가져왔다.
# 높은 배음은 더 빨리 죽는다 — 그래서 감쇠 시간을 따로 준다.
NOTES = [
    # (기음 Hz, 시작 시각 s, 세기)
    (1046.50, 0.000, 1.00),   # C6
    (1396.91, 0.105, 0.95),   # F6
]
# (배음 비율, 세기, 감쇠 시간 s)
PARTIALS = [
    (1.00, 1.00, 0.130),
    (2.00, 0.55, 0.090),
    (2.76, 0.32, 0.065),
    (5.40, 0.16, 0.045),
    (8.93, 0.07, 0.030),
]

BELL_LEN   = 0.34   # 벨 전체 길이(s). 이 뒤는 잘린다
BELL_FADE  = 0.030  # 끝에서 페이드아웃(s). 없으면 '뚝' 끊기는 클릭이 들린다
ATTACK     = 0.002  # 때리는 순간(s). 0 이면 클릭, 길면 종이 아니라 플루트가 된다
GAP        = 0.060  # 벨과 음성 사이 숨(s)
BELL_PEAK  = 0.72   # 벨 최대 진폭(0~1). 약 -2.9 dBFS — 음성 피크와 비슷하게


def bell_samples() -> list[float]:
    """종소리 한 번. 샘플 리스트(-1~1)."""
    n = int(BELL_LEN * SR)
    buf = [0.0] * n

    for f0, start, note_amp in NOTES:
        s0 = int(start * SR)
        for ratio, p_amp, tau in PARTIALS:
            freq = f0 * ratio
            if freq >= SR / 2:        # 나이퀴스트 넘으면 앨리어싱만 만든다
                continue
            w = 2 * math.pi * freq / SR
            amp = note_amp * p_amp
            for i in range(s0, n):
                t = (i - s0) / SR
                env = math.exp(-t / tau)
                if t < ATTACK:        # 선형 어택
                    env *= t / ATTACK
                buf[i] += amp * env * math.sin(w * (i - s0))

    # 끝 페이드 — 감쇠가 다 끝나기 전에 자르므로 반드시 필요하다
    fade = int(BELL_FADE * SR)
    for k in range(fade):
        buf[n - fade + k] *= 1.0 - k / fade

    peak = max(abs(x) for x in buf) or 1.0
    return [x / peak * BELL_PEAK for x in buf]


def write_wav(path: str, samples: list[float]) -> None:
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = bytearray()
        for x in samples:
            v = int(max(-1.0, min(1.0, x)) * 32767)
            frames += struct.pack('<h', v)
        w.writeframes(bytes(frames))


def run(cmd: list[str]) -> None:
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f'실패: {" ".join(cmd[:3])} …\n{r.stderr[-800:]}')


def main() -> None:
    if subprocess.run(['which', 'ffmpeg'], capture_output=True).returncode != 0:
        sys.exit('ffmpeg 이 필요해요: brew install ffmpeg')

    os.makedirs(OUT_DIR, exist_ok=True)
    bell = bell_samples()

    with tempfile.TemporaryDirectory() as tmp:
        bell_wav = os.path.join(tmp, 'bell.wav')
        # 벨 + 숨까지 한 파일로 만들어 둔다 — concat 할 조각이 하나 줄어든다
        write_wav(bell_wav, bell + [0.0] * int(GAP * SR))

        # 벨만 따로 들어볼 수 있게 남겨둔다. **src/assets/sounds 밖에** 둔다 —
        # 그 폴더의 *.mp3 는 전부 번들에 base64 로 인라인되므로, 쓰지도 않을
        # 파일을 거기 두면 앱 용량만 늘어난다.
        run(['ffmpeg', '-v', 'error', '-y', '-i', bell_wav,
             '-ar', str(SR), '-ac', '1', '-b:a', '128k',
             os.path.join(VOICE_DIR, 'bell-preview.mp3')])

        for src_name, out_name in TARGETS:
            src = os.path.join(VOICE_DIR, src_name)
            if not os.path.exists(src):
                sys.exit(f'원본이 없어요: {src}')

            voice_wav = os.path.join(tmp, f'v-{src_name}.wav')
            run(['ffmpeg', '-v', 'error', '-y', '-i', src,
                 '-ar', str(SR), '-ac', '1', voice_wav])

            out = os.path.join(OUT_DIR, out_name)
            # concat 필터로 이어붙인다. demuxer 가 아니라 필터를 쓰는 이유는
            # 두 입력의 포맷을 위에서 이미 같게 맞춰놨기 때문이다.
            run(['ffmpeg', '-v', 'error', '-y',
                 '-i', bell_wav, '-i', voice_wav,
                 '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[a]',
                 '-map', '[a]', '-ar', str(SR), '-ac', '1', '-b:a', '128k',
                 out])
            size = os.path.getsize(out)
            print(f'  {out_name:22s} ← 벨 + {src_name}   ({size:,} bytes)')

    print('\n완료. 설정 > 기타 설정 > 주문 종류별 알림음 에서 들어보세요.')


if __name__ == '__main__':
    main()
