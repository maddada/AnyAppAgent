/* Mockup builder shared by directions.html and system.html.
   Every screen is plain markup styled only through the --aa-* custom properties, so the same
   screens render in any direction or in the final theme. Needs a global ICONS map
   (Lucide icon name -> inner SVG markup). */
(function () {
  const ic = (name, size = 20, cls = "") =>
    `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="var(--aa-icon-stroke)" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;

  const APP_ART = {
    prayer: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#1D3646"/><circle cx="30" cy="33" r="15" fill="#EFE0BC"/><circle cx="37" cy="27.5" r="12.5" fill="#1D3646"/><circle cx="45" cy="19" r="2" fill="#EFE0BC"/><rect x="12" y="50" width="40" height="2" rx="1" fill="#EFE0BC" opacity=".35"/></svg>`,
    habits: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#E4B04A"/>${[0, 1, 2]
      .map((r) =>
        [0, 1, 2]
          .map((c) => {
            const on = [1, 1, 0, 1, 1, 1, 0, 1, 0][r * 3 + c];
            return `<rect x="${14 + c * 13}" y="${14 + r * 13}" width="10" height="10" rx="3" fill="#2A2116" opacity="${on ? 1 : 0.22}"/>`;
          })
          .join(""),
      )
      .join("")}</svg>`,
    groceries: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#F2EADC"/><path d="M24 26c0-6 3.6-10 8-10s8 4 8 10" fill="none" stroke="#B9482B" stroke-width="3" stroke-linecap="round"/><path d="M17 26h30l-3 22a3 3 0 0 1-3 2.6H23a3 3 0 0 1-3-2.6z" fill="#B9482B"/><rect x="26" y="34" width="12" height="2.6" rx="1.3" fill="#F2EADC"/></svg>`,
    tasbih: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#57412F"/>${Array.from({ length: 14 })
      .map((_, i) => {
        const a = (i / 14) * Math.PI * 2 - Math.PI / 2;
        return `<circle cx="${(32 + Math.cos(a) * 15).toFixed(1)}" cy="${(30 + Math.sin(a) * 15).toFixed(1)}" r="3" fill="#F0E2C8"/>`;
      })
      .join("")}<rect x="30.5" y="45" width="3" height="10" rx="1.5" fill="#F0E2C8"/></svg>`,
    water: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#D5E4E8"/><path d="M32 13c7 9 12 15.5 12 22a12 12 0 0 1-24 0c0-6.5 5-13 12-22z" fill="#2B6075"/><path d="M27 38a6 6 0 0 0 5 5" stroke="#D5E4E8" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>`,
  };
  const appIcon = (k, cls = "") => `<div class="appicon ${cls}">${APP_ART[k]}</div>`;

  const mark = (cls = "") => `<img class="mark ${cls}" src="mark/mark.svg" alt="">`;

  const statusBar = () =>
    `<div class="sbar"><span>9:41</span><span class="sbar-r">${ic("wifi", 15)}<svg width="22" height="12" viewBox="0 0 22 12"><rect x=".5" y=".5" width="18" height="11" rx="3" fill="none" stroke="currentColor" opacity=".5"/><rect x="2.5" y="2.5" width="12" height="7" rx="1.5" fill="currentColor"/><rect x="19.8" y="4" width="1.6" height="4" rx=".8" fill="currentColor" opacity=".5"/></svg></span></div>`;
  const gesture = () => `<div class="gesture"><span></span></div>`;

  const stateLine = (state, text) => {
    const m =
      state === "ready"
        ? `<span class="state-dot"></span>`
        : state === "working"
          ? `<span class="spin"></span>`
          : state === "problem"
            ? ic("circle-exclamation-point", 15)
            : "";
    return `<div class="state state-${state}">${m}<span>${text}</span></div>`;
  };

  function tile(k, name, state, text) {
    return `<div class="tile" data-state="${state}">${appIcon(k)}<div class="tile-name">${name}</div>${stateLine(state, text)}</div>`;
  }

  function phoneHome() {
    return `<div class="phone mk">
${statusBar()}
<div class="home-head">
  <div class="home-top"><span class="wordmark-sm">${mark("mark-xs")}<span>Kiwimake</span></span><button class="icon-btn" aria-label="Settings">${ic("settings", 22)}</button></div>
  <h1 class="t-display home-title">Your apps</h1>
  <p class="home-sub"><span class="conn-dot"></span>Connected to your PC</p>
</div>
<div class="grid">
  ${tile("prayer", "Ajman Prayer Times", "ready", "Update ready")}
  ${tile("habits", "Daily Habits", "working", "Making changes")}
  ${tile("groceries", "Groceries", "problem", "Couldn't build")}
  ${tile("tasbih", "Tasbih Counter", "idle", "Updated yesterday")}
  ${tile("water", "Drink Water", "idle", "Updated 3 days ago")}
  <div class="tile tile-new"><div class="new-plus">${ic("plus", 28)}</div><div class="tile-name">New app</div><div class="tile-hint">Describe your idea</div></div>
</div>
${gesture()}
</div>`;
  }

  const toolRow = (icon, title, detail, status) => {
    const s =
      status === "done"
        ? `<span class="tr-status">${ic("check", 16)}</span>`
        : status === "running"
          ? `<span class="tr-status"><span class="spin"></span></span>`
          : status === "pending"
          ? `<span class="tr-status"></span>`
          : `<span class="tr-status tr-failed">${ic("x", 16)}</span>`;
    return `<div class="trow is-${status}"><span class="tr-icon">${ic(icon, 16)}</span><span class="tr-title">${title}</span>${detail ? `<span class="tr-detail">${detail}</span>` : ""}${s}</div>`;
  };

  function buildRow(state) {
    if (state === "building")
      return `<div class="build is-building"><div class="build-top"><span class="build-badge">${ic("package", 20)}</span><div class="build-text"><div class="build-title">Building version 8</div><div class="build-sub">Usually about two minutes</div></div></div><div class="progress"><span style="width:58%"></span></div></div>`;
    if (state === "failed")
      return `<div class="build is-failed"><div class="build-top"><span class="build-badge">${ic("circle-exclamation-point", 20)}</span><div class="build-text"><div class="build-title">Version 8 didn't build</div><div class="build-sub">Tried 3 times. Ask for a fix, or keep using version 7.</div></div></div></div>`;
    return `<div class="build is-ready"><div class="build-top"><span class="build-badge">${ic("package", 20)}</span><div class="build-text"><div class="build-title">Your app is ready</div><div class="build-sub">Version 8, 31 MB</div></div></div><button class="btn btn-primary btn-block">${ic("download", 18)}Install</button></div>`;
  }

  function phoneChat() {
    return `<div class="phone mk">
${statusBar()}
<div class="chat-head">
  <button class="icon-btn" aria-label="Back">${ic("chevron-left", 24)}</button>
  ${appIcon("prayer", "appicon-sm")}
  <div class="chat-id"><div class="chat-title">Ajman Prayer Times</div><div class="chat-sub">Version 8 ready</div></div>
  <button class="btn btn-quiet btn-sm">Open</button>
</div>
<div class="timeline"><div class="tl-inner">
  <div class="msg-user"><div class="bubble">Add a second reminder before each prayer, and let me choose the minutes for both.</div></div>
  <div class="think">${ic("chevron-right", 16)}<span>Thought for 6s</span></div>
  <div class="prose"><p>Good idea. Every prayer will get two reminders, and a screen where you set both times.</p></div>
  <div class="tools">
    ${toolRow("file-pen", "Edit Reminders.tsx", "+48 −6", "done")}
    ${toolRow("terminal", "Run the tests", "1 failed", "failed")}
    ${toolRow("file-pen", "Edit Reminders.tsx", "+2 −2", "done")}
    ${toolRow("terminal", "Run the tests", "14 passed", "done")}
  </div>
  <div class="prose"><p>Done. Reminders now come <strong>15 and 5 minutes</strong> before each prayer. You can change both in Settings.</p></div>
  ${buildRow("ready")}
</div></div>
<div class="composer"><div class="composer-box"><span class="composer-ph">Ask for a change</span><button class="send" aria-label="Send" disabled>${ic("arrow-up", 20)}</button></div></div>
${gesture()}
</div>`;
  }

  const winBar = (title) =>
    `<div class="win-bar"><span class="win-title">${title}</span><span class="win-ctl"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor"/></svg><svg width="10" height="10" viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor"/></svg><svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor"/></svg></span></div>`;

  function stepItem(n, label, status, tag) {
    const marker = status === "done" ? ic("check", 14) : `${n}`;
    return `<li class="step is-${status}"><span class="step-n">${marker}</span><span class="step-l">${label}${tag ? `<span class="step-tag">${tag}</span>` : ""}</span></li>`;
  }

  function deskOnboarding() {
    return `<div class="win mk">
${winBar("Kiwimake setup")}
<div class="win-body onb">
  <aside class="onb-rail">
    <div class="wordmark">${mark("mark-sm")}<span>Kiwimake</span></div>
    <ol class="steps">
      ${stepItem(1, "Welcome", "done")}
      ${stepItem(2, "Tools for building apps", "done")}
      ${stepItem(3, "A safe copy of your apps", "current", "Optional")}
      ${stepItem(4, "Connect your phone", "todo")}
    </ol>
    <p class="rail-foot">You can change any of this later in Settings.</p>
  </aside>
  <main class="onb-main">
    <div class="onb-content">
      <div class="eyebrow">Step 3 of 4, optional</div>
      <h1 class="t-display onb-title">A safe copy of your apps</h1>
      <p class="lede">Kiwimake can keep a private copy of every app you make on GitHub, a free service for storing apps. If this PC ever breaks, nothing is lost.</p>
      <ol class="how">
        <li><span class="how-n">1</span><div><strong>Sign in to GitHub</strong><span>Or make a free account. It takes about a minute.</span></div></li>
        <li><span class="how-n">2</span><div><strong>We make one private copy per app</strong><span>Only you can see them. Nothing is shared.</span></div></li>
        <li><span class="how-n">3</span><div><strong>It stays up to date by itself</strong><span>Every change you ask for is saved there too.</span></div></li>
      </ol>
      <div class="check-card">
        <span class="check-icon">${ic("cloud", 20)}</span>
        <div class="check-text"><strong>GitHub</strong><span>Not signed in yet</span></div>
        <button class="btn btn-primary">Sign in to GitHub ${ic("external-link", 16)}</button>
      </div>
    </div>
    <footer class="onb-foot"><button class="btn btn-quiet">${ic("chevron-left", 18)}Back</button><button class="btn btn-quiet">Skip this step</button></footer>
  </main>
</div>
</div>`;
  }

  function qr(size = 132) {
    const n = 25;
    let seed = 7;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    const cell = size / n;
    let rects = "";
    const inFinder = (x, y) => (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) if (!inFinder(x, y) && rnd() > 0.52) rects += `<rect x="${x * cell}" y="${y * cell}" width="${cell + 0.2}" height="${cell + 0.2}"/>`;
    const finder = (fx, fy) =>
      `<rect x="${fx * cell}" y="${fy * cell}" width="${7 * cell}" height="${7 * cell}" rx="${cell * 1.4}"/><rect x="${(fx + 1) * cell}" y="${(fy + 1) * cell}" width="${5 * cell}" height="${5 * cell}" rx="${cell * 0.9}" fill="var(--aa-qr-bg)"/><rect x="${(fx + 2) * cell}" y="${(fy + 2) * cell}" width="${3 * cell}" height="${3 * cell}" rx="${cell * 0.6}"/>`;
    return `<svg class="qr" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><g fill="var(--aa-qr-fg)">${rects}${finder(0, 0)}${finder(n - 7, 0)}${finder(0, n - 7)}</g></svg>`;
  }

  function appRow(k, name, pkg, state, stateText, meta) {
    return `<div class="lrow">${appIcon(k, "appicon-md")}<div class="lrow-main"><div class="lrow-title">${name}</div>${stateLine(state, stateText)}</div><div class="lrow-meta">${meta}</div><span class="lrow-chev">${ic("chevron-right", 18)}</span></div>`;
  }

  function deskMain() {
    return `<div class="win mk">
${winBar("Kiwimake")}
<div class="win-body dm">
  <aside class="dm-side">
    <div class="wordmark">${mark("mark-sm")}<span>Kiwimake</span></div>
    <nav class="nav">
      <a class="nav-i is-active">${ic("layout-grid", 18)}Apps</a>
      <a class="nav-i">${ic("smartphone", 18)}Phones</a>
      <a class="nav-i">${ic("settings", 18)}Settings</a>
    </nav>
    <div class="side-status"><span class="conn-dot"></span><div><strong>Running</strong><span>Your phone can reach this PC from anywhere</span></div></div>
  </aside>
  <main class="dm-main">
    <header class="dm-head"><div><h1 class="t-title">Your apps</h1><p class="dm-sub">5 apps, all made on this PC</p></div><button class="btn btn-quiet">${ic("folder-open", 18)}Open apps folder</button></header>
    <div class="dm-cols">
      <div class="dm-left"><section class="list">
        ${appRow("prayer", "Ajman Prayer Times", "com.anyapp.ajmanprayertimes", "ready", "Update ready", "v8, 2 min ago")}
        ${appRow("habits", "Daily Habits", "com.anyapp.dailyhabits", "working", "Making changes", "v3, yesterday")}
        ${appRow("groceries", "Groceries", "com.anyapp.groceries", "problem", "Couldn't build", "v5, today")}
        ${appRow("tasbih", "Tasbih Counter", "com.anyapp.tasbihcounter", "idle", "Up to date", "v2, yesterday")}
        ${appRow("water", "Drink Water", "com.anyapp.drinkwater", "idle", "Up to date", "v6, Sunday")}
      </section>
      <section class="recent"><div class="panel-label">Today</div>
        <div class="recent-row"><time>10:42</time><span>Ajman Prayer Times: version 8 built and sent to your phone</span></div>
        <div class="recent-row"><time>10:37</time><span>Daily Habits: started on "add a weekly summary"</span></div>
        <div class="recent-row"><time>09:15</time><span>Groceries: version 6 didn't build after 3 tries</span></div>
      </section></div>
      <aside class="dm-aside">
        <div class="panel"><div class="panel-label">Your phone</div><div class="phone-card">${ic("smartphone", 22)}<div><strong>Pixel 8</strong><span>Connected, seen just now</span></div></div></div>
        <div class="panel qr-card"><div class="panel-label">Add another phone</div><div class="qr-wrap">${qr(136)}</div><p>Open Kiwimake on the phone and scan this code.</p><button class="btn btn-quiet btn-sm">Use a code instead</button></div>
      </aside>
    </div>
  </main>
</div>
</div>`;
  }

  window.AAScreens = { ic, appIcon, mark, qr, stateLine, tile, toolRow, buildRow, phoneHome, phoneChat, deskOnboarding, deskMain, APP_ART };
})();
