import test from "node:test";
import assert from "node:assert/strict";
import {
  compareOp,
  evaluateFieldState,
  detectCircularRules,
  validateSubmission,
  submitRegistration,
  updateRegistrationStatus,
  createForm,
  setFormStatus,
  withRegLock
} from "../server/registration.mjs";
import { buildAcplSeason6Form } from "../server/registration-template-acpl6.mjs";
import { emptySeed, uid, saveUpload } from "../server/store.mjs";
import fs from "fs";
import path from "path";
import os from "os";

function tinyPngDataUrl() {
  // 1x1 PNG
  const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  return `data:image/png;base64,${b64}`;
}

function makeStore() {
  const store = emptySeed();
  store.registrationForms = [];
  store.registrations = [];
  store.registrationFiles = [];
  store.registrationAudits = [];
  store.meta.regFileSecret = "test-secret-key-please-ignore";
  return store;
}

test("compareOp covers equals and contains", () => {
  assert.equal(compareOp("equals", "Yes", "Yes"), true);
  assert.equal(compareOp("notEquals", "Yes", "No"), true);
  assert.equal(compareOp("contains", "Hello World", "world"), true);
  assert.equal(compareOp("isEmpty", "", ""), true);
});

test("ACPL first-time Yes shows cricket fields", () => {
  const store = makeStore();
  const form = buildAcplSeason6Form(store.tournaments[0], store);
  const values = { firstTimeAcpl: "Yes" };
  const { visible, required } = evaluateFieldState(form, values);
  assert.equal(visible.playerType, true);
  assert.equal(required.playerType, true);
  assert.equal(visible.battingStyle, true);
  assert.equal(visible.cricHeroesHas, true);
  assert.equal(visible.cricHeroesProfile, false);
});

test("CricHeroes Yes shows profile and required", () => {
  const store = makeStore();
  const form = buildAcplSeason6Form(store.tournaments[0], store);
  const values = { firstTimeAcpl: "Yes", cricHeroesHas: "Yes" };
  const { visible, required } = evaluateFieldState(form, values);
  assert.equal(visible.cricHeroesProfile, true);
  assert.equal(required.cricHeroesProfile, true);
});

test("CricHeroes No hides profile", () => {
  const store = makeStore();
  const form = buildAcplSeason6Form(store.tournaments[0], store);
  const values = { firstTimeAcpl: "Yes", cricHeroesHas: "No" };
  const { visible } = evaluateFieldState(form, values);
  assert.equal(visible.cricHeroesProfile, false);
});

test("Owner shows flat and relation", () => {
  const store = makeStore();
  const form = buildAcplSeason6Form(store.tournaments[0], store);
  const { visible, required } = evaluateFieldState(form, { arcusRelation: "Owner" });
  assert.equal(visible.flatNumber, true);
  assert.equal(required.flatNumber, true);
  assert.equal(visible.relationWithOwner, true);
  assert.equal(visible.bloodRelativeProof, false);
  assert.equal(visible.rentalAgreement, false);
});

test("Blood relative shows proof", () => {
  const store = makeStore();
  const form = buildAcplSeason6Form(store.tournaments[0], store);
  const { visible, required } = evaluateFieldState(form, { arcusRelation: "1st Blood Relative of Owner" });
  assert.equal(visible.bloodRelativeProof, true);
  assert.equal(required.bloodRelativeProof, true);
});

test("Tenant shows rental agreement", () => {
  const store = makeStore();
  const form = buildAcplSeason6Form(store.tournaments[0], store);
  const { visible, required } = evaluateFieldState(form, { arcusRelation: "Tenant" });
  assert.equal(visible.rentalAgreement, true);
  assert.equal(required.rentalAgreement, true);
});

test("Payment bank / upi / other conditionals", () => {
  const store = makeStore();
  const form = buildAcplSeason6Form(store.tournaments[0], store);
  let s = evaluateFieldState(form, { paymentPreference: "Bank Transfer" });
  assert.equal(s.visible.bankInfo, true);
  assert.equal(s.visible.bankProof, true);
  assert.equal(s.required.bankProof, true);
  assert.equal(s.visible.upiProof, false);

  s = evaluateFieldState(form, { paymentPreference: "UPI" });
  assert.equal(s.visible.upiInfo, true);
  assert.equal(s.visible.upiProof, true);
  assert.equal(s.required.upiProof, true);
  assert.equal(s.visible.bankProof, false);

  s = evaluateFieldState(form, { paymentPreference: "Other" });
  assert.equal(s.visible.otherPaymentMode, true);
  assert.equal(s.required.otherPaymentMode, true);
});

test("detectCircularRules finds cycles", () => {
  const form = {
    rules: [
      { sourceKey: "a", operator: "equals", value: "1", targetKey: "b" },
      { sourceKey: "b", operator: "equals", value: "1", targetKey: "a" }
    ]
  };
  const r = detectCircularRules(form);
  assert.equal(r.ok, false);
});

test("hidden required fields are not validated", () => {
  const store = makeStore();
  const form = buildAcplSeason6Form(store.tournaments[0], store);
  // Minimal visible required fields only — payment UPI so bankProof must not be required
  const values = {
    playerName: "Test Player",
    mobile: "9876543210",
    dob: "2000-01-01",
    category: "Men's",
    jerseySize: "40",
    firstTimeAcpl: "No",
    auctionRepresent: "No",
    arcusRelation: "Owner",
    flatNumber: "A1",
    relationWithOwner: "Self",
    paymentPreference: "UPI"
  };
  const fileIds = { playerPhoto: "file1", upiProof: "file2" };
  const result = validateSubmission(form, values, fileIds);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.errors.bankProof, undefined);
});

async function seedOpenForm(store, capacity = 5) {
  const form = createForm(store, { tournamentId: store.tournaments[0].id, template: "acpl6" });
  form.capacity = capacity;
  form.useCategoryCapacity = false;
  form.payment.bank.accountNumber = "123";
  form.payment.bank.accountName = "ACPL";
  form.payment.bank.ifsc = "IFSC";
  form.payment.bank.bankName = "Bank";
  setFormStatus(store, form.id, "open");
  return form;
}

function baseValues(i) {
  return {
    playerName: `Player ${i}`,
    mobile: `90000000${String(i).padStart(2, "0")}`.slice(0, 10),
    dob: "1995-05-05",
    category: "Men's",
    jerseySize: "42",
    firstTimeAcpl: "No",
    auctionRepresent: "No",
    arcusRelation: "Owner",
    flatNumber: "B2",
    relationWithOwner: "Self",
    paymentPreference: "Other",
    otherPaymentMode: "Cash"
  };
}

test("waiting list: capacity 5 then promote after cancel", async () => {
  const prevCwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reg-test-"));
  process.chdir(tmp);
  fs.mkdirSync(path.join(tmp, "public", "uploads"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "data", "private-uploads"), { recursive: true });

  try {
    const store = makeStore();
    const form = await seedOpenForm(store, 5);

    const results = [];
    for (let i = 1; i <= 6; i++) {
      const photo = {
        id: uid(),
        formId: form.id,
        fieldKey: "playerPhoto",
        registrationId: null,
        playerId: null,
        originalFilename: "p.png",
        storedFilename: `${uid()}.png`,
        mimeType: "image/png",
        fileSize: 10,
        storagePath: `${uid()}.png`,
        uploadedAt: Date.now()
      };
      // write empty private file path referenced
      fs.writeFileSync(path.join(tmp, "data", "private-uploads", photo.storedFilename), Buffer.from("x"));
      // registration module uses PRIVATE_UPLOAD_DIR relative to server folder, not cwd —
      // so for materialize photo we pass saveUpload that returns a fake url
      store.registrationFiles.push(photo);
      const out = await submitRegistration(
        store,
        { token: form.publicToken, values: baseValues(i), fileIds: { playerPhoto: photo.id } },
        { saveUploadFn: () => `/uploads/fake-${i}.png` }
      );
      results.push(out.registration);
    }

    assert.equal(results.filter((r) => r.status === "registered").length, 5);
    assert.equal(results[5].status, "waiting");
    assert.equal(results[5].waitingPosition, 1);
    assert.equal(results[5].sequence, 6);

    const waitingId = store.registrations.find((r) => r.sequence === 6).id;
    const cancelId = store.registrations.find((r) => r.sequence === 3).id;
    const seq6Before = store.registrations.find((r) => r.sequence === 6);
    const ts = seq6Before.registeredAt;
    const rid = seq6Before.registrationId;

    await updateRegistrationStatus(store, cancelId, "cancelled", "admin");

    const promoted = store.registrations.find((r) => r.id === waitingId);
    assert.equal(promoted.status, "registered");
    assert.equal(promoted.sequence, 6);
    assert.equal(promoted.registeredAt, ts);
    assert.equal(promoted.registrationId, rid);
    assert.equal(promoted.waitingPosition, null);
  } finally {
    process.chdir(prevCwd);
  }
});

test("concurrent submissions never overflow capacity", async () => {
  const store = makeStore();
  const form = await seedOpenForm(store, 5);

  const jobs = [];
  for (let i = 1; i <= 10; i++) {
    const photo = {
      id: uid(),
      formId: form.id,
      fieldKey: "playerPhoto",
      registrationId: null,
      playerId: null,
      originalFilename: "p.png",
      storedFilename: `${uid()}.png`,
      mimeType: "image/png",
      fileSize: 10,
      storagePath: "x.png",
      uploadedAt: Date.now()
    };
    store.registrationFiles.push(photo);
    jobs.push(
      submitRegistration(
        store,
        { token: form.publicToken, values: baseValues(i + 20), fileIds: { playerPhoto: photo.id } },
        { saveUploadFn: () => `/uploads/x.png` }
      )
    );
  }
  const settled = await Promise.all(jobs);
  const registered = settled.filter((r) => r.registration.status === "registered");
  const waiting = settled.filter((r) => r.registration.status === "waiting");
  assert.equal(registered.length, 5);
  assert.equal(waiting.length, 5);
  const seqs = settled.map((r) => r.registration.sequence);
  assert.equal(new Set(seqs).size, 10);
});
