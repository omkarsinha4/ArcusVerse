import test from "node:test";
import assert from "node:assert/strict";
import { absoluteAppBase, registrationPublicUrl, whatsappShareHref } from "../lib/publicUrl.ts";

test("absoluteAppBase adds http:// when missing", () => {
  assert.equal(absoluteAppBase("3.16.112.125"), "http://3.16.112.125");
  assert.equal(absoluteAppBase("http://3.16.112.125:3000/"), "http://3.16.112.125:3000");
});

test("registrationPublicUrl builds single-line absolute link", () => {
  assert.equal(
    registrationPublicUrl("http://3.16.112.125", "ACPL-6"),
    "http://3.16.112.125/register/ACPL-6"
  );
});

test("whatsappShareHref puts URL on its own line", () => {
  const href = whatsappShareHref("http://3.16.112.125/register/ACPL-6", "ACPL Season 6");
  assert.ok(href.startsWith("https://wa.me/?text="));
  const text = decodeURIComponent(href.split("text=")[1]);
  assert.ok(text.includes("\n\nhttp://3.16.112.125/register/ACPL-6"));
});
