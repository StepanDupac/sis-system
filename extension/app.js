import { Executor } from "./core/executor.js";
import { withExecutionLock, createJournal } from "./core/coordination.js";
import { DemoAdapter, SCENARIOS } from "./adapters/demo.js";
import { createClock, validatePlan } from "./core/config.js";
import { hasCuniSourceTab } from "./cuni/panel.js";

const $ = (selector) => document.querySelector(selector);
const journal = createJournal(chrome.storage.local, "demoUnresolvedAttempt");
const dateFormat = new Intl.DateTimeFormat("cs-CZ", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat("cs-CZ", { hour: "2-digit", minute: "2-digit" });
const logTimeFormat = new Intl.DateTimeFormat("cs-CZ", { hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 });
let slots = defaultSlots();
let events = [];
let runner = null;
let active = false;
let stopped = false;
let openAt = null;
let runClock = null;
let frame = null;
let saveQueue = Promise.resolve();

function defaultSlots() {
  const first = new Date();
  first.setDate(first.getDate() + 14);
  first.setHours(9, 0, 0, 0);
  return Array.from({ length: 3 }, (_, index) => {
    const date = new Date(first);
    date.setDate(date.getDate() + index * 7);
    return { id: `demo-${index + 1}`, examId: "demo-math", date: date.getTime(), selected: true };
  });
}

function localDateTime(timestamp) {
  const date = new Date(timestamp);
  const part = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}:${part(date.getSeconds())}`;
}

function labelFor(slot) { return `${dateFormat.format(slot.date)}, ${timeFormat.format(slot.date)}`; }
function slotName(id) { const slot = slots.find((item) => item.id === id); return slot ? labelFor(slot) : "vybraný termín"; }
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function savePreferences() {
  const value = { version: 1, slots: structuredClone(slots), scenario: $("#scenario").value, timing: $("input[name=timing]:checked").value, exactTime: $("#open-time").value };
  saveQueue = saveQueue.catch(() => {}).then(() => chrome.storage.local.set({ demoPreferences: value })).catch(() => {
    showResult("failed", "Nastavení se nepodařilo uložit. Zkontrolujte rozšíření v Chrome.");
  });
}

function renderSlots(focusId) {
  const list = $("#slots");
  list.replaceChildren();
  let selectedRank = 0;
  slots.forEach((slot, index) => {
    const row = element("div", `slot${slot.selected ? "" : " unselected"}`);
    row.dataset.slotId = slot.id;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = slot.selected;
    checkbox.disabled = active;
    checkbox.id = `select-${slot.id}`;
    checkbox.setAttribute("aria-label", `Použít termín ${labelFor(slot)}`);
    checkbox.addEventListener("change", () => { slot.selected = checkbox.checked; renderSlots(checkbox.id); savePreferences(); });
    const rank = slot.selected ? String(++selectedRank).padStart(2, "0") : "—";
    const description = element("div");
    description.append(element("span", "slot-title", dateFormat.format(slot.date)), element("span", "slot-subtitle", `${timeFormat.format(slot.date)} · ${slot.selected && selectedRank === 1 ? "První volba" : "Náhradní termín"}`));
    const actions = element("div", "slot-actions");
    for (const [direction, arrow, text] of [[-1, "↑", "Posunout výš"], [1, "↓", "Posunout níž"]]) {
      const button = element("button", "icon-button", arrow);
      button.type = "button";
      button.id = `${direction < 0 ? "up" : "down"}-${slot.id}`;
      button.setAttribute("aria-label", `${text}: ${labelFor(slot)}`);
      button.disabled = active || index + direction < 0 || index + direction >= slots.length;
      button.addEventListener("click", () => {
        [slots[index], slots[index + direction]] = [slots[index + direction], slots[index]];
        renderSlots(button.id);
        savePreferences();
      });
      actions.append(button);
    }
    const edit = element("button", "edit-button", "Upravit");
    edit.type = "button";
    edit.disabled = active;
    edit.setAttribute("aria-label", `Upravit datum: ${labelFor(slot)}`);
    edit.setAttribute("aria-expanded", "false");
    const editor = element("div", "slot-editor");
    editor.hidden = true;
    const input = document.createElement("input");
    input.type = "datetime-local";
    input.value = localDateTime(slot.date).slice(0, 16);
    input.setAttribute("aria-label", "Datum a čas ukázkového termínu");
    input.addEventListener("change", () => {
      const date = new Date(input.value).getTime();
      if (!Number.isFinite(date)) return;
      slot.date = date;
      renderSlots();
      savePreferences();
    });
    editor.append(input);
    edit.addEventListener("click", () => {
      editor.hidden = !editor.hidden;
      edit.setAttribute("aria-expanded", String(!editor.hidden));
      if (!editor.hidden) input.focus();
    });
    actions.append(edit);
    row.append(checkbox, element("span", "rank", rank), description, actions, editor);
    list.append(row);
  });
  const count = slots.filter((slot) => slot.selected).length;
  $("#selected-count").textContent = `${count} ${count === 1 ? "vybraný" : count >= 2 && count <= 4 ? "vybrané" : "vybraných"}`;
  $("#summary-count").textContent = count;
  $("#add-slot").disabled = active || slots.length >= 10;
  if (focusId) document.getElementById(focusId)?.focus();
}

const messages = {
  idle: ["Připraveno k vyzkoušení", "Vyberte termíny a spusťte trénink."],
  preparing: ["Kontroluji připravenost", "Souběžně ověřuji ukázkové přihlášení a termíny."],
  armed: ["Čekám na spuštění", "Vše je připraveno. Běží odpočet."],
  refreshing: ["Poslední kontrola", "Obnovuji připravenost před spuštěním."],
  submitting: ["Zkouším termín", "Odesílám ukázkový požadavek."],
  response: ["Odpověď přijata", "Vyhodnocuji odpověď."],
  fallback: ["Zkouším náhradní termín", "Termín není dostupný. Pokračuji podle vašeho pořadí."],
  retrying: ["Krátce čekám", "Server požádal o čekání nebo zápis ještě není otevřený."],
  verifying: ["Ověřuji výsledek", "Zjišťuji, zda byl termín opravdu zapsán."],
  stopping: ["Zastavuji další pokusy", "Probíhající požadavek ještě ověřím. Odeslaný zápis nelze vzít zpět tlačítkem Stop."],
  success: ["V tréninku se to povedlo", "Ukázkový zápis byl potvrzen. Žádná skutečná rezervace nevznikla."],
  exhausted: ["Všechny volby jsou obsazené", "V tréninku nevyšel žádný vybraný termín. Zkuste jiný scénář."],
  auth_expired: ["Přihlášení vypršelo", "Trénink ukázal ztrátu přihlášení. V ostrém režimu by bylo nutné se znovu přihlásit."],
  existing_registration: ["Jiný termín už je zapsaný", "Postup se zastavil. Existující zápis automaticky nemění."],
  uncertain: ["Výsledek není jistý", "Další pokusy jsou zastavené, aby nevznikl dvojí zápis. V ostrém režimu byste museli ověřit výsledek přímo v systému. Tady můžete trénink vymazat."],
  blocked: ["Zůstal nejasný výsledek", "Před dalším pokusem vymažte nejasný výsledek tréninku tlačítkem níže."],
  stopped: ["Trénink zastaven", "Další pokusy se neodešlou."],
  busy: ["Trénink už běží v jiné záložce", "Vraťte se do záložky s probíhajícím tréninkem. Současný druhý běh se nespustil."],
  late: ["Spuštění se opozdilo", "Prohlížeč se probudil příliš pozdě. Nastavte nový čas a nechte záložku v popředí."],
  not_ready: ["Prohlížeč není připravený", "Zkontrolujte čas a vraťte záložku do popředí. Potom spusťte přípravu znovu."],
  limit: ["Čas na pokusy vypršel", "Postup dosáhl limitu času nebo počtu pokusů a zastavil se."],
  failed: ["Přípravu se nepodařilo dokončit", "Zkontrolujte vybrané termíny a čas spuštění."],
};

function logMessage(event) {
  let text = messages[event.state]?.[1] || event.state;
  if (event.state === "submitting") text = `Pokus ${event.attempt}: ${slotName(event.slotId)}. Odeslání ${event.dispatchDelayMs} ms od cílového času.`;
  if (event.state === "response") {
    const responses = { full: "plno", accepted: "přijato, následuje ověření", not_open: "ještě neotevřeno", rate_limited: "požadováno čekání", unknown: "nejasná odpověď", auth_expired: "přihlášení vypršelo", ineligible: "termín nedostupný" };
    text = `Odpověď: ${responses[event.responseStatus] || "neznámý výsledek"}. Doba ukázkové odpovědi: ${event.latencyMs} ms.`;
  }
  if (event.state === "success") text = `Potvrzeno v tréninku: ${slotName(event.slotId)}. Další pokusy zastaveny.`;
  if (event.state === "retrying") text += ` Čekání ${event.delayMs} ms.`;
  if (event.message) text = event.message;
  return text;
}

function onEvent(event) {
  events.push({ ...event, message: logMessage(event) });
  if (events.length > 150) events.shift();
  $("#status-label").textContent = messages[event.state]?.[0] || event.state;
  $("#empty-log").hidden = true;
  $("#download-log").disabled = false;
  const row = element("li");
  row.dataset.state = event.state;
  const time = element("time", "", logTimeFormat.format(event.at));
  time.dateTime = new Date(event.at).toISOString();
  row.append(time, element("span", "", logMessage(event)));
  $("#activity").append(row);
  while ($("#activity").children.length > 150) $("#activity").firstElementChild.remove();
  $("#activity").scrollTop = $("#activity").scrollHeight;
}

function showResult(state, detail) {
  const [title, description] = messages[state] || messages.failed;
  $("#result").replaceChildren(element("strong", "", title), element("span", "", detail || description));
  $("#result").className = `result ${state === "success" ? "" : ["failed", "auth_expired"].includes(state) ? "error" : "warning"}`;
  $("#result").hidden = false;
  $("#status-label").textContent = title;
  $("#reset-demo").hidden = !["uncertain", "blocked"].includes(state);
}

function setActive(value) {
  active = value;
  $("#start").disabled = value;
  $("#stop").hidden = !value;
  $("#stop").disabled = false;
  $("#live-tab").disabled = value;
  $("#scenario").disabled = value;
  $("#open-time").disabled = value;
  document.querySelectorAll("input[name=timing]").forEach((input) => { input.disabled = value; });
  $("#status-dot").classList.toggle("running", value);
  renderSlots();
}

function paintCountdown() {
  const left = Math.max(0, openAt - runClock.now());
  const milliseconds = Math.floor(left);
  const seconds = Math.floor(milliseconds / 1000) % 60;
  const minutes = Math.floor(milliseconds / 60_000) % 60;
  const hours = Math.floor(milliseconds / 3_600_000);
  $("#countdown").classList.toggle("long", hours > 0);
  const part = (value) => String(value).padStart(2, "0");
  $("#countdown").replaceChildren(document.createTextNode(`${hours ? `${part(hours)}:` : ""}${part(minutes)}:${part(seconds)}`), element("span", "", `.${String(milliseconds % 1000).padStart(3, "0")}`));
  if (active) frame = requestAnimationFrame(paintCountdown);
}

$("#start").addEventListener("click", async () => {
  if (active) return;
  stopped = false;
  $("#result").hidden = true;
  $("#reset-demo").hidden = true;
  events = [];
  $("#activity").replaceChildren();
  $("#download-log").disabled = true;
  $("#empty-log").hidden = false;
  runClock = createClock();
  const quick = $("input[name=timing]:checked").value === "quick";
  openAt = quick ? runClock.now() + 5_000 : new Date($("#open-time").value).getTime();
  const plan = { openAt, slots: slots.filter((slot) => slot.selected).map((slot) => ({ ...slot, label: labelFor(slot) })) };
  try {
    validatePlan(plan, runClock.now());
    if (!quick && localDateTime(openAt).slice(0, $("#open-time").value.length) !== $("#open-time").value) throw new Error("Tento místní čas neexistuje kvůli změně letního času. Vyberte jiný čas.");
  } catch (error) { showResult("failed", error.message); return; }
  setActive(true);
  $("#countdown-caption").textContent = `Spuštění ${new Intl.DateTimeFormat("cs-CZ", { dateStyle: "short", timeStyle: "medium" }).format(openAt)}.`;
  paintCountdown();
  let tabId;
  try {
    const result = await withExecutionLock(async () => {
      if (stopped) return { state: "stopped" };
      tabId = (await chrome.tabs.getCurrent())?.id;
      const awake = await chrome.runtime.sendMessage({ type: "wake", tabId });
      if (!awake?.ok) throw new Error("Nepodařilo se připravit prohlížeč. Otevřete rozšíření znovu.");
      try {
        if (stopped) return { state: "stopped" };
        const adapter = new DemoAdapter({ slots: plan.slots, openAt, scenario: $("#scenario").value });
        runner = new Executor({ adapter, journal, onEvent, clock: runClock });
        return await runner.run(plan);
      } finally {
        await chrome.runtime.sendMessage({ type: "release", tabId }).catch(() => {});
      }
    });
    if (!events.some((event) => event.state === result.state)) onEvent({ state: result.state, at: runClock.now() });
    showResult(result.state, result.state === "success" ? `${slotName(result.slotId)}. Potvrzeno pouze v tréninku; v univerzitním systému se nic nezměnilo.` : result.message);
  } catch (error) { showResult("failed", error.message); }
  finally {
    cancelAnimationFrame(frame);
    runner = null;
    setActive(false);
    $("#countdown-caption").textContent = "Trénink skončil. Výsledek najdete níže.";
  }
});

$("#stop").addEventListener("click", () => {
  stopped = true;
  runner?.stop();
  $("#stop").disabled = true;
});

$("#reset-demo").addEventListener("click", async () => {
  const result = await withExecutionLock(async () => {
    const record = await journal.read();
    if (record && record.adapterId !== "offline-demo") return { state: "blocked" };
    await journal.clear();
    return { state: "idle" };
  });
  if (result.state !== "idle") { showResult(result.state); return; }
  $("#result").hidden = true;
  $("#reset-demo").hidden = true;
  $("#status-label").textContent = messages.idle[0];
});

$("#add-slot").addEventListener("click", () => {
  if (active || slots.length >= 10) return;
  const last = slots.at(-1)?.date || Date.now();
  slots.push({ id: `demo-${crypto.randomUUID()}`, examId: "demo-math", date: last + 604_800_000, selected: true });
  renderSlots();
  savePreferences();
});

function selectTab(mode) {
  if (active) return;
  for (const name of ["demo", "live"]) {
    const selected = name === mode;
    $(`#${name}-tab`).setAttribute("aria-selected", String(selected));
    $(`#${name}-tab`).tabIndex = selected ? 0 : -1;
    $(`#${name}-panel`).hidden = !selected;
  }
}
for (const name of ["demo", "live"]) {
  $(`#${name}-tab`).addEventListener("click", () => selectTab(name));
  $(`#${name}-tab`).addEventListener("keydown", (event) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) && !active) {
      event.preventDefault();
      const next = event.key === "Home" ? "demo" : event.key === "End" ? "live" : name === "demo" ? "live" : "demo";
      selectTab(next);
      $(`#${next}-tab`).focus();
    }
  });
}
$("#back-to-demo").addEventListener("click", () => selectTab("demo"));
document.querySelectorAll("input[name=timing]").forEach((input) => input.addEventListener("change", () => {
  $("#exact-time-row").hidden = $("input[name=timing]:checked").value !== "exact";
  savePreferences();
}));
$("#scenario").addEventListener("change", savePreferences);
$("#open-time").addEventListener("change", savePreferences);
document.addEventListener("visibilitychange", () => { $("#visibility-note").hidden = !document.hidden || !active; });
window.addEventListener("beforeunload", (event) => {
  if (!active) return;
  event.preventDefault();
  event.returnValue = "";
});
$("#download-log").addEventListener("click", () => {
  const payload = { mode: "offline-training", version: chrome.runtime.getManifest().version, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, events };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `termin-trenink-${new Date().toISOString().replaceAll(":", "-")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
});

async function initialize() {
  for (const [value, label] of Object.entries(SCENARIOS)) {
    const option = element("option", "", label);
    option.value = value;
    $("#scenario").append(option);
  }
  $("#open-time").value = localDateTime(Date.now() + 60_000);
  $("#timezone").textContent = `Časové pásmo tohoto počítače: ${Intl.DateTimeFormat().resolvedOptions().timeZone}. Zkontrolujte automatické nastavení času.`;
  try {
    const { demoPreferences } = await chrome.storage.local.get("demoPreferences");
    if (demoPreferences?.version === 1) {
      const saved = demoPreferences.slots;
      if (Array.isArray(saved) && saved.length > 0 && saved.length <= 10 && saved.every((slot) =>
        slot && typeof slot.id === "string" && /^demo-[a-zA-Z0-9-]{1,50}$/.test(slot.id) && slot.examId === "demo-math" &&
        Number.isFinite(slot.date) && Math.abs(slot.date) < 8.64e15 && typeof slot.selected === "boolean") && new Set(saved.map((slot) => slot.id)).size === saved.length) slots = saved;
      if (Object.hasOwn(SCENARIOS, demoPreferences.scenario)) $("#scenario").value = demoPreferences.scenario;
      if (demoPreferences.timing === "exact") $("input[value=exact]").checked = true;
      if (typeof demoPreferences.exactTime === "string" && demoPreferences.exactTime.length <= 19) $("#open-time").value = demoPreferences.exactTime;
    }
    if (await journal.read()) showResult("blocked");
  } catch { showResult("failed", "Uložené nastavení nelze načíst. Používám výchozí trénink."); }
  $("#exact-time-row").hidden = $("input[name=timing]:checked").value !== "exact";
  renderSlots();
  $("#start").disabled = false;
  if (hasCuniSourceTab) selectTab("live");
  document.documentElement.dataset.ready = "true";
}
initialize();
