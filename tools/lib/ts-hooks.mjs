// Let the pipeline scripts import the app's TypeScript source directly.
//
// Node strips types from `.ts` fine, but won't resolve the extensionless
// relative imports TypeScript uses (`from './muscles'`) — that's a bundler
// convention, and Vite is the bundler in the app's own build.
//
// The alternative was to copy the muscle registry / ROM tables into the tools,
// which is exactly the kind of duplication that silently drifts. The tools MUST
// read the same source the app ships.
//
// Used via tools/lib/register-ts.mjs.

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
    try {
      return await next(`${specifier}.ts`, context)
    } catch {
      // Not a .ts module — fall through to Node's normal resolution.
    }
  }
  return next(specifier, context)
}
