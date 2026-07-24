# coding=utf-8
"""Qwen3-TTS 보이스 클로닝 브리지.

Node(shorts-factory)가 JSON 작업 파일을 넘기면, 모델을 한 번만 로드해
여러 문장을 연속 생성한다(장면별 나레이션 배치 처리용).

작업 파일 형식(JSON):
{
  "model": "Qwen/Qwen3-TTS-12Hz-1.7B-Base",   # 생략 가능
  "refAudio": "voices/my-voice.wav",           # 내 목소리 샘플(3초+)
  "refText": "샘플에서 말한 문장 그대로",        # 있으면 품질 상승(ICL 모드)
  "language": "Korean",
  "items": [ {"text": "생성할 문장", "out": "audio/scene_01.wav"}, ... ]
}

결과: 각 out 경로에 wav 저장 + stdout 마지막 줄에 결과 JSON 출력.
"""
import argparse
import json
import sys
import time
from pathlib import Path


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("job", help="작업 JSON 파일 경로")
    args = parser.parse_args()

    job = json.loads(Path(args.job).read_text(encoding="utf-8"))
    model_id = job.get("model", "Qwen/Qwen3-TTS-12Hz-1.7B-Base")
    ref_audio = job["refAudio"]
    ref_text = job.get("refText") or None
    language = job.get("language", "Korean")
    items = job["items"]

    if not Path(ref_audio).exists():
        print(json.dumps({"ok": False, "error": f"참조 음성 없음: {ref_audio}"}))
        return 1

    log(f"[tts] 모델 로드 중: {model_id}")
    t0 = time.time()
    import torch  # noqa: PLC0415 - 지연 임포트(에러 메시지 빠르게)
    import soundfile as sf  # noqa: PLC0415
    from qwen_tts import Qwen3TTSModel  # noqa: PLC0415

    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    dtype = torch.bfloat16 if device.startswith("cuda") else torch.float32
    tts = Qwen3TTSModel.from_pretrained(model_id, device_map=device, dtype=dtype)
    log(f"[tts] 로드 완료 ({time.time() - t0:.1f}s, device={device})")

    # 참조 음성 프롬프트는 한 번만 만들어 재사용한다.
    # refText가 없으면 x-vector 모드(전사 불필요, 품질 약간 낮음).
    prompt = tts.create_voice_clone_prompt(
        ref_audio=ref_audio,
        ref_text=ref_text,
        x_vector_only_mode=ref_text is None,
    )

    gen_kwargs = dict(
        max_new_tokens=2048,
        do_sample=True,
        top_k=50,
        top_p=1.0,
        temperature=0.9,
        repetition_penalty=1.05,
    )

    results = []
    for i, item in enumerate(items):
        text = item["text"]
        out_path = Path(item["out"])
        out_path.parent.mkdir(parents=True, exist_ok=True)
        t1 = time.time()
        wavs, sr = tts.generate_voice_clone(
            text=text,
            language=language,
            voice_clone_prompt=prompt,
            **gen_kwargs,
        )
        sf.write(str(out_path), wavs[0], sr)
        dur = len(wavs[0]) / sr
        log(f"[tts] {i + 1}/{len(items)} 완료 ({time.time() - t1:.1f}s, {dur:.2f}s 음성): {out_path}")
        results.append({"out": str(out_path), "durationSec": round(dur, 3)})

    print(json.dumps({"ok": True, "device": device, "results": results}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
