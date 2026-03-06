/**
 * bcra-proxy (Render-ready)
 * Endpoints:
 *  - GET /            (health)
 *  - GET /health      (health)
 *  - GET /bcra/discover?candidates=a,b,c
 *  - GET /bcra/series/:serie?last=120&since=YYYY-MM-DD
 *  - GET /bcra/metrics/:serie?months=12
 */

import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;
const BCRA_TOKEN = async function fetchReservasFromOfficialBcra() {
  // TODO: reemplazar por el endpoint oficial exacto de reservas
  const url = "https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias/1";

  const r = await fetch(url);
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Official BCRA API error: ${r.status} ${text}`);
  }

  const json = await r.json();

  // Ajustar según estructura real de la API oficial
  const results = json.results || json.Resultado || [];

  return results
    .map((x) => ({
      d: x.fecha || x.Fecha,
      v: Number(x.valor ?? x.Valor),
    }))
    .filter((x) => x.d && Number.isFinite(x.v));
};

// ---- helpers ----
const ALIASES = {
  policy_rate: "leliq",
  badlar: "tasa_badlar",
};

function requireToken(res) {
  if (!BCRA_TOKEN) {
    res.status(500).json({ error: "Missing BCRA_TOKEN env var" });
    return false;
  }
  return true;
}

// ---- health ----
app.get("/", (_req, res) => res.status(200).json({ ok: true, service: "bcra-proxy" }));
app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

// ---- discover ----
app.get("/bcra/discover", async (req, res) => {
  try {
    if (!requireToken(res)) return;

    const candidates = String(req.query.candidates || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (candidates.length === 0) {
      return res.status(400).json({
        error: "Missing candidates",
        example: "/bcra/discover?candidates=leliq,reservas,uva,tasa_badlar",
      });
    }

    const results = [];
    for (const name of candidates) {
      const url = `https://api.estadisticasbcra.com/${encodeURIComponent(name)}`;
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${BCRA_TOKEN}` },
      });
      results.push({ name, ok: r.ok, status: r.status });
    }

    return res.json({ results });
  } catch (e) {
    return res.status(500).json({ error: "Unexpected error", detail: String(e) });
  }
});

// ---- series (filtered to avoid huge payloads) ----
app.get("/bcra/series/:serie", async (req, res) => {
  try {
    if (!requireToken(res)) return;

    let { serie } = req.params;
    serie = String(serie).trim();
    const resolved = ALIASES[serie] || serie;

    const url = `https://api.estadisticasbcra.com/${encodeURIComponent(resolved)}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${BCRA_TOKEN}` },
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({
        error: "BCRA API error",
        serie_requested: serie,
        serie_resolved: resolved,
        detail: text,
      });
    }

    let data = await r.json();

    if (!Array.isArray(data)) {
      return res.json({ serie, resolved, data });
    }

    // since=YYYY-MM-DD
    const sinceRaw = req.query.since;
    if (sinceRaw) {
      const since = String(sinceRaw).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
        return res.status(400).json({
          error: "Invalid 'since' format. Expected YYYY-MM-DD.",
          example: "/bcra/series/reservas?since=2024-01-01",
        });
      }
      data = data.filter((p) => p && typeof p.d === "string" && p.d >= since);
    }

    // last=N
    const lastRaw = req.query.last;
    if (lastRaw !== undefined) {
      const last = Number(lastRaw);
      if (!Number.isFinite(last) || last <= 0 || !Number.isInteger(last)) {
        return res.status(400).json({
          error: "Invalid 'last'. Expected positive integer.",
          example: "/bcra/series/reservas?last=120",
        });
      }
      if (data.length > last) data = data.slice(-last);
    }

    return res.json({ serie, resolved, count: data.length, data });
  } catch (e) {
    return res.status(500).json({ error: "Unexpected error", detail: String(e) });
  }
});

// ---- metrics (compact; avoids ResponseTooLargeError) ----
app.get("/bcra/metrics/:serie", async (req, res) => {
  try {
    if (!requireToken(res)) return;

    let { serie } = req.params;
    serie = String(serie).trim();
    const resolved = ALIASES[serie] || serie;

    const monthsRaw = req.query.months ?? "12";
    const months = Number(monthsRaw);
    if (!Number.isFinite(months) || months <= 0) {
      return res.status(400).json({
        error: "Invalid 'months'. Expected positive number.",
        example: "/bcra/metrics/reservas?months=12",
      });
    }

    const url = `https://api.estadisticasbcra.com/${encodeURIComponent(resolved)}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${BCRA_TOKEN}` },
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({
        error: "BCRA API error",
        serie_requested: serie,
        serie_resolved: resolved,
        detail: text,
      });
    }

    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0) {
      return res.json({ serie, resolved, error: "Empty series" });
    }

    const latest = data[data.length - 1];
    if (!latest?.d || typeof latest.v !== "number") {
      return res.json({ serie, resolved, error: "Unexpected data format" });
    }

    const latestDate = new Date(`${latest.d}T00:00:00Z`);
    const target = new Date(latestDate);
    target.setUTCMonth(target.getUTCMonth() - Math.round(months));

    let closest = null;
    let bestDiff = Infinity;
    for (const p of data) {
      if (!p?.d || typeof p.v !== "number") continue;
      const dt = new Date(`${p.d}T00:00:00Z`).getTime();
      const diff = Math.abs(dt - target.getTime());
      if (diff < bestDiff) {
        bestDiff = diff;
        closest = p;
      }
    }

    if (!closest) {
      return res.json({ serie, resolved, error: "Could not find comparison point" });
    }

    const changeAbs = latest.v - closest.v;
    const changePct = closest.v === 0 ? null : changeAbs / closest.v;

    return res.json({
      serie,
      resolved,
      window: { months },
      latest: { d: latest.d, v: latest.v },
      past: { d: closest.d, v: closest.v },
      change_abs: changeAbs,
      change_pct: changePct,
    });
  } catch (e) {
    return res.status(500).json({ error: "Unexpected error", detail: String(e) });
  }
});

app.listen(PORT, "0.0.0.0", () => console.log(`Listening on ${PORT}`));
