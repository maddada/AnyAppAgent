# Pages: how to show the person a page in the chat

A page is one self-contained HTML file you publish into this app's chat with the `show_page` tool
(MCP server `pages`). The chat shows a card; the person taps it and the page opens on their phone (or
in a window on the PC). Pages are copied from Ghostex pages: same markup, same question kit.

Use a page for:

- **The plan** of a new app or a large change: what you will build, as a picture of it, then one
  question "Build it?" (see "The plan page" below).
- **Questions** about the app, when choices are easier to pick on a page (several questions at once,
  options with a small mockup each, "Ask me more").
- **A feature explained**, when the person asks "how would X work?" or "show me X": a mockup of the
  screen and a few lines on how it would work.

Do not use a page for a one-line answer. Write it for a person who is not technical: plain words, no
code, no file names, nothing about frameworks.

## Publishing

1. Write the file in the folder the `show_page` tool names (outside the app, so it is never part of
   the app or its builds). One file per page, a new name each time (`plan.html`, `colours.html`).
2. Call `show_page` with its absolute `path`. It refuses a page with an em dash (U+2014) or without a
   `<title>`, and names local pictures it cannot find; fix and call it again.
3. End your turn with one short line about the page ("I put the plan in a page for you: have a look
   and tap Build it when it is right."). Never paste the HTML or a link. Do not wait in a loop: the
   answers arrive as the person's next message.

## Answers

What the person picks and types comes back as their next message, in this envelope:

```
<page-answers page="7ea5c5be1f2d68ebc9e40f790db0ef29" title="Prayer alarm: the plan">
{
  "Build it?": "Build it",
  "Build it? (note)": "make the times bigger",
  "Additional notes": "and add Ajman as the city"
}
</page-answers>
```

- A note under a question arrives under its key plus ` (note)`; the page's last "Anything else?" box
  arrives as `"Additional notes"`. A question left blank arrives as `"skipped"`.
- A page that asks nothing ends with a reply box and Mark as seen; you get `{"seen": true}` and
  `"reply"` when they wrote one.
- A pasted picture arrives as `[Image #N](path)`: open the path to see it.
- Once sent, the page is locked and shows "Answered".

## The skeleton

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="ghostex-page" content="v2">
<title>Prayer alarm: the plan</title>
<style>
  /* Only what your mockups need: no page chrome (see below). */
</style>
</head>
<body>
<gx-page>
  <header>
    <span class="gx-eyebrow">Prayer alarm</span>
    <h1>The plan</h1>
    <p class="gx-lede">What this page is for, in a sentence or two.</p>
  </header>
  <h2>What you will see</h2>
  <p>...</p>
</gx-page>
</body>
</html>
```

- **Title**: short and specific, the same in `<title>` and `<h1>` ("Prayer alarm: the plan",
  "Reminders: how snooze would work"). Never "Page", "Questions" or "Plan" alone.
- Everything goes in `<gx-page>` (or `<gx-questions>` for a page that asks), a centred column of
  720px. `<gx-wide>` holds something wider (rare on a phone).
- **Phone first**: the person reads it on a phone, 360 to 430px wide. Side by side only in a
  `.gx-grid` or `.gx-options` (they stack on a phone). A phone mockup goes in a `.gx-frame` at its
  real width (about 360px) so it scrolls sideways instead of squashing. No widths over 360px
  outside a `.gx-frame`, no `100vw`.
- **No page chrome of your own**: no colours, backgrounds or fonts on `html`, `body` or `:root`, no
  padding on `body`, no wrapper with a `max-width`, no Dark/Light switch (the page has one). The page
  already has Kiwimake's look (warm paper, one bottle green, Bricolage Grotesque) in light and
  dark.
- **Parts you use** (styled already):
  - `<span class="gx-eyebrow">`, `<h1>`, `<p class="gx-lede">` in the `<header>`; `<h2>` for
    sections, `<h3>` for parts; lists, tables, `<code>` are styled.
  - `<div class="gx-callout">` (add `data-tone="warn"`, `"good"` or `"bad"`).
  - `<div class="gx-card">`, several in a `<div class="gx-grid">`.
  - `<div class="gx-chips"><span class="gx-chip"><b>5</b> prayers</span></div>` for small facts.
  - `<div class="gx-stats"><div class="gx-stat"><small>Alarms</small><b>10 a day</b></div></div>`.
  - `<figure class="gx-figure"><div class="gx-frame">...</div><figcaption>...</figcaption></figure>`.
  - `<gx-tabs>` with one `<section data-tab="Before">` per tab.
  - `<button class="gx-button">` (add `gx-primary`) only inside a small interactive mockup.
- **Colours for your mockups**: draw the app's own screens in the app's own colours (solid fills,
  light set under `[data-gx-theme=light] .yourclass`). For anything else use the page's tokens:
  `--gx-bg`, `--gx-surface`, `--gx-raised`, `--gx-line`, `--gx-line-strong`, `--gx-fg` (titles),
  `--gx-text`, `--gx-muted`, `--gx-accent`, `--gx-warn`, `--gx-good`, `--gx-bad`, `--gx-code-bg`,
  `--font-sans`, `--font-mono`.
- **Pictures**: `<img src="C:\...\shot.png">` or a path relative to the HTML file is put into the
  page. Libraries from an https CDN load. The page is sandboxed: no `localStorage`, cookies, or
  requests to `http://`; keep state in memory. Up to 8 MB in all.

## Pages with questions

Use `<gx-questions submit="Send">` in place of `<gx-page>`. Write only the questions; the kit letters
the choices, adds "Other / none of these" with a note box to every choice question, an "Anything
else?" box at the end, and the send button. Nothing is preselected.

```html
<gx-questions submit="Send">
  <header>
    <span class="gx-eyebrow">Prayer alarm</span>
    <h1>A few questions first</h1>
    <p class="gx-lede">So the app fits how you pray. Skip anything you do not mind.</p>
  </header>
  <gx-question tag="Q1" title="How should the times be worked out?">
    <p>Different methods give times a few minutes apart.</p>
    <gx-choice value="Umm al-Qura" recommended>Umm al-Qura<small>The method used in the UAE.</small></gx-choice>
    <gx-choice value="Muslim World League">Muslim World League</gx-choice>
  </gx-question>
  <gx-question tag="Q2" title="Which reminders do you want?" multiple>
    <gx-choice>15 minutes before</gx-choice>
    <gx-choice>5 minutes before</gx-choice>
    <gx-choice>At the time</gx-choice>
  </gx-question>
  <gx-question tag="Q3" title="Anything the app must have?" type="text"></gx-question>
</gx-questions>
```

- `<gx-question>`: `title`; `tag` (Q1, Q2: refer to it by tag in the chat); `name`, the answer's key
  (the title when there is none); `multiple`; `type="text"` for a text box. A `<p>` before the
  choices explains it.
- `<gx-choice>`: its text is the choice, a `<small>` is a one-line detail, `value` is what you
  receive, `recommended` adds a Recommended badge.
- Options with a picture each: put them side by side right above their question, each tied to its
  choice so it gets a Pick button:

```html
<div class="gx-options">
  <section data-question="Q4" data-choice="Big clock"><h3>A. Big clock</h3><!-- small mockup --></section>
  <section data-question="Q4" data-choice="List"><h3>B. List of times</h3><!-- small mockup --></section>
</div>
<gx-question tag="Q4" title="What should the main screen look like?">
  <gx-choice value="Big clock">A. Big clock<small>The next prayer, large.</small></gx-choice>
  <gx-choice value="List">B. List of times<small>All five at once.</small></gx-choice>
</gx-question>
```

  List the choices in the same order as the pictures above them. Each question sits right under the
  picture it asks about. Never put a mockup inside a question.
- At most about 8 questions on one page; more pages are better than one long one.

## The plan page

Before you build a new app or make a large change, the person confirms a plan. In the chat, write the
plan as bullets with sub-bullets (what they will see, what it does, what you chose for them), then
publish the plan page and end your turn:

- A strong top: eyebrow (the app's name), `<h1>` "<App>: the plan", a one-line lede, a row of
  `.gx-chip` facts (screens, main features).
- A mockup of the main screen in a phone frame (`.gx-frame`, about 360px wide), drawn in the
  colours you will use, with the real words the app will show.
- "What it does" as a short list, "What I chose for you" as a short list (so they can change it).
- It is a question page: the whole page goes in `<gx-questions submit="Send">`, and it ends with one
  question:

```html
<gx-question tag="P1" name="Build it?" title="Shall I build it like this?">
  <gx-choice value="Build it" recommended>Build it<small>I start now; the app arrives on your phone when it is ready.</small></gx-choice>
  <gx-choice value="Change something">Change something first<small>Say what in the note.</small></gx-choice>
</gx-question>
```

Then wait. "Build it" (or a reply such as "yes", "go", "looks good") means start. "Change something"
means change the plan with their note, publish a new plan page, and ask again.
