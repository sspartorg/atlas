// Superseded by smoke-items.ts (which exercises the unified items model end to
// end, including the per-project counter allocation). Kept as a forwarder so
// any docs/scripts that reference this filename still print a useful pointer.

console.log(
    'smoke-key-allocation.ts is deprecated. Run smoke-items.ts instead — it covers per-project key allocation as part of the items flow.\n' +
        '  pnpm tsx src/scripts/smoke-items.ts',
);
process.exit(0);
