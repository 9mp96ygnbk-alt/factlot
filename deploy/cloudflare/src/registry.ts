/**
 * Registry tools on the hosted API: the catalog checks the input, then this runner asks the
 * registry service (Worker factlot-registry, reached only through a service binding) for the
 * outcome. The service answers with exactly what runTool would return against a registry file.
 */
import type { RegistryRunner, ToolOutcome } from "@factlot/tools";

import type { Fetcher } from "./types.ts";

/** The registry service's address inside the binding; it has no public route. */
export const REGISTRY_RUN_URL = "https://registry.internal/run";

export function registryRunner(service: Fetcher): RegistryRunner {
  return async (name, input) => {
    const response = await service.fetch(
      new Request(REGISTRY_RUN_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tool: name, input }),
      }),
    );
    if (!response.ok)
      throw new Error(`registry service answered ${response.status}`);
    const outcome = (await response.json()) as ToolOutcome;
    if (typeof outcome !== "object" || outcome === null || !("ok" in outcome))
      throw new Error("registry service answered without an outcome");
    return outcome;
  };
}
