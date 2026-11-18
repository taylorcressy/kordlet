import { startService } from "../../packages/service/http";
import { DomainError } from "../../packages/service/store";
const port = (
  process as NodeJS.Process & {
    parentPort?: {
      postMessage(value: unknown): void;
      on(event: string, handler: (message: { data: unknown }) => void): void;
    };
  }
).parentPort;
if (!port) throw Error("Expected Electron utility process.");
const parent = port;
startService({ mode: "desktop", assets: process.env.KORDLET_ASSETS })
  .then((service) => {
    parent.postMessage({ url: service.mintLaunch() });
    parent.on("message", (message) => {
      if (message.data === "stop")
        void service.close().finally(() => process.exit(0));
    });
  })
  .catch((error) => {
    parent.postMessage({
      error: error instanceof Error ? error.message : String(error),
      code: error instanceof DomainError ? error.code : undefined,
    });
    process.exitCode = 1;
  });
