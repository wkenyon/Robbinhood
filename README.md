# Story Console

A choose-your-own-adventure web app for **live performance**. You write the story
in a YAML file. An actor runs the app on a laptop or tablet, reads each scene
aloud, and records what the participant does. The app then moves to the right
next scene.

The participant can move the story forward in three ways:

| The participant…          | In the story file | The actor…                                                          |
| ------------------------- | ----------------- | ------------------------------------------------------------------- |
| **does something**        | `actions:`        | taps what they did                                                  |
| **answers a question**    | `question:`       | taps the answer, or types what they said (matched loosely)          |
| **makes a donation**      | `donation:`       | types the amount or taps a quick amount. The amount picks the next scene |

Each participant donates once. In the example story, the donation comes first
and its amount decides which route they take.

## Running it

Requires Node 18+. There's nothing to install.

```sh
npm start          # http://localhost:8080
npm run check      # check every story in stories/ for mistakes
npm test
```

It is a static site (`index.html`, `styles.css`, `src/`, `vendor/`, `stories/`),
so you can also host it on GitHub Pages or any web server. It has to be served
over http(s). Opening `index.html` straight from disk won't work.

### Editing and publishing on GitHub

The site is published to **GitHub Pages** at `https://<owner>.github.io/<repo>/`
(for this repo, https://wkenyon.github.io/Robbinhood/).

**One-time setup:** in the repo on GitHub, go to **Settings → Pages**. Under
**Build and deployment → Source**, choose **GitHub Actions**. Then re-run the
latest "Check & publish" workflow from the **Actions** tab, or just commit something.

**To change the story:**

1. On GitHub, open `stories/robin-hood.yaml` and click the ✏️ pencil. From the live
   site, **⋯ → Edit story on GitHub** takes you straight there.
2. Make your changes and click **Commit changes**.
3. The **Check & publish** workflow checks the story and republishes the site.
   This takes about a minute. The Actions tab shows a green tick when it is live.
   The site's Session panel shows which commit it is running.

If the story has a mistake (bad indentation, a `goto` to a scene that doesn't exist…),
the workflow fails with a red ✗ and the live site keeps the previous version.
Open the failed run to see the exact problem, fix the file and commit again.

Only commits to the repo's default branch are published. Commits on other
branches and pull requests are still checked.

To publish more than one story, add more files to `stories/`. Open each one with
`?story=stories/<file>.yaml`, e.g. `https://wkenyon.github.io/Robbinhood/?story=stories/my-show.yaml`.

### Loading a story

The app loads `stories/robin-hood.yaml` by default. To use a different story:

- `?story=stories/my-show.yaml` in the URL
- **⋯ → Open story file…**, or drag a `.yaml` file onto the page
- **⋯ → Edit story** to edit in the browser. It checks your story as you type,
  and **Download .yaml** saves a copy.

A story that was opened or edited in the app is saved only in that browser.
Everyone else still sees the published version. While a browser is using its own
copy, a banner says so. Choose **⋯ → Use published story** to go back to the file on GitHub.

## The actor's screen

- **Say** – the line to read aloud, in large text.
- **Stage notes** – private directions for the actor (optional).
- **Input panel** – the buttons or amount box for this scene. It shows where each
  choice leads before you pick it.
- **← Back** undoes the last step. **Jump to scene…** goes anywhere if things go off-script.
- **New participant** adds this participant's donation to the session totals and starts again.
- **⋯ → Export log (CSV)** downloads every step and donation for the session.
- Keyboard: `1`–`9` pick an option, `Enter` continues, `←` goes back.

Your place in the story is saved, so a page refresh or a flat battery won't lose it.

## Story format

```yaml
title: The Outlaw of Sherwood
currency: "£"          # optional, default £
start: crossroads      # optional, defaults to the first scene

scenes:
  crossroads:                  # scene id, used by goto
    title: The Crossroads      # optional, shown to the actor
    say: |
      Halt, traveller! Which way will you go?
    notes: Gesture to the two signposts.     # optional
    actions:                                  # the participant DOES something
      - label: Walks towards the Sheriff's road
        goto: sheriff
      - label: Walks into the forest
        goto: forest

  forest:
    say: What has roots nobody sees, and is taller than trees?
    question:                                 # the participant ANSWERS
      ask: What's the answer?
      answers:
        - label: A mountain
          match: [mountain, a hill]           # other accepted typed answers
          goto: camp
        - label: Wrong
          goto: fight
      otherwise: fight                        # anything typed that doesn't match

  sheriff:
    say: Pay the Sheriff's toll!
    donation:                                 # the participant GIVES money
      prompt: How much went in the helmet?
      quick: [0, 1, 2, 5, 10, 20]             # one-tap amounts
      tiers:                                  # highest `min` the amount reaches wins
        - min: 0
          label: Nothing / pennies
          goto: dungeon
        - min: 2
          label: A fair toll
          goto: waved_through
        - min: 10
          goto: suspicious

  waved_through:
    say: The guard waves you through.
    next: forest                              # no input, just Continue

  ending_legend:
    say: You gave {{donation}}! Songs will be sung of you.
    end: true                                 # an ending (also the default)
```

Each scene has `say` and optional `title` and `notes`. It also has **exactly one** of
`actions`, `question`, `donation`, `next`, or `end`.

**Placeholders** in `say` and `notes`:

- `{{donation}}` – what this participant gave ("nothing" before they donate)
- `{{answer}}` – their last answer to a question
- `{{currency}}` – the currency symbol

**Text formatting**: leave a blank line to start a new paragraph. Use `**bold**` and
`*italic*` for emphasis.

**Typed answers** are matched without caring about capitals, punctuation or
accents. "Lincoln green!" matches `lincoln green`. Every answer's `label` is
accepted automatically. Use `match` to add other spellings.

**Donation tiers**: the app takes the tier with the highest `min` that the
amount reaches. With tiers at 0, 2 and 10, a gift of £5 lands in the 2 tier.

**One donation per participant**: a story may have several donation scenes
(say, one per route), but no participant may pass through two of them.
The checker rejects a story where a donation scene can lead to another.

`npm run check` (and the in-app editor) flags unknown `goto` targets, missing
pieces, scenes with more than one exit, second donations, and scenes that can
never be reached.

## Project layout

```
index.html, styles.css   the actor's console
src/story.js             parses and validates story YAML
src/engine.js            pure game logic (advance, back, jump, tiers)
src/app.js               UI
stories/                 story files
vendor/js-yaml.mjs       YAML parser (MIT, see vendor/js-yaml.LICENSE)
server.js                tiny zero-dependency static server
```
