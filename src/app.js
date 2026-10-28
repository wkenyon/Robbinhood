// The actor's console: loads a story, shows the current scene and records
// what the participant did.

import { parseStory } from "./story.js";
import { advance, back, fmt, interpolate, jump, newRun, resolve, serializeRun, tierFor } from "./engine.js";

const DEFAULT_STORY = "stories/robin-hood.yaml";
const KEYS = { text: "cyoa.storyText", run: "cyoa.run", ledger: "cyoa.ledger" };

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
};

let story = null;
let storyText = "";
let run = null;
let ledger = loadJSON(KEYS.ledger) ?? { runs: [] };

// ---------- storage ----------

function loadJSON(key) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

function save(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private mode); the app still works, it just won't survive a reload.
  }
}

function saveRun() {
  save(KEYS.run, JSON.stringify({ title: story.title, run: JSON.parse(serializeRun(run)) }));
}

// ---------- loading ----------

async function boot() {
  const param = new URLSearchParams(location.search).get("story");
  const path = param || DEFAULT_STORY;
  const saved = !param && loadJSON(KEYS.text);
  showDeployInfo(path);
  try {
    if (saved?.text) {
      useStoryText(saved.text, { resume: true });
    } else {
      const res = await fetch(path, { cache: "no-cache" });
      if (!res.ok) throw new Error(`Couldn't load ${path} (${res.status}).`);
      useStoryText(await res.text(), { resume: true, persist: false });
    }
  } catch (err) {
    showErrors([err.message, "Use ⋯ → Open story file… to load one from your computer."]);
    $("story-title").textContent = "No story loaded";
  }
}

// When deployed by the GitHub Pages workflow, deploy.json says which repo and
// commit is live, so we can link straight to the story file's editor on GitHub.
async function showDeployInfo(path) {
  try {
    const res = await fetch("deploy.json", { cache: "no-cache" });
    if (!res.ok) return;
    const info = await res.json();
    const link = $("btn-github");
    link.href = `https://github.com/${info.repo}/edit/${info.branch}/${path.replace(/^\.?\//, "")}`;
    link.hidden = false;
    const when = new Date(info.time).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    $("deploy-info").textContent = `Published from commit ${info.sha.slice(0, 7)} on ${when}.`;
    $("deploy-info").hidden = false;
  } catch {
    // Not deployed by the workflow (e.g. running locally); nothing to show.
  }
}

// Returns the parse result; only switches story when there are no errors.
function useStoryText(text, { resume = false, persist = true } = {}) {
  const result = parseStory(text);
  if (!result.story) {
    showErrors(result.errors);
    return result;
  }
  story = result.story;
  storyText = text;
  if (persist) save(KEYS.text, { text });

  const saved = resume && loadJSON(KEYS.run);
  run = saved && saved.title === story.title && story.scenes[saved.run?.sceneId] ? saved.run : newRun(story);
  saveRun();
  const notes = persist
    ? ["You're using a copy of the story saved in this browser, not the published one. Use ⋯ → Use published story to switch back."]
    : [];
  showErrors([], [...notes, ...result.warnings]);
  renderJumpList();
  render();
  return result;
}

// ---------- rendering ----------

function showErrors(errors, warnings = []) {
  const box = $("errors");
  box.replaceChildren();
  if (!errors.length && !warnings.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.classList.toggle("only-warnings", errors.length === 0);
  box.append(
    el("strong", { textContent: errors.length ? "This story has problems:" : "Heads up:" }),
    el("ul", {}, ...[...errors, ...warnings].map((m) => el("li", { textContent: m }))),
  );
}

function renderJumpList() {
  const sel = $("jump");
  sel.replaceChildren(
    el("option", { value: "", textContent: "Jump to scene…" }),
    ...Object.values(story.scenes).map((s) => el("option", { value: s.id, textContent: s.title })),
  );
}

// A small, safe subset of Markdown: paragraphs, line breaks, **bold**, *italic*.
function richText(text) {
  const frag = document.createDocumentFragment();
  for (const para of text.split(/\n\s*\n/)) {
    if (!para.trim()) continue;
    const p = el("p");
    p.innerHTML = escapeHTML(para.trim())
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/\n/g, "<br>");
    frag.append(p);
  }
  return frag;
}

function escapeHTML(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const money = (n) => `${story.currency}${fmt(n)}`;

function render() {
  const scene = story.scenes[run.sceneId];
  document.title = `${scene.title} · ${story.title}`;
  $("story-title").textContent = story.title;
  $("scene-title").textContent = scene.title;
  $("run-donation").textContent = run.donation === null || run.donation === undefined ? "—" : money(run.donation);
  $("btn-back").disabled = !run.prev;
  $("jump").value = "";

  $("say").replaceChildren(richText(interpolate(scene.say || "…", story, run)));
  $("notes").hidden = !scene.notes;
  $("notes-body").replaceChildren(richText(interpolate(scene.notes, story, run)));

  renderInput(scene);
  renderLog();
  renderLedger();
}

function renderInput(scene) {
  const box = $("input");
  const exit = scene.exit;
  box.className = `card input-card kind-${exit.kind}`;
  const error = el("p", { className: "input-error", hidden: true });
  const fail = (msg) => {
    error.textContent = msg;
    error.hidden = false;
  };
  const go = (input) => {
    const r = advance(story, run, input);
    if (r.error) return fail(r.error);
    step(r.run);
  };
  const optionButtons = (options) =>
    el(
      "div",
      { className: "options" },
      ...options.map((o, i) =>
        el(
          "button",
          { className: "option", onclick: () => go({ type: "option", index: i }) },
          el("span", { className: "key", textContent: i < 9 ? String(i + 1) : "" }),
          el("span", { className: "option-label", textContent: o.label }),
          el("span", { className: "goto", textContent: `→ ${story.scenes[o.goto]?.title ?? o.goto}` }),
        ),
      ),
    );

  switch (exit.kind) {
    case "next":
      box.replaceChildren(
        el("button", { className: "primary big", id: "continue", onclick: () => go({ type: "next" }) }, "Continue ↵"),
        el("span", { className: "goto", textContent: `→ ${story.scenes[exit.goto].title}` }),
      );
      break;

    case "actions":
      box.replaceChildren(el("div", { className: "label", textContent: exit.prompt }), optionButtons(exit.options), error);
      break;

    case "question": {
      const field = el("input", { type: "text", placeholder: "…or type what they said and press Enter", autocomplete: "off" });
      const preview = el("span", { className: "preview" });
      field.addEventListener("input", () => {
        error.hidden = true;
        const r = field.value.trim() ? resolve(story, run, { type: "answer", text: field.value }) : null;
        preview.textContent = r && !r.error ? `→ ${story.scenes[r.goto].title}` : "";
      });
      const form = el("form", { className: "typed" }, field, preview);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        go({ type: "answer", text: field.value });
      });
      box.replaceChildren(
        el("div", { className: "label", textContent: `Question: ${exit.prompt}` }),
        optionButtons(exit.options),
        form,
        exit.otherwise
          ? el("p", { className: "hint", textContent: `Anything else typed → ${story.scenes[exit.otherwise].title}` })
          : null,
        error,
      );
      break;
    }

    case "donation": {
      const field = el("input", { type: "number", min: "0", step: "any", inputMode: "decimal", placeholder: "0", required: true });
      const preview = el("span", { className: "preview" });
      const update = () => {
        error.hidden = true;
        const amount = Number(field.value);
        if (field.value === "" || !Number.isFinite(amount) || amount < 0) return (preview.textContent = "");
        const t = tierFor(exit.tiers, amount);
        preview.textContent = `→ ${t.label ? `${t.label}: ` : ""}${story.scenes[t.goto].title}`;
      };
      field.addEventListener("input", update);
      const form = el(
        "form",
        { className: "amount" },
        el("span", { className: "currency", textContent: story.currency }),
        field,
        el("button", { className: "primary", type: "submit" }, "Record ↵"),
      );
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        if (field.value === "") return fail("Enter an amount (use 0 if they gave nothing).");
        go({ type: "donation", amount: field.value });
      });
      const quick = exit.quick.length
        ? el(
            "div",
            { className: "quick" },
            ...exit.quick.map((q) => el("button", { onclick: () => go({ type: "donation", amount: q }) }, money(q))),
          )
        : null;
      const tiers = el(
        "ul",
        { className: "tiers" },
        ...exit.tiers.map((t, i) => {
          const upper = exit.tiers[i + 1];
          const range = upper ? `${money(t.min)} – under ${money(upper.min)}` : `${money(t.min)}+`;
          return el("li", {}, el("span", { textContent: range }), el("span", { textContent: `${t.label ? `${t.label} ` : ""}→ ${story.scenes[t.goto].title}` }));
        }),
      );
      box.replaceChildren(
        el("div", { className: "label", textContent: `Donation: ${exit.prompt}` }),
        form,
        preview,
        quick,
        el("details", {}, el("summary", { textContent: "Tiers" }), tiers),
        error,
      );
      setTimeout(() => field.focus(), 0);
      break;
    }

    default:
      box.replaceChildren(
        el("div", { className: "the-end", textContent: "The End" }),
        el("p", {
          className: "hint",
          textContent: run.donation === null || run.donation === undefined ? "No donation recorded." : `Donated ${money(run.donation)}.`,
        }),
        el("button", { className: "primary big", onclick: newParticipant }, "Next participant ↵"),
      );
  }
}

function renderLog() {
  const list = $("log");
  list.replaceChildren(
    ...run.log.map((e) =>
      el(
        "li",
        { className: `log-${e.kind}` },
        el("span", { className: "log-scene", textContent: story.scenes[e.from]?.title ?? e.from }),
        el("span", { className: "log-detail", textContent: e.detail }),
      ),
    ),
    el("li", { className: "log-current", textContent: story.scenes[run.sceneId].title }),
  );
  list.lastChild.scrollIntoView({ block: "nearest" });
}

function renderLedger() {
  $("ledger-runs").textContent = String(ledger.runs.length);
  $("ledger-total").textContent = money(ledger.runs.reduce((sum, r) => sum + (r.donation ?? 0), 0));
}

// ---------- actions ----------

function step(next) {
  run = next;
  saveRun();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function newParticipant() {
  const ended = story.scenes[run.sceneId].exit.kind === "end";
  if (run.log.length && !ended && !confirm("This participant hasn't reached an ending. Start a new participant anyway?")) return;
  if (run.log.length) {
    ledger.runs.push({
      story: story.title,
      finishedAt: new Date().toISOString(),
      ending: story.scenes[run.sceneId].title,
      donation: run.donation ?? 0,
      log: run.log,
    });
    save(KEYS.ledger, ledger);
  }
  step(newRun(story));
}

function exportCSV() {
  const rows = [["participant", "story", "time", "from", "to", "kind", "detail", "amount"]];
  const add = (n, title, log) => {
    for (const e of log) rows.push([n, title, e.time, e.from, e.to, e.kind, e.detail, e.amount ?? ""]);
  };
  ledger.runs.forEach((r, i) => add(i + 1, r.story, r.log));
  if (run.log.length) add(`${ledger.runs.length + 1} (in progress)`, story.title, run.log);
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  download(`story-log-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv");
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  el("a", { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- editor ----------

function openEditor() {
  $("editor-text").value = storyText;
  validateEditor();
  $("editor").showModal();
}

function validateEditor() {
  const { errors, warnings } = parseStory($("editor-text").value);
  const status = $("editor-status");
  status.className = `editor-status ${errors.length ? "bad" : "good"}`;
  status.replaceChildren(
    el("strong", { textContent: errors.length ? `${errors.length} problem(s)` : "Looks good ✓" }),
    el("ul", {}, ...[...errors, ...warnings].map((m) => el("li", { textContent: m }))),
  );
  $("editor-apply").disabled = errors.length > 0;
}

// ---------- wiring ----------

$("btn-back").onclick = () => run.prev && step(back(run));
$("btn-new").onclick = () => story && newParticipant();
$("jump").onchange = (e) => e.target.value && step(jump(story, run, e.target.value));

const menu = $("menu");
const toggleMenu = (open = menu.hidden) => {
  menu.hidden = !open;
  $("btn-menu").setAttribute("aria-expanded", String(open));
};
$("btn-menu").onclick = (e) => {
  e.stopPropagation();
  toggleMenu();
};
document.addEventListener("click", (e) => !menu.contains(e.target) && toggleMenu(false));
menu.addEventListener("click", (e) => (e.target.tagName === "BUTTON" || e.target.tagName === "A") && e.target.id !== "btn-load" && toggleMenu(false));

$("btn-load").onclick = () => $("file-input").click();
$("file-input").onchange = async (e) => {
  const file = e.target.files[0];
  toggleMenu(false);
  if (file) useStoryText(await file.text());
  e.target.value = "";
};
$("btn-edit").onclick = () => story && openEditor();
$("btn-export").onclick = exportCSV;
$("btn-reset-default").onclick = () => {
  if (!confirm("Discard any story opened or edited in this browser and load the published one?")) return;
  save(KEYS.text, null);
  save(KEYS.run, null);
  location.reload();
};
$("btn-clear-ledger").onclick = () => {
  if (!confirm("Clear the session totals and the log of finished participants?")) return;
  ledger = { runs: [] };
  save(KEYS.ledger, ledger);
  if (story) renderLedger();
};

$("editor-text").addEventListener("input", validateEditor);
$("editor-text").addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    e.target.setRangeText("  ", e.target.selectionStart, e.target.selectionEnd, "end");
  }
});
$("editor-apply").onclick = () => {
  const r = useStoryText($("editor-text").value);
  if (r.story) $("editor").close();
};
$("editor-download").onclick = () => {
  const name = (parseStory($("editor-text").value).story?.title || "story").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  download(`${name}.yaml`, $("editor-text").value, "text/yaml");
};

// Drop a .yaml file anywhere to load it.
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", async (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) useStoryText(await file.text());
});

document.addEventListener("keydown", (e) => {
  if (!story || $("editor").open || e.ctrlKey || e.metaKey || e.altKey) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (e.key === "ArrowLeft" && !typing && run.prev) {
    step(back(run));
  } else if (e.key === "Enter" && !typing && document.activeElement?.tagName !== "BUTTON") {
    const kind = story.scenes[run.sceneId].exit.kind;
    if (kind === "next") $("continue").click();
    else if (kind === "end") newParticipant();
    else return;
    e.preventDefault();
  } else if (/^[1-9]$/.test(e.key) && !typing) {
    document.querySelectorAll("#input .option")[Number(e.key) - 1]?.click();
  }
});

boot();
