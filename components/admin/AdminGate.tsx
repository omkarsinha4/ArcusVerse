"use client";

import { createContext, useContext, useEffect, useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/Providers";
import { Shell, Card, adminNav } from "@/components/ui";

type AdminCtx = {
  admin: any;
  staff: string;
  emit: (e: string, p?: unknown) => Promise<any>;
};

const Ctx = createContext<AdminCtx | null>(null);

export function useAdmin() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAdmin");
  return c;
}

export function AdminGate({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <Shell title="Admin">
          <Card>Loading…</Card>
        </Shell>
      }
    >
      <AdminGateInner>{children}</AdminGateInner>
    </Suspense>
  );
}

function AdminGateInner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { emit, socket } = useApp();
  const [admin, setAdmin] = useState<any>(null);
  const [staff, setStaff] = useState("");

  const staffEmit = async (event: string, payload?: unknown) => {
    if (event !== "login") {
      try {
        const saved = sessionStorage.getItem("arcus-auth");
        if (saved) {
          const s = JSON.parse(saved);
          await emit("login", { username: s.username, password: s.password });
        }
      } catch {
        /* */
      }
    }
    return emit(event, payload, event === "upload" ? { timeoutMs: 60000 } : undefined);
  };

  useEffect(() => {
    if (!socket) return;
    const on = (s: any) => setAdmin(s);
    socket.on("admin-state", on);
    return () => {
      socket.off("admin-state", on);
    };
  }, [socket]);

  useEffect(() => {
    if (!socket || admin) return;
    try {
      const saved = sessionStorage.getItem("arcus-auth");
      if (!saved) {
        router.replace("/");
        return;
      }
      const s = JSON.parse(saved);
      emit("login", { username: s.username, password: s.password })
        .then((res: any) => {
          if (!["super", "admin"].includes(res.role)) {
            router.replace(res.role === "auctioneer" ? "/auctioneer" : res.redirect || "/");
            return;
          }
          setAdmin(res.admin);
          setStaff(res.role);
        })
        .catch(() => {
          sessionStorage.removeItem("arcus-auth");
          router.replace("/");
        });
    } catch {
      router.replace("/");
    }
  }, [socket]);

  if (!admin) {
    return (
      <Shell title="Admin">
        <Card>Signing you in…</Card>
      </Shell>
    );
  }

  return (
    <Ctx.Provider value={{ admin, staff, emit: staffEmit }}>
      <Shell title="Admin" subtitle={staff} nav={adminNav(staff)} showLogout>
        {children}
      </Shell>
    </Ctx.Provider>
  );
}
