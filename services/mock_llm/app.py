from datetime import datetime
from typing import Any, Dict, Iterator, List

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json

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
