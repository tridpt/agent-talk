const $ = (id) => document.getElementById(id);
const SS_KEY = "agentTalkSession";
const COLORS = ["#3b82f6", "#ec4899", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444"];
const DIRECTOR = "Đạo diễn";
const SUMMARY_WINDOW = 16; // qua nguong nay thi tom tat bot
const KEEP_RECENT = 8;     // so luot gan nhat luon giu nguyen van

let providers = [];
let running = false;
let history = [];          // [{name, text, kind}]  kind: "agent" | "director"
let lastSpeaker = "";
let summary = "";
let summarizedCount = 0;

const DEFAULT_AGENTS = [
  { name: "Lan", provider: "default", goal: "",
    persona: "Bạn là một người lạc quan, tò mò, thích đặt câu hỏi và luôn nhìn mọi việc theo hướng tích cực." },
  { name: "Minh", provider: "default", goal: "",
    persona: "Bạn là một người hoài nghi, thực tế, thích phản biện và hay chỉ ra mặt trái của vấn đề." },
];

// ---------- Khởi tạo ----------
async function init() {
  await loadProviders();
  if (!restoreSession()) {
    DEFAULT_AGENTS.forEach(addAgentCard);
  }
  bindEvents();
  refreshUi();
}

async function loadProviders() {
  try {
    providers = (await (await fetch("/api/config")).json()).providers || [];
  } catch (e) {
    providers = [{ id: "default", label: "default", model: "", configured: false }];
  }
}

// ---------- Quản lý agent card ----------
function addAgentCard(data = {}) {
  const node = $("agentTpl").content.firstElementChild.cloneNode(true);
  const idx = $("agents").children.length;
  node.style.setProperty("--c", COLORS[idx % COLORS.length]);

  node.querySelector(".a-name").value = data.name || `Agent ${idx + 1}`;
  node.querySelector(".a-persona").value = data.persona || "";
  node.querySelector(".a-goal").value = data.goal || "";

  const prov = node.querySelector(".a-provider");
  providers.forEach((p) => {
    const st = p.configured ? "" : " (chưa có key)";
    prov.innerHTML += `<option value="${p.id}">${p.label} · ${p.model || "?"}${st}</option>`;
  });
  prov.value = data.provider || "default";

  const tpl = node.querySelector(".a-tpl");
  tpl.innerHTML = '<option value="">— chọn mẫu (tùy chọn) —</option>';
  PERSONA_TEMPLATES.forEach((t, i) => (tpl.innerHTML += `<option value="${i}">${t.label}</option>`));
  tpl.addEventListener("change", () => {
    if (tpl.value !== "") node.querySelector(".a-persona").value = PERSONA_TEMPLATES[tpl.value].text;
    saveSession();
  });

  node.querySelector(".remove").addEventListener("click", () => {
    if ($("agents").children.length <= 2) return alert("Cần ít nhất 2 agent.");
    node.remove();
    recolor();
    saveSession();
  });

  node.querySelectorAll("input, textarea, select").forEach((el) =>
    el.addEventListener("input", saveSession)
  );

  $("agents").appendChild(node);
}

function recolor() {
  [...$("agents").children].forEach((c, i) =>
    c.style.setProperty("--c", COLORS[i % COLORS.length])
  );
}

function getAgents() {
  return [...$("agents").children].map((c) => ({
    name: c.querySelector(".a-name").value.trim() || "Agent",
    persona: c.querySelector(".a-persona").value.trim(),
    provider: c.querySelector(".a-provider").value || "default",
    goal: c.querySelector(".a-goal").value.trim(),
  }));
}

function colorFor(name) {
  const names = getAgents().map((a) => a.name);
  const i = names.indexOf(name);
  return i >= 0 ? COLORS[i % COLORS.length] : "#64748b";
}

// ---------- Hiển thị ----------
function newBubble(name) {
  const div = document.createElement("div");
  if (name === DIRECTOR) {
    div.className = "bubble director";
    div.innerHTML = `<span class="who">💬 ${escapeHtml(name)}</span><p class="txt"></p>`;
  } else {
    div.className = "bubble agent";
    div.style.setProperty("--c", colorFor(name));
    div.innerHTML = `<span class="who">${escapeHtml(name)}</span><p class="txt"></p>`;
  }
  $("chat").appendChild(div);
  scrollChat();
  return div.querySelector(".txt");
}

function addError(msg) {
  const div = document.createElement("div");
  div.className = "bubble error";
  div.textContent = msg;
  $("chat").appendChild(div);
  scrollChat();
}

function renderHistory() {
  $("chat").innerHTML = "";
  history.forEach((h) => {
    const t = newBubble(h.name);
    t.textContent = h.text;
  });
}

function scrollChat() {
  const c = $("chat");
  c.scrollTop = c.scrollHeight;
}

const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Tóm tắt khi dài ----------
async function maybeSummarize() {
  if (history.length - summarizedCount <= SUMMARY_WINDOW) return;
  const upTo = history.length - KEEP_RECENT;
  const chunk = history.slice(summarizedCount, upTo).map((h) => ({ name: h.name, text: h.text }));
  try {
    const r = await fetch("/api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prev_summary: summary, turns: chunk }),
    });
    const j = await r.json();
    if (r.ok && j.summary) {
      summary = j.summary;
      summarizedCount = upTo;
    }
  } catch (e) { /* bo qua, van chay binh thuong */ }
}

// ---------- Gọi 1 lượt (streaming) ----------
async function streamTurn(speaker, target) {
  const sendHistory = history.slice(summarizedCount).map((h) => ({ name: h.name, text: h.text }));
  const resp = await fetch("/api/turn_stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agents: getAgents(),
      speaker,
      topic: $("topic").value,
      history: sendHistory,
      summary,
      temperature: parseFloat($("temp").value) || 0.9,
    }),
  });
  if (!resp.ok) {
    let msg = `Lỗi ${resp.status}`;
    try { const j = await resp.json(); if (j.error) msg = j.error; } catch (_) {}
    throw new Error(msg);
  }
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    full += dec.decode(value, { stream: true });
    target.textContent = full;
    scrollChat();
    if (!running) { reader.cancel(); break; }
  }
  return full.trim();
}

async function pickNext(speaker) {
  const agents = getAgents();
  const names = agents.map((a) => a.name);
  if ($("orderMode").value === "auto" && names.length > 2) {
    try {
      const r = await fetch("/api/next_speaker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agents,
          topic: $("topic").value,
          history: history.slice(-8).map((h) => ({ name: h.name, text: h.text })),
          last_speaker: speaker,
        }),
      });
      const j = await r.json();
      if (r.ok && j.name) return j.name;
    } catch (e) {}
  }
  const i = names.indexOf(speaker);
  return names[(i + 1) % names.length];
}

// ---------- Vòng lặp chính ----------
async function loop(firstSpeaker) {
  running = true;
  refreshUi();
  const maxTurns = parseInt($("maxTurns").value) || 12;
  const delayMs = (parseFloat($("delay").value) || 0) * 1000;
  let speaker = firstSpeaker;

  try {
    for (let i = 0; i < maxTurns && running; i++) {
      await maybeSummarize();
      const target = newBubble(speaker);
      const text = await streamTurn(speaker, target);
      if (!running) { if (!text) target.closest(".bubble").remove(); break; }
      if (!text) { target.closest(".bubble").remove(); break; }
      history.push({ name: speaker, text, kind: "agent" });
      lastSpeaker = speaker;
      saveSession();
      speaker = await pickNext(speaker);
      if (delayMs && running && i < maxTurns - 1) await sleep(delayMs);
    }
  } catch (e) {
    addError(e.message);
  }
  stop();
}

function start() {
  history = [];
  summary = "";
  summarizedCount = 0;
  lastSpeaker = "";
  $("chat").innerHTML = "";
  const agents = getAgents();
  loop(agents[0].name);
}

async function cont() {
  if (history.length === 0) return start();
  const next = lastSpeaker ? await pickNext(lastSpeaker) : getAgents()[0].name;
  loop(next);
}

function stop() {
  running = false;
  refreshUi();
  saveSession();
}

function clearChat() {
  if (running) return;
  history = []; summary = ""; summarizedCount = 0; lastSpeaker = "";
  $("chat").innerHTML = "";
  saveSession();
  refreshUi();
}

// ---------- Xen vào (đạo diễn) ----------
function interject() {
  const txt = $("interjectInput").value.trim();
  if (!txt) return;
  history.push({ name: DIRECTOR, text: txt, kind: "director" });
  const t = newBubble(DIRECTOR);
  t.textContent = txt;
  $("interjectInput").value = "";
  saveSession();
  refreshUi();
}

// ---------- Trạng thái UI ----------
function refreshUi() {
  $("startBtn").disabled = running;
  $("continueBtn").disabled = running || history.length === 0;
  $("stopBtn").disabled = !running;
  $("clearBtn").disabled = running;
  $("addAgentBtn").disabled = running;
  $("topic").disabled = running;
  ["maxTurns", "delay", "temp", "orderMode"].forEach((id) => ($(id).disabled = running));
  $("agents").querySelectorAll("input, textarea, select, button").forEach((el) => (el.disabled = running));
  document.querySelectorAll("button.save").forEach((b) => (b.disabled = history.length === 0 || running));
}

// ---------- Lưu / khôi phục phiên (localStorage) ----------
function sessionData() {
  return {
    agents: getAgents(),
    topic: $("topic").value,
    orderMode: $("orderMode").value,
    maxTurns: $("maxTurns").value,
    delay: $("delay").value,
    temp: $("temp").value,
    history, summary, summarizedCount, lastSpeaker,
    savedAt: new Date().toISOString(),
  };
}

function saveSession() {
  try {
    localStorage.setItem(SS_KEY, JSON.stringify(sessionData()));
    updateSessionInfo();
  } catch (e) {}
}

function restoreSession() {
  let d;
  try { d = JSON.parse(localStorage.getItem(SS_KEY)); } catch (e) { return false; }
  if (!d || !d.agents) return false;

  $("agents").innerHTML = "";
  d.agents.forEach(addAgentCard);
  if (d.topic !== undefined) $("topic").value = d.topic;
  if (d.orderMode) $("orderMode").value = d.orderMode;
  if (d.maxTurns) $("maxTurns").value = d.maxTurns;
  if (d.delay !== undefined) $("delay").value = d.delay;
  if (d.temp !== undefined) $("temp").value = d.temp;
  history = d.history || [];
  summary = d.summary || "";
  summarizedCount = d.summarizedCount || 0;
  lastSpeaker = d.lastSpeaker || "";
  renderHistory();
  updateSessionInfo();
  return true;
}

function forgetSession() {
  localStorage.removeItem(SS_KEY);
  updateSessionInfo();
}

function updateSessionInfo() {
  const raw = localStorage.getItem(SS_KEY);
  $("sessionInfo").textContent = raw
    ? `💾 Đã lưu phiên (${history.length} lượt)`
    : "";
}

// ---------- Lưu hội thoại ra file ----------
function buildContent(fmt) {
  const topic = $("topic").value;
  const ts = new Date();
  const stamp = ts.toLocaleString("vi-VN");
  if (fmt === "json") {
    return JSON.stringify({ topic, created_at: ts.toISOString(), turns: history }, null, 2);
  }
  if (fmt === "md") {
    let s = `# Hội thoại Agent Talk\n\n- **Chủ đề:** ${topic}\n- **Thời gian:** ${stamp}\n\n---\n\n`;
    history.forEach((h) => (s += `**${h.name}**: ${h.text}\n\n`));
    return s;
  }
  let s = `Agent Talk — ${stamp}\nChủ đề: ${topic}\n${"=".repeat(40)}\n\n`;
  history.forEach((h) => (s += `${h.name}:\n${h.text}\n\n`));
  return s;
}

function save(fmt) {
  if (history.length === 0) return;
  const mime = { txt: "text/plain", md: "text/markdown", json: "application/json" }[fmt];
  const blob = new Blob([buildContent(fmt)], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const a = document.createElement("a");
  a.href = url;
  a.download = `agent-talk-${stamp}.${fmt}`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- Sự kiện ----------
function bindEvents() {
  $("addAgentBtn").addEventListener("click", () => { addAgentCard(); saveSession(); });
  $("startBtn").addEventListener("click", start);
  $("continueBtn").addEventListener("click", cont);
  $("stopBtn").addEventListener("click", stop);
  $("clearBtn").addEventListener("click", clearChat);
  $("forgetBtn").addEventListener("click", forgetSession);
  $("interjectBtn").addEventListener("click", interject);
  $("interjectInput").addEventListener("keydown", (e) => { if (e.key === "Enter") interject(); });
  ["topic", "orderMode", "maxTurns", "delay", "temp"].forEach((id) =>
    $(id).addEventListener("input", saveSession)
  );
  document.querySelectorAll("button.save").forEach((b) =>
    b.addEventListener("click", () => save(b.dataset.fmt))
  );
}

init();
