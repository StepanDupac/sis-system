import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isCuniStudyUrl } from "../extension/cuni/inspect.js";

test("CUNI inspection accepts only HTTPS and the exact study origin/path", () => {
  assert.equal(isCuniStudyUrl("https://is.cuni.cz/studium/"), true);
  assert.equal(isCuniStudyUrl("https://is.cuni.cz/studium/example/index.php?KEY=placeholder"), true);
  for (const value of [undefined, "", "http://is.cuni.cz/studium/", "https://is.cuni.cz.attacker.test/studium/", "https://attacker.test@is.cuni.cz/studium/", "https://cas.cuni.cz/", "https://is.cuni.cz/elsewhere/", "https://is.cuni.cz/studium/../elsewhere/", "https://is.cuni.cz:444/studium/", "javascript:alert(1)"]) {
    assert.equal(isCuniStudyUrl(value), false, String(value));
  }
});

test("diagnostics do not introduce blanket hosts, cookie access or a network-capable extension page", async () => {
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.permissions.includes("cookies"), false);
  assert.equal(manifest.permissions.includes("activeTab"), true);
  assert.match(manifest.content_security_policy.extension_pages, /connect-src 'none'/);
});
