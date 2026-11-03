# tabGroups

[![CI](https://github.com/iiic/tabGroups/actions/workflows/ci.yml/badge.svg)](https://github.com/iiic/tabGroups/actions/workflows/ci.yml)

Extension for browsers to sort tabs into groups by time (day)

The extension is the `tabGroups` module of AnalyticExtension built as a standalone Firefox extension: the core of
AnalyticExtension with only the parts this module needs, the module (`modules/tabGroups/`), its overview and settings in
the sandbox (`sandbox-modules/tabGroupsSandbox/`) and the welcome page (`modules/onboardingModule/`). Everything except
the files of this repository (README, CI, tests, `package.json`, …) comes from that build — change the code there, not
here.

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
