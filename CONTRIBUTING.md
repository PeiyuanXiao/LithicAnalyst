# Contributing

Thanks for helping. A few conventions keep the tool reliable for research use.

- **Data first.** Changes to the project file need a note in `docs/project-format.md`,
  a test in `tests/core.test.ts`, and — if old readers could misread the file — a new
  `formatVersion` with a migration in `src/core/schema.ts`.
- **Coordinates are sacred.** Never change stored coordinates for display reasons.
- **Every data change is a Command**, so undo, autosave and notifications keep working.
- **Fields** are defined once in `src/core/fields.ts`; enum codes must stay stable once data exist.
- **Both languages, lean interface.** Every new string goes into `src/ui/strings.ts` with `zh` and `en`;
  prefer labels and controls over explanatory text.
- **Tests.** `npm test` must pass; geometry code gets a unit test with a known answer.
- Run `npm run build` before opening a pull request; it type-checks the whole project.

Commit messages: short imperative subject (`Add landmark tool`), body explaining why.
