import os
from pathlib import Path

from dotenv import load_dotenv

# Nap bien moi truong tu file .env o thu muc goc du an
ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

FRONTEND_DIR = ROOT / "frontend"


def _provider(prefix: str, default_base: str, default_model: str, default_label: str):
    return {
        "base_url": os.getenv(f"{prefix}BASE_URL", default_base).rstrip("/"),
        "api_key": os.getenv(f"{prefix}API_KEY", ""),
        "model": os.getenv(f"{prefix}MODEL", default_model),
        "label": os.getenv(f"{prefix}LABEL", default_label),
    }


# Co the cau hinh nhieu provider de moi agent dung mot "bo nao" rieng.
# "default" = LLM_*  (mac dinh Groq) ; "alt" = LLM2_*  (vd Gemini)
PROVIDERS = {
    "default": _provider(
        "LLM_", "https://api.groq.com/openai/v1", "llama-3.3-70b-versatile", "Groq"
    ),
    "alt": _provider("LLM2_", "", "", "Provider phụ"),
}


def get_provider(provider_id: str):
    return PROVIDERS.get(provider_id) or PROVIDERS["default"]


def public_providers():
    """Thong tin provider an toan de gui ra frontend (khong lo API key)."""
    out = []
    for pid, p in PROVIDERS.items():
        out.append(
            {
                "id": pid,
                "label": p["label"],
                "model": p["model"],
                "configured": bool(p["api_key"]),
            }
        )
    return out
