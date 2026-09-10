"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAdmin } from "@/components/admin/AdminGate";
import { AcplLinkPicker } from "@/components/admin/AcplLinkPicker";
import { AcplCareerPanel, AcplStatsCard } from "@/components/AcplStats";
import { Card } from "@/components/ui";
import { inr } from "@/lib/format";

export default function AuctionPlayerDetailPage() {
  const params = useParams<{ id: string }>();
  const { admin, emit } = useAdmin();
  const player = admin.players.find((p: any) => p.id === params.id);
  const [acpl, setAcpl] = useState<any>(null);
  const [full, setFull] = useState<any>(null);

  const refreshAcpl = async (p = player) => {
    if (!p) return;
    try {
      if (p.acplPlayerId) {
        const res: any = await emit("get-acpl-player", { id: p.acplPlayerId });
        setAcpl(res.summary);
        setFull(res.found ? res.player : null);
        return;
      }
      const res: any = await emit("get-acpl-player", { name: p.name });
      setAcpl(res.summary);
      setFull(res.found ? res.player : null);
    } catch {
      setAcpl({ found: false });
      setFull(null);
    }
  };

  useEffect(() => {
    if (!player) return;
    let alive = true;
    refreshAcpl(player).then(() => {
      if (!alive) return;
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emit, player?.id, player?.acplPlayerId, player?.name]);

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
          {player.acplName ? (
            <>
              {" "}
              · ACPL: <strong style={{ color: "var(--turf)" }}>{player.acplName}</strong>
            </>
          ) : null}
        </p>
        <AcplStatsCard acpl={acpl} />
      </Card>
      {full && <AcplCareerPanel player={full} />}
      <Card className="space-y-3">
        <h2 className="font-display text-2xl">Link ACPL stats</h2>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Search ACPL history and select the matching player to attach career stats.
        </p>
        <AcplLinkPicker
          emit={emit}
          playerId={player.id}
          linkedAcplId={player.acplPlayerId || null}
          linkedAcplName={player.acplName || null}
          initialQuery={player.acplName || player.name || ""}
          onLinked={({ summary, acpl: linked }) => {
            setAcpl(summary);
            setFull(linked || null);
            refreshAcpl({ ...player, acplPlayerId: linked?.id, acplName: linked?.name });
          }}
          onUnlinked={() => {
            setAcpl({ found: false });
            setFull(null);
          }}
        />
      </Card>
    </div>
  );
}
