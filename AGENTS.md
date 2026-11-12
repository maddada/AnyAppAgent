# Kiwimake: rules for every agent working here

- Read `docs/SPEC.md` first: what the product is, the decisions already made, and who owns which
  folder. Edit only the folder(s) your task names.
- No em dashes anywhere (the user's rule): never use the em dash character (U+2014) in app text,
  agent replies, documents, comments, commit messages or the apps Kiwimake generates. Use a
  comma, a colon, a full stop or parentheses.
- Android builds and the emulator: follow `docs/ENVIRONMENT.md` literally. The emulator is shared.
- `shared/protocol.ts` is the contract between the phone app, the companion and the desktop app:
  additive changes only, and say so in your report.
- `.reference/` is read only and never imported from. `C:\dev\Ghostex` is read only.
