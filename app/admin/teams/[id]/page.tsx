"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAdmin } from "@/components/admin/AdminGate";
import { Button, Card, Field, FilePick, Select } from "@/components/ui";
import { ROLES } from "@/components/admin/panels";
import { inr, crToLakhs, lakhsToCr } from "@/lib/format";

export default function TeamDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { admin, emit } = useAdmin();
  const team = admin.teams.find((t: any) => t.id === params.id);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<any>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    role: "Batsman",
    baseCr: "2",
    phone: "",
    photo: ""
  });

  const roster = useMemo(() => {
    if (!team) return [];
    const byId = new Map<string, any>();
    for (const p of admin.players.filter((x: any) => x.teamId === team.id)) {
      byId.set(p.id, { ...p, source: p.assignment === "retained" ? "retained" : p.assignment === "team" ? "assigned" : "bought" });
    }
    for (const a of admin.auctions || []) {
      for (const s of a.live?.sold || []) {
        if (s.teamId !== team.id) continue;
        const p = admin.players.find((x: any) => x.id === s.playerId);
        if (!p) continue;
        byId.set(p.id, {
          ...p,
          source: "bought",
          soldPrice: s.soldPrice,
          auctionName: a.name
        });
      }
    }
    for (const r of team.retentions || []) {
      const p = admin.players.find((x: any) => x.id === r.playerId);
      if (!p) continue;
      byId.set(p.id, { ...p, source: "retained", soldPrice: r.soldPrice });
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [admin, team]);

  if (!team) {
    return (
      <Card>
        <p>Team not found.</p>
        <Link className="btn btn-ghost mt-3 inline-block px-4 py-2 text-sm" href="/admin/teams">
          ← Back to teams
        </Link>
      </Card>
    );
  }

  const resetForm = () => {
    setEditing(null);
    setForm({ name: "", role: "Batsman", baseCr: "2", phone: "", photo: "" });
  };

  const savePlayer = async () => {
    try {
      setErr("");
      setNote("");
      if (!form.name.trim()) throw new Error("Enter player name");
      await emit("upsert-player", {
        id: editing?.id,
        name: form.name.trim(),
        role: form.role,
        categoryId: team.categoryId,
        sport: team.sport || "Cricket",
        basePrice: crToLakhs(form.baseCr),
        phone: form.phone,
        photo: form.photo,
        teamId: team.id,
        assignment: "team",
        tournamentIds: editing?.tournamentIds || []
      });
      setNote(editing ? "Player updated." : "Replacement player added to team.");
      resetForm();
    } catch (e: any) {
      setErr(e.message || "Could not save player");
    }
  };

  const editPlayer = (p: any) => {
    setEditing(p);
    setForm({
      name: p.name || "",
      role: p.role || "Batsman",
      baseCr: String(lakhsToCr(p.basePrice || 200)),
      phone: p.phone || "",
      photo: p.photo || ""
    });
    setNote(`Editing ${p.name}`);
  };

  const removePlayer = async (p: any) => {
    if (!confirm(`Delete ${p.name}?`)) return;
    try {
      setErr("");
      await emit("delete-player", { id: p.id });
      if (editing?.id === p.id) resetForm();
      setNote("Player deleted.");
    } catch (e: any) {
      setErr(e.message || "Could not delete");
    }
  };

  const saveTeamLogo = async (url: string) => {
    setLogoBusy(true);
    setErr("");
    try {
      await emit("upsert-team", {
        ...team,
        logo: url,
        playerIds: Array.isArray(team.playerIds)
          ? team.playerIds
          : admin.players.filter((p: any) => p.teamId === team.id && p.assignment === "team").map((p: any) => p.id)
      });
      setNote(url ? "Team logo saved." : "Team logo removed.");
    } catch (e: any) {
      setErr(e?.message || "Could not save team logo");
    } finally {
      setLogoBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-4">
          {team.logo ? (
            <img src={team.logo} alt="" className="h-16 w-16 rounded-xl object-cover" />
          ) : (
            <div
              className="flex h-16 w-16 items-center justify-center rounded-xl text-sm font-bold"
              style={{ background: "color-mix(in srgb, var(--ink) 8%, transparent)", color: team.color }}
            >
              {(team.name || "?").slice(0, 2).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="font-display text-5xl" style={{ color: team.color }}>
              {team.name}
            </h1>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              {team.sport || "Cricket"} · {admin.categories.find((c: any) => c.id === team.categoryId)?.name} ·{" "}
              {roster.length} players
            </p>
          </div>
        </div>
        <Button onClick={() => router.push("/admin/teams")}>All teams</Button>
      </div>

      {err && <p style={{ color: "var(--crimson)" }}>{err}</p>}
      {note && <p style={{ color: "var(--aqua)" }}>{note}</p>}

      <Card className="grid gap-3 md:grid-cols-3">
        <h2 className="font-display md:col-span-3 text-3xl">Team logo</h2>
        <FilePick
          label="Upload team photo / logo"
          onData={async (dataUrl, file) => {
            try {
              const res: any = await emit("upload", { dataUrl, filename: file.name || "logo.jpg" });
              const url = res?.url;
              if (!url) throw new Error(res?.error || "Upload failed");
              await saveTeamLogo(url);
            } catch (e: any) {
              setErr(e?.message || "Logo upload failed — try a smaller JPG/PNG (under 5 MB).");
            }
          }}
        />
        <div className="flex flex-wrap items-center gap-2 md:col-span-2">
          {team.logo ? (
            <>
              <img src={team.logo} alt="" className="h-20 w-20 rounded-xl object-cover" />
              <Button disabled={logoBusy} onClick={() => saveTeamLogo("")}>
                Remove logo
              </Button>
            </>
          ) : (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Upload saves immediately — no extra Save click needed here.
            </p>
          )}
        </div>
      </Card>

      <Card className="grid gap-3 md:grid-cols-3">
        <h2 className="font-display md:col-span-3 text-3xl">{editing ? "Edit player" : "Add player (replacement)"}</h2>
        <p className="md:col-span-3 text-xs" style={{ color: "var(--muted)" }}>
          Use this after the auction to add a late entrant or replacement directly onto the squad.
        </p>
        <Field label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Select label="Playing type" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
        <Field label="Base price (Cr)" value={form.baseCr} onChange={(e) => setForm({ ...form, baseCr: e.target.value })} />
        <Field label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <FilePick
          label="Photo"
          onData={async (dataUrl, file) => {
            try {
              const res: any = await emit("upload", { dataUrl, filename: file.name || "photo.jpg" });
              const url = res?.url;
              if (!url) throw new Error(res?.error || "Upload failed");
              setForm((f) => ({ ...f, photo: url }));
            } catch (e: any) {
              setErr(e?.message || "Photo upload failed");
            }
          }}
        />
        {form.photo ? (
          <div className="flex items-center gap-3">
            <img src={form.photo} alt="" className="h-14 w-14 rounded-xl object-cover" />
            <Button onClick={() => setForm({ ...form, photo: "" })}>Remove photo</Button>
          </div>
        ) : null}
        <div className="md:col-span-3 flex flex-wrap gap-2">
          <Button variant="turf" onClick={savePlayer}>
            {editing ? "Save player" : "Add player"}
          </Button>
          {editing && <Button onClick={resetForm}>Cancel edit</Button>}
        </div>
      </Card>

      <Card className="overflow-auto p-0">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-[color-mix(in_srgb,var(--ink)_12%,transparent)] text-[11px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              <th className="px-4 py-3">Player</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Base</th>
              <th className="px-4 py-3">Sold / fee</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((p: any) => (
              <tr key={p.id} className="border-b border-[color-mix(in_srgb,var(--ink)_8%,transparent)]">
                <td className="px-4 py-3 font-semibold">{p.name}</td>
                <td className="px-4 py-3">{p.role}</td>
                <td className="px-4 py-3">{inr(p.basePrice)}</td>
                <td className="px-4 py-3">{p.soldPrice != null ? inr(p.soldPrice) : "—"}</td>
                <td className="px-4 py-3 capitalize">{p.source}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => editPlayer(p)}>Edit</Button>
                    <Button variant="danger" onClick={() => removePlayer(p)}>
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {!roster.length && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center" style={{ color: "var(--muted)" }}>
                  No players on this team yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
