"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Field, FilePick, Select } from "@/components/ui";
import { DynamicForm } from "@/components/registration/DynamicForm";
import { useApp } from "@/components/Providers";

const TABS = ["Dashboard", "Form builder", "Settings", "Preview", "Registrations", "Waiting list"] as const;

const FIELD_TYPES = [
  "text",
  "paragraph",
  "number",
  "phone",
  "email",
  "date",
  "dropdown",
  "single",
  "yesno",
  "file",
  "image",
  "url",
  "info"
];

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="neu-sm px-4 py-3">
      <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--muted)" }}>
        {label}
      </p>
      <p className="font-display text-3xl">{value}</p>
    </div>
  );
}

function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full" style={{ background: "color-mix(in srgb, var(--ink) 10%, transparent)" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--accent)" }} />
      </div>
    </div>
  );
}

export function RegistrationPanel({ admin, emit }: any) {
  const { hello } = useApp();
  const forms = admin.registration?.forms || [];
  const tournaments = admin.tournaments || [];
  const [tournamentId, setTournamentId] = useState(tournaments[0]?.id || "");
  const [tab, setTab] = useState<(typeof TABS)[number]>("Dashboard");
  const [dashboard, setDashboard] = useState<any>(null);
  const [selectedReg, setSelectedReg] = useState<any>(null);
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<any>(null);
  const [selectedFieldKey, setSelectedFieldKey] = useState("");

  const form = useMemo(() => forms.find((f: any) => f.tournamentId === tournamentId) || null, [forms, tournamentId]);

  useEffect(() => {
    if (!tournamentId && tournaments[0]?.id) setTournamentId(tournaments[0].id);
  }, [tournaments, tournamentId]);

  useEffect(() => {
    if (form) {
      const tour = tournaments.find((t: any) => t.id === form.tournamentId);
      const next = JSON.parse(JSON.stringify(form));
      if (!next.logo && tour?.logo) next.logo = tour.logo;
      setDraft(next);
      setSelectedFieldKey(form.fields?.[0]?.key || "");
    } else {
      setDraft(null);
    }
  }, [form?.id, form?.updatedAt, form?.logo, tournamentId]);

  useEffect(() => {
    if (!form?.id || tab !== "Dashboard") return;
    emit("reg-dashboard", { formId: form.id }).then((res: any) => {
      if (res.ok) setDashboard(res.dashboard);
    });
  }, [form?.id, tab, admin.registration?.registrations?.length]);

  const regs = useMemo(() => {
    const all = (admin.registration?.registrations || []).filter((r: any) => r.formId === form?.id);
    return all
      .filter((r: any) => !filterStatus || r.status === filterStatus)
      .filter((r: any) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (
          String(r.registrationId).toLowerCase().includes(q) ||
          String(r.playerName || r.values?.playerName || "")
            .toLowerCase()
            .includes(q) ||
          String(r.mobile || r.values?.mobile || "").includes(q)
        );
      })
      .sort((a: any, b: any) => a.sequence - b.sequence);
  }, [admin.registration, form?.id, filterStatus, search]);

  const waiting = regs.filter((r: any) => r.status === "waiting");

  const baseUrl = hello?.appUrl || (typeof window !== "undefined" ? window.location.origin : "");
  const publicPath = form?.publicSlug || form?.publicToken;
  const publicUrl = publicPath ? `${baseUrl}/register/${publicPath}` : "";

  const refreshAdmin = (res: any) => {
    if (res?.admin) {
      // AdminGate listens to admin-state; also merge via emit login path — socket wrap returns admin
    }
    if (!res?.ok) throw new Error(res?.error || "Failed");
    return res;
  };

  const createForm = async (template: string) => {
    setBusy(true);
    setMsg("");
    try {
      const res = await emit("reg-create-form", { tournamentId, template });
      refreshAdmin(res);
      setMsg("Registration form created");
      setTab("Settings");
    } catch (e: any) {
      setMsg(e.message || "Could not create form");
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await emit("reg-upsert-form", { ...draft, bumpVersion: true });
      refreshAdmin(res);
      setMsg("Form saved");
    } catch (e: any) {
      setMsg(e.message || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status: string) => {
    if (!form) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await emit("reg-set-status", { formId: form.id, status });
      refreshAdmin(res);
      setMsg(`Form marked ${status}`);
    } catch (e: any) {
      setMsg(e.message || "Status change failed");
    } finally {
      setBusy(false);
    }
  };

  const deleteCurrentForm = async () => {
    if (!form) return;
    const regCount = (admin.registration?.registrations || []).filter((r: any) => r.formId === form.id).length;
    const ok = window.confirm(
      regCount
        ? `Delete this registration form and ${regCount} registration(s)?\nYou can create a new form afterward.`
        : "Delete this registration form?\nYou can create a new form afterward."
    );
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await emit("reg-delete-form", { formId: form.id, force: regCount > 0 });
      if (!res.ok) throw new Error(res.error || "Delete failed");
      setDraft(null);
      setSelectedReg(null);
      setDashboard(null);
      setMsg("Form deleted — create a new one below");
      setTab("Dashboard");
    } catch (e: any) {
      setMsg(e.message || "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  const recreateCurrentForm = async (template: string) => {
    if (!tournamentId) return;
    const regCount = form
      ? (admin.registration?.registrations || []).filter((r: any) => r.formId === form.id).length
      : 0;
    const ok = window.confirm(
      regCount
        ? `Replace the current form with a ${template === "blank" ? "blank" : "ACPL"} template and remove ${regCount} registration(s)?`
        : `Replace the current form with a ${template === "blank" ? "blank" : "ACPL"} template?`
    );
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await emit("reg-recreate-form", { tournamentId, template, force: true });
      if (!res.ok) throw new Error(res.error || "Recreate failed");
      setMsg("Form recreated");
      setTab("Settings");
    } catch (e: any) {
      setMsg(e.message || "Recreate failed");
    } finally {
      setBusy(false);
    }
  };

  const updateRegStatus = async (registrationId: string, status: string, confirmPromote = false) => {
    if (status === "registered") {
      const ok = window.confirm(
        `Are you sure you want to promote ${registrationId}?\nThis will assign the player an active tournament slot.`
      );
      if (!ok) return;
      confirmPromote = true;
    }
    const res = await emit("reg-update-status", { registrationId, status, confirmPromote });
    if (!res.ok) throw new Error(res.error || "Update failed");
    setSelectedReg(null);
  };

  const openFile = async (fileId: string) => {
    const res = await emit("reg-file-url", { fileId });
    if (!res.ok) throw new Error(res.error || "Cannot open file");
    window.open(res.url, "_blank");
  };

  const exportRegs = async () => {
    if (!form) return;
    const res = await emit("reg-export", { formId: form.id });
    if (!res.ok) throw new Error(res.error || "Export failed");
    downloadCsv(`${form.idPrefix || "registrations"}.csv`, res.csv);
  };

  const selectedField = draft?.fields?.find((f: any) => f.key === selectedFieldKey);

  const updateField = (patch: any) => {
    if (!draft || !selectedField) return;
    setDraft({
      ...draft,
      fields: draft.fields.map((f: any) => (f.key === selectedField.key ? { ...f, ...patch } : f))
    });
  };

  const addCustomField = () => {
    if (!draft) return;
    const key = `custom_${Date.now().toString(36)}`;
    const field = {
      id: key,
      key,
      label: "New field",
      fieldType: "text",
      required: false,
      enabled: true,
      description: "",
      placeholder: "",
      options: [],
      displayOrder: (draft.fields?.length || 0) * 10 + 10,
      sectionKey: draft.sections?.[0]?.key || "main",
      validation: {},
      config: {},
      predefined: false
    };
    setDraft({ ...draft, fields: [...(draft.fields || []), field] });
    setSelectedFieldKey(key);
  };

  const addRule = () => {
    if (!draft) return;
    const rule = {
      id: `rule_${Date.now().toString(36)}`,
      sourceKey: draft.fields?.[0]?.key || "",
      operator: "equals",
      value: "",
      targetKey: draft.fields?.[1]?.key || "",
      action: "show",
      makeRequired: false,
      group: "and"
    };
    setDraft({ ...draft, rules: [...(draft.rules || []), rule] });
  };

  if (!tournaments.length) {
    return <Card>Create a tournament first, then configure registration.</Card>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <Select label="Tournament" value={tournamentId} onChange={(e) => setTournamentId(e.target.value)}>
            {tournaments.map((t: any) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>
        {form ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Status: <strong style={{ color: "var(--ink)" }}>{form.status}</strong>
          </p>
        ) : null}
      </div>

      {!form ? (
        <Card className="space-y-3">
          <h2 className="font-display text-3xl">Create registration form</h2>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Each tournament has one registration form. Start from the ACPL Season 6 template (recommended) or a blank form.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="bid" disabled={busy} onClick={() => createForm("acpl6")}>
              Use ACPL template
            </Button>
            <Button disabled={busy} onClick={() => createForm("blank")}>
              Blank form
            </Button>
          </div>
          {msg ? <p className="text-sm">{msg}</p> : null}
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                className="neu-sm px-3 py-2 text-sm"
                style={tab === t ? { outline: "2px solid var(--accent)", color: "var(--accent)" } : undefined}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          {msg ? <p className="text-sm">{msg}</p> : null}

          {tab === "Dashboard" ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="space-y-3">
                <h2 className="font-display text-3xl">Registration</h2>
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Total" value={dashboard?.total ?? "—"} />
                  <Stat label="Registered" value={dashboard?.registered ?? "—"} />
                  <Stat label="Waiting" value={dashboard?.waiting ?? "—"} />
                  <Stat label="Available slots" value={dashboard?.availableSlots ?? "—"} />
                  <Stat label="Today" value={dashboard?.today ?? "—"} />
                </div>
              </Card>
              <Card className="space-y-3">
                <h3 className="font-display text-2xl">By category</h3>
                {Object.entries(dashboard?.byCategory || {}).map(([k, v]: any) => (
                  <BarRow key={k} label={k} value={v} max={dashboard?.total || 1} />
                ))}
                {!Object.keys(dashboard?.byCategory || {}).length ? (
                  <p className="text-sm" style={{ color: "var(--muted)" }}>
                    No registrations yet.
                  </p>
                ) : null}
                <h3 className="font-display mt-4 text-2xl">Payment</h3>
                {Object.entries(dashboard?.byPayment || {}).map(([k, v]: any) => (
                  <BarRow key={k} label={k} value={v} max={dashboard?.total || 1} />
                ))}
              </Card>
            </div>
          ) : null}

          {tab === "Settings" && draft ? (
            <Card className="space-y-3">
              <h2 className="font-display text-3xl">Form settings</h2>
              <Field label="Title" value={draft.title || ""} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              <label className="block space-y-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                Description
                <textarea
                  className="field mt-1 min-h-[80px] w-full"
                  value={draft.description || ""}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </label>
              <FilePick
                label="Form / tournament logo"
                onData={async (dataUrl, file) => {
                  const res: any = await emit("upload", { dataUrl, filename: file.name });
                  if (res.ok) setDraft({ ...draft, logo: res.url });
                }}
              />
              {draft.logo ? <img src={draft.logo} alt="" className="h-16 w-16 rounded-xl object-cover" /> : null}
              {!draft.logo && tournaments.find((t: any) => t.id === tournamentId)?.logo ? (
                <Button
                  onClick={() =>
                    setDraft({
                      ...draft,
                      logo: tournaments.find((t: any) => t.id === tournamentId)?.logo || ""
                    })
                  }
                >
                  Use tournament logo
                </Button>
              ) : null}
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                This logo appears at the top of the public registration page. Saving a tournament logo also updates it here.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label="Opens at (IST)"
                  type="datetime-local"
                  value={draft.opensAt || ""}
                  onChange={(e) => setDraft({ ...draft, opensAt: e.target.value })}
                />
                <Field
                  label="Closes at (IST)"
                  type="datetime-local"
                  value={draft.closesAt || ""}
                  onChange={(e) => setDraft({ ...draft, closesAt: e.target.value })}
                />
              </div>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                Schedule times are India Standard Time. Clicking <strong>Open registration</strong> starts the form
                immediately (a future “Opens at” time is cleared).
              </p>
              <Field
                label="Overall capacity"
                type="number"
                value={draft.capacity ?? 100}
                onChange={(e) => setDraft({ ...draft, capacity: Number(e.target.value) })}
              />
              <Select
                label="Category-specific capacity"
                value={draft.useCategoryCapacity ? "yes" : "no"}
                onChange={(e) => setDraft({ ...draft, useCategoryCapacity: e.target.value === "yes" })}
              >
                <option value="no">No — use overall capacity</option>
                <option value="yes">Yes</option>
              </Select>
              {draft.useCategoryCapacity ? (
                <div className="grid gap-2 md:grid-cols-3">
                  {["Men's", "Women's", "Kid's"].map((c) => (
                    <Field
                      key={c}
                      label={`${c} capacity`}
                      type="number"
                      value={draft.categoryCapacity?.[c] ?? ""}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          categoryCapacity: { ...(draft.categoryCapacity || {}), [c]: Number(e.target.value) }
                        })
                      }
                    />
                  ))}
                </div>
              ) : null}
              <Field
                label="Registration ID prefix"
                value={draft.idPrefix || ""}
                onChange={(e) => setDraft({ ...draft, idPrefix: e.target.value })}
              />
              <h3 className="font-display text-2xl">Payment</h3>
              <div className="grid gap-2 md:grid-cols-3">
                {["Men's", "Women's", "Kid's"].map((c) => (
                  <Field
                    key={c}
                    label={`${c} fee (₹)`}
                    type="number"
                    value={draft.payment?.fees?.[c] ?? ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        payment: {
                          ...draft.payment,
                          fees: { ...(draft.payment?.fees || {}), [c]: Number(e.target.value) }
                        }
                      })
                    }
                  />
                ))}
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <Field
                  label="Account name"
                  value={draft.payment?.bank?.accountName || ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      payment: { ...draft.payment, bank: { ...draft.payment?.bank, accountName: e.target.value } }
                    })
                  }
                />
                <Field
                  label="Account number"
                  value={draft.payment?.bank?.accountNumber || ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      payment: { ...draft.payment, bank: { ...draft.payment?.bank, accountNumber: e.target.value } }
                    })
                  }
                />
                <Field
                  label="IFSC"
                  value={draft.payment?.bank?.ifsc || ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      payment: { ...draft.payment, bank: { ...draft.payment?.bank, ifsc: e.target.value } }
                    })
                  }
                />
                <Field
                  label="Bank name"
                  value={draft.payment?.bank?.bankName || ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      payment: { ...draft.payment, bank: { ...draft.payment?.bank, bankName: e.target.value } }
                    })
                  }
                />
                <Field
                  label="UPI ID"
                  value={draft.payment?.upi?.upiId || ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      payment: { ...draft.payment, upi: { ...draft.payment?.upi, upiId: e.target.value } }
                    })
                  }
                />
                <Field
                  label="UPI mobile"
                  value={draft.payment?.upi?.mobile || ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      payment: { ...draft.payment, upi: { ...draft.payment?.upi, mobile: e.target.value } }
                    })
                  }
                />
              </div>
              <FilePick
                label="UPI QR code"
                onData={async (dataUrl, file) => {
                  const res: any = await emit("upload", { dataUrl, filename: file.name });
                  if (res.ok) {
                    setDraft({
                      ...draft,
                      payment: { ...draft.payment, upi: { ...draft.payment?.upi, qrUrl: res.url } }
                    });
                  }
                }}
              />
              <div className="neu-sm space-y-2 px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--muted)" }}>
                  Public URL
                </p>
                <Field
                  label="Friendly path"
                  value={draft.publicSlug || ""}
                  placeholder="ACPL-6"
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      publicSlug: e.target.value.replace(/\s+/g, "-")
                    })
                  }
                />
                <p className="break-all text-sm">
                  {baseUrl}/register/<strong>{draft.publicSlug || "…"}</strong>
                </p>
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  Letters, numbers, hyphens. Old secret token links still work.
                </p>
                <Button
                  onClick={() => {
                    navigator.clipboard?.writeText(`${baseUrl}/register/${draft.publicSlug || form.publicToken}`);
                    setMsg("Public URL copied");
                  }}
                >
                  Copy URL
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="bid" disabled={busy} onClick={saveDraft}>
                  Save settings
                </Button>
                <Button disabled={busy || form.status === "open"} onClick={() => setStatus("open")}>
                  Open registration
                </Button>
                <Button disabled={busy || form.status === "closed"} onClick={() => setStatus("closed")}>
                  Close registration
                </Button>
                <Button disabled={busy} onClick={() => setStatus("draft")}>
                  Back to draft
                </Button>
              </div>
              <div className="neu-sm space-y-2 px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--muted)" }}>
                  Start over
                </p>
                <p className="text-sm" style={{ color: "var(--muted)" }}>
                  Delete this form to return to the create screen, or replace it with a fresh template.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy} onClick={() => recreateCurrentForm("acpl6")}>
                    Replace with ACPL template
                  </Button>
                  <Button disabled={busy} onClick={() => recreateCurrentForm("blank")}>
                    Replace with blank form
                  </Button>
                  <Button variant="danger" disabled={busy} onClick={deleteCurrentForm}>
                    Delete form
                  </Button>
                </div>
              </div>
            </Card>
          ) : null}

          {tab === "Form builder" && draft ? (
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="space-y-2">
                <h2 className="font-display text-2xl">Fields</h2>
                <div className="max-h-[60vh] space-y-1 overflow-auto">
                  {(draft.fields || []).map((f: any) => (
                    <button
                      key={f.key}
                      type="button"
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm"
                      style={
                        selectedFieldKey === f.key
                          ? { background: "color-mix(in srgb, var(--accent) 14%, transparent)" }
                          : undefined
                      }
                      onClick={() => setSelectedFieldKey(f.key)}
                    >
                      <span>
                        {f.enabled === false ? "☐ " : "☑ "}
                        {f.label}
                      </span>
                      <span style={{ color: "var(--muted)" }}>{f.fieldType}</span>
                    </button>
                  ))}
                </div>
                <Button onClick={addCustomField}>+ Add custom field</Button>
                <Button variant="bid" disabled={busy} onClick={saveDraft}>
                  Save form
                </Button>
              </Card>
              <Card className="space-y-3 lg:col-span-2">
                <h2 className="font-display text-2xl">Field settings</h2>
                {selectedField ? (
                  <>
                    <Field label="Label" value={selectedField.label || ""} onChange={(e) => updateField({ label: e.target.value })} />
                    <Field
                      label="Description"
                      value={selectedField.description || ""}
                      onChange={(e) => updateField({ description: e.target.value })}
                    />
                    <Field
                      label="Placeholder"
                      value={selectedField.placeholder || ""}
                      onChange={(e) => updateField({ placeholder: e.target.value })}
                    />
                    <Select
                      label="Type"
                      value={selectedField.fieldType}
                      onChange={(e) => updateField({ fieldType: e.target.value })}
                      disabled={selectedField.predefined}
                    >
                      {FIELD_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </Select>
                    <Select
                      label="Enabled"
                      value={selectedField.enabled === false ? "no" : "yes"}
                      onChange={(e) => updateField({ enabled: e.target.value === "yes" })}
                    >
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </Select>
                    <Select
                      label="Required"
                      value={selectedField.required ? "yes" : "no"}
                      onChange={(e) => updateField({ required: e.target.value === "yes" })}
                    >
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </Select>
                    <Field
                      label="Display order"
                      type="number"
                      value={selectedField.displayOrder ?? 0}
                      onChange={(e) => updateField({ displayOrder: Number(e.target.value) })}
                    />
                    {(selectedField.fieldType === "dropdown" || selectedField.fieldType === "single") && (
                      <>
                        {selectedField.key === "auctionTeam" ? (
                          <div className="neu-sm space-y-2 px-3 py-3 text-sm">
                            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--muted)" }}>
                              Inherited from tournament
                            </p>
                            <p style={{ color: "var(--muted)" }}>
                              Team choices come from teams added under Tournaments for this event. Edit the tournament’s
                              team list to change this dropdown.
                            </p>
                            <ul className="list-disc pl-5">
                              {(tournaments.find((t: any) => t.id === tournamentId)?.teamIds || [])
                                .map((id: string) => admin.teams.find((x: any) => x.id === id)?.name)
                                .filter(Boolean)
                                .map((name: string) => (
                                  <li key={name}>{name}</li>
                                ))}
                            </ul>
                            {!(tournaments.find((t: any) => t.id === tournamentId)?.teamIds || []).length ? (
                              <p style={{ color: "var(--muted)" }}>No teams linked yet — add them on the Tournaments page.</p>
                            ) : null}
                          </div>
                        ) : (
                          <label
                            className="block space-y-1 text-[11px] font-semibold uppercase tracking-wider"
                            style={{ color: "var(--muted)" }}
                          >
                            Options (one per line)
                            <textarea
                              className="field mt-1 min-h-[100px] w-full"
                              value={(selectedField.options || []).join("\n")}
                              onChange={(e) =>
                                updateField({
                                  options: e.target.value
                                    .split("\n")
                                    .map((x) => x.trim())
                                    .filter(Boolean)
                                })
                              }
                            />
                          </label>
                        )}
                      </>
                    )}
                    {!selectedField.predefined ? (
                      <Button
                        variant="danger"
                        onClick={() => {
                          setDraft({
                            ...draft,
                            fields: draft.fields.filter((f: any) => f.key !== selectedField.key),
                            rules: (draft.rules || []).filter(
                              (r: any) => r.sourceKey !== selectedField.key && r.targetKey !== selectedField.key
                            )
                          });
                          setSelectedFieldKey(draft.fields.find((f: any) => f.key !== selectedField.key)?.key || "");
                        }}
                      >
                        Delete field
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm" style={{ color: "var(--muted)" }}>
                    Select a field
                  </p>
                )}

                <h3 className="font-display pt-4 text-2xl">Conditional rules</h3>
                <div className="space-y-3">
                  {(draft.rules || []).map((r: any, idx: number) => (
                    <div key={r.id || idx} className="neu-sm grid gap-2 px-3 py-3 md:grid-cols-2">
                      <Select
                        label="If field"
                        value={r.sourceKey}
                        onChange={(e) => {
                          const rules = [...draft.rules];
                          rules[idx] = { ...r, sourceKey: e.target.value };
                          setDraft({ ...draft, rules });
                        }}
                      >
                        {(draft.fields || []).map((f: any) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                      </Select>
                      <Select
                        label="Operator"
                        value={r.operator}
                        onChange={(e) => {
                          const rules = [...draft.rules];
                          rules[idx] = { ...r, operator: e.target.value };
                          setDraft({ ...draft, rules });
                        }}
                      >
                        {["equals", "notEquals", "contains", "isEmpty", "isNotEmpty", "greaterThan", "lessThan"].map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </Select>
                      <Field
                        label="Value"
                        value={r.value || ""}
                        onChange={(e) => {
                          const rules = [...draft.rules];
                          rules[idx] = { ...r, value: e.target.value };
                          setDraft({ ...draft, rules });
                        }}
                      />
                      <Select
                        label="Then show field"
                        value={r.targetKey}
                        onChange={(e) => {
                          const rules = [...draft.rules];
                          rules[idx] = { ...r, targetKey: e.target.value };
                          setDraft({ ...draft, rules });
                        }}
                      >
                        {(draft.fields || []).map((f: any) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                      </Select>
                      <Select
                        label="Make required"
                        value={r.makeRequired ? "yes" : "no"}
                        onChange={(e) => {
                          const rules = [...draft.rules];
                          rules[idx] = { ...r, makeRequired: e.target.value === "yes" };
                          setDraft({ ...draft, rules });
                        }}
                      >
                        <option value="no">No</option>
                        <option value="yes">Yes</option>
                      </Select>
                      <Button
                        variant="danger"
                        onClick={() => setDraft({ ...draft, rules: draft.rules.filter((_: any, i: number) => i !== idx) })}
                      >
                        Remove rule
                      </Button>
                    </div>
                  ))}
                </div>
                <Button onClick={addRule}>+ Add rule</Button>
              </Card>
            </div>
          ) : null}

          {tab === "Preview" && form ? (
            <Card>
              <DynamicForm form={form} mode="preview" />
            </Card>
          ) : null}

          {tab === "Registrations" ? (
            <div className="grid gap-4 lg:grid-cols-5">
              <Card className="space-y-3 lg:col-span-3">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[160px] flex-1">
                    <Field label="Search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ID, name, mobile" />
                  </div>
                  <Select label="Status" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                    <option value="">All</option>
                    {["registered", "waiting", "cancelled", "rejected"].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                  <Button onClick={exportRegs}>Export CSV</Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead>
                      <tr style={{ color: "var(--muted)" }}>
                        <th className="py-2">ID</th>
                        <th>#</th>
                        <th>Player</th>
                        <th>Category</th>
                        <th>Status</th>
                        <th>Payment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {regs.map((r: any) => (
                        <tr
                          key={r.id}
                          className="cursor-pointer border-t"
                          style={{ borderColor: "color-mix(in srgb, var(--ink) 10%, transparent)" }}
                          onClick={() => setSelectedReg(r)}
                        >
                          <td className="py-2 font-medium">{r.registrationId}</td>
                          <td>{r.sequence}</td>
                          <td>{r.playerName || r.values?.playerName}</td>
                          <td>{r.category || r.values?.category}</td>
                          <td>
                            {r.status}
                            {r.waitingPosition ? ` #${r.waitingPosition}` : ""}
                          </td>
                          <td>{r.paymentStatus}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              <Card className="space-y-3 lg:col-span-2">
                <h3 className="font-display text-2xl">Detail</h3>
                {!selectedReg ? (
                  <p className="text-sm" style={{ color: "var(--muted)" }}>
                    Select a registration
                  </p>
                ) : (
                  <>
                    <p className="font-display text-3xl">{selectedReg.values?.playerName}</p>
                    <p className="text-sm" style={{ color: "var(--muted)" }}>
                      {selectedReg.registrationId} · #{selectedReg.sequence} ·{" "}
                      {new Date(selectedReg.registeredAt).toLocaleString()}
                    </p>
                    <div className="space-y-1 text-sm">
                      {Object.entries(selectedReg.values || {}).map(([k, v]) => (
                        <p key={k}>
                          <strong>{k}:</strong> {String(v)}
                        </p>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(selectedReg.fileIds || {}).map(([k, id]) => (
                        <Button key={k} onClick={() => openFile(String(id))}>
                          View {k}
                        </Button>
                      ))}
                    </div>
                    <Select
                      label="Payment status"
                      value={selectedReg.paymentStatus || "pending"}
                      onChange={async (e) => {
                        const res = await emit("reg-set-payment", {
                          registrationId: selectedReg.id,
                          paymentStatus: e.target.value
                        });
                        if (!res.ok) setMsg(res.error);
                      }}
                    >
                      {["pending", "verified", "rejected"].map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </Select>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => updateRegStatus(selectedReg.id, "registered", true)}>Promote / Register</Button>
                      <Button onClick={() => updateRegStatus(selectedReg.id, "waiting")}>Move to waiting</Button>
                      <Button variant="danger" onClick={() => updateRegStatus(selectedReg.id, "cancelled")}>
                        Cancel
                      </Button>
                      <Button variant="danger" onClick={() => updateRegStatus(selectedReg.id, "rejected")}>
                        Reject
                      </Button>
                    </div>
                  </>
                )}
              </Card>
            </div>
          ) : null}

          {tab === "Waiting list" ? (
            <Card className="space-y-3">
              <h2 className="font-display text-3xl">Waiting list</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr style={{ color: "var(--muted)" }}>
                      <th className="py-2">Position</th>
                      <th>Sequence</th>
                      <th>Player</th>
                      <th>Category</th>
                      <th>Registered at</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {waiting.map((r: any) => (
                      <tr
                        key={r.id}
                        className="border-t"
                        style={{ borderColor: "color-mix(in srgb, var(--ink) 10%, transparent)" }}
                      >
                        <td className="py-2">{r.waitingPosition}</td>
                        <td>{r.sequence}</td>
                        <td>{r.playerName || r.values?.playerName}</td>
                        <td>{r.category || r.values?.category}</td>
                        <td>{new Date(r.registeredAt).toLocaleString()}</td>
                        <td>
                          <Button onClick={() => updateRegStatus(r.id, "registered", true)}>Promote</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!waiting.length ? (
                  <p className="text-sm" style={{ color: "var(--muted)" }}>
                    Waiting list is empty.
                  </p>
                ) : null}
              </div>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
