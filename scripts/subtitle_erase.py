"""하드코딩된 자막 지우기.

원리: 자막은 시간이 지나면 바뀌거나 사라진다. 그래서 **같은 자리의 진짜 배경**이
앞뒤 프레임 어딘가에는 드러나 있다. 그 픽셀을 끌어와 메우면 뿌옇게 가리는 게 아니라 복원이 된다.

방식 세 가지
  background  앞뒤 프레임에서 배경을 끌어온다(권장·느림). 정지 배경에서 결과가 가장 깨끗하다.
  fast        한 프레임 안에서 주변 픽셀로 메운다(빠름). 움직이는 배경에 낫다.
  blur        그 자리를 흐리게 가린다(가장 빠름). 티가 남지만 확실하다.

사용:
  python subtitle_erase.py <입력> --out <출력> --box x,y,w,h [--mode background] [--start 0 --duration 3]
"""

import argparse
import subprocess
import sys


def parse_box(value: str):
    parts = [int(float(p)) for p in value.split(",")]
    if len(parts) != 4:
        raise ValueError("box는 x,y,w,h 형식이어야 합니다.")
    return parts


def run(cmd):
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        tail = "\n".join((result.stderr or "").strip().splitlines()[-4:])
        raise RuntimeError(f"명령 실패({result.returncode}):\n{tail}")
    return result


def detect_box(frames, height, width, region=0.45):
    """자막 위치를 자동으로 찾는다.

    하드코딩된 자막은 **시간에 따라 바뀌고** 배경은 상대적으로 가만히 있다.
    그래서 화면 아래쪽에서 프레임 간 변화가 큰 띠를 찾으면 그게 자막 자리다.
    """
    import cv2
    import numpy as np

    top = int(height * (1 - region))
    band = [cv2.cvtColor(frame[top:, :], cv2.COLOR_BGR2GRAY).astype(np.float32) for frame in frames]
    if len(band) < 2:
        return 0, top, width, height - top

    stack = np.stack(band, axis=0)
    variance = stack.std(axis=0)
    # 변화가 큰 픽셀만 남긴다(자막 글자가 나타났다 사라지는 자리).
    threshold = max(6.0, float(np.percentile(variance, 97)))
    mask = (variance >= threshold).astype(np.uint8)
    if mask.sum() < 50:
        return 0, top, width, height - top

    rows = np.where(mask.sum(axis=1) > width * 0.01)[0]
    cols = np.where(mask.sum(axis=0) > 0)[0]
    if rows.size == 0 or cols.size == 0:
        return 0, top, width, height - top

    pad_y = int(height * 0.02)
    pad_x = int(width * 0.02)
    y0 = max(0, int(rows[0]) - pad_y) + top
    y1 = min(height, int(rows[-1]) + pad_y + top + 1)
    x0 = max(0, int(cols[0]) - pad_x)
    x1 = min(width, int(cols[-1]) + pad_x + 1)
    return x0, y0, max(1, x1 - x0), max(1, y1 - y0)


def estimate_background(stack, border_color=None):
    """자막이 없던 순간의 배경을 고른다.

    중앙값만 쓰면 글자가 오래 머문 자리에 잔상이 남고, 어두운 분위수를 쓰면
    글자 테두리(검은 윤곽)가 남는다 — 둘 다 실측으로 확인했다.
    그래서 여러 분위수를 후보로 만들고 **주변 배경색과 가장 비슷하고 매끈한 것**을 고른다.
    """
    import cv2
    import numpy as np

    candidates = [np.percentile(stack, q, axis=0).astype(np.uint8) for q in (5, 10, 30, 50, 70, 90, 95)]

    def score(image):
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        roughness = float(cv2.Laplacian(gray, cv2.CV_32F).var())
        if border_color is None:
            return roughness
        distance = float(np.abs(image.astype(np.float32) - border_color).mean())
        # 주변 배경과 얼마나 닮았는지가 더 중요하다 — 가중치를 크게 준다.
        return distance * 12.0 + roughness

    best = min(candidates, key=score)

    # 분위수만으로는 글자 테두리가 남는다(실측). 남은 흔적을 마스크로 잡아 주변에서 메운다.
    if border_color is not None:
        difference = np.abs(best.astype(np.float32) - border_color).mean(axis=2)
        mask = (difference > 18).astype(np.uint8) * 255
        if mask.any():
            mask = cv2.dilate(mask, np.ones((5, 5), np.uint8), iterations=1)
            best = cv2.inpaint(best, mask, 6, cv2.INPAINT_TELEA)
    return best


def border_color_of(frames, x, y, w, h, pad=6):
    """지울 영역 **바깥**의 색 — 그 자리 배경이 어떤 색이어야 하는지의 기준."""
    import numpy as np

    height, width = frames[0].shape[:2]
    top = max(0, y - pad)
    bottom = min(height, y + h + pad)
    left = max(0, x - pad)
    right = min(width, x + w + pad)

    samples = []
    for frame in frames[:: max(1, len(frames) // 10)]:
        if top < y:
            samples.append(frame[top:y, left:right].reshape(-1, 3))
        if bottom > y + h:
            samples.append(frame[y + h : bottom, left:right].reshape(-1, 3))
    if not samples:
        return None
    return np.median(np.concatenate(samples, axis=0), axis=0).astype(np.float32)


def erase(args) -> int:
    import cv2
    import numpy as np

    capture = cv2.VideoCapture(args.media)
    if not capture.isOpened():
        raise RuntimeError(f"영상을 열지 못했습니다: {args.media}")

    fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))

    start_frame = int(args.start * fps)
    end_frame = total if args.duration <= 0 else min(total, start_frame + int(args.duration * fps))
    if start_frame > 0:
        capture.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

    x, y, w, h = (0, 0, width, height)
    if args.box != "auto":
        x, y, w, h = parse_box(args.box)

    # 자막 영역이 화면 밖으로 나가지 않게 자른다.
    x = max(0, min(x, width - 1))
    y = max(0, min(y, height - 1))
    w = max(1, min(w, width - x))
    h = max(1, min(h, height - y))

    frames = []
    while True:
        ok, frame = capture.read()
        if not ok or capture.get(cv2.CAP_PROP_POS_FRAMES) > end_frame:
            break
        frames.append(frame)
    capture.release()

    if not frames:
        raise RuntimeError("읽어들인 프레임이 없습니다.")

    if args.box == "auto":
        x, y, w, h = detect_box(frames, height, width)
        print(f"detected box={x},{y},{w},{h}", file=sys.stderr)

    if args.mode == "background":
        stack = np.stack([frame[y : y + h, x : x + w] for frame in frames], axis=0)
        background = estimate_background(stack, border_color_of(frames, x, y, w, h))
        for frame in frames:
            frame[y : y + h, x : x + w] = background
    elif args.mode == "fast":
        mask = np.zeros((h, w), dtype=np.uint8)
        mask[:] = 255
        for frame in frames:
            patch = frame[y : y + h, x : x + w]
            frame[y : y + h, x : x + w] = cv2.inpaint(patch, mask, 3, cv2.INPAINT_TELEA)
    else:  # blur
        for frame in frames:
            patch = frame[y : y + h, x : x + w]
            frame[y : y + h, x : x + w] = cv2.GaussianBlur(patch, (0, 0), sigmaX=12, sigmaY=12)

    writer = cv2.VideoWriter(args.temp, cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    for frame in frames:
        writer.write(frame)
    writer.release()

    # OpenCV는 소리를 못 쓴다 — 원본 소리를 그대로 얹어 마무리한다.
    audio_args = ["-map", "0:v:0", "-map", "1:a:0?", "-c:v", "libx264", "-crf", "20", "-c:a", "copy", "-shortest"]
    trim = [] if args.duration <= 0 else ["-ss", str(args.start), "-t", str(args.duration)]
    run(["ffmpeg", "-y", "-i", args.temp, *trim, "-i", args.media, *audio_args, args.out])

    print(f"frames={len(frames)} mode={args.mode} out={args.out}", file=sys.stderr)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="영상에 박힌 자막 지우기")
    parser.add_argument("media")
    parser.add_argument("--out", required=True)
    parser.add_argument("--temp", required=True, help="소리 없는 중간 파일 경로")
    parser.add_argument("--box", default="auto", help="지울 영역 x,y,w,h 또는 auto")
    parser.add_argument("--mode", default="background", choices=["background", "fast", "blur"])
    parser.add_argument("--start", type=float, default=0.0)
    parser.add_argument("--duration", type=float, default=0.0, help="0이면 끝까지")
    args = parser.parse_args()
    return erase(args)


if __name__ == "__main__":
    raise SystemExit(main())
