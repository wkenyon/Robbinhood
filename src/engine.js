// The game engine: pure functions that move a run through a story.
// A run is a plain object so it can be saved to localStorage as JSON.

import { normalizeAnswer } from "./story.js";

export function newRun(story) {
  return {
    sceneId: story.start,
    total: 0,
    lastDonation: null,
    lastAnswer: "",
    log: [],
    prev: null, // the run as it was before the last step, for "Back"
  };
}

// Works out where an input leads from the current scene, without changing anything.
// input is one of:
//   { type: "next" }
//   { type: "option", index }        — an action or a question answer button
//   { type: "answer", text }         — a typed question answer
//   { type: "donation", amount }
// Returns { goto, detail } or { error }.
export function resolve(story, run, input) {
  const scene = story.scenes[run.sceneId];
  const exit = scene?.exit;
  if (!exit) return { error: "Unknown scene." };

  switch (exit.kind) {
    case "next":
      return { goto: exit.goto, detail: "Continue" };

    case "actions": {
      const opt = exit.options[input.index];
      if (!opt) return { error: "No such action." };
      return { goto: opt.goto, detail: opt.label };
    }

    case "question": {
      if (input.type === "option") {
        const opt = exit.options[input.index];
        if (!opt) return { error: "No such answer." };
        return { goto: opt.goto, detail: opt.label, answer: opt.label };
      }
      const said = normalizeAnswer(input.text ?? "");
      if (!said) return { error: "Type what the participant said, or pick an answer." };
      const hit = exit.options.find((o) => o.match.includes(said));
      if (hit) return { goto: hit.goto, detail: `"${input.text}" → ${hit.label}`, answer: input.text };
      if (exit.otherwise) return { goto: exit.otherwise, detail: `"${input.text}" → (other)`, answer: input.text };
      return { error: `"${input.text}" doesn't match any answer. Pick one of the buttons.` };
    }

    case "donation": {
      const amount = Number(input.amount);
      if (!Number.isFinite(amount) || amount < 0) return { error: "Enter a donation amount (0 or more)." };
      const value = exit.basis === "total" ? run.total + amount : amount;
      const tier = tierFor(exit.tiers, value);
      return {
        goto: tier.goto,
        detail: `${story.currency}${fmt(amount)}${tier.label ? ` → ${tier.label}` : ""}`,
        amount,
      };
    }

    default:
      return { error: "This is an ending." };
  }
}

export function tierFor(tiers, value) {
  let chosen = tiers[0];
  for (const t of tiers) if (value >= t.min) chosen = t;
  return chosen;
}

export function advance(story, run, input, now = new Date()) {
  const r = resolve(story, run, input);
  if (r.error) return { run, error: r.error };
  const next = {
    ...run,
    sceneId: r.goto,
    total: r.amount !== undefined ? run.total + r.amount : run.total,
    lastDonation: r.amount !== undefined ? r.amount : run.lastDonation,
    lastAnswer: r.answer !== undefined ? r.answer : run.lastAnswer,
    log: [
      ...run.log,
      {
        time: now.toISOString(),
        from: run.sceneId,
        to: r.goto,
        kind: story.scenes[run.sceneId].exit.kind,
        detail: r.detail,
        amount: r.amount ?? null,
      },
    ],
    prev: run,
  };
  return { run: next };
}

export function back(run) {
  return run.prev ?? run;
}

// Lets the actor recover if they clicked the wrong thing or need to skip ahead.
export function jump(story, run, sceneId, now = new Date()) {
  if (!story.scenes[sceneId] || sceneId === run.sceneId) return run;
  return {
    ...run,
    sceneId,
    log: [...run.log, { time: now.toISOString(), from: run.sceneId, to: sceneId, kind: "jump", detail: "Jumped", amount: null }],
    prev: run,
  };
}

// Replaces {{total}}, {{donation}}, {{answer}} in scene text.
export function interpolate(text, story, run) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key) => {
    switch (key) {
      case "total":
        return `${story.currency}${fmt(run.total)}`;
      case "donation":
        return run.lastDonation === null ? "nothing" : `${story.currency}${fmt(run.lastDonation)}`;
      case "answer":
        return run.lastAnswer || "…";
      case "currency":
        return story.currency;
      default:
        return whole;
    }
  });
}

export function fmt(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// Strips the undo chain so a run can be saved without growing without bound.
export function serializeRun(run, depth = 50) {
  const chain = [];
  for (let r = run; r && chain.length < depth; r = r.prev) chain.push({ ...r, prev: null });
  for (let i = 0; i < chain.length - 1; i++) chain[i].prev = chain[i + 1];
  return JSON.stringify(chain[0]);
}
