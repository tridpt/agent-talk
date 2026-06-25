const $ = (id) => document.getElementById(id);
const SS_KEY = "agentTalkSession";
const COLORS = ["#3b82f6", "#ec4899", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444"];
const DIRECTOR = "Đạo diễn";
const CRITS = [
  { key: "logic", label: "Logic", icon: "🧩" },
  { key: "evidence", label: "Bằng chứng", icon: "📊" },
  { key: "creativity", label: "Sáng tạo", icon: "💡" },
  { key: "attitude", label: "Thái độ", icon: "🤝" },
];
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
  const fromShare = loadFromShare();
  if (!fromShare && !restoreSession()) {
    DEFAULT_AGENTS.forEach(addAgentCard);
  }
  bindEvents();
  refreshUi();
  renderLeaderboard();
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
  node.querySelector(".a-memory").value = data.memory || "";

  node.querySelector(".mem-clear").addEventListener("click", () => {
    node.querySelector(".a-memory").value = "";
    saveSession();
  });

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
    memory: c.querySelector(".a-memory").value.trim(),
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

// ---------- Đọc to (Text-to-Speech) ----------
const tts = {
  voices: [],
  supported: "speechSynthesis" in window,
  load() {
    if (!this.supported) return;
    this.voices = speechSynthesis.getVoices();
  },
  // Chọn giọng ổn định theo tên agent (ưu tiên giọng tiếng Việt nếu có)
  voiceFor(name) {
    if (!this.voices.length) this.load();
    if (!this.voices.length) return null;
    const vi = this.voices.filter((v) => /vi[-_]?/i.test(v.lang));
    const pool = vi.length ? vi : this.voices;
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return pool[h % pool.length];
  },
  speak(name, text) {
    if (!this.supported || !$("ttsOn").checked || !text.trim()) return;
    const u = new SpeechSynthesisUtterance(text);
    const v = this.voiceFor(name);
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = "vi-VN"; }
    u.rate = 1; u.pitch = 1;
    speechSynthesis.speak(u);
  },
  stop() {
    if (this.supported) speechSynthesis.cancel();
  },
};
if (tts.supported) {
  tts.load();
  speechSynthesis.onvoiceschanged = () => tts.load();
}

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
      const bubbleEl = target.closest(".bubble");
      bubbleEl.classList.add("speaking");
      const text = await streamTurn(speaker, target);
      bubbleEl.classList.remove("speaking");
      if (!running) { if (!text) bubbleEl.remove(); break; }
      if (!text) { bubbleEl.remove(); break; }
      history.push({ name: speaker, text, kind: "agent" });
      lastSpeaker = speaker;
      saveSession();
      tts.speak(speaker, text);
      speaker = await pickNext(speaker);
      if (delayMs && running && i < maxTurns - 1) await sleep(delayMs);
    }
  } catch (e) {
    addError(e.message);
  }
  await updateMemories();
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
  tts.stop();
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
  ["copyBtn", "shareBtn", "scoreBtn"].forEach((id) => ($(id).disabled = history.length === 0 || running));
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
    ttsOn: $("ttsOn").checked,
    memOn: $("memOn").checked,
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
  if (d.ttsOn !== undefined) $("ttsOn").checked = d.ttsOn;
  if (d.memOn !== undefined) $("memOn").checked = d.memOn;
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

// ---------- Bộ nhớ dài hạn ----------
async function updateMemories() {
  if (!$("memOn").checked || history.length === 0) return;
  const agents = getAgents();
  const cards = [...$("agents").children];
  setStatus("🧠 Đang cập nhật bộ nhớ...");
  const turns = history.map((h) => ({ name: h.name, text: h.text }));
  await Promise.all(
    agents.map(async (a, i) => {
      try {
        const r = await fetch("/api/distill_memory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agent: a, prev_memory: a.memory, topic: $("topic").value, history: turns,
          }),
        });
        const j = await r.json();
        if (r.ok && j.memory && cards[i]) {
          cards[i].querySelector(".a-memory").value = j.memory.trim();
        }
      } catch (e) { /* bo qua */ }
    })
  );
  setStatus("");
  saveSession();
}

// ---------- Sao chép hội thoại ----------
async function copyConversation() {
  if (history.length === 0) return;
  try {
    await navigator.clipboard.writeText(buildContent("txt"));
    flash($("copyBtn"), "✅ Đã chép");
  } catch (e) {
    flash($("copyBtn"), "✕ Lỗi chép");
  }
}

// ---------- Chia sẻ qua link ----------
const b64encode = (s) => btoa(unescape(encodeURIComponent(s)));
const b64decode = (s) => decodeURIComponent(escape(atob(s)));

async function shareLink() {
  if (history.length === 0) return;
  const payload = {
    agents: getAgents().map(({ memory, ...rest }) => rest), // khong chia se bo nho rieng tu
    topic: $("topic").value,
    history,
    summary, summarizedCount, lastSpeaker,
  };
  let code;
  try { code = b64encode(JSON.stringify(payload)); }
  catch (e) { return flash($("shareBtn"), "✕ Lỗi"); }
  const url = `${location.origin}${location.pathname}#share=${code}`;
  try {
    await navigator.clipboard.writeText(url);
    flash($("shareBtn"), url.length > 8000 ? "⚠ Link dài, đã chép" : "✅ Đã chép link");
  } catch (e) {
    prompt("Sao chép link chia sẻ:", url);
  }
}

function loadFromShare() {
  const m = location.hash.match(/#share=(.+)$/);
  if (!m) return false;
  let d;
  try { d = JSON.parse(b64decode(m[1])); } catch (e) { return false; }
  if (!d || !d.agents) return false;
  if (history.length && !confirm("Mở phiên được chia sẻ? Phiên hiện tại sẽ bị thay thế.")) return false;

  $("agents").innerHTML = "";
  d.agents.forEach(addAgentCard);
  if (d.topic !== undefined) $("topic").value = d.topic;
  history = d.history || [];
  summary = d.summary || "";
  summarizedCount = d.summarizedCount || 0;
  lastSpeaker = d.lastSpeaker || "";
  renderHistory();
  // Xoa hash khoi URL de tranh tai lai khi reload, va luu phien
  window.history.replaceState(null, "", location.pathname);
  saveSession();
  refreshUi();
  return true;
}

// ---------- Chấm điểm ----------
async function scoreConversation() {
  if (history.length === 0 || running) return;
  const box = $("scoreResult");
  box.hidden = false;
  box.innerHTML = '<p class="score-loading">⏳ Đang chấm điểm...</p>';
  try {
    const r = await fetch("/api/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agents: getAgents(),
        topic: $("topic").value,
        history: history.map((h) => ({ name: h.name, text: h.text })),
      }),
    });
    const j = await r.json();
    if (!r.ok) { box.innerHTML = `<p class="score-err">${escapeHtml(j.error || "Lỗi chấm điểm")}</p>`; return; }
    renderScore(j);
  } catch (e) {
    box.innerHTML = `<p class="score-err">${escapeHtml(e.message)}</p>`;
  }
}

function renderScore(data) {
  const box = $("scoreResult");
  const crits = CRITS.filter((c) => (data.criteria || CRITS.map((x) => x.key)).includes(c.key));
  const scores = (data.scores || []).slice().sort((a, b) => (b.overall || 0) - (a.overall || 0));
  let html = '<h3>🏆 Kết quả chấm điểm</h3><div class="score-list">';
  scores.forEach((s) => {
    const win = data.winner && s.name === data.winner;
    const overall = s.overall ?? 0;
    const opct = Math.max(0, Math.min(100, overall * 10));
    let crow = '<div class="crit-grid">';
    crits.forEach((c) => {
      const v = s[c.key];
      const pct = Math.max(0, Math.min(100, (v || 0) * 10));
      crow += `
        <div class="crit">
          <span class="crit-label">${c.icon} ${c.label}</span>
          <span class="crit-bar"><i style="width:${pct}%;background:${colorFor(s.name)}"></i></span>
          <span class="crit-num">${v ?? "?"}</span>
        </div>`;
    });
    crow += "</div>";
    html += `
      <div class="score-item${win ? " winner" : ""}">
        <div class="score-top">
          <span class="score-name" style="color:${colorFor(s.name)}">${escapeHtml(s.name)}${win ? " 👑" : ""}</span>
          <span class="score-num">${overall}/10</span>
        </div>
        <div class="score-bar"><span style="width:${opct}%;background:${colorFor(s.name)}"></span></div>
        ${crow}
        ${s.reason ? `<p class="score-reason">${escapeHtml(s.reason)}</p>` : ""}
      </div>`;
  });
  html += "</div>";
  if (data.winner) html += `<p class="score-winner">Thuyết phục nhất: <b>${escapeHtml(data.winner)}</b></p>`;
  box.innerHTML = html;

  recordScore(data);
}

// ---------- Bảng xếp hạng tích lũy ----------
const LB_KEY = "agentTalkLeaderboard";

function loadLeaderboard() {
  try { return JSON.parse(localStorage.getItem(LB_KEY)) || {}; }
  catch (e) { return {}; }
}

function recordScore(data) {
  const lb = loadLeaderboard();
  (data.scores || []).forEach((s) => {
    const e = lb[s.name] || { sessions: 0, wins: 0, sumOverall: 0 };
    e.sessions += 1;
    e.sumOverall += Number(s.overall) || 0;
    CRITS.forEach((c) => {
      e["sum_" + c.key] = (e["sum_" + c.key] || 0) + (Number(s[c.key]) || 0);
    });
    if (data.winner && s.name === data.winner) e.wins += 1;
    lb[s.name] = e;
  });
  try { localStorage.setItem(LB_KEY, JSON.stringify(lb)); } catch (e) {}
  renderLeaderboard();
}

function renderLeaderboard() {
  const box = $("leaderboard");
  const lb = loadLeaderboard();
  const rows = Object.entries(lb).map(([name, e]) => ({
    name,
    sessions: e.sessions,
    wins: e.wins,
    avg: e.sessions ? e.sumOverall / e.sessions : 0,
  })).sort((a, b) => b.wins - a.wins || b.avg - a.avg);

  if (rows.length === 0) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;

  const medals = ["🥇", "🥈", "🥉"];
  let html = `
    <div class="lb-head">
      <h3>📊 Bảng xếp hạng tích lũy</h3>
      <button id="lbClear" class="mini">Xóa bảng</button>
    </div>
    <table class="lb-table">
      <thead><tr><th>#</th><th>Tên</th><th>Thắng</th><th>Phiên</th><th>Điểm TB</th></tr></thead>
      <tbody>`;
  rows.forEach((r, i) => {
    html += `
      <tr>
        <td>${medals[i] || i + 1}</td>
        <td style="color:${colorFor(r.name)};font-weight:700">${escapeHtml(r.name)}</td>
        <td>${r.wins}</td>
        <td>${r.sessions}</td>
        <td>${r.avg.toFixed(1)}</td>
      </tr>`;
  });
  html += "</tbody></table>";
  box.innerHTML = html;
  $("lbClear").addEventListener("click", clearLeaderboard);
}

function clearLeaderboard() {
  if (!confirm("Xóa toàn bộ bảng xếp hạng tích lũy?")) return;
  localStorage.removeItem(LB_KEY);
  renderLeaderboard();
}

// ---------- Tiện ích UI ----------
function setStatus(msg) {
  if (msg) $("sessionInfo").textContent = msg;
  else updateSessionInfo();
}

function flash(btn, msg) {
  const old = btn.textContent;
  btn.textContent = msg;
  setTimeout(() => { btn.textContent = old; }, 1500);
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
  $("copyBtn").addEventListener("click", copyConversation);
  $("shareBtn").addEventListener("click", shareLink);
  $("scoreBtn").addEventListener("click", scoreConversation);
  $("ttsOn").addEventListener("change", () => { if (!$("ttsOn").checked) tts.stop(); saveSession(); });
  $("memOn").addEventListener("change", saveSession);
  ["topic", "orderMode", "maxTurns", "delay", "temp"].forEach((id) =>
    $(id).addEventListener("input", saveSession)
  );
  document.querySelectorAll("button.save").forEach((b) =>
    b.addEventListener("click", () => save(b.dataset.fmt))
  );
}

init();
