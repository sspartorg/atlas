import { lazy, type ComponentType } from 'react';

// Tiny shim around React.lazy for modules that use NAMED exports (which most
// of this codebase does) instead of default exports. `React.lazy` requires
// `{ default: Foo }`, so we wrap the dynamic import and rebrand the chosen
// named export as `default` before passing it through.
//
// The generic preserves the named export's prop type so callers get full
// type-checking on the lazy component — no `any`-erasure.
//
// Usage:
//   const NewProjectModal = lazyNamed(
//       () => import('./projects/NewProjectModal.js'),
//       'NewProjectModal',
//   );
export function lazyNamed<
    M extends Record<string, ComponentType<never>>,
    N extends keyof M & string,
>(loader: () => Promise<M>, name: N): M[N] {
    return lazy(() =>
        loader().then((m) => ({ default: m[name] as ComponentType<unknown> })),
    ) as unknown as M[N];
}
