# Third-party dependency inventory

Recorded from installed package metadata on 2026-10-01. Dependencies retain their
own licenses; the original application code is MIT under `LICENSE`. Versions below
reflect the installed tree used for validation. The lockfile is the install input.

## Direct dependencies

| Package | Installed version | Declared license | Scope |
| --- | --- | --- | --- |
| `@base-ui/react` | 1.6.0 | MIT | runtime |
| `@vscode/tree-sitter-wasm` | 0.3.1 | MIT | runtime |
| `ajv` | 8.20.0 | MIT | runtime |
| `class-variance-authority` | 0.7.1 | Apache-2.0 | runtime |
| `clsx` | 2.1.1 | MIT | runtime |
| `cmdk` | 1.1.1 | MIT | runtime |
| `lucide-react` | 1.21.0 | ISC | runtime |
| `next` | 16.2.9 | MIT | runtime |
| `next-themes` | 0.4.6 | MIT | runtime |
| `parse-diff` | 0.12.0 | MIT | runtime |
| `react` | 19.2.4 | MIT | runtime |
| `react-dom` | 19.2.4 | MIT | runtime |
| `react-resizable-panels` | 4.11.2 | MIT | runtime |
| `server-only` | 0.0.1 | MIT | runtime |
| `shadcn` | 4.11.0 | MIT | runtime |
| `shiki` | 4.3.0 | MIT | runtime |
| `simple-git` | 3.36.0 | MIT | runtime |
| `sonner` | 2.0.7 | MIT | runtime |
| `swr` | 2.4.2 | MIT | runtime |
| `tailwind-merge` | 3.6.0 | MIT | runtime |
| `tw-animate-css` | 1.4.0 | MIT | runtime |
| `web-tree-sitter` | 0.26.9 | MIT | runtime |
| `@modelcontextprotocol/sdk` | 1.31.0 | MIT | development |
| `@tailwindcss/postcss` | 4.3.1 | MIT | development |
| `@types/node` | 20.19.43 | MIT | development |
| `@types/react` | 19.2.17 | MIT | development |
| `@types/react-dom` | 19.2.3 | MIT | development |
| `eslint` | 9.39.4 | MIT | development |
| `eslint-config-next` | 16.2.9 | MIT | development |
| `tailwindcss` | 4.3.1 | MIT | development |
| `typescript` | 5.9.3 | Apache-2.0 | development |

## Installed transitive metadata inventory

Scanned 670 unique installed package/version pairs, including development
and platform packages. This is package metadata, not a distribution SBOM.

| Declared license expression | Package/version count |
| --- | --- |
| 0BSD | 1 |
| Apache-2.0 | 26 |
| BSD-2-Clause | 12 |
| BSD-3-Clause | 8 |
| BlueOak-1.0.0 | 2 |
| CC-BY-4.0 | 1 |
| CC0-1.0 | 1 |
| ISC | 26 |
| LGPL-3.0-or-later | 2 |
| MIT | 586 |
| MPL-2.0 | 4 |
| Python-2.0 | 1 |

## Dependencies requiring particular notice review

| Package | Version | Declared license |
| --- | --- | --- |
| `caniuse-lite` | 1.0.30001799 | CC-BY-4.0 |
| `lightningcss` | 1.32.0 | MPL-2.0 |
| `axe-core` | 4.12.1 | MPL-2.0 |
| `minimatch` | 10.2.5 | BlueOak-1.0.0 |
| `@img/sharp-libvips-linux-x64` | 1.2.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linuxmusl-x64` | 1.2.4 | LGPL-3.0-or-later |
| `lightningcss-linux-x64-gnu` | 1.32.0 | MPL-2.0 |
| `lightningcss-linux-x64-musl` | 1.32.0 | MPL-2.0 |
| `argparse` | 2.0.1 | Python-2.0 |
| `isexe` | 3.1.5 | BlueOak-1.0.0 |

The installed tree includes copyleft and attribution licenses. Do not assume that
a permissive project license replaces their obligations. Check which packages
are shipped in source or generated bundles and retain their required notices.

## Source distribution review

- Preserve dependency license/NOTICE files when redistributing bundled code.
- shadcn-derived components and visible Lucide/Feather icons have retained notices
  in `THIRD_PARTY_NOTICES.md`; no grammar binaries or dependency bundles are shipped.
- This inventory does not imply an exhaustive provenance or vulnerability audit.
- A clean install from the lockfile was not performed during this preparation.
  Existing dependencies were used without installing new packages.
