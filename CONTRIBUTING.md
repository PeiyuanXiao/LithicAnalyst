# Contributing

Thanks for helping. A few conventions keep the tool reliable for research use.

- **Issues first.** For anything larger than a small fix, open an issue (there are templates for
  feature requests and bug reports) so the approach can be agreed before code is written.
- **Data first.** Changes to the project file need a note in `docs/project-format.md`,
  a test in `tests/core.test.ts`, and — if old readers could misread the file — a new
  `formatVersion` with a migration in `src/core/schema.ts`.
- **Coordinates are sacred.** Never change stored coordinates for display reasons.
- **Every data change is a Command**, so undo, autosave and notifications keep working.
- **Fields** are defined once in `src/core/fields.ts`; enum codes must stay stable once data exist.
- **Lean interface, every language.** Every new string goes into `src/ui/strings.ts` with `en` and `zh`
  at least (`it` and `fr` where you can; what is missing shows in English). Prefer labels and controls
  over explanatory text. `npm run i18n -- export` puts every text in one spreadsheet for review and
  translation (see `docs/developing.md`).
- **Code and comments in English.**
- **Tests.** `npm test` must pass; geometry code gets a unit test with a known answer.
- Run `npm run build` before opening a pull request; it type-checks the whole project. For a change to
  the interface, run `npm run e2e` too.

Commit messages: short imperative subject (`Add landmark tool`), body explaining why.
