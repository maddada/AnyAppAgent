# Third-party notices

## bb

The chat screen (`src/chat/`, `src/app/chat/[id].tsx`) keeps the structure of bb's thread view:
right-aligned user bubbles, assistant text without a bubble, one-line work rows that expand and
fold, a collapsed thinking row, a plan and a composer. Its colours and type now come from the shared
AnyAppAgent theme (`../shared/theme`); no bb code is imported. Source: https://github.com/get-bb/bb

```
MIT License

Copyright (c) 2026 Michael Yong

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Fonts

Bricolage Grotesque and IBM Plex Mono, bundled from `../shared/theme/fonts`, under the SIL Open
Font License 1.1 (the licence files are next to the fonts there).

## Easy Connect bridge (Ghostex, Tailcat)

The phone's Easy Connect tunnel is Ghostex's tailcat bridge (`bridge.go`, `interfaces.go`, same
owner), built with gomobile into `tailcatbridge.jar` and `libgojni.so` (staged at build time by
`scripts/stage-bridge.mjs`, not kept in Git), plus `EasyConnect.kt` and `EasyConnectInterfaces.kt`
copied from `../server/easy-connect/android/` (Ghostex's `GhostexTailcatInterfaces.kt`). The bridge
links Tailcat (github.com/tailscale/tailcat, BSD-3-Clause, Tailscale Inc.) and its Go dependencies;
their notices are listed in `../server/THIRD_PARTY_NOTICES.md`.
