"""영상에 박힌 자막·워터마크 지우기.

**글자가 있는 자리만** 지운다. 영역을 통째로 덮으면 그 자리를 지나가는 사람·물체까지
사라져 영상이 망가진다(움직이는 배경으로 실측해 확인한 사고).

지우는 순서
  1) 글자 찾기 — 텍스트 검출기로 글자 상자를 찾는다. 상자 밖은 한 픽셀도 건드리지 않는다.
  2) 글자 픽셀 고르기 — 상자 안에서 배경과 다른 픽셀(글자 + 테두리)만 고른다.
     테두리까지 통째로 잡아야 검은 잔상이 남지 않는다.
  3) 시간축 복원 — 그 픽셀이 드러났던 가장 가까운 프레임의 값을 가져온다.
     자막은 바뀌므로 앞뒤 몇 초 안에 진짜 배경이 드러나 있다.
  4) 그래도 남으면 주변 픽셀로 메운다(inpaint).

긴 영상도 처리할 수 있게 토막 단위로 흘려보낸다. 전 프레임을 메모리에 올리면
10분 영상에서 수십 GB가 필요해 그대로 터진다.

방식
  background  1~4 전부 (권장). 움직이는 배경도 살린다.
  fast        1,2,4 (프레임별 메우기). 빠르지만 배경 복원력은 낮다.
  blur        글자 상자를 흐리게 가린다. 가장 빠르지만 티가 난다.

대상
  subtitle   화면 아래쪽 자막
  watermark  늘 같은 자리에 있는 표식(로고·채널명)
  both       화면 안의 모든 글자
"""

import argparse
import subprocess
import sys

CHUNK_FRAMES = 240      # 한 번에 다루는 프레임 수 — 메모리와 복원력의 절충
FILL_RADIUS = 60        # 배경을 찾아 거슬러 올라갈 최대 프레임 수
DETECT_STRIDE = 10      # 글자 검출 간격 — 자막은 몇 초씩 머무르므로 매 프레임 볼 필요가 없다
STROKE_REACH = 15       # 글자 획에서 이만큼(px)까지가 글자다. 더 먼 곳은 사람·사물이다
SUBTITLE_BAND = 0.55    # 자막을 찾을 범위(화면 아래쪽). 위쪽 글자는 영상의 일부다


def parse_box(value):
    """x,y,w,h 를 숫자 넷으로 읽는다. 형식이 틀리면 사람이 읽을 수 있게 알린다."""
    try:
        parts = [int(float(p)) for p in value.split(",")]
    except ValueError:
        raise ValueError(
            "지울 영역을 이해하지 못했습니다: " + value + "\n"
            "auto(자동 감지) 또는 x,y,너비,높이 형식으로 적어주세요. 예: 100,600,1080,120"
        ) from None
    if len(parts) != 4:
        raise ValueError("지울 영역은 x,y,너비,높이 네 개의 숫자여야 합니다. 예: 100,600,1080,120")
    if parts[2] <= 0 or parts[3] <= 0:
        raise ValueError("지울 영역의 너비와 높이는 0보다 커야 합니다.")
    return parts


def load_detector():
    """글자 검출기. 없으면 None — 그때는 지정한 영역만 어림잡아 지운다."""
    try:
        from rapidocr_onnxruntime import RapidOCR

        return RapidOCR().text_detector
    except Exception as error:
        print(f"note: 글자 검출기를 쓸 수 없어 어림짐작으로 진행합니다 ({error})", file=sys.stderr)
        return None


def detect_boxes(detector, image, pad=14):
    """이미지에서 글자 상자들을 찾아 (x0, y0, x1, y1) 목록으로 돌려준다."""
    import numpy as np

    try:
        found = detector(image)
    except Exception:
        return []
    quads = found[0] if isinstance(found, tuple) else found
    if quads is None:
        return []

    height, width = image.shape[:2]
    rects = []
    for quad in quads:
        points = np.array(quad).astype(int)
        x0 = max(0, int(points[:, 0].min()) - pad)
        y0 = max(0, int(points[:, 1].min()) - pad)
        x1 = min(width, int(points[:, 0].max()) + pad)
        y1 = min(height, int(points[:, 1].max()) + pad)
        if x1 > x0 and y1 > y0:
            rects.append((x0, y0, x1, y1))
    return rects


def region_of(rects, shape, margin=6):
    """상자들을 모두 감싸는 사각형 — 시간축 계산을 이 안에서만 한다."""
    if not rects:
        return None
    height, width = shape
    x0 = max(0, min(r[0] for r in rects) - margin)
    y0 = max(0, min(r[1] for r in rects) - margin)
    x1 = min(width, max(r[2] for r in rects) + margin)
    y1 = min(height, max(r[3] for r in rects) + margin)
    return x0, y0, x1 - x0, y1 - y0


def clip_rects(rects, box):
    """사용자가 정한 영역 밖의 상자는 버린다 — 지정한 곳만 건드린다는 약속."""
    if box is None:
        return rects
    bx, by, bw, bh = box
    kept = []
    for x0, y0, x1, y1 in rects:
        nx0, ny0 = max(x0, bx), max(y0, by)
        nx1, ny1 = min(x1, bx + bw), min(y1, by + bh)
        if nx1 > nx0 and ny1 > ny0:
            kept.append((nx0, ny0, nx1, ny1))
    return kept


def merge_lines(rects, gap_ratio=1.5):
    """같은 줄에 있는 글자 상자들을 한 줄로 합친다.

    검출기는 자막 한 줄을 단어 단위로 쪼개 준다. 쪼개진 채로 두면 '좁은 상자'라
    자막이 아니라고 걸러진다(실측: 한 줄이 네 조각으로 나뉘어 통째로 놓쳤다).
    """
    merged = list(rects)
    changed = True
    while changed:
        changed = False
        for first in range(len(merged)):
            for second in range(first + 1, len(merged)):
                a, b = merged[first], merged[second]
                overlap = min(a[3], b[3]) - max(a[1], b[1])
                shorter = min(a[3] - a[1], b[3] - b[1])
                gap = max(a[0], b[0]) - min(a[2], b[2])
                if overlap > shorter * 0.5 and gap <= shorter * gap_ratio:
                    merged[first] = (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))
                    merged.pop(second)
                    changed = True
                    break
            if changed:
                break
    return merged


def caption_like(rect, shape):
    """자막 한 줄처럼 생겼는지 — 넓고 낮고 가운데 쪽에 있다.

    화면에 원래 있던 글자(버튼 이름, 키보드 자판)는 좁거나 구석에 있다.
    이 조건을 안 걸면 화면 절반이 지울 대상이 된다(실측).
    """
    height, width = shape
    x0, y0, x1, y1 = rect
    if x1 - x0 < width * 0.15 or not (height * 0.015 <= y1 - y0 <= height * 0.2):
        return False
    middle = (x0 + x1) / 2
    return width * 0.15 <= middle <= width * 0.85


def changing_rects(frames, keys, found, share=0.08):
    """시간에 따라 **바뀌는** 글자 상자만 남긴다.

    화면에 원래 있던 글자(키보드 자판, 웹페이지 글씨)까지 지우면 영상이 망가진다.
    자막은 몇 초마다 바뀌므로 그 자리 픽셀이 시간에 따라 흔들린다. 원래 있던 글자는
    가만히 있어 그대로 남는다(실측: 키보드가 있는 영상에서 화면 절반이 대상으로 잡혔다).
    """
    import cv2
    import numpy as np

    thumbs = [cv2.cvtColor(cv2.resize(frames[key], None, fx=0.5, fy=0.5), cv2.COLOR_BGR2GRAY) for key in keys]
    varying = np.stack(thumbs).std(axis=0) >= 12
    height, width = varying.shape

    kept = {}
    for key in keys:
        chosen = []
        for rect in merge_lines(found[key]):
            if not caption_like(rect, frames[key].shape[:2]):
                continue
            x0, y0, x1, y1 = (value // 2 for value in rect)
            x1 = min(max(x1, x0 + 1), width)
            y1 = min(max(y1, y0 + 1), height)
            if varying[y0:y1, x0:x1].mean() >= share:
                chosen.append(rect)
        kept[key] = chosen
    return kept


def overlaps(a, b, ratio=0.5):
    """두 상자가 같은 자리인지 — 워터마크는 늘 같은 곳에 뜬다."""
    x0, y0 = max(a[0], b[0]), max(a[1], b[1])
    x1, y1 = min(a[2], b[2]), min(a[3], b[3])
    if x1 <= x0 or y1 <= y0:
        return False
    inter = (x1 - x0) * (y1 - y0)
    smaller = min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]))
    return inter >= smaller * ratio


def fill_small_holes(mask, limit=1500):
    """글자 안쪽의 작은 구멍만 메운다.

    구멍을 가리지 않고 다 메우면 안 된다. 자막 한 줄의 테두리가 줄 전체를 둘러싸기 때문에
    줄 안쪽이 통째로 칠해지고, 결국 자막 자리를 통으로 지우게 된다(실측으로 확인한 사고).
    """
    import cv2
    import numpy as np

    count, labels, stats, _ = cv2.connectedComponentsWithStats(cv2.bitwise_not(mask), connectivity=4)
    height, width = mask.shape
    left = stats[:, cv2.CC_STAT_LEFT]
    top = stats[:, cv2.CC_STAT_TOP]
    right = left + stats[:, cv2.CC_STAT_WIDTH]
    bottom = top + stats[:, cv2.CC_STAT_HEIGHT]
    inner = (left > 0) & (top > 0) & (right < width) & (bottom < height)
    small = inner & (stats[:, cv2.CC_STAT_AREA] <= limit)
    if count:
        small[0] = False
    return cv2.bitwise_or(mask, (small[labels] * 255).astype(np.uint8))


def estimate_background(stack, covered, max_samples=24):
    """글자에 가려지지 않은 프레임들만 모아 배경을 추정한다.

    그냥 전체 중앙값을 쓰면 안 된다. 자막 테두리가 절반 넘는 프레임을 덮는 픽셀에서는
    **테두리 자체가 배경**이 돼 그 자리에 검은 얼룩이 그대로 남는다(실측으로 확인).

    돌려주는 값: (배경, 믿을 수 있는 자리 표시). 표본이 몇 장 안 되는 자리는
    그때 지나가던 사물이 배경으로 굳을 수 있어 믿지 않는다(실측으로 확인).
    """
    import cv2
    import numpy as np

    step = max(1, len(stack) // max_samples)
    sample = stack[::step]
    hidden = covered[::step]

    height = stack.shape[1]
    background = np.empty(stack.shape[1:], np.float32)
    for top in range(0, height, 64):  # 띠 단위로 계산해 큰 영상에서도 메모리가 넘치지 않게
        part = sample[:, top : top + 64].astype(np.float32)
        part[hidden[:, top : top + 64]] = np.nan
        with np.errstate(invalid="ignore"):
            median = np.nanmedian(part, axis=0)
        plain = np.median(sample[:, top : top + 64], axis=0)
        background[top : top + 64] = np.where(np.isnan(median), plain, median)

    # 표본이 몇 장 없는 자리는 그때 지나가던 사물이 배경으로 굳는다(실측으로 확인).
    # 배경은 주변과 이어져 있으니 잘 관찰된 이웃 값으로 메꾼다.
    counts = (~hidden).sum(axis=0)
    weak = counts < 12
    if weak.any():
        smoothed = cv2.medianBlur(background.astype(np.uint8), 21).astype(np.float32)
        background = np.where(weak[..., None], smoothed, background)
    return background.astype(np.uint8), counts >= 2


def stroke_mask(patch, wide):
    """주변보다 밝기가 튀는 픽셀 = 글자 획. 배경을 고르고 글자색을 찾는 데 쓴다."""
    import cv2
    import numpy as np

    gray = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY)
    relief = gray.astype(np.int16) - cv2.GaussianBlur(gray, (0, 0), sigmaX=7, sigmaY=7).astype(np.int16)
    return relief, cv2.dilate((np.abs(relief) >= 22).astype(np.uint8) * 255, wide)


def glyph_masks(patches, rect_masks):
    """상자 안에서 글자 픽셀만 고른다.

    두 가지가 동시에 맞아야 지운다.
      1) 배경과 다르다 — 원래 화면에 없던 것이다.
      2) 자막 색이다 — 글자색이나 테두리색에 가깝다.
    둘 다 걸어야 자막 뒤를 지나가는 물체를 뚫지 않는다(실측으로 확인).

    배경은 글자 획에 가려지지 않은 프레임들만 모아 추정한다. 그냥 중앙값을 쓰면
    테두리가 오래 덮은 자리에서 테두리가 배경이 돼 검은 얼룩이 남는다.
    """
    import cv2
    import numpy as np

    stack = np.stack(patches, axis=0)
    small = np.ones((3, 3), np.uint8)
    wide = np.ones((5, 5), np.uint8)

    strokes = [stroke_mask(patch, wide)[1] for patch in stack]

    # 배경을 고를 때는 글자를 **속까지** 빼야 한다. 획 언저리만 빼면 두꺼운 테두리 안쪽이
    # 배경 표본으로 섞여 그 자리에 검은 잔상이 남는다(실측으로 확인한 사고).
    thick = np.ones((11, 11), np.uint8)
    hidden = np.stack([cv2.dilate(stroke, thick) for stroke in strokes], axis=0) > 0
    background, trusted = estimate_background(stack, hidden)

    # 글자에서 먼 곳은 건드리지 않는다. 글자는 획에서 테두리까지 몇 픽셀 안이지만
    # 자막 뒤를 지나가는 사물은 속이 넓다 — 그 속을 지우면 구멍이 뚫린다(실측).
    around = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (STROKE_REACH * 2 + 1, STROKE_REACH * 2 + 1))

    masks = []
    for patch, inside, stroke in zip(stack, rect_masks, strokes):
        changed = cv2.absdiff(patch, background).max(axis=2) >= 22
        picked = ((changed & trusted) | (stroke > 0)).astype(np.uint8) * 255
        picked = cv2.bitwise_and(picked, cv2.dilate(stroke, around))

        mask = cv2.bitwise_and(picked, inside)
        mask = fill_small_holes(cv2.morphologyEx(mask, cv2.MORPH_CLOSE, small))
        # 글자 경계 한 겹까지 덮어야 잔상이 없다. 상자 밖으로는 번지지 않게 자른다.
        masks.append(cv2.bitwise_and(cv2.dilate(mask, wide), inside))
    return masks, background, trusted


def fill_from_time(patches, masks, background, trusted, radius=FILL_RADIUS):
    """가려진 픽셀을 그 픽셀이 드러났던 가장 가까운 프레임에서 가져온다.

    시간이 가까운 값을 쓰기 때문에 움직이는 배경도 자연스럽게 이어진다.
    다만 **배경처럼 보이는 프레임을 먼저 고른다.** 아무 프레임이나 쓰면 그때 지나가던
    사람·사물을 퍼와 엉뚱한 잔상이 생긴다(실측으로 확인한 사고).
    배경다운 곳을 못 찾으면 추정한 배경값을 쓰고, 그마저 모르면 주변 픽셀로 잇는다.
    """
    import cv2
    import numpy as np

    margin = np.ones((7, 7), np.uint8)
    safe = [cv2.dilate(mask, margin) == 0 for mask in masks]
    plain = [cv2.absdiff(patch, background).max(axis=2) <= 30 for patch in patches]
    filled = [patch.copy() for patch in patches]
    remaining = [mask.copy() for mask in masks]

    # 지금 이 프레임에 사물이 있는 자리는 시간축으로 채우지 않는다.
    # 다른 시간대의 배경을 끌어오면 사물이 파여 보인다 — 그 자리는 주변 픽셀로 잇는 편이 자연스럽다.
    spread = np.ones((61, 61), np.uint8)
    hold = [
        cv2.dilate(((~clean) & (mask == 0)).astype(np.uint8) * 255, spread) > 0
        for clean, mask in zip(plain, masks)
    ]

    # 1) 배경이 드러난 가장 가까운 프레임에서 가져온다.
    take_from(patches, filled, remaining, [ok & clean for ok, clean in zip(safe, plain)], hold, radius)

    # 2) 그래도 남으면 추정한 배경값을 쓴다. 아무 프레임에서나 퍼오면
    #    그때 지나가던 사람·사물이 엉뚱한 자리에 복사된다(실측으로 확인한 사고).
    for patch_index, mask in enumerate(remaining):
        usable = (mask > 0) & trusted & ~hold[patch_index]
        if usable.any():
            filled[patch_index][usable] = background[usable]
            remaining[patch_index][usable] = 0
    return filled, remaining


def take_from(patches, filled, remaining, sources, hold, radius):
    """남은 자리를 앞뒤 프레임에서 채운다.

    프레임마다 앞뒤를 다 훑으면 긴 영상에서 너무 느리다(10초에 3분, 실측).
    대신 앞으로 한 번, 뒤로 한 번 지나가며 **가장 최근에 본 배경**을 들고 다닌다.
    """
    import numpy as np

    for direction in (1, -1):
        order = range(len(patches)) if direction == 1 else range(len(patches) - 1, -1, -1)
        carry = None
        age = None
        for index in order:
            if carry is not None:
                need = (remaining[index] > 0) & ~hold[index] & (age <= radius)
                if need.any():
                    filled[index][need] = carry[need]
                    remaining[index][need] = 0
            fresh = sources[index]
            if carry is None:
                carry = patches[index].copy()
                age = np.full(fresh.shape, radius + 1, np.int32)
            carry[fresh] = patches[index][fresh]
            age = np.where(fresh, 0, age + 1)


def erase_chunk(frames, rects_per_frame, mode):
    """토막 하나를 지운다. 글자 상자가 없으면 원본 그대로 둔다."""
    import cv2
    import numpy as np

    every = [rect for rects in rects_per_frame for rect in rects]
    region = region_of(every, frames[0].shape[:2])
    if region is None:
        return frames, 0.0

    x, y, w, h = region
    patches = [frame[y : y + h, x : x + w].copy() for frame in frames]

    rect_masks = []
    for rects in rects_per_frame:
        canvas = np.zeros((h, w), np.uint8)
        for x0, y0, x1, y1 in rects:
            cv2.rectangle(canvas, (x0 - x, y0 - y), (x1 - x - 1, y1 - y - 1), 255, -1)
        rect_masks.append(canvas)

    masks, background, trusted = glyph_masks(patches, rect_masks)
    covered = float(np.mean([mask.mean() / 255 for mask in masks]))

    if mode == "background":
        patches, masks = fill_from_time(patches, masks, background, trusted)
    for index, (patch, mask) in enumerate(zip(patches, masks)):
        if mask.any():
            patches[index] = cv2.inpaint(patch, mask, 5, cv2.INPAINT_TELEA)

    for frame, patch in zip(frames, patches):
        frame[y : y + h, x : x + w] = patch
    return frames, covered


def blur_chunk(frames, rects_per_frame):
    """흐리게 가리기 — 가장 빠르지만 티가 난다."""
    import cv2

    for frame, rects in zip(frames, rects_per_frame):
        for x0, y0, x1, y1 in rects:
            region = frame[y0:y1, x0:x1]
            frame[y0:y1, x0:x1] = cv2.GaussianBlur(region, (0, 0), sigmaX=12, sigmaY=12)
    return frames


def heuristic_rects(frames, target, box):
    """검출기가 없을 때 — 사용자가 준 영역, 없으면 화면 아래쪽 띠를 쓴다."""
    height, width = frames[0].shape[:2]
    if box is not None:
        x, y, w, h = box
        rect = (x, y, x + w, y + h)
    else:
        top = int(height * 0.7) if target == "subtitle" else 0
        rect = (0, top, width, height)
    return [[rect] for _ in frames]


def plan_rects(detector, frames, target, offset_y, box):
    """토막 안의 프레임마다 글자 상자를 정한다.

    매 프레임 검출하면 느리다. 몇 프레임 간격으로만 보고, 사이 프레임은
    앞뒤 검출 결과를 합쳐 쓴다. 자막이 바뀌는 순간도 이렇게 덮인다.
    """
    if detector is None:
        return heuristic_rects(frames, target, box)

    total = len(frames)
    keys = list(range(0, total, DETECT_STRIDE))
    if keys[-1] != total - 1:
        keys.append(total - 1)

    found = {}
    for key in keys:
        image = frames[key][offset_y:, :] if offset_y else frames[key]
        rects = [(x0, y0 + offset_y, x1, y1 + offset_y) for x0, y0, x1, y1 in detect_boxes(detector, image)]
        found[key] = clip_rects(rects, box)

    if target == "subtitle":
        found = changing_rects(frames, keys, found)

    if target == "watermark":
        # 늘 같은 자리에 있는 상자만 남긴다 — 바뀌는 자막은 워터마크가 아니다.
        need = max(2, int(len(keys) * 0.6))
        steady = []
        for rect in [rect for key in keys for rect in found[key]]:
            hits = sum(1 for key in keys if any(overlaps(rect, other) for other in found[key]))
            if hits >= need and not any(overlaps(rect, kept) for kept in steady):
                steady.append(rect)
        found = {key: steady for key in keys}

    per_frame = []
    for index in range(total):
        before = max([key for key in keys if key <= index], default=keys[0])
        after = min([key for key in keys if key >= index], default=keys[-1])
        merged = list(found[before])
        merged.extend(rect for rect in found[after] if rect not in merged)
        per_frame.append(merged)
    return per_frame


def open_writer(args, fps, width, height):
    """프레임을 그대로 받아 한 번만 인코딩하는 ffmpeg — 소리는 원본에서 가져온다."""
    trim = [] if args.duration <= 0 else ["-ss", str(args.start), "-t", str(args.duration)]
    command = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{width}x{height}", "-r", str(fps), "-i", "-",
        *trim, "-i", args.media,
        "-map", "0:v:0", "-map", "1:a:0?",
        "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy", "-shortest",
        args.out,
    ]
    return subprocess.Popen(command, stdin=subprocess.PIPE)


def erase(args):
    import cv2

    reader = cv2.VideoCapture(args.media)
    if not reader.isOpened():
        raise RuntimeError(f"영상을 열지 못했습니다: {args.media}")

    fps = reader.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(reader.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(reader.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(reader.get(cv2.CAP_PROP_FRAME_COUNT))

    start_frame = int(args.start * fps)
    end_frame = total if args.duration <= 0 else min(total, start_frame + int(args.duration * fps))
    if start_frame > 0:
        reader.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
    wanted = max(1, end_frame - start_frame)

    box = None if args.box == "auto" else parse_box(args.box)
    # 자막은 화면 아래쪽에 있다. 위쪽까지 훑으면 느릴 뿐 아니라 화면에 원래 있던 글자
    # (작업표시줄, 웹페이지)까지 지울 대상이 된다(실측: 자막 없는 영상도 훼손했다).
    offset_y = int(height * SUBTITLE_BAND) if box is None and args.target == "subtitle" else 0

    detector = load_detector()
    # 중간 파일로 한 번 저장했다가 다시 인코딩하면 손대지 않은 곳까지 화질이 떨어진다
    # (실측: 아무것도 못 지운 영상도 원본과 어긋났다). 프레임을 ffmpeg로 바로 흘려보낸다.
    writer = open_writer(args, fps, width, height)

    done = 0
    ratios = []
    boxes_seen = []
    while done < wanted:
        frames = []
        while len(frames) < CHUNK_FRAMES and done + len(frames) < wanted:
            ok, frame = reader.read()
            if not ok:
                break
            frames.append(frame)
        if not frames:
            break

        rects_per_frame = plan_rects(detector, frames, args.target, offset_y, box)
        for rects in rects_per_frame:
            boxes_seen.extend(rects)

        if args.mode == "blur":
            frames = blur_chunk(frames, rects_per_frame)
        else:
            frames, covered = erase_chunk(frames, rects_per_frame, args.mode)
            ratios.append(covered)

        for frame in frames:
            writer.stdin.write(frame.tobytes())
        done += len(frames)
        print(f"progress={done}/{wanted}", file=sys.stderr, flush=True)

    reader.release()
    writer.stdin.close()
    if writer.wait() != 0:
        raise RuntimeError("영상을 저장하지 못했습니다. ffmpeg가 설치돼 있는지 확인해주세요.")

    if not done:
        raise RuntimeError("읽어들인 프레임이 없습니다.")

    region = region_of(boxes_seen, (height, width))
    if region:
        print("detected box={},{},{},{}".format(*region), file=sys.stderr)
    else:
        print("note: 지울 글자를 찾지 못했습니다. 원본 그대로 내보냅니다.", file=sys.stderr)
    if ratios:
        print(f"masked_ratio={sum(ratios) / len(ratios):.3f}", file=sys.stderr)

    print(f"frames={done} mode={args.mode} target={args.target} out={args.out}", file=sys.stderr)
    return 0


def main():
    parser = argparse.ArgumentParser(description="영상에 박힌 자막·워터마크 지우기")
    parser.add_argument("media")
    parser.add_argument("--out", required=True)
    parser.add_argument("--temp", default="", help="쓰지 않음(옛 호출 호환용)")
    parser.add_argument("--box", default="auto", help="지울 영역 x,y,w,h 또는 auto")
    parser.add_argument("--mode", default="background", choices=["background", "fast", "blur"])
    parser.add_argument("--target", default="subtitle", choices=["subtitle", "watermark", "both"])
    parser.add_argument("--start", type=float, default=0.0)
    parser.add_argument("--duration", type=float, default=0.0, help="0이면 끝까지")
    args = parser.parse_args()
    try:
        return erase(args)
    except Exception as error:  # 사용자에게는 파이썬 추적 대신 한 줄 이유를 보여준다.
        print(f"자막 지우기 실패: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
