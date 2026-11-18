# Install and develop

Install Node 24 LTS and pnpm 10.32.1. Use the lockfile with `pnpm install --frozen-lockfile`. A compiler, Python and matching system headers may be required for SQLite native builds. On Windows, use Visual Studio Build Tools with the C++ workload. On macOS, install Xcode command line tools. On Linux, install a C++ toolchain and standard build utilities.

| Command | Output |
|---|---|
| `pnpm dev:web` | Loopback service and browser UI. Open the printed one-time link. |
| `pnpm dev:desktop` | Electron window and staged Electron-native service dependencies. |
| `pnpm build:web` | Browser assets, runnable Node service, and CLI under `dist`. Retain the installed production dependencies. |
| `pnpm build:desktop` | Renderer, Electron main and utility process entries. |
| `pnpm build:cli` | Node CLI with local launch and installed skill source. |
| `pnpm build:mcp` | The same distributable CLI with its stdio adapter. Run `kordlet mcp`. |
| `pnpm build` | All build targets. |
| `pnpm package:desktop` | Native installer artifacts under `release`. |
| `pnpm verify` | Local boundary checks, strict types, generation drift, builds, conformance and browser tests. |

Builds require no remote credentials. Run `pnpm exec playwright install chromium` before the browser tests. To use an existing Chrome installation, set `KORDLET_CHROME` to the executable path.

Run `pnpm package:node` to create `release/kordlet-node.tar.gz` with the server, CLI, MCP adapter, and web assets.
To stage a Node distribution, copy `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and `dist` into a distribution directory. Exclude the Electron staging folder. Run `pnpm install --prod --frozen-lockfile` there on the destination OS/runtime. Launch `node dist/server.mjs` or `node dist/kordlet.mjs serve`. Keep the web assets next to the service entry. An Electron installer does not install the separate CLI on PATH.

Electron runs a distinct native module staging install. Build on the target architecture. Windows output targets NSIS, macOS outputs DMG and zip, and Linux targets AppImage. Linux may need FUSE for the AppImage, or use its `--appimage-extract` option. Verify the desktop environment, permissions, and distribution support for unsigned local artifacts before installing. Platform evidence is recorded in [the release checklist](../release.md).
