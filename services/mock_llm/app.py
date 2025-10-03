from datetime import datetime
from typing import Any, Dict, List

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Tyrum Mock LLM", version="0.1.0")


class CompletionRequest(BaseModel):
    prompt: str
    max_tokens: int | None = None


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


@app.post("/v1/completions", response_model=CompletionResponse)
def create_completion(request: CompletionRequest) -> CompletionResponse:
    now = int(datetime.utcnow().timestamp())
    return CompletionResponse(
        id="mock-llm-001",
        created=now,
        model="tyrum-mock",
        choices=[CompletionChoice(index=0, text=f"Echo: {request.prompt}")],
        usage={"prompt_tokens": len(request.prompt.split()), "completion_tokens": 3},
    )
