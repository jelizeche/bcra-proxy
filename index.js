import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BCRA_TOKEN = process.env.BCRA_TOKEN;
app.get("/bcra/discover", async (req, res) => {
  try {
    if (!BCRA_TOKEN) {
      return res.status(500).json({ error: "Missing BCRA_TOKEN env var" });
    }

    const candidates = String(req.query.candidates || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    if (candidates.length === 0) {
      return res.status(400).json({
        error: "Missing candidates",
        example:
          "/bcra/discover?candidates=leliq,reservas,uva,badlar_en_pesos_de_bancos_privados,tamar_en_pesos_de_bancos_privados"
      });
    }

    const results = [];
    for (const name of candidates) {
      const url = `https://api.estadisticasbcra.com/${encodeURIComponent(name)}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${BCRA_TOKEN}` } });
      results.push({ name, ok: r.ok, status: r.status });
    }

    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: "Unexpected error", detail: String(e) });
  }
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/bcra/series/:serie", async (req, res) => {
  try {
    const { serie } = req.params;

    if (!BCRA_TOKEN) {
      return res.status(500).json({ error: "Missing BCRA_TOKEN env var" });
    }

    const url = `https://api.estadisticasbcra.com/${encodeURIComponent(serie)}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${BCRA_TOKEN}` },
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({ error: "BCRA API error", detail: text });
    }

    const data = await r.json();
    res.json({ serie, data });
  } catch (e) {
    res.status(500).json({ error: "Unexpected error", detail: String(e) });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
