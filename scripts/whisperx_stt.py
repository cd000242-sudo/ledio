"""롱폼 자막용 WhisperX 실행기.

전사(ctranslate2)와 정렬(torch)을 **각각 다른 프로세스**에서 돌린다.
한 프로세스에서 둘 다 GPU에 올리면 cuDNN이 충돌해 0xC0000409로 즉사한다(실측).
프로세스를 나누면 둘 다 GPU를 쓸 수 있다 — 정렬이 CPU 대비 7배 빠르다(실측 5.0초 → 0.7초).

사용:
  python whisperx_stt.py transcribe <media> --out segments.json [--initial-prompt "대본 앞부분"]
  python whisperx_stt.py align <media> --segments segments.json --out result.json

출력(align): {"language": "ko", "segments": [{"start","end","text","words":[{"word","start","end"}]}]}
"""

import argparse
import json
import os
import sys
import time


def progress_writer(path, stage):
    """진행 퍼센트를 파일에 적는 함수를 만든다.

    화면이 "몇 분 걸립니다"만 띄우고 아무것도 안 알려주면 멈춘 줄 안다.
    whisperx가 주는 진짜 퍼센트를 그대로 적는다(추정이 아니다).
    너무 자주 쓰면 디스크만 괴롭히므로 0.4초 간격 또는 1% 변화일 때만 쓴다.
    """
    if not path:
        return None

    state = {"at": 0.0, "percent": -1.0}

    def write(percent):
        now = time.monotonic()
        if percent < 100 and now - state["at"] < 0.4 and abs(percent - state["percent"]) < 1:
            return
        state["at"] = now
        state["percent"] = percent
        payload = {"stage": stage, "percent": round(float(percent), 1)}
        temp = path + ".tmp"
        try:
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
            with open(temp, "w", encoding="utf-8") as handle:
                json.dump(payload, handle)
            os.replace(temp, path)  # 반쯤 쓰인 파일을 읽지 않게 통째로 바꾼다
        except OSError:
            pass  # 진행 표시가 안 되는 것뿐이다 — 받아쓰기를 막지 않는다

    return write


def transcribe(args) -> int:
    import whisperx

    audio = whisperx.load_audio(args.media)
    language = None if args.language in ("", "auto") else args.language
    # 대본 앞부분을 힌트로 주면 고유명사·숫자·영어를 처음부터 맞게 받아쓴다.
    asr_options = {"initial_prompt": args.initial_prompt} if args.initial_prompt else None
    model = whisperx.load_model(
        args.model,
        args.device,
        compute_type=args.compute_type,
        language=language,
        asr_options=asr_options,
    )
    report = progress_writer(args.progress, "transcribe")
    result = model.transcribe(audio, batch_size=args.batch_size, progress_callback=report)
    if report:
        report(100)
    payload = {"language": result.get("language") or args.language, "segments": result["segments"]}
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False)
    print(f"segments={len(result['segments'])}", file=sys.stderr)
    return 0


def align(args) -> int:
    import whisperx

    audio = whisperx.load_audio(args.media)
    with open(args.segments, encoding="utf-8") as handle:
        source = json.load(handle)
    language = source.get("language") or args.language or "ko"

    model, metadata = whisperx.load_align_model(language_code=language, device=args.device)
    report = progress_writer(args.progress, "align")
    aligned = whisperx.align(
        source["segments"],
        model,
        metadata,
        audio,
        args.device,
        return_char_alignments=False,
        progress_callback=report,
    )
    if report:
        report(100)
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump({"language": language, "segments": aligned["segments"]}, handle, ensure_ascii=False)

    words = sum(len(segment.get("words", [])) for segment in aligned["segments"])
    print(f"words={words}", file=sys.stderr)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="WhisperX 2단계 실행기")
    sub = parser.add_subparsers(dest="phase", required=True)

    p_tx = sub.add_parser("transcribe")
    p_tx.add_argument("media")
    p_tx.add_argument("--out", required=True)
    p_tx.add_argument("--model", default="large-v3")
    p_tx.add_argument("--language", default="ko")
    p_tx.add_argument("--device", default="cuda")
    p_tx.add_argument("--compute-type", default="float16")
    p_tx.add_argument("--batch-size", type=int, default=16)
    p_tx.add_argument("--initial-prompt", default="")
    p_tx.add_argument("--progress", default="", help="진행 퍼센트를 적을 파일")
    p_tx.set_defaults(func=transcribe)

    p_al = sub.add_parser("align")
    p_al.add_argument("media")
    p_al.add_argument("--segments", required=True)
    p_al.add_argument("--out", required=True)
    p_al.add_argument("--language", default="ko")
    p_al.add_argument("--device", default="cuda")
    p_al.add_argument("--progress", default="", help="진행 퍼센트를 적을 파일")
    p_al.set_defaults(func=align)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
