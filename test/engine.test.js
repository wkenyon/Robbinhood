import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseStory } from "../src/story.js";
import { advance, back, interpolate, jump, newRun, serializeRun } from "../src/engine.js";

const mini = `
title: Mini
start: a
scenes:
  a:
    say: Start
    actions:
      - label: Left
        goto: q
      - label: Right
        goto: d
  q:
    say: Riddle
    question:
      ask: What is it?
      answers:
        - label: Mountain
          match: [a hill]
          goto: win
      otherwise: lose
  d:
    say: Give
    donation:
      basis: this
      tiers:
        - min: 5
          goto: win
        - min: 0
          goto: lose
  win:
    say: You gave {{donation}}, {{total}} total. You said {{answer}}.
    end: true
  lose:
    say: Lost
`;

const story = () => parseStory(mini).story;

test("example stories have no errors", () => {
  const { errors, warnings } = parseStory(readFileSync("stories/robin-hood.yaml", "utf8"));
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test("actions go to the chosen scene", () => {
  const s = story();
  const { run } = advance(s, newRun(s), { type: "option", index: 1 });
  assert.equal(run.sceneId, "d");
  assert.equal(run.log.at(-1).detail, "Right");
});

test("typed answers match labels and aliases loosely, else otherwise", () => {
  const s = story();
  const at = { ...newRun(s), sceneId: "q" };
  assert.equal(advance(s, at, { type: "answer", text: "  MOUNTAIN!" }).run.sceneId, "win");
  assert.equal(advance(s, at, { type: "answer", text: "A hill" }).run.sceneId, "win");
  assert.equal(advance(s, at, { type: "answer", text: "a tree" }).run.sceneId, "lose");
  assert.ok(advance(s, at, { type: "answer", text: "  " }).error);
});

test("donations pick the highest tier at or below the amount and add to total", () => {
  const s = story();
  const at = { ...newRun(s), sceneId: "d" };
  assert.equal(advance(s, at, { type: "donation", amount: 4.99 }).run.sceneId, "lose");
  const { run } = advance(s, at, { type: "donation", amount: "5" });
  assert.equal(run.sceneId, "win");
  assert.equal(run.total, 5);
  assert.ok(advance(s, at, { type: "donation", amount: -1 }).error);
  assert.ok(advance(s, at, { type: "donation", amount: "abc" }).error);
});

test("donation basis 'total' uses the running total", () => {
  const s = parseStory(mini.replace("basis: this", "basis: total")).story;
  const at = { ...newRun(s), sceneId: "d", total: 4 };
  assert.equal(advance(s, at, { type: "donation", amount: 1 }).run.sceneId, "win");
});

test("back undoes a step, jump moves anywhere", () => {
  const s = story();
  const start = newRun(s);
  const { run } = advance(s, start, { type: "option", index: 0 });
  assert.equal(back(run), start);
  assert.equal(jump(s, start, "win").sceneId, "win");
});

test("interpolate fills in donation, total and answer", () => {
  const s = story();
  const run = { ...newRun(s), total: 12.5, lastDonation: 10, lastAnswer: "hill" };
  assert.equal(interpolate(s.scenes.win.say, s, run), "You gave £10, £12.50 total. You said hill.");
});

test("serializeRun keeps a bounded undo chain", () => {
  const s = story();
  let run = newRun(s);
  for (let i = 0; i < 10; i++) run = jump(s, run, i % 2 ? "a" : "q");
  const restored = JSON.parse(serializeRun(run, 3));
  assert.equal(restored.sceneId, run.sceneId);
  assert.equal(restored.prev.prev.prev, null);
});

test("validation reports helpful errors", () => {
  const { story: s, errors } = parseStory(`
start: nowhere
scenes:
  a:
    say: hi
    next: b
    actions:
      - label: x
  c:
    donation:
      tiers: []
`);
  assert.equal(s, null);
  const all = errors.join("\n");
  assert.match(all, /start.*unknown scene "nowhere"/);
  assert.match(all, /use only one/);
  assert.match(all, /missing `goto`/);
  assert.match(all, /at least one tier/);
  assert.match(parseStory("scenes: [").errors[0], /YAML error/);
});

test("unreachable scenes are warned about", () => {
  const { warnings } = parseStory("scenes:\n  a:\n    end: true\n  b:\n    next: a\n");
  assert.deepEqual(warnings, ['Scene "b" can never be reached.']);
});
