"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAdmin } from "@/components/admin/AdminGate";
import { AcplCareerPanel, AcplStatsCard } from "@/components/AcplStats";
import { Card } from "@/components/ui";
import { inr } from "@/lib/format";

export default function AuctionPlayerDetailPage() {
  const params = useParams<{ id: string }>();
  const { admin, emit } = useAdmin();
  const player = admin.players.find((p: any) => p.id === params.id);
  const [acpl, setAcpl] = useState<any>(null);
  const [full, setFull] = useState<any>(null);

  useEffect(() => {
    if (!player?.name) return;
    let alive = true;
    emit("get-acpl-player", { name: player.name })
      .then((res: any) => {
        if (!alive) return;
        setAcpl(res.summary);
        setFull(res.found ? res.player : null);
      })
      .catch(() => {
        if (alive) setAcpl({ found: false });
      });
    return () => {
      alive = false;
    };
  }, [emit, player?.name]);

  if (!player) {
    return (
      <Card>
        <p>Player not found.</p>
        <Link className="btn btn-ghost mt-3 inline-block px-4 py-2 text-sm" href="/admin/players">
          ← Players
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Link href="/admin/players" className="btn btn-ghost inline-flex px-4 py-2 text-xs font-bold uppercase tracking-wider">
        ← Players
      </Link>
      <Card className="space-y-3">
        <h1 className="font-display text-5xl">{player.name}</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {player.sport || "Cricket"} · {player.role} ·{" "}
            {admin.categories.find((c: any) => c.id === player.categoryId)?.name} · Base {inr(player.basePrice)}
          </p>
        <AcplStatsCard acpl={acpl} href={full?.id ? `/admin/acpl/${full.id}` : undefined} />
      </Card>
      {full && <AcplCareerPanel player={full} />}
      {!full && acpl && !acpl.found && (
        <Card>
          <p style={{ color: "var(--muted)" }}>No ACPL historical record matches this auction player name.</p>
        </Card>
      )}
    </div>
  );
}
