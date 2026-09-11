import https from "https";
import http from "http";

/** Known ACPL Season 6 Cricheroes share links (admin-provided). */
export const ACPL6_CRICHEROES_LINKS = [
  { name: "Royal Challengers", shareUrl: "https://chshare.link/team/kX42bL", shareSlug: "kX42bL" },
  { name: "Mavericks", shareUrl: "https://chshare.link/team/kFUmMj", shareSlug: "kFUmMj" },
  { name: "Royal Warriors", shareUrl: "https://chshare.link/team/iI6NfX", shareSlug: "iI6NfX" },
  { name: "Vikings", shareUrl: "https://chshare.link/team/g2HS2a", shareSlug: "g2HS2a" },
  { name: "Phoenix", shareUrl: "https://chshare.link/team/nQFA1C", shareSlug: "nQFA1C" },
  { name: "Strikers", shareUrl: "https://chshare.link/team/kKfiMZ", shareSlug: "kKfiMZ" }
];

function fetchText(url, { headers = {}, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "text/html,application/json,*/*",
          ...headers
        },
        timeout: timeoutMs
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, url).toString();
          res.resume();
          fetchText(next, { headers, timeoutMs }).then(resolve, reject);
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode || 0, body, url: url });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
  });
}

function fetchJson(url, { headers = {} } = {}) {
  return fetchText(url, { headers: { Accept: "application/json", ...headers } }).then(({ status, body }) => {
    let json = null;
    try {
      json = JSON.parse(body);
    } catch {
      /* */
    }
    return { status, body, json };
  });
}

/** Resolve chshare.link / cricheroes profile URL → { teamId, slug, profileUrl }. */
export async function resolveCricheroesShare(shareOrProfileUrl) {
  const input = String(shareOrProfileUrl || "").trim();
  if (!input) throw new Error("Cricheroes URL required");

  const direct = input.match(/team-profile\/(\d+)\/([^/?#]+)/i);
  if (direct) {
    const teamId = direct[1];
    const slug = decodeURIComponent(direct[2]);
    return {
      teamId,
      slug,
      profileUrl: `https://cricheroes.com/team-profile/${teamId}/${slug}`,
      shareUrl: input.includes("chshare.link") ? input : "",
      shareSlug: ""
    };
  }

  const shareSlug = (input.match(/chshare\.link\/team\/([A-Za-z0-9]+)/i) || [])[1] || "";
  const url = shareSlug ? `https://chshare.link/team/${shareSlug}` : input;
  const { status, body } = await fetchText(url);
  if (status >= 400) throw new Error(`Could not resolve share link (HTTP ${status})`);

  // Prefer embedded __NEXT_DATA__ link_data.url
  const next = body.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (next) {
    try {
      const data = JSON.parse(next[1]);
      const profileUrl = data?.props?.pageProps?.link_data?.url || "";
      const m = String(profileUrl).match(/team-profile\/(\d+)\/([^/?#]+)/i);
      if (m) {
        return {
          teamId: m[1],
          slug: decodeURIComponent(m[2]),
          profileUrl: `https://cricheroes.com/team-profile/${m[1]}/${decodeURIComponent(m[2])}`,
          shareUrl: url,
          shareSlug: shareSlug || data?.props?.pageProps?.id || ""
        };
      }
    } catch {
      /* fall through */
    }
  }

  const m = body.match(/team-profile\/(\d+)\/([^"'/\s]+)/i);
  if (!m) throw new Error("Could not find Cricheroes team id in share page");
  return {
    teamId: m[1],
    slug: decodeURIComponent(m[2]),
    profileUrl: `https://cricheroes.com/team-profile/${m[1]}/${decodeURIComponent(m[2])}`,
    shareUrl: url,
    shareSlug
  };
}

function emptyCache(meta = {}) {
  return {
    fetchedAt: null,
    source: null,
    notes: [],
    name: meta.name || "",
    logo: "",
    location: "",
    teamId: meta.teamId || "",
    slug: meta.slug || "",
    profileUrl: meta.profileUrl || "",
    shareUrl: meta.shareUrl || "",
    tabs: {
      members: meta.profileUrl ? `${meta.profileUrl}/members` : "",
      matches: meta.profileUrl ? `${meta.profileUrl}/matches` : "",
      stats: meta.profileUrl ? `${meta.profileUrl}/stats` : "",
      leaderboard: meta.profileUrl ? `${meta.profileUrl}/leaderboard` : "",
      profile: meta.profileUrl || ""
    },
    stats: [],
    leaderboard: { batting: [], bowling: [], fielding: [] },
    matches: { past: [], upcoming: [] },
    members: []
  };
}

/**
 * Fetch team payload from Cricheroes API when CRICHEROES_API_KEY is configured.
 * Official mobile API requires api-key + device-type headers.
 */
export async function fetchCricheroesApiTeam(teamId) {
  const apiKey = process.env.CRICHEROES_API_KEY || "";
  const deviceType = process.env.CRICHEROES_DEVICE_TYPE || "android";
  if (!apiKey) {
    return { ok: false, reason: "missing_api_key", data: null };
  }
  const headers = {
    "api-key": apiKey,
    "device-type": deviceType,
    "User-Agent": "okhttp/4.9.0",
    Accept: "application/json"
  };
  const base = process.env.CRICHEROES_API_BASE || "https://api.cricheroes.in/api/v1";
  const endpoints = {
    details: `${base}/team/${teamId}`,
    stats: `${base}/team/${teamId}/stats`,
    matches: `${base}/team/${teamId}/matches`,
    leaderboard: `${base}/team/${teamId}/leaderboard`,
    members: `${base}/team/${teamId}/members`
  };
  const out = {};
  const notes = [];
  for (const [k, url] of Object.entries(endpoints)) {
    try {
      const res = await fetchJson(url, { headers });
      out[k] = res.json;
      if (!res.json?.status && res.json?.error?.message) {
        notes.push(`${k}: ${res.json.error.message}`);
      }
    } catch (e) {
      notes.push(`${k}: ${e.message}`);
      out[k] = null;
    }
  }
  return { ok: true, reason: "api", data: out, notes };
}

function normalizeApiCache(meta, apiPayload) {
  const cache = emptyCache(meta);
  cache.fetchedAt = new Date().toISOString();
  cache.source = "api";
  cache.notes = apiPayload?.notes || [];
  const details = apiPayload?.data?.details?.data || apiPayload?.data?.details || {};
  cache.name = details.team_name || details.name || cache.name;
  cache.logo = details.team_logo || details.logo || "";
  cache.location = details.city || details.location || "";

  const statsRaw = apiPayload?.data?.stats?.data || apiPayload?.data?.stats || [];
  if (Array.isArray(statsRaw)) {
    cache.stats = statsRaw.map((s) => ({
      label: s.label || s.title || s.name || "",
      value: s.value ?? s.count ?? s.stat ?? ""
    }));
  } else if (statsRaw && typeof statsRaw === "object") {
    cache.stats = Object.entries(statsRaw).map(([label, value]) => ({ label, value }));
  }

  const lb = apiPayload?.data?.leaderboard?.data || apiPayload?.data?.leaderboard || {};
  for (const key of ["batting", "bowling", "fielding"]) {
    const rows = lb[key] || lb[key?.toUpperCase?.()] || [];
    cache.leaderboard[key] = (Array.isArray(rows) ? rows : []).map((r) => ({
      player: r.player_name || r.name || r.player || "",
      stat: r.stat || r.value || r.score || ""
    }));
  }

  const matches = apiPayload?.data?.matches?.data || apiPayload?.data?.matches || {};
  const past = matches.past || matches.completed || matches.recent || (Array.isArray(matches) ? matches : []);
  const upcoming = matches.upcoming || matches.scheduled || matches.fixtures || [];
  cache.matches.past = (Array.isArray(past) ? past : []).map((m) => ({
    tournament: m.tournament || m.tournament_name || "",
    date: m.date || m.match_date || "",
    venue: m.venue || m.ground || "",
    score: m.score || m.scores || "",
    result: m.result || m.status || "",
    url: m.url || m.match_url || ""
  }));
  cache.matches.upcoming = (Array.isArray(upcoming) ? upcoming : []).map((m) => ({
    tournament: m.tournament || m.tournament_name || "",
    date: m.date || m.match_date || "",
    time: m.time || m.match_time || "",
    venue: m.venue || m.ground || "",
    opponent: m.opponent || m.opposition || m.team_b || m.teamB || "",
    url: m.url || m.match_url || ""
  }));

  const members = apiPayload?.data?.members?.data || apiPayload?.data?.members || [];
  cache.members = (Array.isArray(members) ? members : []).map((p) => ({
    name: p.name || p.player_name || "",
    role: p.role || p.sub_title || p.speciality || ""
  }));
  return cache;
}

/** Attach / refresh Cricheroes metadata (+ API cache when key present) onto a store team. */
export async function syncTeamCricheroes(store, team, { shareUrl } = {}) {
  const url = String(shareUrl || team.cricheroesShareUrl || team.cricheroesProfileUrl || "").trim();
  if (!url) throw new Error("Set a Cricheroes share or profile URL on this team first");

  const resolved = await resolveCricheroesShare(url);
  team.cricheroesShareUrl = resolved.shareUrl || team.cricheroesShareUrl || url;
  team.cricheroesShareSlug = resolved.shareSlug || team.cricheroesShareSlug || "";
  team.cricheroesTeamId = resolved.teamId;
  team.cricheroesSlug = resolved.slug;
  team.cricheroesProfileUrl = resolved.profileUrl;

  const meta = {
    name: team.name,
    teamId: resolved.teamId,
    slug: resolved.slug,
    profileUrl: resolved.profileUrl,
    shareUrl: team.cricheroesShareUrl
  };

  let cache = emptyCache(meta);
  cache.fetchedAt = new Date().toISOString();
  cache.source = "share_resolve";
  cache.notes = [
    "Share link resolved to Cricheroes team profile.",
    "Live stats/matches require CRICHEROES_API_KEY (Cloudflare blocks website scraping)."
  ];

  const api = await fetchCricheroesApiTeam(resolved.teamId);
  if (api.ok && api.data && !api.notes?.some((n) => /api-key|Device-type|Invalid/i.test(n))) {
    cache = normalizeApiCache(meta, api);
  } else if (api.notes?.length) {
    cache.notes.push(...api.notes);
  } else if (!process.env.CRICHEROES_API_KEY) {
    cache.notes.push("Set CRICHEROES_API_KEY in production.env to pull stats/matches/leaderboard automatically.");
  }

  // Preserve manually entered upcoming matches if API returned none
  const prevUpcoming = team.cricheroes?.matches?.upcoming || [];
  if ((!cache.matches.upcoming || !cache.matches.upcoming.length) && prevUpcoming.length) {
    cache.matches.upcoming = prevUpcoming;
    cache.notes.push("Kept previously saved upcoming matches (API returned none).");
  }

  team.cricheroes = cache;
  return { team, cache, resolved };
}

export function applyAcpl6CricheroesLinks(store) {
  let linked = 0;
  for (const link of ACPL6_CRICHEROES_LINKS) {
    const team = (store.teams || []).find(
      (t) => String(t.name || "").trim().toLowerCase() === link.name.toLowerCase()
    );
    if (!team) continue;
    team.cricheroesShareUrl = link.shareUrl;
    team.cricheroesShareSlug = link.shareSlug;
    linked += 1;
  }
  return { linked };
}

export async function syncAllLinkedCricheroes(store) {
  applyAcpl6CricheroesLinks(store);
  const results = [];
  for (const team of store.teams || []) {
    if (!team.cricheroesShareUrl && !team.cricheroesProfileUrl) continue;
    try {
      const res = await syncTeamCricheroes(store, team);
      results.push({ teamId: team.id, name: team.name, ok: true, teamIdCh: res.resolved.teamId });
    } catch (e) {
      results.push({ teamId: team.id, name: team.name, ok: false, error: e.message });
    }
  }
  return { results };
}
