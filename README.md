# Agent Talk 🤖💬

Cho hai agent AI co tinh cach rieng **tu tro chuyen voi nhau**, ban ngoi xem chung noi gi.

Khong can GPU. Dung API LLM free (Groq / Gemini / OpenRouter).

## Cau truc

```
agent-talk/
├── backend/
│   ├── main.py      # FastAPI: dieu phoi luot noi
│   ├── llm.py       # Goi LLM (chuan OpenAI-compatible)
│   └── config.py    # Doc cau hinh tu .env
├── frontend/
│   ├── index.html   # Giao dien cau hinh + khung chat
│   ├── app.js       # Vong lap A <-> B
│   └── style.css
├── .env.example
└── requirements.txt
```

## Cai dat

```bash
# 1. Tao moi truong ao (khuyen dung)
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux

# 2. Cai thu vien
pip install -r requirements.txt

# 3. Tao file .env tu mau roi dan API key
copy .env.example .env        # Windows
# cp .env.example .env        # macOS/Linux
```

### Lay API key free

- **Groq** (mac dinh, nhanh): https://console.groq.com → tao key → dan vao `LLM_API_KEY`.
- **Gemini**: https://aistudio.google.com/app/apikey — xem vi du trong `.env.example`.

## Chay

```bash
uvicorn backend.main:app --reload
```

Mo trinh duyet: http://127.0.0.1:8000

## Cach dung

1. Dat ten + tinh cach cho Agent A va Agent B.
2. (Tuy chon) nhap chu de.
3. Chinh so luot, toc do, do sang tao.
4. Bam **Bat dau** va xem hai agent tro chuyen.

## Y tuong mo rong

- Them agent thu 3, 4 (hoi thoai nhom).
- Luu lai cac cuoc tro chuyen ra file.
- Cho moi agent mot "muc tieu" ngam de xem chung thuyet phuc nhau.
- Doi LLM khac nhau cho moi agent.
