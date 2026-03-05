app.get("/bcra/metrics/:serie", async (req, res) => {
  try {
    let { serie } = req.params;
    serie = String(serie).trim();

    const monthsRaw = req.query.months ?? "12";
    const months = Number(monthsRaw);
    if (!Number.isFinite(months) || months <= 0) {
      return res.status(400).json({
        error: "Invalid 'months'. Expected positive number.",
        example: "/bcra/metrics/reservas?months=12"
      });
    }

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

    res.json({
      serie,
      resolved,
      window: { months },
      latest: { d: latest.d, v: latest.v },
      past: { d: closest.d, v: closest.v },
      change_abs: changeAbs,
      change_pct: changePct
    });
  } catch (e) {
    res.status(500).json({ error: "Unexpected error", detail: String(e) });
  }
});
