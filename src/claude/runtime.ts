import type { RuntimeMode } from "../buddy/hash.js";

export function detectCurrentRuntime(): Exclude<RuntimeMode, "auto"> {
  return typeof Bun !== "undefined" ? "bun" : "node";
}

export function resolveRuntime(runtime: RuntimeMode): Exclude<RuntimeMode, "auto"> {
  return runtime === "auto" ? detectCurrentRuntime() : runtime;
}
