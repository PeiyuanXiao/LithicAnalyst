# Contributing

Thanks for helping. A few conventions keep the tool reliable for research use.

## Setup

You need [Git](https://git-scm.com/) and [Node.js](https://nodejs.org/) 20 or later (CI uses 22).
In the project folder:

```bash
npm ci                          # install the dependencies
npx playwright install chromium # once, before the first npm run e2e
```

## Commands

```bash
npm run dev     # development server: open the address it prints; the page reloads as you edit
npm test        # unit tests (Vitest, tests/)
npm run e2e     # end-to-end tests: builds, then drives dist/index.html in Chromium (Playwright, e2e/)
npm run build   # type check, then dist/index.html and dist/artifact.html
```

## Interface text and translations

Every text of the interface is in `src/ui/strings.ts`; the labels of fields and options are in
`src/core/fields.ts`. To go over them or translate them, use one spreadsheet:

```bash
npm run i18n -- export                  # writes i18n/texts.xlsx: a row per text, a column per language
npm run i18n -- import i18n/texts.xlsx  # writes the changed texts back into the sources (--dry lists them only)
npm run i18n -- check                   # checks only: placeholders, empty cells, missing or unused texts
```

- Edit the cells of the language columns in Excel or WPS and save as .xlsx. Do not change the `id`
  column or delete rows. The sheet "说明 readme" repeats these rules.
- Keep placeholders such as `{n}` and `{name}` in every language (they may move). English and Chinese
  cannot be left empty. If anything is wrong, the import writes nothing and lists the errors.
- **Adding a language:** add a column after the last language, headed with its code (`ja`, `de`,
  `pt-BR`, `zh-TW`, …), fill in the rows `@lang.name` (the language's name in itself) and `@lang.short`
  (one or two characters for the language button), then import. Cells left empty show English, so a
  language can be translated a part at a time.
- After an import, run `npm test` and `npm run build`.

## Conventions

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
  over explanatory text.
- **Code and comments in English.**
- **Tests.** `npm test` must pass; geometry code gets a unit test with a known answer.
- Run `npm run build` before opening a pull request; it type-checks the whole project. For a change to
  the interface, run `npm run e2e` too.

Commit messages: short imperative subject (`Add landmark tool`), body explaining why.
