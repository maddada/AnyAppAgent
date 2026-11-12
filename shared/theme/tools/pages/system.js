/* Builds system.html. Every value shown is read back from theme.css at runtime
   (getComputedStyle on a light and a dark pane); TOKEN_NAMES only lists which names to show. */
(function () {
  const S = window.AAScreens;
  const { ic } = S;
  const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  const duo = (html, cls = "") =>
    `<div class="duo">${["light", "dark"].map((m) => `<div class="pane mk ${cls}" data-aa-theme="${m}"><div class="pane-label">${m === "light" ? "Light" : "Dark"}</div>${html}</div>`).join("")}</div>`;
  const comp = (n, title, note, html, cls) =>
    `<div class="comp" id="c-${n}"><div class="comp-h"><h3>${n}. ${title}</h3><p>${note}</p></div>${duo(html, cls)}</div>`;

  // ---------- colour ----------
  const groups = [
    ["Surfaces", ["bg", "surface", "surfaceSunken", "surfaceOverlay", "scrim"]],
    ["Text", ["text", "textSecondary", "textTertiary"]],
    ["Lines", ["border", "borderStrong", "focus"]],
    ["Accent", ["accent", "accentPressed", "onAccent"]],
    ["States", ["working", "workingSoft", "ready", "readySoft", "problem", "problemSoft", "onProblem"]],
  ];
  const listed = new Set(groups.flatMap((g) => g[1]));
  groups.push(["Component aliases", TOKEN_NAMES.colors.filter((c) => !listed.has(c))]);
  const swatches = groups
    .map(
      ([g, names]) =>
        `<div class="sw-group">${g}</div><div class="swatches">${names
          .map((n) => `<div class="sw"><div class="sw-chip" style="background:var(--aa-${kebab(n)})"></div><div class="sw-t"><b>${n}</b><span data-var="--aa-${kebab(n)}"></span></div></div>`)
          .join("")}</div>`,
    )
    .join("");

  // ---------- type ----------
  const samples = {
    hero: "A safe copy of your apps",
    display: "Your apps",
    title: "Your apps",
    titleSmall: "Ajman Prayer Times",
    heading: "Your app is ready",
    name: "Daily Habits",
    body: "Every prayer will get two reminders, and a screen where you set both times.",
    prose: "Done. Reminders now come 15 and 5 minutes before each prayer.",
    lede: "Kiwimake can keep a private copy of every app you make.",
    callout: "Connected to your PC",
    label: "Update ready",
    row: "Run the tests, 14 passed",
    caption: "You can change any of this later in Settings.",
    button: "Install",
    buttonSmall: "Open",
    mono: "Edit Reminders.tsx  +48 \u22126",
    eyebrow: "Step 3 of 4, optional",
  };
  const typeRows = TOKEN_NAMES.types
    .map((r) => {
      const k = kebab(r);
      return `<div class="typerow"><div class="typemeta"><b>${r}</b><span data-type="${k}"></span></div><div class="typesample aa-type-${k}">${samples[r] || r}</div></div>`;
    })
    .join("");

  // ---------- components ----------
  const buttons = `<div class="col">
    <div class="row"><button class="btn btn-primary">${ic("download", 18)}Install</button><button class="btn btn-primary is-pressed">Pressed</button><button class="btn btn-quiet">Skip this step</button><button class="btn btn-quiet btn-sm">Open</button></div>
    <div class="row"><button class="btn btn-problem">Forget phone</button><button class="btn" disabled>Install</button><button class="btn btn-quiet is-focus">Focused</button><button class="btn btn-text">Use a code instead</button></div>
  </div>`;
  const fields = `<div class="col" style="width:100%;max-width:358px">
    <div class="field"><div class="field-label">Name</div><div class="field-box"><span class="ph">For example, Prayer Times</span></div></div>
    <div class="field is-focus"><div class="field-label">What should it do?</div><div class="field-box"><span>Alarms for the five prayers in Ajman</span><span class="caret"></span></div><div class="field-help">Plain words are best. You can change it any time.</div></div>
    <div class="field is-problem"><div class="field-label">Name</div><div class="field-box"><span class="ph">For example, Prayer Times</span></div><div class="field-help">Give your app a name first.</div></div>
  </div>`;
  const tiles = `<div class="tiles2">
    ${S.tile("prayer", "Ajman Prayer Times", "ready", "Update ready")}
    ${S.tile("habits", "Daily Habits", "working", "Making changes")}
    ${S.tile("groceries", "Groceries", "problem", "Couldn't build")}
    ${S.tile("tasbih", "Tasbih Counter", "idle", "Updated yesterday")}
    <div class="tile tile-new"><div class="new-plus">${ic("plus", 28)}</div><div class="tile-name">New app</div><div class="tile-hint">Describe your idea</div></div>
  </div>`;
  const sheet = `<div class="col"><div class="sheet-stage"><div class="sheet"><div class="grabber"></div>
    <div class="sheet-head">${S.appIcon("prayer")}<div><div class="sheet-title">Ajman Prayer Times</div>${S.stateLine("ready", "Update ready")}</div></div>
    <div class="sheet-actions"><button class="btn btn-primary btn-block">${ic("download", 18)}Install version 8</button><button class="btn btn-quiet btn-block">${ic("play", 18)}Open</button><button class="btn btn-quiet btn-block">${ic("pencil", 18)}Change it</button></div>
    <p class="sheet-note">Version 7 is on this phone.</p></div></div>
    <div class="dialog-stage"><div class="dialog"><h2>Forget this phone?</h2><p>Pixel 8 will not reach this PC again until you scan the code once more. Its apps stay installed.</p><div class="dialog-actions"><button class="btn btn-quiet">Cancel</button><button class="btn btn-problem">Forget phone</button></div></div></div></div>`;
  const lists = `<div class="col" style="width:100%">
    <div class="slist">
      <div class="srow"><span class="srow-ic">${ic("smartphone", 20)}</span><span class="srow-l">Phone</span><span class="srow-v">Pixel 8</span>${ic("chevron-right", 18, "srow-ic")}</div>
      <div class="srow is-pressed"><span class="srow-ic">${ic("globe", 20)}</span><span class="srow-l">Reach from anywhere</span><span class="srow-v">On</span>${ic("chevron-right", 18, "srow-ic")}</div>
      <div class="srow"><span class="srow-ic">${ic("folder", 20)}</span><span class="srow-l">Apps folder</span><span class="srow-v">C:\\aa\\apps</span>${ic("chevron-right", 18, "srow-ic")}</div>
    </div>
    <div class="list" style="width:100%;max-width:520px">${["prayer|Ajman Prayer Times|ready|Update ready|v8, 2 min ago", "groceries|Groceries|problem|Couldn't build|v5, today"]
      .map((r) => {
        const [k, n, st, tx, meta] = r.split("|");
        return `<div class="lrow">${S.appIcon(k, "appicon-md")}<div class="lrow-main"><div class="lrow-title">${n}</div>${S.stateLine(st, tx)}</div><div class="lrow-meta">${meta}</div><span class="lrow-chev">${ic("chevron-right", 18)}</span></div>`;
      })
      .join("")}</div>
  </div>`;
  const steps = `<div class="onb-rail" style="width:300px;border:0;border-radius:12px;padding:20px">
    <ol class="steps" style="margin-top:0">
      <li class="step is-done"><span class="step-n">${ic("check", 14)}</span><span class="step-l">Welcome</span></li>
      <li class="step is-current"><span class="step-n">3</span><span class="step-l">A safe copy of your apps<span class="step-tag">Optional</span></span></li>
      <li class="step is-todo"><span class="step-n">4</span><span class="step-l">Connect your phone</span></li>
    </ol></div>`;
  const qr = `<div class="panel qr-card qr-standalone"><div class="panel-label">Add another phone</div><div class="qr-wrap">${S.qr(136)}</div><p>Open Kiwimake on the phone and scan this code.</p><button class="btn btn-quiet btn-sm">Use a code instead</button></div>`;
  const progress = `<div class="col" style="width:100%;max-width:358px">
    <div class="note">Determinate</div><div class="progress" style="width:100%"><span style="width:58%"></span></div>
    <div class="note">Indeterminate (sweeps)</div><div class="progress is-indeterminate" style="width:100%"><span></span></div>
    <div class="note">States</div>
    <div class="row">${S.stateLine("working", "Making changes")}${S.stateLine("ready", "Update ready")}${S.stateLine("problem", "Couldn't build")}${S.stateLine("idle", "Updated yesterday")}</div>
  </div>`;
  const toasts = `<div class="col"><div class="toast">${ic("circle-check", 20)}<span>Version 8 is installed</span></div><div class="toast">${ic("wifi", 20)}<span>Lost the PC. Trying again</span><b>Details</b></div></div>`;

  const chatA = `<div class="chatcol">
    <div class="note">User message</div>
    <div class="msg-user" style="padding-left:40px"><div class="bubble">Add a second reminder before each prayer, and let me choose the minutes for both.</div></div>
    <div class="note">Assistant message (markdown)</div>
    <div class="prose"><p>Here is what changed:</p><ul><li>Two reminders for every prayer</li><li>A <strong>Reminders</strong> screen in Settings</li></ul><p>Times come from <code>PrayerTimes.ts</code>, using the <a>Umm al-Qura</a> method.</p></div>
    <div class="note">Thinking row, collapsed and open</div>
    <div class="think">${ic("chevron-right", 16)}<span>Thought for 6s</span></div>
    <div class="think">${ic("chevron-down", 16)}<span>Thought for 6s</span></div>
    <div class="think-body">Asr in the UAE follows the Shafi'i time, so the later shadow rule does not apply here.</div>
    <div class="note">Plan</div>
    <div class="plan"><div class="plan-head">${ic("list-todo", 16)}<span>Plan</span><span class="plan-count">1 of 3 done</span></div>
      <div class="plan-item is-done">${ic("circle-check", 16)}<span>Two reminders for each prayer</span></div>
      <div class="plan-item is-active"><span class="spin" style="margin:0 1.5px"></span><span>A screen to set both times</span></div>
      <div class="plan-item is-pending">${ic("circle-dashed", 16)}<span>Build version 8</span></div></div>
  </div>`;
  const chatB = `<div class="chatcol">
    <div class="note">Tool-call rows: pending, running, done, failed, open</div>
    <div class="tools">
      ${S.toolRow("search", "Search for prayer settings", "", "pending")}
      ${S.toolRow("terminal", "Install expo-notifications", "", "running")}
      ${S.toolRow("file-pen", "Edit Reminders.tsx", "+48 \u22126", "done")}
      ${S.toolRow("terminal", "Run the tests", "1 failed", "failed")}
    </div>
    <div class="trow-body">FAIL  Reminders.test.ts
  second reminder fires 5 min before Maghrib
  expected 18:21, received 18:26</div>
    <div class="note">Build row: building, ready, failed</div>
    ${S.buildRow("building")}${S.buildRow("ready")}${S.buildRow("failed")}
  </div>`;
  const chatC = `<div class="chatcol">
    <div class="note">Permission request</div>
    <div class="perm"><div class="perm-top"><span class="build-badge">${ic("lock", 18)}</span><div><div class="perm-t">Allow this step?</div><div class="perm-s">npm install expo-notifications</div></div></div><div class="perm-actions"><button class="btn btn-quiet btn-sm">Don't allow</button><button class="btn btn-primary btn-sm">Allow</button></div></div>
    <div class="note">Error row</div>
    <div class="err">${ic("circle-exclamation-point", 16)}<span>Couldn't reach GitHub, so this version is only saved on your PC.</span></div>
    <div class="note">Composer: empty, typing</div>
    <div class="composer" style="padding:0"><div class="composer-box"><span class="composer-ph">Ask for a change</span><button class="send" disabled>${ic("arrow-up", 20)}</button></div></div>
    <div class="composer" style="padding:0"><div class="composer-box"><span class="composer-text">Make the Fajr alarm louder</span><button class="send is-active">${ic("arrow-up", 20)}</button></div></div>
  </div>`;

  // ---------- marks ----------
  const markPane = (m) => `<div class="marks">
    <img src="mark/mark.svg" width="108" height="108" alt="">
    <img src="mark/mark.svg" width="48" height="48" alt="">
    <img src="mark/mark-small.svg" width="24" height="24" alt="">
    <img src="mark/mark-small.svg" width="16" height="16" alt="">
    <div class="adapt" style="border-radius:50%"><img src="mark/android/adaptive-background.svg" alt=""><img src="mark/android/adaptive-foreground.svg" alt=""></div>
    <div class="adapt" style="border-radius:32%"><img src="mark/android/adaptive-background.svg" alt=""><img src="mark/android/adaptive-foreground.svg" alt=""></div>
    <div class="adapt adapt-mono" style="border-radius:50%;background:var(--aa-ready-soft)"><img src="mark/android/adaptive-monochrome.svg" alt="" style="opacity:.72"></div>
    <img src="mark/${m === "light" ? "lockup.svg" : "lockup-dark.svg"}" height="40" alt="Kiwimake">
  </div>`;

  const sections = `
  <section class="sec" id="colour"><h2>Colour</h2><p class="sec-note">Paper, graphite and one bottle green. Green means the next thing to do, or ready. Brick red means a problem. Working is ink in motion, never a colour. Every swatch below is read from <code>theme.css</code>.</p>
    <div class="duo">${["light", "dark"].map((m) => `<div class="pane mk" data-aa-theme="${m}"><div class="pane-label">${m === "light" ? "Light" : "Dark"}</div>${swatches}</div>`).join("")}</div></section>
  <section class="sec" id="type"><h2>Type</h2><p class="sec-note">Bricolage Grotesque, cut at two optical sizes (Display for big headings, Text for everything else), and IBM Plex Mono for labels, file names and times. Both OFL.</p>
    ${duo(typeRows)}</section>
  <section class="sec" id="mark"><h2>Mark</h2><p class="sec-note">Three finished tiles and one still being set into place: your apps, and the next one on the bench. The Android adaptive layers keep inside the 66dp safe zone; the 16 and 24px versions are drawn on the pixel grid for the Windows tray.</p>
    <div class="duo">${["light", "dark"].map((m) => `<div class="pane mk" data-aa-theme="${m}"><div class="pane-label">${m === "light" ? "Light" : "Dark"}</div>${markPane(m)}</div>`).join("")}</div></section>
  <section class="sec" id="components"><h2>Components</h2><p class="sec-note">Numbered as in <code>COMPONENTS.md</code>. Each one in light and dark, built only from theme.css variables.</p>
    ${comp(1, "Buttons", "Primary (one per screen), quiet, small, problem, disabled, focus, text.", buttons)}
    ${comp(2, "Text field", "Rest, focused with text, problem.", fields)}
    ${comp(3, "App tile", "Ready, working, problem, idle, and the new app slot.", tiles)}
    ${comp(4, "Sheet and dialog", "Phone bottom sheet after tapping an app; desktop confirm dialog.", sheet)}
    ${comp(5, "List rows", "Settings row (one pressed) and the desktop app row.", lists)}
    ${comp(6, "Onboarding step rail", "Done, current, to do. The full step layout is in Screens below.", steps)}
    ${comp(7, "QR card", "Always dark modules on light paper, also in dark mode.", qr)}
    ${comp(8, "Progress and states", "Bar, sweep, and the three states with their marks.", progress)}
    ${comp(9, "Toast", "Inverted ink, at the bottom, one line.", toasts)}
    ${comp(10, "Chat: messages, thinking, plan", "The structure of bb's thread view, in this theme.", chatA)}
    ${comp(11, "Chat: tool calls and build", "Quiet rows; only a failure and a ready build get colour.", chatB)}
    ${comp(12, "Chat: permission, error, composer", "", chatC)}
  </section>
  <section class="sec" id="screens"><h2>Screens</h2><p class="sec-note">The four screens from the directions page, rebuilt from the final theme.css.</p>
    <div class="screens">${["light", "dark"]
      .map(
        (m) => `<div class="mode-col" data-aa-theme="${m}"><div class="mode-label">${m === "light" ? "Light" : "Dark"}</div>
        <div class="pair"><div class="fit">${S.phoneHome()}</div><div class="fit">${S.phoneChat()}</div></div>
        <div class="fit">${S.deskOnboarding()}</div><div class="fit">${S.deskMain()}</div></div>`,
      )
      .join("")}</div></section>`;
  document.getElementById("sections").innerHTML = sections;

  // Read values back from theme.css.
  for (const el of document.querySelectorAll("[data-var]")) {
    el.textContent = getComputedStyle(el).getPropertyValue(el.dataset.var).trim();
  }
  for (const el of document.querySelectorAll("[data-type]")) {
    const cs = getComputedStyle(el);
    const v = (p) => cs.getPropertyValue(`--aa-type-${el.dataset.type}-${p}`).trim();
    const f = v("family").toLowerCase();
    const fam = f.includes("display") ? "Display" : f.includes("mono") ? "Mono" : "Text";
    el.textContent = `${fam} ${v("weight")}, ${v("size")}/${v("line")}${v("tracking") !== "0" ? `, ${v("tracking")}` : ""}`;
  }
})();
