# Dependency audit — 2026-10-08

Measured with `npm audit --omit=dev --json` and `npm audit --json`, before changes and after a clean `npm ci`. Counts are vulnerable dependency entries, including affected ancestors, not independent exploitable defects. Raw reports remain outside the repository.

| Scope | Before (low / moderate / high / critical) | After | Total before → after |
| --- | --- | --- | --- |
| Runtime (`--omit=dev`) | 18 / 69 / 34 / 2 | 0 / 17 / 21 / 0 | 123 → 38 |
| Full dependency graph | 18 / 72 / 39 / 4 | 0 / 20 / 26 / 2 | 133 → 48 |

## Changes

- Removed unused direct `@solana/wallet-adapter-wallets` (locked 0.19.39). Repository imports and the provider configuration use Phantom and Solflare directly; both remain. The bundle removal eliminated 593 lockfile package paths, including unused hardware/multichain wallet integrations. Other direct packages were retained after inspecting source imports, tooling, peer dependencies, and SDK use; no further unused duplicate was established.
- Compatible transitive updates: `shell-quote` 1.10.0 → 1.12.0, `sharp` 0.35.4 → 0.35.5 (with matching platform/libvips packages), `source-map-js` 1.2.1 → 1.2.2. No core SDK, Next, React, or wallet-adapter version changed. No forced audit fix or major migration.

## The four original critical entries

| Entry / advisory | Dependency path and disposition |
| --- | --- |
| `protobufjs`, [GHSA-xq3m-2v4x-88gg](https://github.com/advisories/GHSA-xq3m-2v4x-88gg) | Unused wallet bundle → wallet-adapter-trezor → connect-web → connect → `@trezor/protobuf`; blockchain-link-utils and device-authenticity also carried nested protobuf 7.4.0. Removed with the unused bundle. EquiCurve did not invoke that adapter. |
| `shell-quote`, [GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv) | wallet-adapter-react → optional/mobile adapter graph → React Native → react-devtools-core → shell-quote. Runtime-labelled transitive tooling, not an EquiCurve shell-command feature. Updated within the parent's compatible range; advisory removed. |
| `tinypool`, [GHSA-5gmw-xhrv-c9v3](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3), [GHSA-85c8-ppgw-ccpr](https://github.com/advisories/GHSA-85c8-ppgw-ccpr) | Dev-only Vitest 3.2.7 → tinypool 1.1.1. Residual prototype-pollution/worker-options risk. Tests run trusted repository code with `vitest run`; no public test server or user-supplied worker options. A fixed tinypool requires leaving the current major range. |
| `vitest` | Dev-only direct ancestor flagged critical through tinypool, not a fourth independent runtime critical exploit. Also has mocker/path-traversal findings. npm proposes Vitest 5.0.3, a breaking upgrade deferred before submission. |

## Remaining high-risk roots and affected ancestors

- **Potentially runtime reachable:** Solana SPL Token / buffer-layout-utils → `bigint-buffer` 1.1.5 ([buffer-overflow advisory](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg)). SDK account decoding is used. Local tests/build reported the pure-JS fallback, but that is not a guarantee that every deployment lacks native bindings. npm reports no fix; replacing the Solana graph or forcing a different implementation is outside this freeze. Treat as residual risk, not proven unreachable.
- **Runtime dependency, unused vulnerable facility:** Anchor → `toml` (recursive parsing / prototype pollution). EquiCurve imports Anchor's Borsh coder/event parser; it does not accept TOML or load Anchor workspace files from users. npm reports no compatible fix. Anchor, Meteora and SPL entries inherit these transitive severities.
- **Build/optional tooling:** `braces` nested-pattern exhaustion via micromatch/fast-glob/chokidar; Next ESLint and Tailwind inherit it. React Native/Metro in the optional mobile peer graph also inherit it. No user-supplied glob compilation or Metro service is exposed by this web app. npm reports no safe fix for the root; major tool migrations are deferred.
- **Build processing in a runtime-labelled package:** Next 15.5.25 pins PostCSS 8.4.31, whose source-map handling has file-read advisories. CSS is repository-owned; there is no uploaded-CSS processor. The separate direct PostCSS is already 8.5.28. Replacing Next's exact pin with an override would exceed its declared dependency contract; not done merely to lower counts.

Moderate findings remain in the Solana/wallet graph and dev tooling. These reachability classifications come from source/configuration inspection, not a penetration test or proof of non-exploitability. A lower audit count does not establish that the application is “all secure.” Reassess advisories and perform tested SDK/toolchain upgrades after submission; do not run `npm audit fix --force` on this frozen release.
