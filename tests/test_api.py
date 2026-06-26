"""Test cac endpoint API. LLM duoc mock nen khong goi mang."""
import json

import pytest

from backend import main


def _mock_chat(monkeypatch, return_value):
    async def fake_chat(messages, provider_id="default", temperature=0.9, max_tokens=300):
        return return_value
    monkeypatch.setattr(main.llm, "chat", fake_chat)


# ---------- /api/config ----------
def test_config(client):
    r = client.get("/api/config")
    assert r.status_code == 200
    providers = r.json()["providers"]
    assert any(p["id"] == "default" for p in providers)


# ---------- /api/summarize ----------
def test_summarize(client, monkeypatch):
    _mock_chat(monkeypatch, "Tóm tắt ngắn gọn.")
    r = client.post("/api/summarize", json={
        "prev_summary": "",
        "turns": [{"name": "A", "text": "xin chào"}],
    })
    assert r.status_code == 200
    assert r.json()["summary"] == "Tóm tắt ngắn gọn."


# ---------- /api/next_speaker ----------
def test_next_speaker_picks_valid_name(client, monkeypatch):
    _mock_chat(monkeypatch, "Minh")
    r = client.post("/api/next_speaker", json={
        "agents": [{"name": "Lan"}, {"name": "Minh"}, {"name": "An"}],
        "history": [{"name": "Lan", "text": "..."}],
        "last_speaker": "Lan",
    })
    assert r.status_code == 200
    assert r.json()["name"] == "Minh"


def test_next_speaker_fallback_when_unknown(client, monkeypatch):
    _mock_chat(monkeypatch, "khong-co-ten-nay")
    r = client.post("/api/next_speaker", json={
        "agents": [{"name": "Lan"}, {"name": "Minh"}],
        "history": [],
        "last_speaker": "Lan",
    })
    assert r.status_code == 200
    # fallback luan phien -> nguoi tiep theo Lan la Minh
    assert r.json()["name"] == "Minh"


# ---------- /api/score ----------
def test_score_empty_history(client):
    r = client.post("/api/score", json={"agents": [{"name": "Lan"}], "history": []})
    assert r.status_code == 400


def test_score_normalizes_overall_and_winner(client, monkeypatch):
    # Model tra ve thieu 'overall' va 'winner' -> backend tu tinh/dien
    raw = json.dumps({
        "scores": [
            {"name": "Lan", "logic": 8, "evidence": 6, "creativity": 7, "attitude": 9},
            {"name": "Minh", "logic": 4, "evidence": 4, "creativity": 4, "attitude": 4},
        ]
    })
    _mock_chat(monkeypatch, raw)
    r = client.post("/api/score", json={
        "agents": [{"name": "Lan"}, {"name": "Minh"}],
        "history": [{"name": "Lan", "text": "a"}, {"name": "Minh", "text": "b"}],
    })
    assert r.status_code == 200
    data = r.json()
    assert data["criteria"] == ["logic", "evidence", "creativity", "attitude"]
    lan = next(s for s in data["scores"] if s["name"] == "Lan")
    assert lan["overall"] == pytest.approx(7.5)  # (8+6+7+9)/4
    assert data["winner"] == "Lan"


def test_score_invalid_json(client, monkeypatch):
    _mock_chat(monkeypatch, "khong phai json")
    r = client.post("/api/score", json={
        "agents": [{"name": "Lan"}],
        "history": [{"name": "Lan", "text": "a"}],
    })
    assert r.status_code == 502


# ---------- /api/distill_memory ----------
def test_distill_memory_empty_history_returns_prev(client):
    r = client.post("/api/distill_memory", json={
        "agent": {"name": "Lan", "persona": "lạc quan"},
        "prev_memory": "ký ức cũ",
        "history": [],
    })
    assert r.status_code == 200
    assert r.json()["memory"] == "ký ức cũ"


def test_distill_memory_returns_new(client, monkeypatch):
    _mock_chat(monkeypatch, "* ghi nhớ mới")
    r = client.post("/api/distill_memory", json={
        "agent": {"name": "Lan", "persona": "lạc quan"},
        "prev_memory": "",
        "history": [{"name": "Lan", "text": "xin chào"}],
    })
    assert r.status_code == 200
    assert r.json()["memory"] == "* ghi nhớ mới"


# ---------- /api/turn_stream ----------
def test_turn_stream(client, monkeypatch):
    async def fake_stream(messages, provider_id="default", temperature=0.9, max_tokens=300):
        for chunk in ["Xin ", "chào ", "mọi người."]:
            yield chunk

    async def no_search(req, me):
        return None, []

    monkeypatch.setattr(main.llm, "chat_stream", fake_stream)
    monkeypatch.setattr(main, "maybe_search_context", no_search)
    monkeypatch.setitem(main.config.PROVIDERS["default"], "api_key", "test-key")
    r = client.post("/api/turn_stream", json={
        "agents": [{"name": "Lan", "persona": "lạc quan"}, {"name": "Minh"}],
        "speaker": "Lan",
        "topic": "test",
        "history": [],
    })
    assert r.status_code == 200
    assert r.text == "Xin chào mọi người."


# ---------- /api/session (luu & doc phien chia se) ----------
def test_session_save_and_get(client):
    payload = {"topic": "demo", "history": [{"name": "Lan", "text": "xin chào"}]}
    r = client.post("/api/session/save", json=payload)
    assert r.status_code == 200
    sid = r.json()["id"]
    assert sid

    r2 = client.get(f"/api/session/{sid}")
    assert r2.status_code == 200
    assert r2.json()["topic"] == "demo"


def test_session_get_not_found(client):
    r = client.get("/api/session/khongtontai123")
    assert r.status_code == 404


def test_session_get_invalid_id(client):
    r = client.get("/api/session/..%2Fetc")
    # Ma khong hop le hoac khong tim thay -> khong duoc 200
    assert r.status_code in (400, 404)
