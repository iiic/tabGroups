# tabGroups

[![CI](https://github.com/iiic/tabGroups/actions/workflows/ci.yml/badge.svg)](https://github.com/iiic/tabGroups/actions/workflows/ci.yml)

Extension for browsers to sort tabs into groups by time (day)

## Development

```sh
npm install        # also enables the pre-commit hook (.githooks)
npm start          # run the extension in a temporary Firefox profile
npm run check      # validation, type check, linters and tests (runs before npm publish)
npm run build      # extension zip in web-ext-artifacts/
```

| Script | What it checks |
| --- | --- |
| `npm run validate` | versions in package.json and manifest.json match, referenced files exist and are in the npm package, translations (`_locales`) are complete |
| `npm run lint` | ESLint (JS), Stylelint (CSS), html-validate (HTML), `web-ext lint` (manifest, addons.mozilla.org rules) |
| `npm test` | unit tests (`node:test`, `test/`); `npm run test:coverage` with coverage |
| `npm run typecheck` | TypeScript check of the JSDoc types |

## Release

```sh
npm version patch  # bumps package.json and manifest.json, commits, tags vX.Y.Z
git push --follow-tags
```

Then publish a GitHub release for the tag. The `publish.yml` workflow runs all checks, publishes the package to npm and attaches the extension zip to the release.
