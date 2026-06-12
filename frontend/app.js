const $ = (id) => document.getElementById(id);

let running = false;
let history = [];          // [{speaker, name, provider, text}]
let nextSpeaker = "A";     // luot ke tiep (dung cho nut "Tiep tuc")
let providers = [];        // tu /api/config

// ---------- Khoi tao ----------
async function init() {
  populateTemplates();
  await loadProviders();
}

function populateTemplates() {
  document.querySelectorAll("select.tpl").forEach((sel) => {
    sel.innerHTML = '<option value="">— chọn mẫu (tùy chọn) —</option>';
    PERSONA_TEMPLATES.forEach((t, i) => {
      sel.innerHTML += `<option value="${i}">${t.label}</option>`;
    });
    sel.addEventListener("change", () => {
      if (sel.value === "") return;
      $(sel.dataset.target).value = PERSONA_TEMPLATES[sel.value].text;
    });
  });
}

async function loadProviders() {
  try {
    const r = await fetch("/api/config");
    const c = await r.json();
    providers = c.providers || [];
  } catch (e) {
    providers = [];
  }
  ["providerA", "providerB"].forEach((id) => {
    const sel = $(id);
    sel.innerHTML = "";
    providers.forEach((p) => {
      const status = p.configured ? "" : " (chưa có key)";
      sel.innerHTML += `<option value="${p.id}">${p.label} · ${p.model || "?"}${status}</option>`;
    });
  });
}

// ---------- Hien thi ----------
function agents() {
  return {
    agent_a: {
      name: $("nameA").value.trim() || "A",
      persona: $("personaA").value.trim(),
      provider: $("providerA").value || "default",
    },
    agent_b: {
      name: $("nameB").value.trim() || "B",
      persona: $("personaB").value.trim(),
      provider: $("providerB").value || "default",
    },
  };
}

function newBubble(speaker, name) {
  const div = document.createElement("div");
  div.className = `bubble ${speaker === "A" ? "left" : "right"}`;
  div.innerHTML = `<span class="who">${escapeHtml(name)}</span><p class="txt"></p>`;
  $("chat").appendChild(div);
  div.scrollIntoView({ behavior: "smooth", block: "end" });
  return div.querySelector(".txt");
}

function addError(msg) {
  const div = document.createElement("div");
  div.className = "bubble error";
  div.textContent = msg;
  $("chat").appendChild(div);
  div.scrollIntoView({ behavior: "smooth", block: "end" });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Goi 1 luot (streaming) ----------
async function streamTurn(speaker, target) {
  const { agent_a, agent_b } = agents();
  const resp = await fetch("/api/turn_stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_a,
      agent_b,
      topic: $("topic").value,
      history: history.map((h) => ({ speaker: h.speaker, text: h.text })),
      next_speaker: speaker,
      temperature: parseFloat($("temp").value) || 0.9,
    }),
  });

  if (!resp.ok) {
    let msg = `Lỗi ${resp.status}`;
    try {
      const j = await resp.json();
      if (j.error) msg = j.error;
    } catch (_) {}
    throw new Error(msg);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    full += chunk;
    target.textContent = full;
    target.scrollIntoView({ behavior: "smooth", block: "end" });
    if (!running) {
      reader.cancel();
      break;
    }
  }
  return full.trim();
}

// ---------- Vong lap chinh ----------
async function loop() {
  running = true;
  setUiRunning(true);

  const { agent_a, agent_b } = agents();
  const names = { A: agent_a.name, B: agent_b.name };
  const provs = { A: agent_a.provider, B: agent_b.provider };
  const maxTurns = parseInt($("maxTurns").value) || 12;
  const delayMs = (parseFloat($("delay").value) || 0) * 1000;

  try {
    for (let i = 0; i < maxTurns && running; i++) {
      const target = newBubble(nextSpeaker, names[nextSpeaker]);
      const text = await streamTurn(nextSpeaker, target);
      if (!text) break;
      history.push({
        speaker: nextSpeaker,
        name: names[nextSpeaker],
        provider: provs[nextSpeaker],
        text,
      });
      nextSpeaker = nextSpeaker === "A" ? "B" : "A";
      if (delayMs && running && i < maxTurns - 1) await sleep(delayMs);
    }
  } catch (e) {
    addError(e.message);
  }

  stop();
}

function start() {
  // bat dau moi: xoa lich su, luot dau cua A
  history = [];
  nextSpeaker = "A";
  $("chat").innerHTML = "";
  loop();
}

function cont() {
  if (history.length === 0) return start();
  loop();
}

function stop() {
  running = false;
  setUiRunning(false);
}

function clearChat() {
  if (running) return;
  history = [];
  nextSpeaker = "A";
  $("chat").innerHTML = "";
  updateSaveButtons();
}

// ---------- UI state ----------
function setUiRunning(r) {
  $("startBtn").disabled = r;
  $("continueBtn").disabled = r || history.length === 0;
  $("stopBtn").disabled = !r;
  $("clearBtn").disabled = r;
  ["nameA", "personaA", "providerA", "tplA",
   "nameB", "personaB", "providerB", "tplB",
   "topic", "maxTurns", "temp"].forEach((id) => ($(id).disabled = r));
  updateSaveButtons();
}

function updateSaveButtons() {
  const has = history.length > 0;
  document.querySelectorAll("button.save").forEach((b) => (b.disabled = !has || running));
  $("continueBtn").disabled = running || history.length === 0;
}

// ---------- Luu hoi thoai ----------
function buildContent(fmt) {
  const topic = $("topic").value;
  const ts = new Date();
  const stamp = ts.toLocaleString("vi-VN");

  if (fmt === "json") {
    return JSON.stringify(
      { topic, created_at: ts.toISOString(), turns: history },
      null,
      2
    );
  }
  if (fmt === "md") {
    let s = `# Hội thoại Agent Talk\n\n- **Chủ đề:** ${topic}\n- **Thời gian:** ${stamp}\n\n---\n\n`;
    history.forEach((h) => {
      s += `**${h.name}** _(${h.provider})_: ${h.text}\n\n`;
    });
    return s;
  }
  // txt
  let s = `Agent Talk — ${stamp}\nChủ đề: ${topic}\n${"=".repeat(40)}\n\n`;
  history.forEach((h) => {
    s += `${h.name} [${h.provider}]:\n${h.text}\n\n`;
  });
  return s;
}

function save(fmt) {
  if (history.length === 0) return;
  const content = buildContent(fmt);
  const mime = { txt: "text/plain", md: "text/markdown", json: "application/json" }[fmt];
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const a = document.createElement("a");
  a.href = url;
  a.download = `agent-talk-${stamp}.${fmt}`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- Su kien ----------
$("startBtn").addEventListener("click", start);
$("continueBtn").addEventListener("click", cont);
$("stopBtn").addEventListener("click", stop);
$("clearBtn").addEventListener("click", clearChat);
document.querySelectorAll("button.save").forEach((b) =>
  b.addEventListener("click", () => save(b.dataset.fmt))
);

init();
