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
import sys


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
    result = model.transcribe(audio, batch_size=args.batch_size)
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
    aligned = whisperx.align(
        source["segments"], model, metadata, audio, args.device, return_char_alignments=False
    )
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
    p_tx.set_defaults(func=transcribe)

    p_al = sub.add_parser("align")
    p_al.add_argument("media")
    p_al.add_argument("--segments", required=True)
    p_al.add_argument("--out", required=True)
    p_al.add_argument("--language", default="ko")
    p_al.add_argument("--device", default="cuda")
    p_al.set_defaults(func=align)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
