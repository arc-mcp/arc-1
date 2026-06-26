# Package Safety Enforcement on Existing-Object Mutations

> **Priority**: **CRITICAL** — ARC-1 has the same bug
> **Source**: vibing-steampunk commit 0713d75, PR #101 (2026-04-12)
> **ARC-1 component**: `src/handlers/intent.ts` (update/delete/edit_method handlers), `src/adt/safety.ts`
> **Status**: Bug confirmed in ARC-1 — `checkPackage()` only called on create, not on update/delete/edit_method

## The Bug (vibing-steampunk)

`SAP_ALLOWED_PACKAGES` was only enforced on object creation flows. Existing-object mutations (EditSource, WriteProgram, WriteClass, UpdateSource, DeleteObject, RenameObject) bypassed the package restriction entirely.

This meant: if `SAP_ALLOWED_PACKAGES=$TMP`, a user could still modify or delete objects in `ZSAP_CORE` or any other restricted package.

## vibing-steampunk's Fix

Introduced a unified `checkMutation` gate that:
1. Resolves the object's package via `SearchObject` (extracts package from search metadata)
2. Validates package against the allowlist before any mutation
3. Covers: UpdateSource, WriteProgram, WriteClass, WriteSource, DeleteObject, RenameObject, CreateTestInclude, UpdateClassInclude, WriteMessageClassTexts, WriteDataElementLabels, UI5 mutations

Key functions added:
- `checkObjectPackageSafety()` — resolves package + validates against allowlist
- `getObjectPackage()` — extracts package from search results
- `normalizeObjectURLForPackageCheck()` — strips `/source/main`, `/includes/` suffixes
- Precedence: explicit Package param > resolve via ObjectURL > fail closed

## ARC-1 Status: SAME BUG EXISTS

**`checkPackage()` is only called in two places** in `src/handlers/intent.ts`:

1. **Line 1175** — `create` action: `checkPackage(client.safety, pkg)` ✅
2. **Line 1272** — `batch_create` action: `checkPackage(client.safety, pkg)` ✅

**Not called in these mutation handlers:**

| Handler | Line | Package Check | Status |
|---------|------|--------------|--------|
| `update` | 1163-1172 | ❌ None | **VULNERABLE** |
| `edit_method` | 1213-1244 | ❌ None | **VULNERABLE** |
| `delete` | 1245-1262 | ❌ None | **VULNERABLE** |

### Proof of concept

If `SAP_ALLOWED_PACKAGES=Z*` (only custom Z* objects allowed):

- ✅ `SAPWrite(action=create, package=ZSAP)` → Blocked by `checkPackage()`
- ❌ `SAPWrite(action=update, name=CL_IN_RESTRICTED_PKG)` → **Succeeds** (no check)
- ❌ `SAPWrite(action=delete, name=CL_IN_RESTRICTED_PKG)` → **Succeeds** (no check)
- ❌ `SAPWrite(action=edit_method, name=CL_IN_RESTRICTED_PKG)` → **Succeeds** (no check)

## Recommended Fix for ARC-1

### Option A: Resolve package before mutation (recommended)

Before each mutation, resolve the object's package and validate:

```typescript
// Add helper to resolve package for an existing object
async function resolveAndCheckPackage(
  client: AdtClient,
  type: string,
  name: string,
): Promise<void> {
  if (client.safety.allowedPackages.length === 0) return; // no restrictions configured
  
  // Use search to find the object's package
  const results = await client.searchObject(name);
  const match = results.find(r => r.name.toUpperCase() === name.toUpperCase());
  if (!match?.packageName) {
    throw new AdtSafetyError(
      `Cannot determine package for ${type} ${name} — mutation blocked by safety policy`
    );
  }
  checkPackage(client.safety, match.packageName);
}

// In update handler:
case 'update': {
  await resolveAndCheckPackage(client, type, name);  // NEW
  // ... existing update logic ...
}

// In edit_method handler:
case 'edit_method': {
  await resolveAndCheckPackage(client, type, name);  // NEW
  // ... existing edit_method logic ...
}

// In delete handler:
case 'delete': {
  await resolveAndCheckPackage(client, type, name);  // NEW
  // ... existing delete logic ...
}
```

### Option B: Check package in CRUD layer

Add package check to `safeUpdateSource()` and `deleteObject()` in `crud.ts`. This is more centralized but requires passing the safety config's allowedPackages and a package resolver to the CRUD layer.

**Recommendation: Option A** — keeps the check in the handler layer where we already have access to the client and search capabilities.

### Edge cases to handle

1. **Object not found in search**: Fail closed (block the mutation)
2. **Object has no package**: Fail closed
3. **No allowedPackages configured**: Skip check (no restrictions)
4. **Performance**: The search call adds ~100-200ms per mutation. Could cache package mapping.

## Decision

**IMPLEMENT IMMEDIATELY.** This is a safety system bypass — the exact scenario `SAP_ALLOWED_PACKAGES` is designed to prevent. vibing-steampunk's fix is the reference implementation.

**Effort**: 0.5 day (implement + test)
