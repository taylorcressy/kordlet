# Release verification

Kordlet is an initial release candidate. Linux x64 is the locally exercised desktop target. Windows x64 and macOS arm64/x64 have packaging jobs, and require successful native runs before a release can claim support. The app currently uses Electron's default OS icon. Electron 45 requires macOS 13 or later. Windows and Linux minimum product baselines still require verification. [Electron breaking changes](https://www.electronjs.org/docs/latest/breaking-changes/)

| Target | Local evidence |
|---|---|
| Node 26.3.0 on Linux x64 | REST and CLI subprocess tests, MCP wire tests, strict typecheck, generated drift and OpenAPI validation |
| Chrome on Linux x64 | Empty workspace, keyboard creation, claim and review, persistence, opt-in sample and narrow inspector |
| Extracted Node distribution | Fresh production-only install, web service, and independent CLI smoke check |
| Electron 45.3.4 on Linux x64 | Packaged desktop SQLite write, read and restart, external CLI connection, ownership shutdown and headless attachment |
| Linux x64 AppImage | Built and extracted locally. The packaged executable passed the SQLite and ownership smoke test. |
| Windows x64 NSIS | Requires native build, installation and smoke check |
| macOS arm64/x64 DMG and zip | Requires native builds, installation, signing/notarization as applicable and smoke checks |

## Release checklist

1. Run `pnpm verify` locally. Check every public registry operation and its fixtures, generated drift, migration and backup evidence, and relevant browser checks.
2. Build with `pnpm package:desktop` on each target architecture. Use `pnpm test:desktop <executable>` against its packaged executable. Verify installation as an ordinary user and check paths with spaces and Unicode.
3. Test the separate Node distribution against the running desktop and headless service. Run `scripts/release-files.mjs` with Node to stage desktop artifacts and checksums.
4. Compare the generated contract to the last released contract and document necessary migrations/version changes. There is no previous published contract for 0.1.0.
5. Select a signing identity and configure secrets only after the maintainer establishes them. The manually dispatched workflow stages artifacts and does not publish.
6. Record exact revisions, verification evidence and remaining limitations before choosing a release.

## Local performance sample

One Gentoo Linux x64 run on an AMD Ryzen 9 9950X3D and Node 26.3.0 populated 10,000 issues using eight concurrent HTTP requests. A subsequent 128-request filtered list run at concurrency eight returned 50 rows per request. Service cold start to launch URL was 301 ms. Median list time was 2 ms and p95 was 7 ms. Linux RSS after the load was about 191 MiB. The Linux AppImage was approximately 143 MiB. UI response timing and OS baseline coverage remain unmeasured. Reproduce the server sample with `pnpm build:web` and `node scripts/benchmark.mjs`.

## Remaining compatibility work

The parity suite compares the live inventories and runs every operation through equivalent REST, CLI subprocess, and MCP SDK scenarios. It covers selected error, permission, concurrency, and recovery cases. Bootstrap has a checked local SDK connection and project configuration fixture. Provider-client onboarding, Windows paths and installer testing remain to be verified on those environments.

The desktop onboarding flow uses the separate CLI for installing project helper files. Portable import/export and offline database maintenance also use the CLI or the corresponding public domain operations. Project discovery recognizes registered directory mappings and markers. A linked worktree without an independent mapping or marker may require an explicit project ID.
