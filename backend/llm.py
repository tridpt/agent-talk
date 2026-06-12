"""Lop goi LLM theo chuan OpenAI-compatible (Groq / Gemini / OpenRouter / OpenAI)."""
import json

import httpx

from . import config


class LLMError(Exception):
    pass


def _prepare(provider_id: str, messages, temperature: float, max_tokens: int, stream: bool):
    p = config.get_provider(provider_id)
    if not p["api_key"]:
        raise LLMError(
            f"Provider '{p['label']}' chưa cấu hình API key. "
            "Kiểm tra file .env (LLM_API_KEY hoặc LLM2_API_KEY)."
        )
    url = f"{p['base_url']}/chat/completions"
    headers = {
        "Authorization": f"Bearer {p['api_key']}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": p["model"],
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": stream,
    }
    return url, headers, payload


async def chat(messages, provider_id="default", temperature=0.9, max_tokens=300) -> str:
    """Goi non-streaming, tra ve toan bo noi dung."""
    url, headers, payload = _prepare(provider_id, messages, temperature, max_tokens, False)
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(url, headers=headers, json=payload)
    except httpx.HTTPError as e:
        raise LLMError(f"Loi ket noi toi LLM: {e}") from e

    if resp.status_code != 200:
        raise LLMError(f"LLM tra ve {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    try:
        return data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError) as e:
        raise LLMError(f"Phan hoi LLM khong dung dinh dang: {data}") from e


async def chat_stream(messages, provider_id="default", temperature=0.9, max_tokens=300):
    """Async generator: yield tung doan text khi LLM sinh ra (streaming)."""
    url, headers, payload = _prepare(provider_id, messages, temperature, max_tokens, True)
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream("POST", url, headers=headers, json=payload) as resp:
                if resp.status_code != 200:
                    body = await resp.aread()
                    raise LLMError(f"LLM tra ve {resp.status_code}: {body.decode()[:300]}")
                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[len("data:"):].strip()
                    if data == "[DONE]":
                        break
                    try:
                        obj = json.loads(data)
                        delta = obj["choices"][0]["delta"].get("content")
                        if delta:
                            yield delta
                    except (json.JSONDecodeError, KeyError, IndexError):
                        continue
    except httpx.HTTPError as e:
        raise LLMError(f"Loi ket noi toi LLM: {e}") from e
