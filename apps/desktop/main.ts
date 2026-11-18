import { app, BrowserWindow, dialog, utilityProcess } from "electron";
import type { UtilityProcess } from "electron";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { dataDirectory, discover } from "../../packages/service/paths";
const root = dirname(fileURLToPath(import.meta.url));
let child: UtilityProcess | undefined;
let window: BrowserWindow | undefined;
let quitting = false;
let opening = false;
async function attach(instance: Awaited<ReturnType<typeof discover>>) {
  const token = readFileSync(join(dataDirectory(), "owner.token"), "utf8");
  const response = await fetch(instance.endpoint + "/session/launch", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    redirect: "error",
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw Error("Could not open an owner session.");
  const { url } = await response.json();
  if (new URL(url).origin !== instance.endpoint)
    throw Error("Invalid service launch URL.");
  return url as string;
}

async function startOrAttach() {
  const existing = await discover().catch(() => null);
  if (existing) return attach(existing);
  const owned = utilityProcess.fork(join(root, "utility.cjs"), [], {
    env: { ...process.env, KORDLET_ASSETS: join(root, "web") },
  });
  child = owned;
  owned.once("exit", () => {
    if (child === owned) child = undefined;
  });
  const message = await new Promise<{
    url?: string;
    error?: string;
    code?: string;
  }>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("The local service took too long to start.")),
      12000,
    );
    owned.once(
      "message",
      (result: { url?: string; error?: string; code?: string }) => {
        clearTimeout(timer);
        resolve(result);
      },
    );
    owned.once("exit", () => {
      clearTimeout(timer);
      reject(Error("The local service exited."));
    });
  });
  if (message.url) return message.url;
  if (message.code === "service_owned") {
    for (let attempt = 0; attempt < 20; attempt++) {
      const instance = await discover().catch(() => null);
      if (instance) return attach(instance);
      await delay(100);
    }
  }
  throw Error(message.error ?? "Service startup failed.");
}

async function launch() {
  if (opening || (window && !window.isDestroyed())) return;
  opening = true;
  try {
    const startUrl = await startOrAttach();
    const endpoint = new URL(startUrl).origin;
    window = new BrowserWindow({
      width: 1512,
      height: 940,
      minWidth: 530,
      minHeight: 560,
      backgroundColor: "#0e101a",
      title: "Kordlet",
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => {
      if (new URL(url).origin !== endpoint) event.preventDefault();
    });
    await window.loadURL(startUrl);
  } catch (error) {
    dialog.showErrorBox(
      "Kordlet service unavailable",
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
  } finally {
    opening = false;
  }
}
app.whenReady().then(launch);
app.on("activate", () => void launch());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", (event) => {
  if (!child || quitting) return;
  event.preventDefault();
  quitting = true;
  const owned = child;
  const timeout = setTimeout(() => {
    owned.kill();
    app.quit();
  }, 3500);
  owned.once("exit", () => {
    clearTimeout(timeout);
    app.quit();
  });
  owned.postMessage("stop");
});
