// CI/helper scripts under scripts/ are plain ESM (.mjs) with no type declarations. The unit tests
// that exercise them import them untyped; this ambient declaration makes that explicit (and
// silences noImplicitAny) for the test typecheck only — src/ has no .mjs imports.
declare module '*.mjs';
