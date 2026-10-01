# Showcase change manifest

Source revision: `07de580f966cc19c7036e67d83db42e5f1ef2841`.

This manifest compares the isolated showcase with the original tracked snapshot.
A raw patch is omitted because deleted infrastructure values would otherwise remain
visible in removed lines. The clean source is the review deliverable.

| Path | Change |
| --- | --- |
| `LICENSE` | MIT; Lucas Muller, 2026 |
| `THIRD_PARTY_NOTICES.md` | Preserved shadcn/ui, Lucide and Feather license notices |
| `public/*.svg` | Unused template images removed |
| `.env.example` | Added |
| `.gitignore` | Changed |
| `README.md` | Changed |
| `docs/CHANGES.md` | Added |
| `docs/LICENSE-REVIEW.md` | Added |
| `docs/PROVENANCE.md` | Added |
| `docs/THIRD-PARTY.md` | Added |
| `docs/VALIDATION.md` | Added |
| `docs/deployment-20260928.md` | Excluded |
| `docs/screenshots/gitscope-dashboard.jpg` | Added |
| `docs/screenshots/gitscope-guide.jpg` | Added |
| `docs/screenshots/gitscope-staged.jpg` | Added |
| `docs/screenshots/gitscope-react-diff.jpg` | Added |
| `eslint.config.mjs` | Changed |
| `next.config.ts` | Changed |
| `package.json` | Changed |
| `scripts/demo-fixtures.mjs` | Added |
| `scripts/demo.mjs` | Added |
| `src/app/api/repos/[id]/refs/route.ts` | Changed |
| `src/app/api/repos/route.ts` | Changed |
| `src/app/globals.css` | Changed |
| `src/app/layout.tsx` | Changed |
| `src/app/page.tsx` | Changed |
| `src/app/workspace.tsx` | Added |
| `src/components/diff/diff-file.tsx` | Changed |
| `src/hooks/use-local-storage.ts` | Changed |
| `src/hooks/use-comments.ts` | Replaced literal NUL delimiter with equivalent escaped Unicode for readable Git diffs |
| `src/proxy.ts` | Added |
| `tests/demo.integration.mjs` | Added |
| `tests/demo.test.mjs` | Added |
| `tests/mcp.integration.mjs` | Changed |
| `tsconfig.json` | Changed |
