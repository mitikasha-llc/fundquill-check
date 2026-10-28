# Release manifest

Each release records the SHA-256 of every distributable artifact here (and in the GitHub Release),
so the copy you run, CLI, npm package or offline `dist/check.html`, is provably the copy that was
published. All artifacts are built from a single tagged commit.

| Artifact | SHA-256 |
|---|---|
| `dist/check.html`, v0.1.0 (offline single file) | `sha256:6ea63a8e925263bcac17e9d97f73416160fc96d48cebbf6425a3beee1b4ff825` |
| npm `fundquill-check@0.1.0` | via the registry: `npm view fundquill-check@0.1.0 dist.integrity` |

> Reproduce the offline artifact's hash from a clean checkout:
> ```sh
> npm run build:html && shasum -a 256 dist/check.html
> ```
