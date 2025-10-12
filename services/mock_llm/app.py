from datetime import datetime
from typing import Any, Dict, Iterator, List, Optional

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import base64
import io
import json
import math
import struct
import wave

app = FastAPI(title="Tyrum Mock LLM", version="0.1.0")


class CompletionRequest(BaseModel):
    prompt: str
    max_tokens: int | None = None
    stream: bool = False


class CompletionChoice(BaseModel):
    index: int
    text: str


class CompletionResponse(BaseModel):
    id: str
    created: int
    model: str
    choices: List[CompletionChoice]
    usage: Dict[str, Any]


class PronunciationEntry(BaseModel):
    token: str
    pronounce: str


class SpeechRequest(BaseModel):
    model: str
    input: str
    voice: str
    format: str = Field(default="wav", pattern="^(wav|mp3)$")
    stream: bool = False
    pace: Optional[float] = None
    pitch: Optional[float] = None
    warmth: Optional[float] = None
    pronunciation_dict: List[PronunciationEntry] = Field(default_factory=list)


class SpeechResponse(BaseModel):
    audio_base64: str
    format: str


@app.get("/healthz")
def healthz() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/completions")
def create_completion(request: CompletionRequest):
    now = int(datetime.utcnow().timestamp())

    if request.stream:
        def event_stream() -> Iterator[str]:
            chunk = {
                "id": "mock-llm-stream-001",
                "object": "text_completion",
                "created": now,
                "model": "tyrum-mock",
                "choices": [
                    {
                        "index": 0,
                        "text": f"Echo: {request.prompt}",
                        "finish_reason": None,
                    }
                ],
            }
            yield f"data: {json.dumps(chunk)}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    return CompletionResponse(
        id="mock-llm-001",
        created=now,
        model="tyrum-mock",
        choices=[CompletionChoice(index=0, text=f"Echo: {request.prompt}")],
        usage={"prompt_tokens": len(request.prompt.split()), "completion_tokens": 3},
    )


@app.post("/v1/audio/speech")
def create_speech(request: SpeechRequest):
    buffer = io.BytesIO()
    sample_rate = 8000
    frequency = 660.0
    duration = 0.1
    amplitude = 0.3

    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        for n in range(int(sample_rate * duration)):
            value = int(
                amplitude
                * 32767
                * math.sin(2 * math.pi * frequency * n / sample_rate)
            )
            wav_file.writeframes(struct.pack("<h", value))

    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return SpeechResponse(audio_base64=encoded, format=request.format)
