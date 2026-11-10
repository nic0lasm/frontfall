# Translating Frontfall

English is the reference: every interface text is a key in `apps/client/src/i18n/en.json`, and each language is a file with the same keys, such as `fr.json`.

## Add a language

1. Copy `en.json` to `apps/client/src/i18n/<code>.json`, with the two-letter [ISO 639-1](https://en.wikipedia.org/wiki/List_of_ISO_639_language_codes) code (`de`, `es`…). Translate the values, not the keys.
2. Add one entry to `CATALOGUES` in `apps/client/src/i18n/index.ts`:

   ```ts
   de: { complete: false, load: () => import("./de.json").then((module) => module.default) },
   ```

3. Run `pnpm exec vitest run apps/client/test/i18n.test.ts` and `pnpm typecheck`.
4. Once every key is translated, set `complete: true`.

Keep the `{placeholders}` of each English message, spelled the same. Plural forms are keys ending in `.one`, `.other` and so on; give the forms your language uses ([CLDR plural rules](https://cldr.unicode.org/index/cldr-spec/plural-rules)).

The picker names the language in itself, from its code. A language with `complete: false` is not offered, not detected from the browser and not restored from storage, so a partial translation can be merged and finished later. To try it in the game, set `complete: true` locally and don't commit that.

## Known gap

A few texts are not in the catalogues yet: tables in `apps/client/src` with one entry per language (`work-text.ts`, `hints.ts`, `tutorial-text.ts` and others) and the names of maps and landmarks. `pnpm typecheck` reports each of them once a language is registered; add yours there. The pages in `apps/client/public` (`about`, `legal`, `privacy`, `terms`) and the sign-in email stay in English until someone translates them in their own pull request.
