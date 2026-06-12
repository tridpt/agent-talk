"""Backend FastAPI: dieu phoi hai agent tro chuyen voi nhau."""
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config, llm

app = FastAPI(title="Agent Talk")


class Agent(BaseModel):
    name: str
    persona: str
    provider: str = "default"      # "default" hoac "alt"


class TurnRequest(BaseModel):
    agent_a: Agent
    agent_b: Agent
    topic: str = ""
    history: list[dict] = []        # [{"speaker": "A"|"B", "text": "..."}]
    next_speaker: str = "A"         # "A" hoac "B"
    temperature: float = 0.9


def _resolve(req: TurnRequest):
    """Tra ve (me, other) theo next_speaker."""
    if req.next_speaker == "A":
        return req.agent_a, req.agent_b
    return req.agent_b, req.agent_a


def build_messages(req: TurnRequest):
    """Tao danh sach messages cho luot noi cua next_speaker."""
    me, other = _resolve(req)

    topic_line = f" Chủ đề cuộc trò chuyện: {req.topic}." if req.topic.strip() else ""
    system = (
        f"Bạn là {me.name}. {me.persona}\n"
        f"Bạn đang trò chuyện trực tiếp với {other.name}.{topic_line}\n"
        "Hãy trả lời tự nhiên, ngắn gọn (2-4 câu), bằng tiếng Việt CÓ DẤU đầy đủ, "
        "đúng tính cách của bạn. Chỉ nói lời thoại của bạn, không mô tả hành động, "
        "không viết tên mình ở đầu câu, không đóng vai người kia."
    )

    messages = [{"role": "system", "content": system}]
    for turn in req.history:
        role = "assistant" if turn.get("speaker") == req.next_speaker else "user"
        messages.append({"role": role, "content": turn.get("text", "")})

    if not messages or messages[-1]["role"] != "user":
        starter = "Hãy bắt đầu cuộc trò chuyện" + (
            f" về chủ đề: {req.topic}." if req.topic.strip() else "."
        )
        messages.append({"role": "user", "content": starter})

    return messages


@app.post("/api/turn")
async def turn(req: TurnRequest):
    me, _ = _resolve(req)
    messages = build_messages(req)
    try:
        text = await llm.chat(messages, provider_id=me.provider, temperature=req.temperature)
    except llm.LLMError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return {"speaker": req.next_speaker, "text": text}


@app.post("/api/turn_stream")
async def turn_stream(req: TurnRequest):
    me, _ = _resolve(req)
    messages = build_messages(req)

    # Kiem tra provider truoc khi stream de co the tra loi 400 goned gang
    provider = config.get_provider(me.provider)
    if not provider["api_key"]:
        return JSONResponse(
            status_code=400,
            content={"error": f"Provider '{provider['label']}' chưa cấu hình API key."},
        )

    async def gen():
        try:
            async for chunk in llm.chat_stream(
                messages, provider_id=me.provider, temperature=req.temperature
            ):
                yield chunk
        except llm.LLMError as e:
            yield f"\n[LOI] {e}"

    return StreamingResponse(gen(), media_type="text/plain; charset=utf-8")


@app.get("/api/config")
async def get_config():
    return {"providers": config.public_providers()}


@app.get("/")
async def index():
    return FileResponse(config.FRONTEND_DIR / "index.html")


app.mount("/", StaticFiles(directory=str(config.FRONTEND_DIR)), name="static")
