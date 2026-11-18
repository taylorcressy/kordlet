import { startService } from "../../packages/service/http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
export const assets =
  process.env.KORDLET_ASSETS ??
  fileURLToPath(new URL("./web", import.meta.url));
export async function serve(mode: "headless" | "desktop" = "headless") {
  return startService({
    mode,
    port:
      process.env.KORDLET_PORT === undefined
        ? undefined
        : Number(process.env.KORDLET_PORT),
    assets: resolve(assets),
  });
}
