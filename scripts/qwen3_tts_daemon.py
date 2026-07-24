# coding=utf-8
"""Qwen3-TTS 상주 데몬.

매 호출마다 모델을 다시 로드하던 19초(임포트 6초+로드 13초)를 없애기 위해
모델을 한 번만 GPU에 올려두고 HTTP로 작업을 받는다.

- POST /tts  : qwen3_tts_infer.py와 같은 작업 JSON을 body로 받음 → 같은 결과 JSON 반환
- GET  /health : {"ok": true, "loaded": bool}
- 유휴 30분이 지나면 스스로 종료해 VRAM을 돌려준다.
"""
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8756
IDLE_LIMIT_SEC = 30 * 60

_state = {"tts": None, "torch": None, "sf": None, "last_used": time.time(), "prompt_cache": {}}
_lock = threading.Lock()


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def ensure_model():
    if _state["tts"] is None:
        t0 = time.time()
        import torch
        import soundfile as sf
        from qwen_tts import Qwen3TTSModel

        device = "cuda:0" if torch.cuda.is_available() else "cpu"
        dtype = torch.bfloat16 if device.startswith("cuda") else torch.float32
        _state["tts"] = Qwen3TTSModel.from_pretrained(
            "Qwen/Qwen3-TTS-12Hz-1.7B-Base", device_map=device, dtype=dtype
        )
        _state["torch"] = torch
        _state["sf"] = sf
        _state["device"] = device
        log(f"[daemon] 모델 로드 완료 ({time.time() - t0:.1f}s, {device})")
    return _state["tts"]


def get_prompt(tts, ref_audio: str, ref_text):
    # 같은 목소리의 프롬프트는 캐시해 재계산을 피한다.
    key = f"{ref_audio}:{ref_text or ''}"
    cached = _state["prompt_cache"].get(key)
    if cached is not None:
        return cached
    prompt = tts.create_voice_clone_prompt(
        ref_audio=ref_audio, ref_text=ref_text, x_vector_only_mode=ref_text is None
    )
    _state["prompt_cache"][key] = prompt
    return prompt


def run_job(job: dict) -> dict:
    ref_audio = job["refAudio"]
    if not Path(ref_audio).exists():
        return {"ok": False, "error": f"참조 음성 없음: {ref_audio}"}
    with _lock:
        tts = ensure_model()
        sf = _state["sf"]
        prompt = get_prompt(tts, ref_audio, job.get("refText") or None)
        gen_kwargs = dict(
            max_new_tokens=2048, do_sample=True, top_k=50, top_p=1.0,
            temperature=0.9, repetition_penalty=1.05,
        )
        results = []
        for i, item in enumerate(job["items"]):
            out_path = Path(item["out"])
            out_path.parent.mkdir(parents=True, exist_ok=True)
            t1 = time.time()
            wavs, sr = tts.generate_voice_clone(
                text=item["text"], language=job.get("language", "Korean"),
                voice_clone_prompt=prompt, **gen_kwargs,
            )
            sf.write(str(out_path), wavs[0], sr)
            dur = len(wavs[0]) / sr
            log(f"[daemon] {i + 1}/{len(job['items'])} 완료 ({time.time() - t1:.1f}s, {dur:.2f}s): {out_path}")
            results.append({"out": str(out_path), "durationSec": round(dur, 3)})
        return {"ok": True, "device": _state.get("device", "?"), "results": results}


def warm_model():
    with _lock:
        try:
            ensure_model()
        except Exception as err:  # noqa: BLE001
            log(f"[daemon] 예열 실패: {err}")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # 기본 액세스 로그 끄기
        pass

    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"ok": True, "loaded": _state["tts"] is not None})
        elif self.path == "/warmup":
            # 모델을 백그라운드에서 미리 로드해 첫 요청의 대기를 없앤다.
            _state["last_used"] = time.time()
            if _state["tts"] is None:
                threading.Thread(target=warm_model, daemon=True).start()
            self._send(200, {"ok": True, "warming": _state["tts"] is None})
        else:
            self._send(404, {"ok": False})

    def do_POST(self):
        if self.path != "/tts":
            self._send(404, {"ok": False})
            return
        _state["last_used"] = time.time()
        try:
            length = int(self.headers.get("content-length", "0"))
            job = json.loads(self.rfile.read(length).decode("utf-8"))
            result = run_job(job)
            _state["last_used"] = time.time()
            self._send(200, result)
        except Exception as err:  # noqa: BLE001 - 데몬은 죽지 않아야 한다
            self._send(500, {"ok": False, "error": str(err)})


def idle_watchdog(server):
    while True:
        time.sleep(60)
        if time.time() - _state["last_used"] > IDLE_LIMIT_SEC:
            log("[daemon] 유휴 30분 경과 — 종료")
            threading.Thread(target=server.shutdown, daemon=True).start()
            return


def main() -> int:
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=idle_watchdog, args=(server,), daemon=True).start()
    log(f"[daemon] Qwen3-TTS 데몬 시작: http://127.0.0.1:{PORT}")
    server.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
