"""Tra cuu web cho agent.

Uu tien Tavily neu co TAVILY_API_KEY trong .env (chat luong cao hon),
neu khong thi fallback ve DuckDuckGo HTML (mien phi, khong can key).
Moi loi deu duoc nuot va tra ve danh sach rong -> agent van tra loi binh thuong.
"""
import html
import os
import re

import httpx

TAVILY_KEY = os.getenv("TAVILY_API_KEY", "")


async def _tavily(query: str, max_results: int):
    url = "https://api.tavily.com/search"
    payload = {
        "api_key": TAVILY_KEY,
        "query": query,
        "max_results": max_results,
        "search_depth": "basic",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url, json=payload)
    if resp.status_code != 200:
        return []
    out = []
    for r in resp.json().get("results", [])[:max_results]:
        out.append({
            "title": (r.get("title") or "").strip(),
            "snippet": (r.get("content") or "").strip()[:300],
            "url": r.get("url") or "",
        })
    return out


_DDG_RE = re.compile(
    r'<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>.*?'
    r'(?:class="result__snippet"[^>]*>(.*?)</a>)?',
    re.DOTALL,
)
_TAG_RE = re.compile(r"<[^>]+>")


def _clean(s: str) -> str:
    return html.unescape(_TAG_RE.sub("", s or "")).strip()


async def _duckduckgo(query: str, max_results: int):
    url = "https://html.duckduckgo.com/html/"
    headers = {"User-Agent": "Mozilla/5.0 (compatible; AgentTalk/1.0)"}
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        resp = await client.post(url, data={"q": query}, headers=headers)
    if resp.status_code != 200:
        return []
    out = []
    for m in _DDG_RE.finditer(resp.text):
        href, title, snippet = m.group(1), m.group(2), m.group(3)
        title = _clean(title)
        if not title:
            continue
        out.append({
            "title": title,
            "snippet": _clean(snippet)[:300],
            "url": href,
        })
        if len(out) >= max_results:
            break
    return out


async def web_search(query: str, max_results: int = 4):
    """Tra ve [{title, snippet, url}]. Khong bao gio raise ra ngoai."""
    query = (query or "").strip()
    if not query:
        return []
    try:
        if TAVILY_KEY:
            res = await _tavily(query, max_results)
            if res:
                return res
        return await _duckduckgo(query, max_results)
    except (httpx.HTTPError, Exception):
        return []


def format_results(results) -> str:
    """Dinh dang ket qua de chen vao ngu canh LLM."""
    if not results:
        return ""
    lines = []
    for i, r in enumerate(results, 1):
        line = f"[{i}] {r['title']}"
        if r.get("snippet"):
            line += f" — {r['snippet']}"
        if r.get("url"):
            line += f" (nguồn: {r['url']})"
        lines.append(line)
    return "\n".join(lines)
