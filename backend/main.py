"""Backend FastAPI: nhieu agent tro chuyen nhom voi nhau."""
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config, llm

app = FastAPI(title="Agent Talk")

DIRECTOR_NAME = "Đạo diễn"


class Agent(BaseModel):
    name: str
    persona: str = ""
    provider: str = "default"
    goal: str = ""               # muc tieu ngam


class TurnRequest(BaseModel):
    agents: list[Agent]
    speaker: str                 # ten agent dang noi
    topic: str = ""
    history: list[dict] = []     # [{"name": "...", "text": "..."}]
    summary: str = ""            # tom tat doan cu (neu co)
    temperature: float = 0.9


class NextRequest(BaseModel):
    agents: list[Agent]
    topic: str = ""
    history: list[dict] = []
    last_speaker: str = ""


class SummarizeRequest(BaseModel):
    prev_summary: str = ""
    turns: list[dict] = []


def _find(agents, name):
    for a in agents:
        if a.name == name:
            return a
    return None


def build_messages(req: TurnRequest):
    me = _find(req.agents, req.speaker)
    if me is None:
        me = req.agents[0]
    others = [a.name for a in req.agents if a.name != me.name]

    if len(req.agents) > 2:
        who = "Đây là cuộc trò chuyện nhóm giữa: " + ", ".join(a.name for a in req.agents) + "."
    elif others:
        who = f"Bạn đang trò chuyện trực tiếp với {others[0]}."
    else:
        who = ""

    topic_line = f" Chủ đề: {req.topic}." if req.topic.strip() else ""
    goal_line = ""
    if me.goal.strip():
        goal_line = (
            f"\nMục tiêu thầm kín của bạn (ĐỪNG nói lộ liễu, hãy khéo léo dẫn dắt "
            f"cuộc trò chuyện về phía đó): {me.goal.strip()}"
        )

    system = (
        f"Bạn là {me.name}. {me.persona}\n"
        f"{who}{topic_line}{goal_line}\n"
        "Hãy trả lời tự nhiên, ngắn gọn (2-4 câu), bằng tiếng Việt CÓ DẤU đầy đủ, "
        "đúng tính cách của bạn. Chỉ nói lời thoại của bạn, không mô tả hành động, "
        "không viết tên mình ở đầu câu, không đóng vai người khác. "
        "Bạn có thể gọi tên người khác khi muốn nói với họ."
    )

    messages = [{"role": "system", "content": system}]

    if req.summary.strip():
        messages.append(
            {"role": "system", "content": f"Tóm tắt diễn biến trước đó: {req.summary.strip()}"}
        )

    for turn in req.history:
        name = turn.get("name", "")
        text = turn.get("text", "")
        if name == me.name:
            messages.append({"role": "assistant", "content": text})
        else:
            messages.append({"role": "user", "content": f"{name}: {text}"})

    if not req.history:
        starter = "Hãy bắt đầu cuộc trò chuyện" + (
            f" về chủ đề: {req.topic}." if req.topic.strip() else "."
        )
        messages.append({"role": "user", "content": starter})
    elif messages[-1]["role"] == "assistant":
        messages.append({"role": "user", "content": "(tiếp tục cuộc trò chuyện)"})

    return me, messages


@app.post("/api/turn_stream")
async def turn_stream(req: TurnRequest):
    me, messages = build_messages(req)

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
            yield f"\n[LỖI] {e}"

    return StreamingResponse(gen(), media_type="text/plain; charset=utf-8")


@app.post("/api/next_speaker")
async def next_speaker(req: NextRequest):
    """Chon agent noi tiep theo mot cach tu nhien (che do 'Tu chon')."""
    names = [a.name for a in req.agents]
    recent = req.history[-8:]
    convo = "\n".join(f'{t.get("name","")}: {t.get("text","")}' for t in recent)
    prompt = (
        f"Đây là cuộc trò chuyện nhóm giữa: {', '.join(names)}.\n"
        f"Diễn biến gần đây:\n{convo or '(chưa có)'}\n\n"
        f"Người vừa nói: {req.last_speaker or '(chưa ai)'}.\n"
        "Theo mạch tự nhiên, AI NÊN nói tiếp theo? "
        "Chỉ trả lời ĐÚNG MỘT tên trong danh sách, không giải thích."
    )
    try:
        ans = await llm.chat(
            [{"role": "user", "content": prompt}], temperature=0.3, max_tokens=20
        )
    except llm.LLMError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})

    # Khop ten gan dung nhat
    ans_low = ans.lower()
    chosen = None
    for n in names:
        if n.lower() in ans_low and n != req.last_speaker:
            chosen = n
            break
    if chosen is None:
        # fallback: luan phien
        if req.last_speaker in names:
            chosen = names[(names.index(req.last_speaker) + 1) % len(names)]
        else:
            chosen = names[0]
    return {"name": chosen}


@app.post("/api/summarize")
async def summarize(req: SummarizeRequest):
    convo = "\n".join(f'{t.get("name","")}: {t.get("text","")}' for t in req.turns)
    prompt = (
        "Tóm tắt ngắn gọn (3-5 câu, tiếng Việt có dấu) diễn biến cuộc trò chuyện sau, "
        "giữ lại các ý chính, quan điểm và mâu thuẫn của từng người.\n"
    )
    if req.prev_summary.strip():
        prompt += f"\nTóm tắt trước đó: {req.prev_summary.strip()}\n"
    prompt += f"\nĐoạn hội thoại mới:\n{convo}"
    try:
        text = await llm.chat(
            [{"role": "user", "content": prompt}], temperature=0.3, max_tokens=300
        )
    except llm.LLMError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return {"summary": text}


@app.get("/api/config")
async def get_config():
    return {"providers": config.public_providers()}


@app.get("/")
async def index():
    return FileResponse(config.FRONTEND_DIR / "index.html")


app.mount("/", StaticFiles(directory=str(config.FRONTEND_DIR)), name="static")
