// Checks story files for mistakes (unknown scenes, missing gotos, unreachable scenes).
// Usage: npm run check [-- stories/my-story.yaml ...]   (defaults to every file in stories/)

import { readFile, readdir } from "node:fs/promises";
import { parseStory } from "../src/story.js";

let files = process.argv.slice(2);
if (files.length === 0) {
  files = (await readdir("stories")).filter((f) => /\.ya?ml$/.test(f)).map((f) => `stories/${f}`);
}

let failed = false;
for (const file of files) {
  const { story, errors, warnings } = parseStory(await readFile(file, "utf8"));
  if (errors.length) failed = true;
  const status = errors.length ? "✗" : "✓";
  const count = story ? ` (${Object.keys(story.scenes).length} scenes)` : "";
  console.log(`${status} ${file}${count}`);
  for (const e of errors) console.log(`    error: ${e}`);
  for (const w of warnings) console.log(`    warning: ${w}`);
}
process.exit(failed ? 1 : 0);
