# Kiwimake components

The exact spec of the components the Android app (`app/`) and the desktop app (`desktop/`) share,
written in tokens from `tokens.ts`. `system.html` renders every one of them, numbered as here, in
light and dark.

## How to read this

- `color.x`, `type.x`, `space.x`, `size.x`, `radius.x`, `border.x`, `elevation[n]`, `motion.x`
  and `icon.x` are paths in `tokens.ts`. In CSS the same token is a custom property in kebab case:
  `color.surfaceSunken` is `--aa-surface-sunken`, `space.lg` is `--aa-space-lg`,
  `size.buttonHeight` is `--aa-size-button-height`, `radius.appIcon` is `--aa-radius-app-icon`,
  `elevation[1]` is `--aa-shadow-1`, `type.label` is the `--aa-type-label-*` set (or the
  `.aa-type-label` class).
- A type role sets family, size, line height, weight, letter spacing and case together. Never mix
  parts of two roles.
- Icons are Lucide, `icon.stroke` (1.75) with absolute stroke width, at `icon.size.sm` (16) in rows,
  `icon.size.button` (18) in buttons, `icon.size.md` (20) in navigation and cards, `icon.size.lg`
  (24) in headers.
- Icon to text is always `space.sm`. Anything tappable on the phone is at least `size.touch` (44)
  high, padding the hit area when the drawn element is smaller.
- "Ink" means `color.text`. When in doubt, a thing is ink; colour is earned.

## 1. Buttons

| Variant | Height | Padding x | Fill | Label | Use |
| --- | --- | --- | --- | --- | --- |
| Primary | `size.buttonHeight` | `space.xl` | `color.accent` | `color.onAccent`, `type.button` | The one next action on a screen: New app, Install, Sign in, Allow, Continue. |
| Quiet | `size.buttonHeight` | `space.xl` | none, inner line `border.width` `color.borderStrong` | `color.text`, `type.button` | Everything else: Open, Back, Skip this step, Cancel. |
| Small | `size.buttonHeightSmall` | `space.lg` | as primary or quiet | `type.buttonSmall` | Inside cards and headers (chat header "Open", permission row). |
| Problem | `size.buttonHeight` | `space.xl` | `color.problem` | `color.onProblem`, `type.button` | Only to confirm something that loses data or a connection ("Forget phone"). |
| Text | auto | 0 | none | `color.text`, `type.button`, underline 1px `color.borderStrong`, offset 3 | Escape hatches: "Use a code instead". |

- Shape `radius.button`. Optional leading icon at `icon.size.button`, gap `space.sm`. Block variant
  is full width.
- Pressed: primary fill `color.accentPressed`; quiet and text fill `color.selectedBg`.
  Change over `motion.duration.instant`.
- Disabled: fill `color.surfaceSunken`, label `color.textTertiary`, no line. Do not hide a disabled
  primary; say next to it what unlocks it.
- Keyboard focus (desktop): outline `border.focusWidth` `color.focus`, offset 2.
- **At most one primary per screen** (a sheet or dialog counts as its own screen).

## 2. Text field

- Label above: `type.label`, `color.text`, gap `space.sm` to the box.
- Box: height `size.fieldHeight`, padding x `space.lg`, `radius.field`, fill `color.fieldBg`,
  inner line `border.width` `color.fieldBorder`. Text `type.body` `color.text`; placeholder
  `color.textTertiary` ("For example, Prayer Times").
- Multi-line ("What should it do?"): min three lines, padding y `space.md`, grows to eight.
- Focus: inner line `border.focusWidth` `color.accent`, caret `color.accent`.
- Help line under the box: `type.caption`, `color.textSecondary`, gap `space.sm`.
- Problem: inner line `border.focusWidth` `color.problem`; help line becomes the reason, in
  `color.problem` ("Give your app a name first."). Validate on submit, not on every key.

## 3. App tile (phone home)

- Grid: two columns, gap `size.gridGap`, side padding `size.screenGutter`.
- Tile: fill `color.tileBg`, `radius.tile`, padding `look.tilePadding`, shadow
  `elevation[look.tileElevation]` (level 1), line `color.tileBorder` (transparent in light),
  min height `size.tileMinHeight`, content aligned `look.tileAlign`.
- Icon: the app's own launcher icon, `size.appIcon`, `radius.appIcon` (size / 4), with a 1px inner
  line `color.iconEdge`. Gap below `space.md`.
- Name: `type.name`, `color.text`, at most two lines then ellipsis; gap below `space.xs`.
- State line (8) pinned to the bottom of the tile.
- New app tile: fill `color.tileNewBg`, line `border.tileWidth` `border.tileNewStyle` (dashed)
  `color.tileNewBorder`, no shadow. A `size.appIcon` square in `color.accent` with a `plus` icon
  (28, `color.onAccent`), the name "New app", and a hint "Describe your idea" in `type.label`
  `color.textSecondary`. It is the screen's primary action, so nothing else on home is green
  except ready states.
- Press: scale to 0.98 over `motion.duration.instant`, release over `motion.duration.fast`.
  Tap opens the app sheet (4).

## 4. Sheet (phone) and dialog (desktop)

**Sheet**
- Scrim `color.scrim` over everything. Sheet fill `color.surfaceOverlay`, top corners
  `radius.sheet`, `elevation[3]`. Padding top `space.md`, sides `space.xl`, bottom `space.2xl`
  plus the gesture inset.
- Grabber 36 x 4, `radius.full`, `color.borderStrong`, centred, gap below `space.lg`.
- Head: app icon 56 (radius 14), gap `space.md`, title `type.titleSmall`, state line under it.
  Gap below `space.xl`.
- Actions: block buttons stacked, gap `space.sm`. The app sheet is: primary "Install version N"
  when an update is ready, then quiet "Open" and quiet "Change it". With no update ready, "Open"
  is the primary.
- Note under the actions: `type.caption` `color.textSecondary`, centred ("Version 7 is on this
  phone.").
- Enter: slide up from the bottom over `motion.duration.slow`, `motion.easing.enter`; scrim fades
  over `motion.duration.base`. Exit: `motion.duration.base`, `motion.easing.exit`. Drag down or tap
  the scrim to close.

**Dialog**
- Width `size.dialogWidth`, centred, fill `color.surfaceOverlay`, `radius.sheet`, `elevation[3]`,
  padding `space.2xl`, over `color.scrim`.
- Title `type.titleSmall`; body `type.callout` `color.textSecondary`, gap `space.sm` above and
  `space.2xl` below. Actions right aligned, gap `space.sm`: quiet "Cancel" then the confirm
  (primary, or problem when it loses something).
- Enter: fade and scale from 0.98 over `motion.duration.slow`, `motion.easing.enter`. Esc and the
  scrim cancel.

## 5. List rows

**Settings row** (phone and desktop settings)
- Min height `size.rowHeight`, padding x `space.lg`, gap `space.md`. Leading icon `icon.size.md`
  `color.textSecondary`; label `type.body` `color.text`, fills; value `type.label`
  `color.textTertiary`; trailing `chevron-right` 18 `color.textTertiary`.
- Divider `border.width` `color.border` between rows. Group: `radius.card`, inner line
  `border.width` `color.border`. Pressed: fill `color.selectedBg`.

**App row** (desktop app list)
- Height `size.appRowHeight`, padding x `space.lg`, gap `space.md`. Icon `size.appIconMedium`
  (radius size / 4); name `type.heading` `color.text` with the state line (8) under it; trailing
  meta `type.label` `color.textTertiary` ("v8, 2 min ago"); `chevron-right`.
- List container fill `color.listBg`, `radius.card`, inner line `border.listWidth` `color.border`,
  dividers `color.border`. No package ids or paths in the row: this user does not need them.

## 6. Onboarding step layout (desktop)

- Window: rail on the left, content on the right, footer under the content.
- Rail: width `size.railWidth`, fill `color.railBg`, right line `border.width` `color.border`,
  padding `space.3xl` x, `space.3xl` top. Wordmark lockup at the top; steps `space.4xl` below it;
  a reassurance line at the bottom in `type.caption` `color.textTertiary` ("You can change any of
  this later in Settings.").
- Step item: min height `size.touch`, padding x `space.md`, `radius.button`, gap `space.md`,
  label `type.callout`.
  - Badge `size.stepBadge`, `radius.step`, number in `type.mono` weight 600 at 12.
  - Done: badge fill `color.surfaceSunken`, `check` 14 `color.textSecondary`; label
    `color.textSecondary`.
  - Current: item fill `color.selectedBg`, label `color.text` weight 500; badge inverted (fill
    `color.text`, number `color.bg`).
  - To do: badge inner line `color.borderStrong`, number `color.textTertiary`; label
    `color.textSecondary`.
  - "Optional" under the label: `type.eyebrow` `color.textTertiary`.
- Content: padding top and left `space.7xl`, max width 760. Eyebrow `type.eyebrow`
  `color.textSecondary` ("Step 3 of 4, optional"); title `type.hero`, gap `space.lg`; lede
  `type.lede` `color.textSecondary`, max width 560, gap `space.lg`.
- "How it works" list, `space.3xl` below the lede, items gap `space.xl`: number in `type.mono`
  `color.textTertiary` (28 wide), item title `type.body` weight 600, line `type.callout`
  `color.textSecondary`.
- Check card, `space.3xl` below: fill `color.surface`, `radius.card`, inner line `color.border`,
  `elevation[1]`, padding `space.lg`, gap `space.md`. Badge `size.badge` (`radius.badge`, fill
  `color.surfaceSunken`, icon `color.textSecondary`); title `type.body` weight 600 and status
  `type.label` `color.textSecondary`; the step's one primary button at the end. When the check
  passes, the badge turns `color.readySoft` / `color.ready` with a `check`, the status reads what
  was found ("Signed in as ..."), and the footer's quiet "Skip this step" becomes a primary
  "Continue".
- Footer: top line `color.border`, padding `space.xl` `space.3xl`; quiet "Back" on the left, quiet
  "Skip this step" (or primary "Continue") on the right.
- Words: plain, second person, no jargon without a reason given in the same sentence ("GitHub, a
  free service for storing apps").

## 7. QR card

- Panel: fill `color.surface`, `radius.card`, inner line `color.border`, padding `space.lg`
  top/bottom and `space.xl` sides. Label `type.eyebrow` `color.textSecondary` ("Add another
  phone").
- Plate, `space.md` below: fill `color.qrBg`, padding `space.md`, `radius.card`, inner line
  `color.border`. Modules `color.qrFg`, `size.qr` square (never below 120), finder patterns with
  rounded corners. Dark modules on light paper in both modes, so every phone camera reads it.
- Under it: `type.label` `color.textSecondary` ("Open Kiwimake on the phone and scan this
  code."), then a small quiet block button for the fallback ("Use a code instead").

## 8. Progress and state line

- Bar: height `size.progressHeight`, `radius.progress`, track `color.surfaceSunken`, fill
  `color.working`. Width changes ease over `motion.duration.base`.
- Indeterminate: a 32% segment sweeps left to right over `motion.duration.progressSweep`,
  `motion.easing.standard`, looping.
- Spinner: `size.spinner` ring, 2px, `currentColor` with one quarter clear, one turn per
  `motion.duration.spinner`, linear. With reduce motion: a static ring at 60% opacity.
- **State line** (tiles, rows, chat header): mark plus words, gap `space.sm`, `type.label`.
  - Working: spinner, `color.working`. "Making changes", "Building version 8", "Setting up".
  - Ready: dot `size.dot` filled, `color.ready`. "Update ready", "Ready", "Connected".
  - Problem: `circle-exclamation-point` at `size.stateIcon`, `color.problem`. "Couldn't build",
    "Can't reach your PC".
  - Idle: no mark, `color.textTertiary`. "Updated yesterday", "Up to date".
- These are the only states. Do not add colours for others; reword them into one of these four.

## 9. Toast

- Inverted ink: fill `color.text`, text and icon `color.bg`. `radius.toast`, padding `space.md`
  `space.lg`, min height 48, gap `space.md`, `elevation[2]`, max width `size.toastMaxWidth`.
- Leading icon `icon.size.md`; message `type.callout`, one line; optional action in the same
  colour, weight `strongWeight`, underlined ("Details").
- Phone: bottom, `space.lg` from the sides, above the composer or gesture bar. Desktop: bottom
  centre of the window.
- Enter: rise 8 and fade in over `motion.duration.base`, `motion.easing.enter`. Stays 4 s (8 s
  with an action). Exit: fade over `motion.duration.fast`. One toast at a time; a newer one
  replaces it. Never use a toast for a problem the user must act on: that goes in the chat.

## 10 to 12. Chat

The structure is bb's thread view (`.reference/bb/apps/app/src/components/thread/timeline`):
right-aligned user bubbles, assistant text without a bubble, one-line work rows with a leading
glyph that expand, a collapsed thinking row, a plan, and a composer at the bottom. Re-skinned with
these tokens; nothing of bb's palette is kept. Item kinds map one to one onto
`ChatItemKind` in `shared/protocol.ts`.

**Timeline**: padding `space.lg` sides, `space.lg` top, `space.md` bottom; rows gap `space.md`.
Newest at the bottom, sticky to the bottom while the agent writes.

**Chat header** (phone): height `size.chatHeaderHeight`, bottom line `color.border`. Back
`chevron-left` `icon.size.lg` in a `size.touch` target; app icon `size.appIconSmall` (radius
size / 4); title `type.heading`, one line; state line under it in `type.caption` weight 500 in the
state colour ("Version 8 ready"); a small quiet "Open" button at the end.

**User message** (`user`)
- Right aligned, max width `size.bubbleMaxWidthPercent`% on the phone, 70% on desktop.
- Fill `color.bubbleBg`, text `color.bubbleText` `type.callout`, `radius.bubble` (the bottom
  right corner tight), padding `space.md` `space.lg`. Text only, no markdown rendering.

**Assistant message** (`assistant`)
- No bubble, full width, padding x `space.xs`, `type.prose` `color.text`.
- Markdown: paragraphs and lists gap `space.md`; lists indent `space.xl`, markers
  `color.textTertiary`; **strong** at `strongWeight`; inline code `type.mono` at 0.86em on
  `color.codeBg`, `radius.code`, padding 1 5; code blocks `type.mono` on `color.codeBg`,
  `radius.badge`, padding `space.md`, scroll sideways, never wrap. Links are ink with a 1px
  `color.borderStrong` underline (never the accent). Headings inside a message render as
  `type.heading`.
- While streaming, text appears as it arrives; no cursor, no shimmer.

**Thinking row** (`thought`)
- Collapsed: `chevron-right` `icon.size.sm` + "Thought for 6s", `type.row` `color.textTertiary`,
  font style `look.thinkingFontStyle`, padding x `space.xs`.
- While the agent is thinking: a spinner instead of the chevron and the words "Thinking".
- Open: `chevron-down`; the text below in `type.callout` `color.textSecondary`, left rule 2px
  `color.border`, padding left `space.md`. Rotation and height change over
  `motion.duration.base`.

**Tool-call row** (`tool`)
- Height `size.toolRowHeight` (hit area padded to `size.touch`), padding x `space.xs`, gap
  `space.sm`, `type.row` `color.textSecondary`.
- Leading glyph `icon.size.sm` `color.textTertiary`, by ACP kind: read `file-text`, edit
  `file-pen`, delete `trash`, move `folder`, search `search`, execute `terminal`, think `brain`,
  fetch `globe`, other `circle-dot`.
- Title as the server sends it ("Edit Reminders.tsx", "Run the tests"); then the detail in
  `type.mono` `color.textTertiary` (diff counts, "14 passed").
- Status at the trailing edge:
  - pending: no mark; title `color.textTertiary`.
  - in_progress: spinner; title `color.text`.
  - completed: `check` `icon.size.sm` `color.textTertiary`.
  - failed: `x` `icon.size.sm` `color.problem`; detail `color.problem`.
- Tap to open: the detail block below, indented 28, fill `color.codeBg`, `radius.badge`, padding
  `space.md`, `type.mono` `color.textSecondary`, wraps, at most 12 lines then a fade and "Show all".
- Completed turns (bb's summary row): consecutive tool rows of a finished turn fold into one row,
  "Edited 2 files, ran the tests twice", same style, opening to the rows.

**Plan** (`plan`)
- Box: inner line `border.width` `color.border`, `radius.card`, padding `space.md`, rows gap
  `space.xs`, margin x `space.xs`.
- Head: `list-todo` + "Plan" in `type.label` `color.textSecondary`; count at the end in `type.row`
  `color.textTertiary` ("1 of 3 done").
- Items, `type.row`: completed `circle-check` `color.textTertiary` with text
  `color.textSecondary`; in_progress spinner with text `color.text` weight 500; pending
  `circle-dashed` and text `color.textTertiary`.

**Build row** (`build`)
- Card: fill `color.surface`, `radius.card`, inner line `color.border`, `elevation[1]`, padding
  `space.lg`, gap `space.lg`. Top: badge `size.badge` (`radius.badge`) then title `type.heading`
  and sub-line `type.row` `color.textSecondary`, gap `space.md`.
- Building: badge `package` on `color.surfaceSunken`, `color.textSecondary`; "Building version 8",
  "Usually about two minutes"; progress bar (8), indeterminate until the server sends a fraction.
- Ready: badge `package` on `color.readySoft` in `color.ready`; "Your app is ready",
  "Version 8, 31 MB"; a primary block button with `download`, "Install". After install it becomes
  a quiet "Open" and the sub-line reads "Installed".
- Failed: badge `circle-exclamation-point` on `color.problemSoft` in `color.problem`;
  "Version 8 didn't build", "Tried 3 times. Ask for a fix, or keep using version 7."; no button
  (the composer is the way forward).
- Building to ready: the content crossfades and the height eases over `motion.duration.base`,
  `motion.easing.standard`. The Install button is the only primary in the chat; when it shows,
  the composer's send stays quiet until the user types.

**Permission request** (`permission`)
- Card: fill `color.surface`, `radius.card`, inner line `border.width` `color.borderStrong`,
  padding `space.lg`, gap `space.md`. Badge 36 with `lock`; "Allow this step?" in `type.heading`;
  what it wants in `type.mono` `color.textSecondary`.
- Two small buttons sharing the width: quiet "Don't allow", primary "Allow". An "always" option
  from ACP is a third, quiet, below. Once answered the card collapses into a tool-style row: "You
  allowed: npm install expo-notifications".

**Error row** (`error`)
- `circle-exclamation-point` `icon.size.sm` `color.problem`, then one or two plain sentences in
  `type.row` `color.textSecondary`, padding x `space.xs`. Say what still works ("so this version is
  only saved on your PC").

**Composer**
- Area padding `space.sm` top, `space.md` sides, `space.xs` bottom (plus the keyboard or gesture
  inset).
- Box: min height `size.composerMinHeight`, `radius.composer`, fill `color.fieldBg`, inner line
  `border.width` `color.fieldBorder`, `elevation[1]`, padding left `space.lg`, gap `space.sm`.
  Input `type.body` `color.text`, placeholder "Ask for a change" `color.textTertiary`; grows to six
  lines, then scrolls.
- Send: `size.sendButton`, `radius.send`, `arrow-up` `icon.size.md`. Empty: fill
  `color.surfaceSunken`, icon `color.textTertiary`, disabled. With text: fill `color.accent`, icon
  `color.onAccent`. While the agent works: the button shows `square` (stop) on
  `color.surfaceSunken` in `color.text`; typing is still allowed and queues the message.
