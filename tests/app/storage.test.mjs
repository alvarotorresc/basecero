import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyStorageFailure } from "../../app/js/format.js";

// El VFS opfs-sahpool solo admite una instancia: si otra pestaña/PWA tiene la BD
// abierta, createSyncAccessHandle lanza NoModificationAllowedError. Ese caso es
// "locked" (recuperable cerrando la otra instancia), no "unsupported".
test("classifyStorageFailure: NoModificationAllowedError → locked", () => {
  const e = Object.assign(new Error("Access Handles cannot be created if there is another open Access Handle"), {
    name: "NoModificationAllowedError",
  });
  assert.equal(classifyStorageFailure(e), "locked");
});

test("classifyStorageFailure: mensaje con 'Access Handle' sin name → locked", () => {
  assert.equal(classifyStorageFailure(new Error("Failed: another open Access Handle exists")), "locked");
});

test("classifyStorageFailure: otros errores → unsupported", () => {
  assert.equal(classifyStorageFailure(new Error("OPFS not available in this context")), "unsupported");
  assert.equal(classifyStorageFailure(undefined), "unsupported");
  assert.equal(classifyStorageFailure("cadena rara"), "unsupported");
});
