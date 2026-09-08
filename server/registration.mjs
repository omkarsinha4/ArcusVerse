import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { uid } from "./store.mjs";
import { buildAcplSeason6Form, blankRegistrationForm, normalizePublicSlug, suggestPublicSlug } from "./registration-template-acpl6.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PRIVATE_UPLOAD_DIR = path.join(__dirname, "..", "data", "private-uploads");

let chain = Promise.resolve();

/** Serialize critical registration mutations in-process. */
export function withRegLock(fn) {
  const run = chain.then(() => fn());
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function ensureCollections(store) {
  store.registrationForms ||= [];
  store.registrations ||= [];
  store.registrationFiles ||= [];
  store.registrationAudits ||= [];
  store.meta ||= {};
  if (!store.meta.regFileSecret) store.meta.regFileSecret = randomBytes(32).toString("hex");
}

export function migrateRegistration(store) {
  ensureCollections(store);
  store.tournaments = (store.tournaments || []).map((t) => ({
    logo: "",
    ...t,
    logo: t.logo || ""
  }));
  store.registrationForms = (store.registrationForms || []).map((f) => {
    const tournament = (store.tournaments || []).find((t) => t.id === f.tournamentId);
    let publicSlug = normalizePublicSlug(f.publicSlug);
    if (!publicSlug) publicSlug = suggestPublicSlug(tournament, { idPrefix: f.idPrefix });
    // Ensure uniqueness among forms
    const taken = new Set(
      (store.registrationForms || [])
        .filter((x) => x.id !== f.id)
        .map((x) => String(x.publicSlug || "").toLowerCase())
        .filter(Boolean)
    );
    let candidate = publicSlug;
    let n = 2;
    while (taken.has(candidate.toLowerCase())) {
      candidate = `${publicSlug}-${n++}`.slice(0, 64);
    }
    return { ...f, publicSlug: candidate };
  });
  return store;
}

function audit(store, registrationId, action, oldValue, newValue, performedBy) {
  store.registrationAudits.push({
    id: uid(),
    registrationId,
    action,
    oldValue: oldValue ?? null,
    newValue: newValue ?? null,
    performedBy: performedBy || "system",
    performedAt: Date.now()
  });
}

export function compareOp(operator, left, right) {
  const L = left == null ? "" : String(left);
  const R = right == null ? "" : String(right);
  switch (operator) {
    case "equals":
      return L === R;
    case "notEquals":
      return L !== R;
    case "contains":
      return L.toLowerCase().includes(R.toLowerCase());
    case "doesNotContain":
      return !L.toLowerCase().includes(R.toLowerCase());
    case "greaterThan":
      return Number(L) > Number(R);
    case "lessThan":
      return Number(L) < Number(R);
    case "isEmpty":
      return L.trim() === "";
    case "isNotEmpty":
      return L.trim() !== "";
    default:
      return false;
  }
}

function ruleMatches(rule, values) {
  if (rule.alsoRequireSource) {
    const src = values[rule.alsoRequireSource.key];
    if (String(src) !== String(rule.alsoRequireSource.value)) return false;
  }
  return compareOp(rule.operator, values[rule.sourceKey], rule.value);
}

/** Visibility + required overrides from conditional rules. */
export function evaluateFieldState(form, values) {
  const fields = (form.fields || []).filter((f) => f.enabled !== false && f.fieldType !== "section");
  const rules = form.rules || [];
  const targets = new Set(rules.map((r) => r.targetKey));
  const visible = {};
  const required = {};

  for (const f of fields) {
    const isTarget = targets.has(f.key);
    visible[f.key] = isTarget ? false : true;
    required[f.key] = !!f.required;
  }

  // Group rules by target; within a group OR of matching groups named, default AND for same target
  const byTarget = new Map();
  for (const r of rules) {
    if (!byTarget.has(r.targetKey)) byTarget.set(r.targetKey, []);
    byTarget.get(r.targetKey).push(r);
  }

  for (const [targetKey, list] of byTarget) {
    const groups = new Map();
    for (const r of list) {
      const g = r.groupId || r.group || "default";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(r);
    }
    // OR across groups, AND within group
    let show = false;
    let makeReq = false;
    for (const [, groupRules] of groups) {
      const allMatch = groupRules.every((r) => ruleMatches(r, values));
      if (allMatch) {
        show = true;
        if (groupRules.some((r) => r.makeRequired || r.action === "require")) makeReq = true;
      }
    }
    if (show) {
      visible[targetKey] = true;
      if (makeReq) required[targetKey] = true;
    } else {
      visible[targetKey] = false;
      required[targetKey] = false;
    }
  }

  return { visible, required };
}

export function detectCircularRules(form) {
  const edges = new Map();
  for (const r of form.rules || []) {
    if (!edges.has(r.targetKey)) edges.set(r.targetKey, new Set());
    edges.get(r.targetKey).add(r.sourceKey);
  }
  const visiting = new Set();
  const visited = new Set();
  const cycle = [];

  function dfs(node) {
    if (visiting.has(node)) {
      cycle.push(node);
      return true;
    }
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of edges.get(node) || []) {
      if (dfs(next)) {
        cycle.push(node);
        return true;
      }
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  }

  for (const key of edges.keys()) {
    if (dfs(key)) return { ok: false, cycle: [...new Set(cycle)].reverse() };
  }
  return { ok: true };
}

export function validateFormForOpen(form) {
  const errors = [];
  if (!String(form.title || "").trim()) errors.push("Form title is required");
  const enabled = (form.fields || []).filter((f) => f.enabled !== false && f.fieldType !== "section" && f.fieldType !== "info");
  if (!enabled.length) errors.push("At least one enabled field is required");
  if (!(Number(form.capacity) > 0)) errors.push("Capacity must be greater than 0");
  const circ = detectCircularRules(form);
  if (!circ.ok) errors.push(`Circular conditional rules: ${circ.cycle.join(" → ")}`);
  const paymentFields = enabled.some((f) => ["paymentPreference", "bankProof", "upiProof"].includes(f.key));
  if (paymentFields) {
    const bank = form.payment?.bank || {};
    const upi = form.payment?.upi || {};
    if (!bank.accountNumber && !upi.upiId) {
      errors.push("Configure bank or UPI payment details before opening");
    }
  }
  const catField = (form.fields || []).find((f) => f.key === "category" && f.enabled !== false);
  if (catField && !(catField.options || []).length) errors.push("Category options are required");
  return errors;
}

function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

function ageFromDob(dob, at = new Date()) {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  let age = at.getFullYear() - d.getFullYear();
  const m = at.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < d.getDate())) age -= 1;
  return age;
}

export function validateSubmission(form, values, fileIds) {
  const errors = {};
  const { visible, required } = evaluateFieldState(form, values);
  const fields = (form.fields || []).filter((f) => f.enabled !== false);

  for (const f of fields) {
    if (f.fieldType === "section" || f.fieldType === "info") continue;
    if (!visible[f.key]) continue;
    const isFile = f.fieldType === "file" || f.fieldType === "image";
    const val = isFile ? fileIds?.[f.key] : values?.[f.key];
    const empty =
      val == null ||
      val === "" ||
      (Array.isArray(val) && !val.length);

    if (required[f.key] && empty) {
      errors[f.key] = `${f.label || f.key} is required`;
      continue;
    }
    if (empty) continue;

    if (f.fieldType === "phone") {
      const phone = normalizePhone(val);
      const pattern = f.validation?.pattern || "^[6-9]\\d{9}$";
      if (!new RegExp(pattern).test(phone)) {
        errors[f.key] = f.validation?.message || "Invalid mobile number";
      }
    }
    if (f.fieldType === "email") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(val))) errors[f.key] = "Invalid email";
    }
    if ((f.fieldType === "dropdown" || f.fieldType === "single") && (f.options || []).length) {
      if (!(f.options || []).includes(String(val))) errors[f.key] = "Invalid option";
    }
  }

  const dob = values.dob;
  const category = values.category;
  if (dob && category && form.ageRules?.[category]) {
    const age = ageFromDob(dob);
    const rule = form.ageRules[category];
    if (age != null) {
      if (rule.min != null && age < rule.min) errors.dob = `Minimum age for ${category} is ${rule.min}`;
      if (rule.max != null && age > rule.max) errors.dob = `Maximum age for ${category} is ${rule.max}`;
    }
  }

  return { ok: !Object.keys(errors).length, errors, visible, required };
}

/** Parse form schedule datetimes. Naive values (from datetime-local) are treated as IST. */
export function parseFormDateTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return NaN;
  // Already has timezone or Z
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(raw)) {
    const t = new Date(raw).getTime();
    return t;
  }
  // date only
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const iso = `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T00:00:00+05:30`;
    return new Date(iso).getTime();
  }
  // datetime-local: YYYY-MM-DDTHH:mm or with seconds
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const sec = m[6] || "00";
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${sec}+05:30`;
    return new Date(iso).getTime();
  }
  return new Date(raw).getTime();
}

function formIsAccepting(form, now = Date.now()) {
  if (form.status !== "open") {
    if (form.status === "draft") {
      return { ok: false, reason: "draft", message: "Registration for this tournament is currently closed." };
    }
    return { ok: false, reason: "closed", message: "Registration for this tournament is currently closed." };
  }
  if (form.opensAt) {
    const t = parseFormDateTime(form.opensAt);
    if (!Number.isNaN(t) && now < t) {
      return { ok: false, reason: "not_started", message: "Registration has not started yet." };
    }
  }
  if (form.closesAt) {
    const t = parseFormDateTime(form.closesAt);
    if (!Number.isNaN(t) && now > t) {
      return { ok: false, reason: "ended", message: "Registration is closed." };
    }
  }
  return { ok: true };
}

function activeStatuses() {
  return new Set(["registered", "waiting", "submitted", "under_review", "approved"]);
}

function findDuplicate(store, form, mobile, name) {
  const phone = normalizePhone(mobile);
  const active = activeStatuses();
  return (store.registrations || []).find((r) => {
    if (r.tournamentId !== form.tournamentId) return false;
    if (!active.has(r.status)) return false;
    const m = normalizePhone(r.values?.mobile);
    if (m && phone && m === phone) return r;
    return false;
  });
}

function nextSequence(store, tournamentId) {
  const seqs = (store.registrations || []).filter((r) => r.tournamentId === tournamentId).map((r) => r.sequence || 0);
  return (seqs.length ? Math.max(...seqs) : 0) + 1;
}

function formatRegId(prefix, sequence) {
  const p = String(prefix || "REG").replace(/-+$/, "");
  return `${p}-${String(sequence).padStart(4, "0")}`;
}

function categoryKey(values) {
  return String(values?.category || "").trim();
}

function countRegistered(store, form, category = null) {
  return (store.registrations || []).filter((r) => {
    if (r.formId !== form.id) return false;
    if (r.status !== "registered") return false;
    if (category != null) return categoryKey(r.values) === category;
    return true;
  }).length;
}

function capacityLimit(form, category) {
  if (form.useCategoryCapacity && category && form.categoryCapacity?.[category] != null) {
    return Number(form.categoryCapacity[category]);
  }
  return Number(form.capacity) || 0;
}

function recomputeWaitingPositions(store, form) {
  const waiting = (store.registrations || [])
    .filter((r) => r.formId === form.id && r.status === "waiting")
    .sort((a, b) => a.sequence - b.sequence);

  if (form.useCategoryCapacity) {
    const byCat = new Map();
    for (const r of waiting) {
      const c = categoryKey(r.values) || "_";
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c).push(r);
    }
    for (const [, list] of byCat) {
      list.forEach((r, i) => {
        r.waitingPosition = i + 1;
      });
    }
  } else {
    waiting.forEach((r, i) => {
      r.waitingPosition = i + 1;
    });
  }
}

function mapRoleFromValues(values) {
  if (values.playerType === "Batter") return "Batsman";
  if (values.playerType === "Bowler") return "Bowler";
  if (values.playerType === "All-rounder") return "All-Rounder";
  if (values.wicketkeeper === "Yes") return "Wicketkeeper";
  return "Player";
}

function resolveCategoryId(store, categoryLabel) {
  const label = String(categoryLabel || "").toLowerCase().replace(/['’]/g, "");
  const found = (store.categories || []).find((c) => {
    const n = String(c.name || "")
      .toLowerCase()
      .replace(/['’]/g, "");
    return n === label || n === label.replace(/s$/, "") || `${n}s` === label || n.startsWith(label.slice(0, 3));
  });
  return found?.id || store.categories[0]?.id;
}

function findOrCreatePlayer(store, form, values, fileMeta) {
  const phone = normalizePhone(values.mobile);
  const name = String(values.playerName || "").trim();
  let player =
    (store.players || []).find((p) => phone && normalizePhone(p.phone) === phone) ||
    (store.players || []).find(
      (p) => phone && normalizePhone(p.phone) === phone && String(p.name).toLowerCase() === name.toLowerCase()
    );

  const categoryId = resolveCategoryId(store, values.category);
  const tournament = store.tournaments.find((t) => t.id === form.tournamentId);
  const photoUrl = fileMeta?.publicPhotoUrl || "";

  if (player) {
    const tids = new Set(player.tournamentIds || []);
    tids.add(form.tournamentId);
    player.tournamentIds = [...tids];
    if (!player.phone && phone) player.phone = phone;
    if (form.photoPolicy === "keepExisting") {
      if (!player.photo && photoUrl) player.photo = photoUrl;
    } else if (photoUrl) {
      player.photo = photoUrl;
    }
    return player;
  }

  player = {
    id: uid(),
    name,
    photo: photoUrl || "",
    role: mapRoleFromValues(values),
    categoryId,
    sport: tournament?.sport || "Cricket",
    basePrice: 100,
    phone,
    teamId: null,
    assignment: "auction",
    tournamentIds: [form.tournamentId]
  };
  store.players.push(player);
  return player;
}

export function getFormByToken(store, tokenOrSlug) {
  ensureCollections(store);
  const key = String(tokenOrSlug || "").trim();
  if (!key) return null;
  const lower = key.toLowerCase();
  return (
    store.registrationForms.find((f) => f.publicToken === key) ||
    store.registrationForms.find((f) => String(f.publicSlug || "").toLowerCase() === lower) ||
    null
  );
}

export function formPublicPath(form) {
  if (!form) return "";
  return form.publicSlug || form.publicToken || "";
}

function assertUniqueSlug(store, slug, exceptFormId) {
  const normalized = normalizePublicSlug(slug);
  if (!normalized) throw new Error("Public URL slug is required");
  if (normalized.length < 2) throw new Error("Public URL slug is too short");
  const clash = store.registrationForms.find(
    (f) => f.id !== exceptFormId && String(f.publicSlug || "").toLowerCase() === normalized.toLowerCase()
  );
  if (clash) throw new Error(`Public URL slug "${normalized}" is already used by another form`);
  return normalized;
}

export function getFormByTournament(store, tournamentId) {
  ensureCollections(store);
  return store.registrationForms.find((f) => f.tournamentId === tournamentId) || null;
}

export function publicFormPayload(store, form) {
  const tournament = store.tournaments.find((t) => t.id === form.tournamentId);
  const teamIds = tournament?.teamIds || [];
  const teams = (store.teams || [])
    .filter((t) => teamIds.includes(t.id))
    .map((t) => ({ id: t.id, name: t.name }));

  const fields = (form.fields || []).map((f) => {
    if (f.config?.source === "tournamentTeams" && teams.length) {
      return { ...f, options: teams.map((t) => t.name) };
    }
    return f;
  });

  const accepting = formIsAccepting(form);
  return {
    form: {
      id: form.id,
      tournamentId: form.tournamentId,
      title: form.title,
      description: form.description,
      logo: form.logo || tournament?.logo || "",
      publicSlug: form.publicSlug || "",
      status: form.status,
      opensAt: form.opensAt,
      closesAt: form.closesAt,
      payment: form.payment,
      sections: form.sections,
      fields,
      rules: form.rules,
      version: form.version
    },
    tournament: tournament
      ? {
          id: tournament.id,
          name: tournament.name,
          sport: tournament.sport,
          venue: tournament.venue,
          logo: tournament.logo || ""
        }
      : null,
    accepting
  };
}

export function createForm(store, { tournamentId, template }) {
  ensureCollections(store);
  const tournament = store.tournaments.find((t) => t.id === tournamentId);
  if (!tournament) throw new Error("Tournament not found");
  if (getFormByTournament(store, tournamentId)) throw new Error("Registration form already exists for this tournament");

  const form =
    template === "blank" ? blankRegistrationForm(tournament) : buildAcplSeason6Form(tournament, store);
  store.registrationForms.push(form);
  return form;
}

/** Remove a form so a new one can be created. Blocks if registrations exist unless force=true. */
export function deleteForm(store, formId, { force = false } = {}) {
  ensureCollections(store);
  const i = store.registrationForms.findIndex((f) => f.id === formId);
  if (i < 0) throw new Error("Form not found");
  const form = store.registrationForms[i];
  const regCount = (store.registrations || []).filter((r) => r.formId === formId).length;
  if (regCount > 0 && !force) {
    throw new Error(
      `This form has ${regCount} registration(s). Confirm force delete to remove the form and its registrations.`
    );
  }
  if (force && regCount > 0) {
    const regIds = new Set(
      (store.registrations || []).filter((r) => r.formId === formId).map((r) => r.id)
    );
    store.registrations = (store.registrations || []).filter((r) => r.formId !== formId);
    store.registrationAudits = (store.registrationAudits || []).filter((a) => !regIds.has(a.registrationId));
    store.registrationFiles = (store.registrationFiles || []).filter((f) => f.formId !== formId);
  }
  store.registrationForms.splice(i, 1);
  return { deletedId: form.id, tournamentId: form.tournamentId, removedRegistrations: force ? regCount : 0 };
}

/** Delete existing form (if any) and create a fresh template for the tournament. */
export function recreateForm(store, { tournamentId, template, force = false }) {
  ensureCollections(store);
  const existing = getFormByTournament(store, tournamentId);
  if (existing) {
    deleteForm(store, existing.id, { force });
  }
  return createForm(store, { tournamentId, template: template || "acpl6" });
}

export function upsertForm(store, patch) {
  ensureCollections(store);
  const i = store.registrationForms.findIndex((f) => f.id === patch.id);
  if (i < 0) throw new Error("Form not found");
  const prev = store.registrationForms[i];
  const tournament = store.tournaments.find((t) => t.id === prev.tournamentId);
  const next = {
    ...prev,
    ...patch,
    id: prev.id,
    tournamentId: prev.tournamentId,
    publicToken: prev.publicToken,
    version: Number(prev.version || 1) + (patch.bumpVersion ? 1 : 0),
    updatedAt: Date.now()
  };
  delete next.bumpVersion;
  if (patch.publicSlug != null) {
    next.publicSlug = assertUniqueSlug(store, patch.publicSlug, prev.id);
  } else if (!next.publicSlug) {
    next.publicSlug = assertUniqueSlug(store, suggestPublicSlug(tournament, { idPrefix: next.idPrefix }), prev.id);
  }
  if (!next.logo && tournament?.logo) next.logo = tournament.logo;
  // Keep tournament logo aligned when form logo is set
  if (next.logo && tournament && !tournament.logo) {
    tournament.logo = next.logo;
  }
  if (Array.isArray(patch.fields) && patch.fields !== prev.fields) {
    next.fieldHistory = [...(prev.fieldHistory || []), { version: prev.version, fields: prev.fields, at: Date.now() }].slice(
      -20
    );
  }
  store.registrationForms[i] = next;
  return next;
}

export function setFormStatus(store, formId, status) {
  const form = store.registrationForms.find((f) => f.id === formId);
  if (!form) throw new Error("Form not found");
  if (status === "open") {
    const errors = validateFormForOpen(form);
    if (errors.length) throw new Error(errors.join("; "));
    // Manual Open starts registration immediately — don't leave a future opensAt blocking the public form.
    if (form.opensAt) {
      const t = parseFormDateTime(form.opensAt);
      if (!Number.isNaN(t) && t > Date.now()) {
        form.opensAt = "";
      }
    }
  }
  if (!["draft", "open", "closed"].includes(status)) throw new Error("Invalid status");
  form.status = status;
  form.updatedAt = Date.now();
  return form;
}

function sniffMime(buf, filename) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf.toString("ascii", 0, 4) === "RIFF") return "image/webp";
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "application/pdf";
  const ext = String(filename || "")
    .split(".")
    .pop()
    ?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "pdf") return "application/pdf";
  return "application/octet-stream";
}

export function savePrivateUpload(store, { dataUrl, filename, fieldKey, formId, maxBytes, allowedMime }) {
  ensureCollections(store);
  fs.mkdirSync(PRIVATE_UPLOAD_DIR, { recursive: true });
  const match = String(dataUrl).match(/^data:(.+);base64,(.+)$/);
  if (!match) throw new Error("Invalid file data");
  const buf = Buffer.from(match[2], "base64");
  if (maxBytes && buf.length > maxBytes) throw new Error("File too large");
  const mime = sniffMime(buf, filename);
  if (allowedMime?.length && !allowedMime.includes(mime)) throw new Error(`File type not allowed (${mime})`);

  const ext =
    mime === "image/jpeg"
      ? "jpg"
      : mime === "image/png"
        ? "png"
        : mime === "image/webp"
          ? "webp"
          : mime === "application/pdf"
            ? "pdf"
            : "bin";
  const stored = `${randomBytes(16).toString("hex")}.${ext}`;
  fs.writeFileSync(path.join(PRIVATE_UPLOAD_DIR, stored), buf);
  const file = {
    id: uid(),
    formId,
    fieldKey,
    registrationId: null,
    playerId: null,
    originalFilename: filename || stored,
    storedFilename: stored,
    mimeType: mime,
    fileSize: buf.length,
    storagePath: stored,
    uploadedAt: Date.now()
  };
  store.registrationFiles.push(file);
  return file;
}

/** Copy player photo into public uploads for auction UI when registering. */
export function materializePlayerPhoto(store, file, saveUploadFn) {
  if (!file) return "";
  const abs = path.join(PRIVATE_UPLOAD_DIR, file.storedFilename);
  if (!fs.existsSync(abs)) return "";
  const buf = fs.readFileSync(abs);
  const b64 = buf.toString("base64");
  const dataUrl = `data:${file.mimeType};base64,${b64}`;
  return saveUploadFn(dataUrl, file.originalFilename || "photo.jpg");
}

export async function submitRegistration(store, { token, values, fileIds }, { saveUploadFn, performedBy } = {}) {
  return withRegLock(() => {
    ensureCollections(store);
    const form = getFormByToken(store, token);
    if (!form) throw new Error("Registration form not found");
    const accepting = formIsAccepting(form);
    if (!accepting.ok) throw new Error(accepting.message);

    const cleanValues = { ...(values || {}) };
    const cleanFiles = { ...(fileIds || {}) };
    const { visible } = evaluateFieldState(form, cleanValues);
    for (const key of Object.keys(cleanValues)) {
      if (visible[key] === false) delete cleanValues[key];
    }
    for (const key of Object.keys(cleanFiles)) {
      if (visible[key] === false) delete cleanFiles[key];
    }

    const validation = validateSubmission(form, cleanValues, cleanFiles);
    if (!validation.ok) {
      const err = new Error("Validation failed");
      err.validation = validation.errors;
      throw err;
    }

    const dup = findDuplicate(store, form, cleanValues.mobile, cleanValues.playerName);
    if (dup) {
      const err = new Error(
        `A registration already exists for this tournament. Registration ID: ${dup.registrationId}. Status: ${dup.status}`
      );
      err.duplicate = dup;
      throw err;
    }

    // Verify file ids belong to this form and are unused
    for (const [key, fid] of Object.entries(cleanFiles)) {
      const file = store.registrationFiles.find((f) => f.id === fid);
      if (!file || file.formId !== form.id) throw new Error(`Invalid upload for ${key}`);
      if (file.registrationId) throw new Error(`Upload already used for ${key}`);
    }

    const registeredAt = Date.now();
    const sequence = nextSequence(store, form.tournamentId);
    const registrationId = formatRegId(form.idPrefix, sequence);
    const cat = categoryKey(cleanValues);
    const limit = capacityLimit(form, cat);
    const used = form.useCategoryCapacity ? countRegistered(store, form, cat) : countRegistered(store, form);
    let status = "registered";
    let waitingPosition = null;
    if (limit > 0 && used >= limit) {
      status = "waiting";
    }

    let publicPhotoUrl = "";
    if (cleanFiles.playerPhoto && saveUploadFn) {
      const photoFile = store.registrationFiles.find((f) => f.id === cleanFiles.playerPhoto);
      publicPhotoUrl = materializePlayerPhoto(store, photoFile, saveUploadFn);
    }

    const player = findOrCreatePlayer(store, form, cleanValues, { publicPhotoUrl });

    const registration = {
      id: uid(),
      registrationId,
      tournamentId: form.tournamentId,
      formId: form.id,
      formVersion: form.version,
      playerId: player.id,
      registrationSequence: sequence,
      sequence,
      registeredAt,
      status,
      waitingPosition,
      paymentStatus: "pending",
      values: cleanValues,
      fileIds: cleanFiles,
      createdAt: registeredAt,
      updatedAt: registeredAt
    };
    store.registrations.push(registration);

    for (const fid of Object.values(cleanFiles)) {
      const file = store.registrationFiles.find((f) => f.id === fid);
      if (file) {
        file.registrationId = registration.id;
        file.playerId = player.id;
      }
    }

    recomputeWaitingPositions(store, form);

    audit(store, registration.id, "submitted", null, { status, sequence, registrationId }, performedBy || "public");
    audit(store, registration.id, "sequence_assigned", null, sequence, "system");
    if (status === "waiting") {
      audit(store, registration.id, "waiting_list", null, registration.waitingPosition, "system");
    } else {
      audit(store, registration.id, "registered", null, status, "system");
    }

    return {
      registration: {
        registrationId: registration.registrationId,
        sequence: registration.sequence,
        registeredAt: registration.registeredAt,
        status: registration.status,
        waitingPosition: registration.waitingPosition,
        tournamentName: store.tournaments.find((t) => t.id === form.tournamentId)?.name || ""
      }
    };
  });
}

export function promoteNextWaiting(store, form, category, performedBy) {
  const waiting = (store.registrations || [])
    .filter((r) => {
      if (r.formId !== form.id || r.status !== "waiting") return false;
      if (form.useCategoryCapacity && category) return categoryKey(r.values) === category;
      return true;
    })
    .sort((a, b) => a.sequence - b.sequence);
  const next = waiting[0];
  if (!next) return null;
  const old = next.status;
  next.status = "registered";
  next.waitingPosition = null;
  next.updatedAt = Date.now();
  audit(store, next.id, "promoted", old, "registered", performedBy || "system");
  recomputeWaitingPositions(store, form);
  return next;
}

export function updateRegistrationStatus(store, registrationId, status, performedBy, { confirmPromote } = {}) {
  return withRegLock(() => {
    ensureCollections(store);
    const reg = store.registrations.find((r) => r.id === registrationId || r.registrationId === registrationId);
    if (!reg) throw new Error("Registration not found");
    const form = store.registrationForms.find((f) => f.id === reg.formId);
    if (!form) throw new Error("Form not found");

    const allowed = ["registered", "waiting", "cancelled", "rejected", "approved", "under_review"];
    if (!allowed.includes(status)) throw new Error("Invalid status");

    if (status === "registered" && reg.status === "waiting") {
      if (!confirmPromote) throw new Error("Confirmation required to promote");
    }

    const old = reg.status;
    const wasRegistered = old === "registered";
    reg.status = status;
    reg.updatedAt = Date.now();
    if (status !== "waiting") reg.waitingPosition = null;
    audit(store, reg.id, "status_changed", old, status, performedBy || "admin");

    if (wasRegistered && (status === "cancelled" || status === "rejected")) {
      promoteNextWaiting(store, form, categoryKey(reg.values), performedBy || "system");
    }
    recomputeWaitingPositions(store, form);
    return reg;
  });
}

export function setPaymentStatus(store, registrationId, paymentStatus, performedBy) {
  ensureCollections(store);
  const reg = store.registrations.find((r) => r.id === registrationId || r.registrationId === registrationId);
  if (!reg) throw new Error("Registration not found");
  if (!["pending", "verified", "rejected"].includes(paymentStatus)) throw new Error("Invalid payment status");
  const old = reg.paymentStatus;
  reg.paymentStatus = paymentStatus;
  reg.updatedAt = Date.now();
  audit(store, reg.id, "payment_status", old, paymentStatus, performedBy || "admin");
  return reg;
}

export function dashboardForForm(store, formId) {
  ensureCollections(store);
  const form = store.registrationForms.find((f) => f.id === formId);
  if (!form) throw new Error("Form not found");
  const regs = store.registrations.filter((r) => r.formId === formId);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const byCategory = {};
  const byStatus = {};
  const byPayment = {};
  for (const r of regs) {
    const c = categoryKey(r.values) || "—";
    byCategory[c] = (byCategory[c] || 0) + 1;
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    byPayment[r.paymentStatus || "pending"] = (byPayment[r.paymentStatus || "pending"] || 0) + 1;
  }
  const registered = byStatus.registered || 0;
  const waiting = byStatus.waiting || 0;
  const capacity = Number(form.capacity) || 0;
  return {
    total: regs.length,
    registered,
    waiting,
    availableSlots: Math.max(0, capacity - registered),
    today: regs.filter((r) => r.registeredAt >= todayStart.getTime()).length,
    byCategory,
    byStatus,
    byPayment,
    capacity,
    useCategoryCapacity: !!form.useCategoryCapacity,
    categoryCapacity: form.categoryCapacity || {}
  };
}

export function listRegistrations(store, formId, { status } = {}) {
  ensureCollections(store);
  return store.registrations
    .filter((r) => r.formId === formId && (!status || r.status === status))
    .sort((a, b) => a.sequence - b.sequence)
    .map((r) => ({
      ...r,
      playerName: r.values?.playerName || store.players.find((p) => p.id === r.playerId)?.name || "",
      mobile: r.values?.mobile || "",
      category: r.values?.category || ""
    }));
}

export function exportCsv(store, formId) {
  const rows = listRegistrations(store, formId);
  const headers = [
    "Registration ID",
    "Sequence",
    "Registered At",
    "Player Name",
    "Mobile",
    "Date of Birth",
    "Category",
    "Jersey Name/Number",
    "Jersey Size",
    "Player Type",
    "Batting Style",
    "Bowling Style",
    "Wicketkeeper",
    "CricHeroes",
    "Auction Team",
    "Arcus Relationship",
    "Payment Preference",
    "Payment Status",
    "Registration Status",
    "Waiting Position"
  ];
  const escape = (v) => {
    const s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    const v = r.values || {};
    lines.push(
      [
        r.registrationId,
        r.sequence,
        new Date(r.registeredAt).toISOString(),
        v.playerName,
        v.mobile,
        v.dob,
        v.category,
        v.jerseyNameNumber,
        v.jerseySize,
        v.playerType,
        v.battingStyle,
        v.bowlingStyle,
        v.wicketkeeper,
        v.cricHeroesProfile || v.cricHeroesHas,
        v.auctionTeam,
        v.arcusRelation,
        v.paymentPreference,
        r.paymentStatus,
        r.status,
        r.waitingPosition ?? ""
      ]
        .map(escape)
        .join(",")
    );
  }
  return lines.join("\n");
}

export function signFileAccess(store, fileId, ttlMs = 15 * 60 * 1000) {
  ensureCollections(store);
  const exp = Date.now() + ttlMs;
  const payload = `${fileId}.${exp}`;
  const sig = createHmac("sha256", store.meta.regFileSecret).update(payload).digest("hex");
  return { exp, sig };
}

export function verifyFileAccess(store, fileId, exp, sig) {
  ensureCollections(store);
  if (!exp || !sig) return false;
  if (Number(exp) < Date.now()) return false;
  const payload = `${fileId}.${exp}`;
  const expected = createHmac("sha256", store.meta.regFileSecret).update(payload).digest("hex");
  try {
    const a = Buffer.from(String(sig));
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function getPrivateFile(store, fileId) {
  ensureCollections(store);
  const file = store.registrationFiles.find((f) => f.id === fileId);
  if (!file) return null;
  const abs = path.join(PRIVATE_UPLOAD_DIR, file.storedFilename);
  if (!fs.existsSync(abs)) return null;
  return { file, abs };
}

export function registrationAdminState(store) {
  ensureCollections(store);
  return {
    forms: store.registrationForms,
    registrations: store.registrations.map((r) => ({
      id: r.id,
      registrationId: r.registrationId,
      tournamentId: r.tournamentId,
      formId: r.formId,
      formVersion: r.formVersion,
      playerId: r.playerId,
      sequence: r.sequence,
      registeredAt: r.registeredAt,
      status: r.status,
      waitingPosition: r.waitingPosition,
      paymentStatus: r.paymentStatus,
      values: r.values,
      fileIds: r.fileIds,
      playerName: r.values?.playerName || "",
      mobile: r.values?.mobile || "",
      category: r.values?.category || ""
    })),
    audits: store.registrationAudits.slice(-500)
  };
}
