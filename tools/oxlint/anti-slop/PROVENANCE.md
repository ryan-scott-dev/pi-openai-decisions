# Anti-slop provenance

Vendored generic production source from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop)
at commit [`c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`](https://github.com/dmmulroy/anti-slop/tree/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src).

The upstream project has no official npm package and recommends vendoring. This copy
preserves the original relative paths under `src/`. Upstream tests and the optional
Effect directory are omitted; the generic entry point, 18 rules, shared helpers, and
ESLint Stylistic vendor files are unchanged. There are no local source modifications.
The top-level upstream MIT `LICENSE` and nested Stylistic `LICENSE`/`UPSTREAM.md` are
retained. Optional Effect rules are not enabled because this project does not use Effect.

Oxlint and `@oxlint/plugins` are pinned together at 1.87.0. Keep these versions aligned
when upgrading. Oxlint's JavaScript plugin interface is not a stable compatibility
contract, so validate the rule-loading regression test after any upgrade.

The plugin is developer tooling only. It is excluded from application lint/format
checks and the distributable package allowlist, preserving the pinned upstream copy.
It is loaded by the root `oxlint.config.ts` while linting owned source and tests.

For updates, compare this pinned upstream revision with the desired new revision and
review the changes. Preserve license notices and any future local customizations;
do not replace the directory blindly. Run all offline checks and policy regressions.
