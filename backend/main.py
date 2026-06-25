"""Backend FastAPI: nhieu agent tro chuyen nhom voi nhau."""
import json
import re

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config, llm, search

app = FastAPI(title="Agent Talk")


class Agent(BaseModel):
    name: str
    persona: str = ""
    provider: str = "default"
    goal: str = ""               # muc tieu ngam
    memory: str = ""             # bo nho dai han (tu cac phien truoc)


class TurnRequest(BaseModel):
    agents: list[Agent]
    speaker: str                 # ten agent dang noi
    topic: str = ""
    history: list[dict] = []     # [{"name": "...", "text": "..."}]
    summary: str = ""            # tom tat doan cu (neu co)
    temperature: float = 0.9
    allow_search: bool = False   # cho phep tra cuu web truoc khi noi
    phase: str = ""              # giai doan tranh bien (mo man / phan bien / ket luan)


class NextRequest(BaseModel):
    agents: list[Agent]
    topic: str = ""
    history: list[dict] = []
    last_speaker: str = ""


class SummarizeRequest(BaseModel):
    prev_summary: str = ""
    turns: list[dict] = []


class ScoreRequest(BaseModel):
    agents: list[Agent]
    topic: str = ""
    history: list[dict] = []


class MemoryRequest(BaseModel):
    agent: Agent
    prev_memory: str = ""
    topic: str = ""
    history: list[dict] = []


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

    memory_line = ""
    if me.memory.strip():
        memory_line = (
            f"\nĐiều bạn còn nhớ từ những cuộc trò chuyện trước (hãy dùng tự nhiên "
            f"khi phù hợp): {me.memory.strip()}"
        )

    phase_line = ""
    phase = (req.phase or "").strip().lower()
    if phase == "mo_man":
        phase_line = (
            "\n[TRANH BIỆN — MỞ MÀN] Hãy trình bày rõ lập trường của bạn về chủ đề "
            "và đưa ra 1-2 luận điểm chính. Chưa cần phản bác ai."
        )
    elif phase == "phan_bien":
        phase_line = (
            "\n[TRANH BIỆN — PHẢN BIỆN] Hãy phản bác trực tiếp luận điểm của đối phương "
            "và củng cố quan điểm của bạn bằng lý lẽ/bằng chứng."
        )
    elif phase == "ket_luan":
        phase_line = (
            "\n[TRANH BIỆN — KẾT LUẬN] Hãy tóm lại lập trường và đưa ra lời chốt "
            "thuyết phục cuối cùng, không nêu thêm luận điểm mới."
        )

    system = (
        f"Bạn là {me.name}. {me.persona}\n"
        f"{who}{topic_line}{goal_line}{memory_line}{phase_line}\n"
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


async def maybe_search_context(req: TurnRequest, me: Agent):
    """Neu allow_search: nho LLM nghi 1 truy van, tra cuu web, tra ve system message.
    Khong bao gio raise — loi gi cung tra ve None de luot noi van chay binh thuong."""
    if not req.allow_search:
        return None
    recent = req.history[-6:]
    convo = "\n".join(f'{t.get("name","")}: {t.get("text","")}' for t in recent)
    q_prompt = (
        f"Chủ đề: {req.topic or '(chưa rõ)'}.\n"
        f"Diễn biến gần đây:\n{convo or '(chưa có)'}\n\n"
        f"Sắp tới lượt {me.name} nói. Nếu cần một dữ kiện THỰC TẾ để lập luận có sức nặng, "
        "hãy đưa ra MỘT truy vấn tìm kiếm ngắn (chỉ từ khóa). "
        "Nếu không cần tra cứu, trả lời chính xác: KHÔNG."
    )
    try:
        q = await llm.chat(
            [{"role": "user", "content": q_prompt}],
            provider_id=me.provider, temperature=0.2, max_tokens=40,
        )
    except llm.LLMError:
        return None
    q = q.strip().strip('"').strip()
    if not q or q.upper().startswith("KHÔNG") or q.upper().startswith("KHONG"):
        return None
    results = await search.web_search(q, max_results=4)
    formatted = search.format_results(results)
    if not formatted:
        return None
    return {
        "role": "system",
        "content": (
            f"Kết quả tra cứu web cho '{q}' (dùng làm dẫn chứng, có thể trích nguồn "
            f"một cách tự nhiên, KHÔNG bịa thêm):\n{formatted}"
        ),
    }


@app.post("/api/turn_stream")
async def turn_stream(req: TurnRequest):
    me, messages = build_messages(req)

    provider = config.get_provider(me.provider)
    if not provider["api_key"]:
        return JSONResponse(
            status_code=400,
            content={"error": f"Provider '{provider['label']}' chưa cấu hình API key."},
        )

    search_msg = await maybe_search_context(req, me)
    if search_msg:
        # Chen ngay sau system goc de lam ngu canh cho luot noi
        messages.insert(1, search_msg)

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


@app.post("/api/score")
async def score(req: ScoreRequest):
    """Cham diem cac agent theo nhieu tieu chi trong cuoc tro chuyen."""
    names = [a.name for a in req.agents]
    convo = "\n".join(f'{t.get("name","")}: {t.get("text","")}' for t in req.history)
    if not convo.strip():
        return JSONResponse(status_code=400, content={"error": "Chưa có hội thoại để chấm điểm."})

    topic_line = f"Chủ đề: {req.topic}.\n" if req.topic.strip() else ""
    prompt = (
        "Bạn là trọng tài trung lập. Dưới đây là một cuộc trò chuyện nhóm.\n"
        f"{topic_line}Các thành viên: {', '.join(names)}.\n\n"
        f"Hội thoại:\n{convo}\n\n"
        "Hãy chấm điểm mỗi thành viên trên thang 0-10 theo BỐN tiêu chí:\n"
        "- logic: lập luận chặt chẽ, mạch lạc\n"
        "- evidence: dùng bằng chứng, ví dụ, dữ kiện cụ thể\n"
        "- creativity: góc nhìn mới mẻ, sáng tạo\n"
        "- attitude: thái độ tôn trọng, xây dựng, lắng nghe\n"
        "Chỉ trả về JSON hợp lệ dạng: "
        '{"criteria":["logic","evidence","creativity","attitude"],'
        '"scores":[{"name":"...","logic":0,"evidence":0,"creativity":0,'
        '"attitude":0,"overall":0,"reason":"nhận xét ngắn"}],'
        '"winner":"tên người thuyết phục nhất tổng thể"}. '
        '"overall" là điểm trung bình bốn tiêu chí (0-10). '
        "Không kèm văn bản nào khác ngoài JSON."
    )
    try:
        raw = await llm.chat(
            [{"role": "user", "content": prompt}], temperature=0.2, max_tokens=700
        )
    except llm.LLMError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})

    # Trich xuat JSON (phong khi model bao quanh bang ```json ... ```)
    text = raw.strip()
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        text = m.group(0)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return JSONResponse(
            status_code=502,
            content={"error": "Không phân tích được kết quả chấm điểm.", "raw": raw[:500]},
        )

    # Chuan hoa: dam bao co 'overall' va 'criteria' (phong khi model bo sot)
    crits = ["logic", "evidence", "creativity", "attitude"]
    data.setdefault("criteria", crits)
    for s in data.get("scores", []):
        vals = []
        for c in crits:
            try:
                v = float(s.get(c))
                s[c] = round(v, 1)
                vals.append(v)
            except (TypeError, ValueError):
                s[c] = None
        if s.get("overall") is None and vals:
            s["overall"] = round(sum(vals) / len(vals), 1)
    if not data.get("winner") and data.get("scores"):
        best = max(data["scores"], key=lambda x: x.get("overall") or 0)
        data["winner"] = best.get("name")
    return data


@app.post("/api/distill_memory")
async def distill_memory(req: MemoryRequest):
    """Chat loc 'bo nho dai han' cho mot agent tu cuoc tro chuyen vua dien ra."""
    me = req.agent
    convo = "\n".join(f'{t.get("name","")}: {t.get("text","")}' for t in req.history)
    if not convo.strip():
        return {"memory": req.prev_memory}

    prompt = (
        f"Bạn đang giúp nhân vật tên {me.name} ghi lại trí nhớ dài hạn.\n"
        f"Tính cách của {me.name}: {me.persona or '(không rõ)'}\n"
    )
    if req.prev_memory.strip():
        prompt += f"\nTrí nhớ hiện có: {req.prev_memory.strip()}\n"
    prompt += (
        f"\nCuộc trò chuyện vừa diễn ra:\n{convo}\n\n"
        f"Hãy viết lại trí nhớ dài hạn của {me.name} (tối đa 5 gạch đầu dòng ngắn, "
        "tiếng Việt có dấu) — giữ lại quan điểm cá nhân, điều đã học được, "
        "mối quan hệ và cảm nhận về những người khác. Gộp với trí nhớ cũ, "
        "bỏ chi tiết vụn vặt. Chỉ trả về nội dung trí nhớ, không lời dẫn."
    )
    try:
        text = await llm.chat(
            [{"role": "user", "content": prompt}],
            provider_id=me.provider,
            temperature=0.3,
            max_tokens=350,
        )
    except llm.LLMError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return {"memory": text}


@app.get("/api/config")
async def get_config():
    return {"providers": config.public_providers()}


@app.get("/")
async def index():
    return FileResponse(config.FRONTEND_DIR / "index.html")


app.mount("/", StaticFiles(directory=str(config.FRONTEND_DIR)), name="static")
