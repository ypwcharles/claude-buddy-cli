import type { RuntimeMode } from "../buddy/hash.js";

export function detectCurrentRuntime(): Exclude<RuntimeMode, "auto"> {
  return typeof Bun !== "undefined" ? "bun" : "node";
}

export function getRuntimeOverrideFromEnv(): Exclude<RuntimeMode, "auto"> | undefined {
  const runtime = process.env.CLAUDE_BUDDY_RUNTIME;
  if (runtime === "node" || runtime === "bun") {
    return runtime;
  }
  return undefined;
}

export function resolveRuntime(runtime: RuntimeMode): Exclude<RuntimeMode, "auto"> {
  if (runtime !== "auto") {
    return runtime;
  }

  return getRuntimeOverrideFromEnv() ?? detectCurrentRuntime();
}
