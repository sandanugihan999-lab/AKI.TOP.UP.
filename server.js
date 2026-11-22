require("dotenv").config();
const express = require("express");
const path = require("path");

const API_KEY = process.env.NOVA_API_KEY;
if (!API_KEY) {
  console.error("NOVA_API_KEY missing. Create a .env file (see .env.example).");
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "2kb" }));
app.use(express.static(path.join(__dirname, "public")));

// Simple per-IP limit so visitors can't burn your monthly verify quota.
const hits = new Map();
const LIMIT = 10;          // requests
const WINDOW = 60 * 1000;  // per minute
function limiter(req, res, next) {
  const now = Date.now();
  const ip = req.ip;
  const list = (hits.get(ip) || []).filter((t) => now - t < WINDOW);
  if (list.length >= LIMIT) {
    return res.status(429).json({ success: false, error: "Too many tries. Wait a minute." });
  }
  list.push(now);
  hits.set(ip, list);
  next();
}
setInterval(() => hits.clear(), 10 * WINDOW).unref();

app.post("/api/player", limiter, async (req, res) => {
  const playerId = String(req.body.player_id || "").trim();
  const region = req.body.region === "MY" ? "MY" : "SG";

  if (!/^\d{5,15}$/.test(playerId)) {
    return res.status(400).json({ success: false, error: "Player ID must be 5 to 15 digits." });
  }

  try {
    const r = await fetch("https://api.novatopup.com/api/v1/verify-player", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({ player_id: playerId, region }),
    });
    const data = await r.json().catch(() => ({}));

    if (r.status === 401 || r.status === 403) {
      console.error("NovaTopup auth/plan problem:", data);
      return res.status(502).json({ success: false, error: "Lookup is unavailable right now." });
    }
    if (r.status === 429) {
      return res.status(429).json({ success: false, error: "Busy. Try again in a moment." });
    }
    if (!data.success) {
      return res.status(404).json({ success: false, error: "Player not found in " + region + "." });
    }

    // Send only what the page needs (no quota info, no raw API response).
    const b = data.basic_info || {};
    res.json({
      success: true,
      player_id: data.player_id,
      nickname: data.nickname,
      region: data.region,
      level: b.level,
      exp: b.exp,
      rank: b.rank,
      br_rank: b.br_rank,
      cs_rank: b.cs_rank,
      liked: b.liked,
      badge_cnt: b.badge_cnt,
    });
  } catch (e) {
    console.error(e);
    res.status(502).json({ success: false, error: "Could not reach the lookup service." });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Running on http://localhost:" + port));
