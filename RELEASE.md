# Releasing `fundquill-check`

Publishing is what turns "a recipient can verify a FundQuill report without trusting FundQuill"
from a claim into a fact. It is also outward-facing and effectively irreversible, so every step
here is manual and deliberate.

## Identity (entity/identity firewall): read first

The package belongs to the **company, never a person**:

- **GitHub:** `github.com/mitikasha-llc/fundquill-check`, public, under the **`mitikasha-llc`
  organization** (it already exists; `privhaven-check` lives there).
- **npm:** published by the **`mitikasha-llc`** npm account (`apps@mitikasha.com`), the maintainer
  of `privhaven-check`. `npm whoami` must print `mitikasha-llc`.
- **Commits:** `Mitikasha LLC <apps@mitikasha.com>`, no personal names and no co-author lines.
  `author`, `LICENSE` and every URL already say Mitikasha LLC; keep it that way.

## Pre-flight (from a clean checkout)

```sh
npm test                                              # no dependencies
npm run build:html && shasum -a 256 dist/check.html   # must match MANIFEST.md
```

And in the FundQuill repository, the live cross-check against freshly generated documents:

```sh
CHECKER=/path/to/fundquill-check just cross-check
```

## First publish (manual, one time)

1. `npm whoami` prints `mitikasha-llc` (else `npm login` as that account).
2. ⚠️ `npm whoami` succeeding is **not** publish capability. With 2FA on writes, `npm publish`
   needs a fresh one-time code, and a non-interactive run cannot prompt for it. Run the script
   from a **real terminal**. (privhaven-check's first release learned this the hard way: the
   public repo went up while npm still refused.)
3. Run:

   ```sh
   scripts/first-release.sh mitikasha-llc
   ```

   It checks the org and npm identity, refuses a non-terminal run when 2FA is on, asks for a typed
   `YES`, runs the tests, refuses unless `dist/check.html` matches MANIFEST.md, then creates the
   public repo, publishes to npm, tags, and attaches the offline file to a GitHub release.

## Later releases

`.github/workflows/release.yml` **stages** a release on any `v*` tag via npm trusted publishing
(GitHub OIDC, no stored token). Configure it on npmjs.com after the first publish: trusted
publisher GitHub Actions, repo `mitikasha-llc/fundquill-check`, workflow `release.yml`,
environment `mitikasha-fundquill`, **"stage publish" permission only**. Nothing goes public until
a maintainer approves it with 2FA:

```sh
npm version patch && git push --follow-tags
npm stage list fundquill-check && npm stage approve <stage-id>
```

## After the first publish

1. FundQuill `/verify`: add the CLI (`npx fundquill-check report.json model.xlsx`) and the offline
   download. The page names neither until they exist.
2. Commit MANIFEST.md with the released artifact hash.

## Keeping it in step with FundQuill

`test/fixtures` is a copy of FundQuill's `apps/web/src/lib/fixtures` (made by FundQuill's own
code, with `expected.json`). When FundQuill's document format changes: regenerate there, copy
here, and both test suites must stay green. A format change that only one side handles is the
failure this arrangement exists to catch.
