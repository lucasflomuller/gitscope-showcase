# License and redistribution review

On 2026-10-01 the owner selected the MIT license for GitScope's original project
code. `LICENSE` records Copyright (c) 2026 Lucas Muller. This is the application
license; dependencies and adapted third-party components retain their own terms.
`private: true` in `package.json` prevents accidental npm publication, not source
publication.

## Reviewed redistribution boundary

- The public source contains application TS/TSX, CSS, configuration, documentation,
  synthetic fixture definitions, a small application SVG icon and real-app screenshots.
- Generated/adapted UI primitives are identified by `components.json`; the shadcn
  MIT notice is retained in `THIRD_PARTY_NOTICES.md`.
- Lucide's complete ISC/Feather MIT notices are retained, including for icons visible
  in screenshots. No icon library bundle is vendored in the source tree.
- Unused Next.js/Vercel scaffold SVG assets were removed.
- No dependencies, font files, WASM grammars, native libraries or compiled app are
  redistributed. The lockfile references dependencies installed separately.
- The installed dependency metadata includes MPL/LGPL and attribution licenses;
  a future bundled/binary distribution needs its own included-material review.

The review covers visible source provenance, retained notices and the distribution
boundary. It is not an independent legal attestation about every historical line
or generated component. No employer/client source was intentionally included.

Sources: [MIT license](https://opensource.org/license/mit), installed shadcn and
Lucide license files, `components.json`, and `docs/THIRD-PARTY.md`.
