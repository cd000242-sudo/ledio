"""롱폼 자막용 WhisperX 실행기.

전사(faster-whisper/ctranslate2)는 GPU에서, 정렬(wav2vec2/torch)은 기본 CPU에서 돌린다.
둘 다 GPU로 돌리면 cuDNN이 충돌해 프로세스가 0xC0000409로 즉사한다(실측).
전사 후 모델을 내리고 VRAM을 비운 뒤 정렬을 시작한다.

출력: {"segments": [{"start","end","text","words":[{"word","start","end"}]}]} 형식의 JSON 파일.
"""

import argparse
import gc
import json
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description="WhisperX transcribe + align")
    parser.add_argument("media")
    parser.add_argument("--out", required=True, help="결과 JSON 경로")
    parser.add_argument("--model", default="large-v3")
    parser.add_argument("--language", default="ko")
    parser.add_argument("--device", default="cuda", help="전사 장치")
    parser.add_argument("--align-device", default="cpu", help="정렬 장치(기본 cpu — GPU는 충돌 위험)")
    parser.add_argument("--compute-type", default="float16")
    parser.add_argument("--batch-size", type=int, default=8)
    args = parser.parse_args()

    import torch
    import whisperx

    audio = whisperx.load_audio(args.media)

    language = None if args.language in ("", "auto") else args.language
    model = whisperx.load_model(
        args.model, args.device, compute_type=args.compute_type, language=language
    )
    result = model.transcribe(audio, batch_size=args.batch_size)

    # 정렬 전에 전사 모델을 완전히 내린다 — 두 엔진이 GPU를 동시에 잡으면 죽는다.
    del model
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    detected = result.get("language") or args.language
    align_model, metadata = whisperx.load_align_model(
        language_code=detected, device=args.align_device
    )
    aligned = whisperx.align(
        result["segments"], align_model, metadata, audio, args.align_device,
        return_char_alignments=False,
    )

    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump({"language": detected, "segments": aligned["segments"]}, handle, ensure_ascii=False)

    word_count = sum(len(segment.get("words", [])) for segment in aligned["segments"])
    print(f"segments={len(aligned['segments'])} words={word_count}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
