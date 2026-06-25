# Agent Talk 🤖💬

Cho nhiều agent AI có tính cách riêng **tự trò chuyện với nhau**, bạn ngồi xem (và xen vào) chúng nói gì.

Không cần GPU. Dùng API LLM free (Groq / Gemini / OpenRouter).

## Tính năng

- **Nhiều agent** (2 trở lên) cùng tham gia một cuộc hội thoại nhóm.
- **Streaming**: xem từng chữ agent "gõ" ra theo thời gian thực.
- **Thứ tự nói**: luân phiên, hoặc để AI tự quyết ai nói tiếp ("Tự chọn").
- **Tính cách mẫu** chọn nhanh + ô tính cách tự do cho mỗi agent.
- **Mục tiêu ngầm**: cho mỗi agent một ý đồ riêng để khéo léo dẫn dắt câu chuyện.
- **Đạo diễn**: xen vào giữa chừng để gợi ý, đặt câu hỏi, đổi hướng.
- **Tự tóm tắt** khi hội thoại dài để không vỡ ngữ cảnh.
- **Đọc to (TTS)**: bật để nghe agent "nói" bằng giọng trình duyệt, mỗi agent một giọng.
- **Bộ nhớ dài hạn**: agent tự ghi nhớ điều đã học sau mỗi phiên và dùng lại ở phiên sau.
- **Chấm điểm**: trọng tài AI chấm độ thuyết phục của từng agent và chọn người thắng.
- **Sao chép & chia sẻ**: chép nhanh hội thoại, hoặc tạo link chia sẻ cả phiên.
- **Lưu phiên** tự động (localStorage) và **xuất file** `.txt` / `.md` / `.json`.
- **Nhiều "bộ não"**: cấu hình 2 provider để mỗi agent dùng một LLM khác nhau.

## Cấu trúc

```
agent-talk/
├── backend/
│   ├── main.py      # FastAPI: điều phối lượt nói, tóm tắt, chọn người nói
│   ├── llm.py       # Gọi LLM (chuẩn OpenAI-compatible, có streaming)
│   └── config.py    # Đọc cấu hình provider từ .env
├── frontend/
│   ├── index.html   # Giao diện cấu hình + khung chat
│   ├── app.js       # Vòng lặp hội thoại, lưu phiên, xuất file
│   ├── personas.js  # Thư viện tính cách mẫu
│   └── style.css
├── .env.example
└── requirements.txt
```

## Cài đặt

```bash
# 1. Tạo môi trường ảo (khuyên dùng)
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux

# 2. Cài thư viện
pip install -r requirements.txt

# 3. Tạo file .env từ mẫu rồi dán API key
copy .env.example .env        # Windows
# cp .env.example .env        # macOS/Linux
```

### Lấy API key free

- **Groq** (mặc định, nhanh): https://console.groq.com → tạo key → dán vào `LLM_API_KEY`.
- **Gemini**: https://aistudio.google.com/app/apikey — xem ví dụ trong `.env.example` (điền vào nhóm `LLM2_*` để làm provider phụ).

> ⚠️ File `.env` chứa API key thật — đã được `.gitignore`, đừng chia sẻ hay đăng nó lên đâu.

## Chạy

```bash
uvicorn backend.main:app --reload
```

Mở trình duyệt: http://127.0.0.1:8000

## Cách dùng

1. Thêm/đặt tên và tính cách cho các agent (ít nhất 2). Có thể chọn tính cách mẫu để điền nhanh.
2. (Tùy chọn) nhập chủ đề và mục tiêu ngầm cho từng agent.
3. Chọn thứ tự nói, số lượt, tốc độ, độ sáng tạo.
4. Bấm **Bắt đầu** và xem chúng trò chuyện. Dùng ô **Đạo diễn** để xen vào bất cứ lúc nào.
5. Bấm **Tiếp tục** để chạy thêm lượt, hoặc lưu lại hội thoại ra file.

## Ý tưởng mở rộng

- Đồng bộ phiên/bộ nhớ giữa nhiều thiết bị (hiện chỉ lưu cục bộ trên trình duyệt).
- Cho phép nhiều "trọng tài" chấm điểm theo nhiều tiêu chí khác nhau.
- Bảng xếp hạng tích lũy điểm thuyết phục qua nhiều phiên.
- Cho agent chủ động tra cứu thông tin ngoài (web/tools) khi tranh luận.
