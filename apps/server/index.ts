import { serve } from "./serve";
const service = await serve();
console.log(service.mintLaunch());
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => void service.close());
