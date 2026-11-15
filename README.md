# tabGroups

[![CI](https://github.com/iiic/tabGroups/actions/workflows/ci.yml/badge.svg)](https://github.com/iiic/tabGroups/actions/workflows/ci.yml)

Extension for browsers to sort tabs into groups by time (day)

The extension is the `tabGroups` module of AnalyticExtension built as a standalone Firefox extension: the core of
AnalyticExtension with only the parts this module needs, the module (`modules/tabGroups/`), its overview and settings in
the sandbox (`sandbox-modules/tabGroupsSandbox/`) and the welcome page (`modules/onboardingModule/`). Everything except
the files of this repository (README, CI, tests, `package.json`, …) comes from that build — change the code there, not
here.

## Changes in 1.0.5

Since 1.0.4:

- **Colors of groups from bookmarks by their name** — a group from bookmarks gets its default color from its name (the
  group name, or the name of the bookmark folder when the group name is empty). The same name always gives the same
  color: the color of the text (`colorFromText()` of the SDK) turned into the nearest of the colors the browser has for
  tab groups (by the distance in OKLab). The color list of the editor marks it as "(default)". While a group keeps its
  default color, the color changes along with a new name or another folder; a color the user picks stays. Groups set
  up before keep their colors.
- **Permission for groups from bookmarks fixed** — it could not be granted in this extension. Settings now have an
  "Allow groups from bookmarks" button above the settings of the groups (drawn by the core,
  `tabGroups.requestPermission`); it asks for `bookmarks` and `tabs`. The permission buttons of the overview open
  Settings right at the settings of the groups (`options.html#tabGroupsSandbox`).
- **Sorting by last use is the default** — a tab the user switches to moves into the "today" group. It applies after
  the update too unless the sorting was chosen in Settings; the previous behavior is "when the tab was opened".
- **Dashboard** — the overview of the groups can also be shown on a whole page (`dashboard.html`): "Show module
  output" → "Dashboard" in Settings. When the overview is no longer in the popup, the toolbar button opens the
  dashboard.
- **Smaller changes** — the toolbar icon is an SVG that follows the light or dark look of the browser (`icon.svg`
  instead of `icon.png`) and Settings show the version of each module.
- **Repository** — the extension zip for addons.mozilla.org of the version is in `dist/` (`npm run sync:module` of
  AnalyticExtension puts it there).

## Development

```sh
npm install        # also enables the pre-commit hook (.githooks)
npm start          # run the extension in a temporary Firefox profile
npm run check      # validation, type check, linters and tests (runs before npm publish)
npm run build      # extension zip in web-ext-artifacts/
```

| Script | What it checks |
| --- | --- |
| `npm run validate` | versions in package.json and manifest.json match, referenced files (also those of the uploaded module in `modules.json`) exist and are in the npm package, translations (`_locales` of the core and of the modules, `messages.json` of the uploaded module) are complete |
| `npm run lint` | ESLint (JS), Stylelint (CSS), html-validate (HTML), `web-ext lint` (manifest, addons.mozilla.org rules) |
| `npm test` | unit tests (`node:test`, `test/`); `npm run test:coverage` with coverage |
| `npm run typecheck` | TypeScript check of the JSDoc types |

## Release

The version is the one of the module (`VERSION` in `modules/tabGroups/module.mjs` of AnalyticExtension). In
AnalyticExtension:

```sh
powershell -ExecutionPolicy Bypass -File scripts\build-module-firefox.ps1 -Module tabGroups
npm run sync:module -- tabGroups ../tabGroups   # copies the build here, sets the version in package.json
```

Then here:

```sh
git commit -m "tabGroups X.Y.Z"
git tag vX.Y.Z
git push --follow-tags
```

Then publish a GitHub release for the tag. The `publish.yml` workflow runs all checks, publishes the package to npm and attaches the extension zip to the release.
