import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BCRA_TOKEN = process.env.BCRA_TOKEN;

app.get("/health", (req, res) => res.json({ ok: true }));

/**
 * Discover which candidate series names exist upstream.
 * Example: /bcra/discover?candidates=leliq,tasa_leliq,tasa_badlar,reservas,uva
 */
app.get("/bcra/discover", async (req, res) => {
  try {
    if (!BCRA_TOKEN) {
      return res.status(500).json({ error: "Missing BCRA_TOKEN env var" });
    }

    const candidates = String(req.query.candidates || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (candidates.length === 0) {
      return res.status(400).json({
        error: "Missing candidates",
        example: "/bcra/discover?candidates=leliq,reservas,uva,tasa_badlar"
      });
    }

    const results = [];
    for (const name of candidates) {
      const url = `https://api.estadisticasbcra.com/${encodeURIComponent(name)}`;
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${BCRA_TOKEN}` }
      });
      results.push({ name, ok: r.ok, status: r.status });
    }

    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: "Unexpected error", detail: String(e) });
  }
});

/**
 * Get a BCRA time series by name or alias.
 * Supports query params to avoid huge payloads:
 *  - last: integer, returns only last N points
 *  - since: YYYY-MM-DD, returns only points with d >= since
 *
 * Examples:
 *  /bcra/series/reservas?last=400
 *  /bcra/series/reservas?since=2024-01-01
 *  /bcra/series/policy_rate?last=60
 */
app.get("/bcra/series/:serie", async (req, res) => {
  try {
    let { serie } = req.params;
    serie = String(serie).trim();

    const ALIASES = {
      policy_rate: "leliq",
      badlar: "tasa_badlar"
    };

    const resolved = ALIASES[serie] || serie;

    if (!BCRA_TOKEN) {
      return res.status(500).json({ error: "Missing BCRA_TOKEN env var" });
    }

    const url = `https://api.estadisticasbcra.com/${encodeURIComponent(resolved)}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${BCRA_TOKEN}` }
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({
        error: "BCRA API error",
        serie_requested: serie,
        serie_resolved: resolved,
        detail: text
      });
    }

    let data = await r.json();

    // Expecting array of points like: [{ d: "YYYY-MM-DD", v: number }, ...]
    if (!Array.isArray(data)) {
      // If upstream changes format, still return something useful.
      return res.json({ serie, resolved, data });
    }

    // Apply "since" filter (YYYY-MM-DD)
    const sinceRaw = req.query.since;
    if (sinceRaw) {
      const since = String(sinceRaw).trim();
      // Basic validation for YYYY-MM-DD
      if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
        return res.status(400).json({
          error: "Invalid 'since' format. Expected YYYY-MM-DD.",
          example: "/bcra/series/reservas?since=2024-01-01"
        });
      }
      data = data.filter((p) => p && typeof p.d === "string" && p.d >= since);
    }

    // Apply "last" limit
    const lastRaw = req.query.last;
    if (lastRaw !== undefined) {
      const last = Number(lastRaw);
      if (!Number.isFinite(last) || last <= 0 || !Number.isInteger(last)) {
        return res.status(400).json({
          error: "Invalid 'last'. Expected positive integer.",
          example: "/bcra/series/reservas?last=400"
        });
      }
      if (data.length > last) data = data.slice(-last);
    }

    res.json({
      serie,
      resolved,
      count: data.length,
      data
    });
  } catch (e) {
    res.status(500).json({ error: "Unexpected error", detail: String(e) });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
