// Unit tests run the Worker's modules under plain Node (`node --test`). One dependency of the
// hosted Worker, @cloudflare/workers-oauth-provider, imports `cloudflare:workers` (for the
// WorkerEntrypoint base class), which only the Workers runtime provides. This hook answers that
// import with an empty class so the module loads; nothing in the tests extends it. It also sets
// the compatibility flag the library reads at load (production sets it in wrangler.jsonc), so the
// tests see the same advertised capabilities as the deployed Worker.
import * as nodeModule from "node:module";

const STUB = "data:text/javascript,export class WorkerEntrypoint {}";

globalThis.Cloudflare ??= {
  compatibilityFlags: { global_fetch_strictly_public: true },
};

if (typeof nodeModule.registerHooks === "function") {
  nodeModule.registerHooks({
    resolve(specifier, context, next) {
      if (specifier === "cloudflare:workers")
        return { url: STUB, shortCircuit: true };
      return next(specifier, context);
    },
  });
} else {
  // Node before 22.15: the asynchronous hooks API, with the hooks module inline.
  const hooks = `export async function resolve(specifier, context, next) {
    if (specifier === "cloudflare:workers") return { url: ${JSON.stringify(STUB)}, shortCircuit: true };
    return next(specifier, context);
  }`;
  nodeModule.register(
    `data:text/javascript,${encodeURIComponent(hooks)}`,
    import.meta.url,
  );
}
