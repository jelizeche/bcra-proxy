import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BCRA_TOKEN = process.env.BCRA_TOKEN;

/**
 * Discover which candidate series names exist upstream (api.estadisticasbcra.com)
 * Example:
 *  /bcra/discover?candidates=leliq,tasa_leliq,tasa_badlar
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
        example:
          "/bcra/discover?candidates=leliq,reservas,uva,tasa_badlar,tasa_leliq",
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

    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: "Unexpected error", detail: String(e) });
  }
});

app.get("/health", (req, res) => res.json({ ok: true }));

/**
 * Get a BCRA time series by name (supports aliases)
 * Examples:
 *  /bcra/series/reservas
 *  /bcra/series/uva
 *  /bcra/series/policy_rate  -> leliq
 *  /bcra/series/badlar       -> tasa_badlar
 */
app.get("/bcra/series/:serie", async (req, res) => {
  try {
    let { serie } = req.params;

    // 1) sanitize
    serie = String(serie).trim();

    // 2) stable aliases (so GPT never has to guess upstream names)
    const ALIASES = {
      policy_rate: "leliq",     // ✅ "tasa de política" proxy
      badlar: "tasa_badlar",    // ✅ BADLAR proxy (exists in your discover)
      leliq: "leliq",           // optional: explicit
      tasa_leliq: "tasa_leliq", // optional: explicit
    };

    const resolved = ALIASES[serie] || serie;

    if (!BCRA_TOKEN) {
      return res.status(500).json({ error: "Missing BCRA_TOKEN env var" });
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
    res.json({ serie: serie, resolved, data });
  } catch (e) {
    res.status(500).json({ error: "Unexpected error", detail: String(e) });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
