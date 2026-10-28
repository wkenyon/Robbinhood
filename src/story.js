// Parsing and validation of story files.
//
// A story is a YAML document with a title, a start scene and a map of scenes.
// Each scene has some text for the actor to say and exactly one way of moving
// on: `actions`, `question`, `donation`, `next`, or `end`. A participant
// donates once, so no path may lead through more than one donation scene.
// See README.md for the full format.

import { load } from "../vendor/js-yaml.mjs";

const EXITS = ["actions", "question", "donation", "next", "end"];

export function parseStory(text) {
  let raw;
  try {
    raw = load(text);
  } catch (err) {
    return { story: null, errors: [`YAML error: ${err.message}`], warnings: [] };
  }
  return normalizeStory(raw);
}

export function normalizeStory(raw) {
  const errors = [];
  const warnings = [];

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { story: null, errors: ["The story file must be a YAML mapping (key: value pairs)."], warnings };
  }
  if (!raw.scenes || typeof raw.scenes !== "object" || Array.isArray(raw.scenes)) {
    return { story: null, errors: ["The story needs a `scenes:` section containing named scenes."], warnings };
  }

  const sceneIds = Object.keys(raw.scenes);
  if (sceneIds.length === 0) errors.push("`scenes:` is empty.");

  const story = {
    title: str(raw.title) || "Untitled story",
    currency: raw.currency === undefined ? "£" : str(raw.currency),
    start: str(raw.start) || sceneIds[0],
    scenes: {},
  };

  const checkTarget = (target, where) => {
    if (target === undefined || target === null || target === "") {
      errors.push(`${where}: missing \`goto\`.`);
    } else if (!(String(target) in raw.scenes)) {
      errors.push(`${where}: goes to unknown scene "${target}".`);
    }
    return target === undefined || target === null ? "" : String(target);
  };

  if (story.start && !(story.start in raw.scenes)) {
    errors.push(`\`start\` refers to unknown scene "${story.start}".`);
  }

  for (const id of sceneIds) {
    const src = raw.scenes[id] ?? {};
    const where = `Scene "${id}"`;
    if (typeof src !== "object" || Array.isArray(src)) {
      errors.push(`${where}: must be a mapping with \`say\`, \`notes\` etc.`);
      continue;
    }

    const scene = {
      id,
      title: str(src.title) || id,
      say: str(src.say),
      notes: str(src.notes),
      exit: null,
    };

    const present = EXITS.filter((k) => src[k] !== undefined && src[k] !== false);
    if (present.length > 1) {
      errors.push(`${where}: has ${present.map((k) => `\`${k}\``).join(" and ")} — use only one.`);
    }
    const kind = present[0];

    if (!kind || kind === "end") {
      scene.exit = { kind: "end" };
    } else if (kind === "next") {
      scene.exit = { kind: "next", label: "Continue", goto: checkTarget(src.next, where) };
    } else if (kind === "actions") {
      const list = asList(src.actions, `${where} \`actions\``, errors);
      scene.exit = {
        kind: "actions",
        prompt: "What does the participant do?",
        options: list.map((a, i) => ({
          label: str(a?.label) || `Option ${i + 1}`,
          goto: checkTarget(a?.goto, `${where}, action ${i + 1}`),
        })),
      };
      if (list.length === 0) errors.push(`${where}: \`actions\` needs at least one option.`);
    } else if (kind === "question") {
      const q = typeof src.question === "string" ? { ask: src.question } : src.question ?? {};
      const list = asList(q.answers, `${where} \`question.answers\``, errors);
      scene.exit = {
        kind: "question",
        prompt: str(q.ask) || "What did the participant answer?",
        options: list.map((a, i) => ({
          label: str(a?.label) || `Answer ${i + 1}`,
          match: [a?.label, ...(Array.isArray(a?.match) ? a.match : a?.match ? [a.match] : [])]
            .filter((m) => m !== undefined && m !== null && m !== "")
            .map(normalizeAnswer),
          goto: checkTarget(a?.goto, `${where}, answer ${i + 1}`),
        })),
        otherwise: q.otherwise === undefined ? "" : checkTarget(q.otherwise, `${where}, \`otherwise\``),
      };
      if (list.length === 0 && !scene.exit.otherwise) {
        errors.push(`${where}: \`question\` needs \`answers\` or an \`otherwise\`.`);
      }
    } else if (kind === "donation") {
      const d = src.donation ?? {};
      const list = asList(d.tiers, `${where} \`donation.tiers\``, errors);
      const tiers = list.map((t, i) => {
        const min = Number(t?.min ?? 0);
        if (!Number.isFinite(min)) errors.push(`${where}, tier ${i + 1}: \`min\` must be a number.`);
        return {
          min,
          label: str(t?.label),
          goto: checkTarget(t?.goto, `${where}, tier ${i + 1}`),
        };
      });
      tiers.sort((a, b) => a.min - b.min);
      if (tiers.length === 0) errors.push(`${where}: \`donation\` needs at least one tier.`);
      else if (tiers[0].min > 0) {
        warnings.push(`${where}: no tier for donations below ${tiers[0].min}; they will use the lowest tier.`);
      }
      scene.exit = {
        kind: "donation",
        prompt: str(d.prompt) || "How much did the participant donate?",
        quick: (Array.isArray(d.quick) ? d.quick : []).map(Number).filter(Number.isFinite),
        tiers,
      };
    }

    story.scenes[id] = scene;
  }

  if (errors.length === 0) {
    errors.push(...repeatDonations(story));
  }
  if (errors.length === 0) {
    for (const id of unreachable(story)) {
      warnings.push(`Scene "${id}" can never be reached.`);
    }
  }

  return { story: errors.length ? null : story, errors, warnings };
}

export function targetsOf(scene) {
  const e = scene.exit;
  switch (e.kind) {
    case "next":
      return [e.goto];
    case "actions":
      return e.options.map((o) => o.goto);
    case "question":
      return [...e.options.map((o) => o.goto), e.otherwise].filter(Boolean);
    case "donation":
      return e.tiers.map((t) => t.goto);
    default:
      return [];
  }
}

// Each participant donates once, so a donation scene must not lead,
// directly or later on, to another donation scene (or back to itself).
function repeatDonations(story) {
  const errors = [];
  for (const scene of Object.values(story.scenes)) {
    if (scene.exit.kind !== "donation") continue;
    const seen = new Set();
    const stack = [...targetsOf(scene)];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const next = story.scenes[id];
      if (next.exit.kind === "donation") {
        errors.push(
          `Scene "${scene.id}" leads to another donation (scene "${id}"), but each participant only donates once.`,
        );
        break;
      }
      stack.push(...targetsOf(next));
    }
  }
  return errors;
}

function unreachable(story) {
  const seen = new Set();
  const stack = [story.start];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id) || !story.scenes[id]) continue;
    seen.add(id);
    stack.push(...targetsOf(story.scenes[id]));
  }
  return Object.keys(story.scenes).filter((id) => !seen.has(id));
}

export function normalizeAnswer(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function str(v) {
  return v === undefined || v === null ? "" : String(v).trim();
}

function asList(v, where, errors) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    errors.push(`${where} must be a list (each item starting with "- ").`);
    return [];
  }
  return v;
}
