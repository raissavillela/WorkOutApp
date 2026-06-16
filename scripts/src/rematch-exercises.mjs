import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(ROOT, "artifacts/api-server/data");
const CACHE_FILE = path.join(DATA_DIR, "exercise-media-cache.json");
const TRANSLATIONS_FILE = path.join(DATA_DIR, "exercise-translations.json");
const KEYWORD_CACHE_FILE = path.join(DATA_DIR, "keyword-cache.json");

const KEY = process.env.WORKOUTX_API_KEY || "";
const WX_BASE = "https://api.workoutxapp.com/v1";
const DELAY_MS = 2200;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normKey(s) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const STOP = new Set([
  "the","a","an","of","with","and","on","in","to","for","at","or","by","from",
  "left","right","both","each","alternating","alternate","single","double",
  "unilateral","bilateral","one","two","arm","arms","leg","legs",
  "low","high","up","down","front","back","side","lateral","frontal",
  "isometric","standing","seated","lying","extended","closed","open",
  "weight","weighted","plate","disc",
]);
const KEYWORD_BOOST = new Set([
  "burpee","deadlift","thruster","snatch","clean","jerk","swing","superman",
  "kickback","skullcrusher","goblet","kettlebell","barbell","dumbbell","cable",
  "pulldown","pullover","shrug","mountain","climber","bicycle","jackknife",
  "rdl","sdlhp","glute","hamstring","calf","oblique","windmill","russian",
  "thrust","sumo","romanian","bulgarian","split","hollow","dragon","pistol",
  "elliptical","treadmill","skip","jumping","squat","press","row","curl",
  "raise","lunge","crunch","plank","jump","push","pull","kick","hold","lift",
  "shrug","hammer","concentration","scott","reverse","incline","flat","wide",
  "close","grip","overhead","hip","hip thrust","fly","extension","flexion",
]);

function pickKeywords(en) {
  const toks = en.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[()\\/°]/g," ").replace(/[^a-z0-9 ]/g," ").split(/\s+/)
    .filter(t => t && t.length >= 3 && !STOP.has(t));
  const uniq = Array.from(new Set(toks));
  return uniq.sort((a,b) => {
    const ba = KEYWORD_BOOST.has(a) ? 0 : 1;
    const bb = KEYWORD_BOOST.has(b) ? 0 : 1;
    if (ba !== bb) return ba - bb;
    return b.length - a.length;
  });
}

function scoreMatch(query, candidate) {
  const q = normKey(query).split(" ").filter(Boolean);
  const c = normKey(candidate).split(" ").filter(Boolean);
  if (!q.length || !c.length) return 0;
  let overlap = 0;
  for (const w of q) if (c.includes(w)) overlap++;
  return overlap * 2 - Math.abs(c.length - q.length) * 0.3;
}

const keywordCache = readJson(KEYWORD_CACHE_FILE, {});
let _lastApiCall = 0;

async function wxFetch(p) {
  if (!KEY) throw new Error("WORKOUTX_API_KEY not set");
  const now = Date.now();
  const wait = Math.max(0, _lastApiCall + DELAY_MS - now);
  if (wait > 0) await sleep(wait);
  _lastApiCall = Date.now();
  const url = `${WX_BASE}${p}`;
  const r = await fetch(url, { headers: { "X-WorkoutX-Key": KEY } });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    if (r.status === 429) { await sleep(6000); throw new Error("rate_limit"); }
    throw new Error(`WX ${r.status}: ${body.slice(0,100)}`);
  }
  return r.json();
}

async function fetchByKeyword(kw) {
  if (keywordCache[kw]) return keywordCache[kw];
  try {
    const raw = await wxFetch(`/exercises/name/${encodeURIComponent(kw)}`);
    const arr = Array.isArray(raw?.data) ? raw.data : [];
    keywordCache[kw] = arr;
    return arr;
  } catch(e) {
    console.warn(`  keyword fetch failed for "${kw}": ${e.message}`);
    return [];
  }
}

// Generate synonym variations for a given EN translation
function generateVariants(enName) {
  const base = enName;
  const variants = [base];

  const rules = [
    [/Dumbbell/gi, "DB"],
    [/\bDB\b/g, "Dumbbell"],
    [/Cable/gi, ""],
    [/Romanian Deadlift/gi, "RDL"],
    [/\bRDL\b/g, "Romanian Deadlift"],
    [/Unilateral/gi, "Single Arm"],
    [/Single Arm/gi, "Unilateral"],
    [/Bilateral/gi, ""],
    [/Straight Bar/gi, "Bar"],
    [/Overhead/gi, "OH"],
    [/\bOH\b/g, "Overhead"],
    [/Hip Thrust/gi, "Glute Bridge"],
    [/Front Raise/gi, "Anterior Raise"],
    [/Lateral Raise/gi, "Side Raise"],
    [/Bent-Over Row/gi, "Bent Over Row"],
    [/Bent Over Row/gi, "Bent-Over Row"],
    [/Pushdown/gi, "Push Down"],
    [/Pulldown/gi, "Pull Down"],
    [/Shoulder Press/gi, "Overhead Press"],
    [/Overhead Press/gi, "Shoulder Press"],
    [/Squat Hold/gi, "Squat Isometric"],
    [/High Knees/gi, "Running in Place"],
    [/Alternating Jump Lunge/gi, "Jump Lunge"],
    [/Forearm Plank/gi, "Elbow Plank"],
    [/Forearm Plank/gi, "Plank"],
    [/Hammer Curl/gi, "Neutral Curl"],
    [/Scott Curl/gi, "Preacher Curl"],
    [/Wrist Curl/gi, "Forearm Curl"],
    [/Mountain Climber/gi, "Mountain Climb"],
    [/Wide-Grip/gi, "Wide Grip"],
    [/Close-Grip/gi, "Close Grip"],
  ];

  for (const [from, to] of rules) {
    const v = base.replace(from, to).replace(/\s+/g," ").trim();
    if (v && v !== base && !variants.includes(v)) variants.push(v);
  }

  // Also add first 2-word version for compound names
  const words = base.split(/\s+/);
  if (words.length > 3) {
    variants.push(words.slice(0,3).join(" "));
    variants.push(words.slice(0,2).join(" "));
  }

  return variants.slice(0, 5);
}

async function searchBestMatch(ptName, enName) {
  const variants = generateVariants(enName);
  const seen = new Map();
  let attemptsUsed = 0;

  for (const variant of variants) {
    const keywords = pickKeywords(variant);
    for (const kw of keywords.slice(0,2)) {
      if (attemptsUsed >= 5) break;
      const arr = await fetchByKeyword(kw);
      attemptsUsed++;
      for (const e of arr) {
        const id = e.id || e.exerciseId;
        if (id && !seen.has(id)) seen.set(id, e);
      }
    }
    if (attemptsUsed >= 5) break;
  }

  if (!seen.size) return { best: null, candidates: [], variantsSearched: variants };

  const all = Array.from(seen.values()).map(e => {
    const id = e.id || e.exerciseId || "";
    const name = e.name || "";
    const gifUrl = id ? `/api/exercise-media/gif/${id}` : "";
    return { id, name, gifUrl, bodyPart: e.bodyPart ?? null, target: e.target ?? null };
  }).filter(x => x.id);

  // Score against all variants and take best
  let bestScore = 0;
  let best = null;
  for (const candidate of all) {
    for (const variant of variants) {
      const s = scoreMatch(variant, candidate.name);
      if (s > bestScore) { bestScore = s; best = candidate; }
    }
  }

  const ranked = all
    .map(p => ({ p, s: Math.max(...variants.map(v => scoreMatch(v, p.name))) }))
    .filter(r => r.s > 0)
    .sort((a,b) => b.s - a.s);

  return {
    best: bestScore > 0 ? best : null,
    bestScore,
    candidates: ranked.slice(0,8).map(r => r.p),
    variantsSearched: variants,
  };
}

function confidenceLabel(score) {
  if (score >= 4) return "Alta";
  if (score >= 2) return "Média";
  return "Baixa";
}

async function main() {
  if (!KEY) {
    console.error("❌ WORKOUTX_API_KEY not set. Export it before running.");
    process.exit(1);
  }

  // Load current state
  const cache = readJson(CACHE_FILE, {});
  const translations = readJson(TRANSLATIONS_FILE, {});

  // Find all exercises in WDB that are sem match
  const htmlPath = path.resolve(ROOT, "artifacts/workout/index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const wdbMatch = html.match(/const WDB=(\[[\s\S]*?\]);?\n/);
  if (!wdbMatch) { console.error("WDB not found in index.html"); process.exit(1); }
  const wdb = eval(wdbMatch[1]);

  const allExNames = new Set();
  wdb.forEach(w => (w.s||[]).forEach(st => (st.e||[]).forEach(ex => { if(ex.n) allExNames.add(ex.n); })));

  // Filter to only those without cache match
  const toProcess = [];
  for (const name of allExNames) {
    const key = normKey(name);
    const cached = cache[key];
    if (!cached || cached.source === 'miss') {
      const enName = translations[name] || translations[key];
      if (enName) toProcess.push({ name, key, enName });
      else toProcess.push({ name, key, enName: name }); // fallback: use PT name
    }
  }

  console.log(`\n🔍 Exercícios para reprocessar: ${toProcess.length}\n`);
  if (!toProcess.length) { console.log("✅ Nenhum exercício sem match!"); return; }

  const report = [];
  let matched = 0;
  let noMatch = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const { name, key, enName } = toProcess[i];
    process.stdout.write(`[${i+1}/${toProcess.length}] ${name} → ${enName} ... `);

    try {
      const { best, bestScore, candidates, variantsSearched } = await searchBestMatch(name, enName);

      if (best && bestScore >= 2) {
        // Save to cache
        cache[key] = {
          query: name,
          exerciseId: best.id,
          name: best.name,
          gifUrl: best.gifUrl,
          bodyPart: best.bodyPart,
          target: best.target,
          candidates,
          ts: Date.now(),
          source: "auto",
        };
        writeJson(CACHE_FILE, cache);
        writeJson(KEYWORD_CACHE_FILE, keywordCache);
        console.log(`✅ "${best.name}" [${confidenceLabel(bestScore)}]`);
        matched++;
        report.push({ original: name, translation: enName, found: best.name, confidence: confidenceLabel(bestScore), status: "Matched" });
      } else {
        console.log(`❌ sem match (score ${bestScore?.toFixed(1)||0})`);
        noMatch++;
        report.push({ original: name, translation: enName, found: best?.name || "—", confidence: "—", status: "Sem Match" });
      }
    } catch(e) {
      console.log(`⚠️  erro: ${e.message}`);
      report.push({ original: name, translation: enName, found: "—", confidence: "—", status: "Erro" });
    }
  }

  // Save final state
  writeJson(CACHE_FILE, cache);
  writeJson(KEYWORD_CACHE_FILE, keywordCache);

  // Print report
  console.log(`\n${"=".repeat(80)}`);
  console.log(`RELATÓRIO FINAL — ${new Date().toLocaleString("pt-BR")}`);
  console.log(`${"=".repeat(80)}`);
  console.log(`Total processado: ${toProcess.length}`);
  console.log(`✅ Matched: ${matched}`);
  console.log(`❌ Sem match: ${noMatch}`);
  console.log(`\n${"─".repeat(80)}`);
  console.log(
    "Exercício Original".padEnd(45) +
    "Match Encontrado".padEnd(35) +
    "Confiança".padEnd(12) +
    "Status"
  );
  console.log("─".repeat(80));
  for (const r of report) {
    console.log(
      r.original.slice(0,44).padEnd(45) +
      (r.found||"—").slice(0,34).padEnd(35) +
      r.confidence.padEnd(12) +
      r.status
    );
  }
  console.log(`${"=".repeat(80)}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
