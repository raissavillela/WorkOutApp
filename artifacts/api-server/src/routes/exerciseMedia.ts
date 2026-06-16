import { Router, type IRouter } from "express";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const WX_BASE = "https://api.workoutxapp.com/v1";
const KEY = process.env.WORKOUTX_API_KEY || "";

function resolveDataDir(): string {
  const candidates = [
    path.resolve(process.cwd(), "data"),
    path.resolve(process.cwd(), "artifacts/api-server/data"),
    path.resolve(process.cwd(), "../api-server/data"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  const fallback = path.resolve(process.cwd(), "data");
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}
const DATA_DIR = resolveDataDir();
const CACHE_FILE = path.join(DATA_DIR, "exercise-media-cache.json");
const OVERRIDES_FILE = path.join(DATA_DIR, "exercise-media-overrides.json");
const CUSTOM_URLS_FILE = path.join(DATA_DIR, "exercise-media-custom-urls.json");
const TRANSLATIONS_FILE = path.join(DATA_DIR, "exercise-translations.json");
const GIF_CACHE_DIR = path.join(DATA_DIR, "gif-cache");
if (!fs.existsSync(GIF_CACHE_DIR)) fs.mkdirSync(GIF_CACHE_DIR, { recursive: true });

type CacheEntry = {
  query: string;
  exerciseId: string | null;
  name: string | null;
  gifUrl: string | null;
  bodyPart?: string | null;
  target?: string | null;
  candidates?: Array<{ id: string; name: string; gifUrl: string }>;
  ts: number;
  source: "auto" | "override" | "miss" | "custom";
  customUrl?: string;
};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}
function writeJson(file: string, data: unknown) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let cache: Record<string, CacheEntry> = readJson(CACHE_FILE, {});
let overrides: Record<string, string> = readJson(OVERRIDES_FILE, {});
let customUrls: Record<string, string> = readJson(CUSTOM_URLS_FILE, {});
const translations: Record<string, string> = readJson(TRANSLATIONS_FILE, {});

function normKey(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function persistCache() {
  writeJson(CACHE_FILE, cache);
}
function persistOverrides() {
  writeJson(OVERRIDES_FILE, overrides);
}
function persistCustomUrls() {
  writeJson(CUSTOM_URLS_FILE, customUrls);
}

async function wxFetch(p: string): Promise<unknown> {
  if (!KEY) throw new Error("WORKOUTX_API_KEY not configured");
  const url = `${WX_BASE}${p}`;
  const r = await fetch(url, { headers: { "X-WorkoutX-Key": KEY } });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`WorkoutX ${r.status}: ${body.slice(0, 200)}`);
  }
  return r.json();
}

type WxExercise = {
  id?: string;
  exerciseId?: string;
  name?: string;
  gifUrl?: string;
  gif_url?: string;
  bodyPart?: string;
  target?: string;
};

function pickFields(e: WxExercise) {
  const id = e.id || e.exerciseId || "";
  const name = e.name || "";
  const gifUrl = id ? `/api/exercise-media/gif/${id}` : "";
  return { id, name, gifUrl, bodyPart: e.bodyPart ?? null, target: e.target ?? null };
}

function scoreMatch(query: string, candidate: string): number {
  const q = normKey(query).split(" ").filter(Boolean);
  const c = normKey(candidate).split(" ").filter(Boolean);
  if (!q.length || !c.length) return 0;
  let overlap = 0;
  for (const w of q) if (c.includes(w)) overlap++;
  return overlap * 2 - Math.abs(c.length - q.length) * 0.3;
}

const STOP = new Set([
  "the","a","an","of","with","and","on","in","to","for","at","or","by","from",
  "left","right","both","each","alternating","alternate","alternated",
  "single","double","unilateral","bilateral","one","two","arm","arms","leg","legs",
  "low","high","up","down","front","back","side","lateral","frontal","posterior","anterior",
  "isometric","standing","seated","lying","extended","closed","open",
  "weight","weighted","plate","disc",
]);
const COMMON_KEYWORDS = new Set([
  "squat","press","row","curl","raise","lunge","crunch","plank","jump",
  "step","push","pull","kick","hold","walk","lift",
]);
const KEYWORD_BOOST = new Set([
  "burpee","deadlift","thruster","snatch","clean","jerk","swing","superman",
  "kickback","skullcrusher","goblet","kettlebell","barbell","dumbbell","cable",
  "pulldown","pullover","shrug","mountain","climber","bicycle","jackknife",
  "rdl","sdlhp","glute","hamstring","calf","oblique","windmill","russian",
  "thrust","sumo","romanian","bulgarian","split","hollow","dragon","pistol",
  "elliptical","treadmill","skip","polichinelo","jumping",
]);

function pickKeywords(en: string): string[] {
  const toks = en
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[()\\/]/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t && t.length >= 3 && !STOP.has(t));
  const uniq = Array.from(new Set(toks));
  return uniq.sort((a, b) => {
    const ba = KEYWORD_BOOST.has(a) ? 0 : COMMON_KEYWORDS.has(a) ? 2 : 1;
    const bb = KEYWORD_BOOST.has(b) ? 0 : COMMON_KEYWORDS.has(b) ? 2 : 1;
    if (ba !== bb) return ba - bb;
    return b.length - a.length;
  });
}

const KEYWORD_CACHE_FILE = path.join(DATA_DIR, "keyword-cache.json");
const keywordCache: Record<string, WxExercise[]> = readJson(KEYWORD_CACHE_FILE, {});
let _kwSaveTimer: NodeJS.Timeout | null = null;
function saveKeywordCache() {
  if (_kwSaveTimer) return;
  _kwSaveTimer = setTimeout(() => {
    _kwSaveTimer = null;
    writeJson(KEYWORD_CACHE_FILE, keywordCache);
  }, 500);
}
let _lastApiCall = 0;
const MIN_API_INTERVAL = 2100;
async function throttledApiCall<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const wait = Math.max(0, _lastApiCall + MIN_API_INTERVAL - now);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  _lastApiCall = Date.now();
  return fn();
}

async function fetchByKeyword(keyword: string): Promise<WxExercise[]> {
  if (keywordCache[keyword]) return keywordCache[keyword];
  try {
    const raw = (await throttledApiCall(() =>
      wxFetch(`/exercises/name/${encodeURIComponent(keyword)}`),
    )) as { data?: WxExercise[] };
    const arr = Array.isArray(raw?.data) ? raw.data : [];
    keywordCache[keyword] = arr;
    saveKeywordCache();
    return arr;
  } catch (e) {
    const msg = String(e);
    logger.warn({ err: msg, keyword }, "wx keyword fetch failed");
    if (msg.includes("429") || msg.includes("rate")) {
      await new Promise((r) => setTimeout(r, 5000));
    }
    return [];
  }
}

async function searchExercise(query: string): Promise<{
  best: ReturnType<typeof pickFields> | null;
  candidates: Array<ReturnType<typeof pickFields>>;
}> {
  const keywords = pickKeywords(query);
  if (!keywords.length) return { best: null, candidates: [] };
  const seen = new Map<string, WxExercise>();
  for (const kw of keywords.slice(0, 3)) {
    const arr = await fetchByKeyword(kw);
    for (const e of arr) {
      const id = e.id || e.exerciseId;
      if (id && !seen.has(id)) seen.set(id, e);
    }
    if (seen.size >= 60) break;
  }
  const all = Array.from(seen.values()).map(pickFields).filter((x) => x.id);
  if (!all.length) return { best: null, candidates: [] };
  const ranked = all
    .map((p) => ({ p, s: scoreMatch(query, p.name) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s);
  if (!ranked.length) return { best: null, candidates: all.slice(0, 8) };
  return {
    best: ranked[0].p,
    candidates: ranked.slice(0, 8).map((r) => r.p),
  };
}

router.get("/exercise-media", async (req, res) => {
  const ptName = String(req.query.name || "").trim();
  if (!ptName) return res.status(400).json({ error: "name required" });
  const key = normKey(ptName);

  if (overrides[key]) {
    const id = overrides[key];
    let entry = cache[key];
    if (!entry || entry.exerciseId !== id) {
      try {
        const raw = await wxFetch(`/exercises/exercise/${encodeURIComponent(id)}`).catch(
          () => wxFetch(`/exercises/${encodeURIComponent(id)}`),
        );
        const e = pickFields(raw as WxExercise);
        entry = {
          query: ptName,
          exerciseId: e.id || id,
          name: e.name || null,
          gifUrl: `/api/exercise-media/gif/${id}`,
          bodyPart: e.bodyPart,
          target: e.target,
          ts: Date.now(),
          source: "override",
        };
      } catch {
        entry = {
          query: ptName,
          exerciseId: id,
          name: null,
          gifUrl: `/api/exercise-media/gif/${id}`,
          ts: Date.now(),
          source: "override",
        };
      }
      cache[key] = entry;
      persistCache();
    } else if (entry.source !== "override") {
      entry = { ...entry, source: "override", gifUrl: `/api/exercise-media/gif/${id}` };
      cache[key] = entry;
      persistCache();
    }
    return res.json(entry);
  }

  if (customUrls[key]) {
    return res.json({
      query: ptName,
      exerciseId: null,
      name: null,
      gifUrl: customUrls[key],
      ts: Date.now(),
      source: "custom",
      customUrl: customUrls[key],
    });
  }

  const cached = cache[key];
  if (cached && Date.now() - cached.ts < 30 * 24 * 60 * 60 * 1000) {
    return res.json(cached);
  }

  if (!KEY) {
    return res.status(503).json({
      error: "api_key_missing",
      message: "WORKOUTX_API_KEY not configured on server",
    });
  }

  const enName = translations[ptName] || translations[key] || ptName;
  try {
    const { best, candidates } = await searchExercise(enName);
    const entry: CacheEntry = best
      ? {
          query: ptName,
          exerciseId: best.id,
          name: best.name,
          gifUrl: best.gifUrl,
          bodyPart: best.bodyPart,
          target: best.target,
          candidates,
          ts: Date.now(),
          source: "auto",
        }
      : {
          query: ptName,
          exerciseId: null,
          name: null,
          gifUrl: null,
          candidates: [],
          ts: Date.now(),
          source: "miss",
        };
    cache[key] = entry;
    persistCache();
    return res.json(entry);
  } catch (e) {
    logger.error({ err: String(e), name: ptName }, "exercise-media lookup failed");
    return res.status(502).json({ error: "upstream_error", message: String(e) });
  }
});

router.get("/exercise-media/candidates", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "q required" });
  if (!KEY) return res.status(503).json({ error: "api_key_missing" });
  try {
    const { candidates } = await searchExercise(q);
    res.json({ candidates });
  } catch (e) {
    res.status(502).json({ error: "upstream_error", message: String(e) });
  }
});

router.post("/exercise-media/override", express_json(), (req, res) => {
  const { name, exerciseId } = (req.body || {}) as { name?: string; exerciseId?: string | null };
  if (!name) return res.status(400).json({ error: "name required" });
  const key = normKey(name);
  if (!exerciseId) {
    delete overrides[key];
    delete cache[key];
  } else {
    overrides[key] = exerciseId;
    delete cache[key];
  }
  persistOverrides();
  persistCache();
  res.json({ ok: true });
});

router.post("/exercise-media/custom-url", express_json(), (req, res) => {
  const { name, url } = (req.body || {}) as { name?: string; url?: string | null };
  if (!name) return res.status(400).json({ error: "name required" });
  const key = normKey(name);
  if (!url || !String(url).trim()) {
    delete customUrls[key];
  } else {
    const u = String(url).trim();
    if (!/^https?:\/\//i.test(u)) {
      return res.status(400).json({ error: "url must be http(s)" });
    }
    customUrls[key] = u;
  }
  persistCustomUrls();
  res.json({ ok: true });
});

async function fetchAndCacheGif(id: string): Promise<{ buf: Buffer; ct: string } | null> {
  for (const urlSuffix of [`/gifs/${id}.gif`, `/gifs/${id}`]) {
    try {
      const r = await fetch(`${WX_BASE}${urlSuffix}`, {
        headers: { "X-WorkoutX-Key": KEY },
      });
      if (!r.ok) continue;
      const ct = r.headers.get("content-type") || "image/gif";
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 100) continue;
      const ext = ct.includes("webp") ? "webp" : ct.includes("png") ? "png" : "gif";
      const cachePath = path.join(GIF_CACHE_DIR, `${id}.${ext}`);
      fs.writeFileSync(cachePath, buf);
      return { buf, ct };
    } catch {
      continue;
    }
  }
  return null;
}

function findCachedGif(id: string): { buf: Buffer; ct: string } | null {
  for (const ext of ["gif", "webp", "png"]) {
    const p = path.join(GIF_CACHE_DIR, `${id}.${ext}`);
    if (fs.existsSync(p)) {
      const ct = ext === "webp" ? "image/webp" : ext === "png" ? "image/png" : "image/gif";
      return { buf: fs.readFileSync(p), ct };
    }
  }
  return null;
}

router.get("/exercise-media/gif/:id", async (req, res) => {
  const id = String(req.params.id || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!id) return res.status(400).end();

  const fromDisk = findCachedGif(id);
  if (fromDisk) {
    res.setHeader("Content-Type", fromDisk.ct);
    res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    return res.end(fromDisk.buf);
  }

  if (!KEY) return res.status(503).end();
  try {
    const result = await fetchAndCacheGif(id);
    if (!result) return res.status(404).end();
    res.setHeader("Content-Type", result.ct);
    res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    return res.end(result.buf);
  } catch (e) {
    logger.warn({ err: String(e), id }, "gif proxy failed");
    return res.status(502).end();
  }
});

router.get("/exercise-media/_status", (_req, res) => {
  res.json({
    keyConfigured: !!KEY,
    cacheSize: Object.keys(cache).length,
    overrideCount: Object.keys(overrides).length,
  });
});

function express_json() {
  // Body parser is already applied globally in app.ts; this is a no-op middleware.
  return (_req: unknown, _res: unknown, next: () => void) => next();
}

export default router;
