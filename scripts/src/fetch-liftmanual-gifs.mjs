import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(ROOT, "artifacts/api-server/data");
const CUSTOM_URLS_FILE = path.join(DATA_DIR, "exercise-media-custom-urls.json");
const TRANSLATIONS_FILE = path.join(DATA_DIR, "exercise-translations.json");
const SLUGS_FILE = path.join(DATA_DIR, "liftmanual-slugs.txt");

const DELAY_MS = 200;
const LM_UPLOADS = "https://liftmanual.com/wp-content/uploads/2023/04";

// Manual fallback terms for hard-to-match exercises
const FALLBACK_TERMS = {
  "eliptico": ["elliptical", "cross trainer"],
  "polichinelo lateral": ["side jumping jack", "lateral jumping jack", "jumping jack"],
  "sdlhp": ["sumo deadlift high pull", "high pull"],
  "sdlhp db unilateral": ["dumbbell high pull", "sumo high pull"],
  "abdução horizontal de ombros db": ["dumbbell lateral raise", "lateral raise"],
  "crucifixo em pé cross linha dos ombros": ["cable standing fly", "cable fly"],
  "flexão tronco em pé cross corda": ["cable crunch", "standing cable crunch"],
  "extensão tronco sentado db": ["back extension", "seated back extension"],
  "rosca punho db sentado supinado": ["wrist curl", "dumbbell wrist curl"],
  "tríceps arremesso corda cross": ["cable overhead triceps extension", "rope overhead extension"],
  "desenvolvimento fechado db": ["close grip shoulder press", "dumbbell shoulder press"],
  "rosca inversa cross barra reta": ["cable reverse curl", "reverse curl"],
  "extensão tronco solo unilateral mão na cabeça": ["back extension", "superman"],
  "pulldown cross barra reta": ["cable pulldown", "lat pulldown"],
  "snatch db aberto": ["dumbbell snatch", "power snatch"],
  "saltito frontal alternando pernas": ["alternate leg raise", "alternating hop"],
  "deslocamento lateral com salto alto": ["lateral shuffle", "side shuffle"],
  "lunge db oh": ["overhead lunge", "dumbbell overhead lunge"],
  "elevação de quadril unilateral solo db": ["single leg hip thrust", "unilateral glute bridge"],
  "prancha frontal cotovelo apoiado": ["forearm plank", "elbow plank"],
  "rotação de tronco de baixo para cima anilha": ["wood chop", "plate wood chop"],
  "passada db front": ["dumbbell forward lunge", "forward lunge"],
  "pullover anilha": ["plate pullover", "dumbbell pullover"],
  "step up lateral alternado": ["lateral step up", "dumbbell lateral step up"],
  "crucifixo 30° db": ["dumbbell incline fly", "incline dumbbell fly"],
  "remada curvada supinado cross": ["cable bent over row", "underhand cable row"],
  "snatch db fechado": ["dumbbell snatch", "narrow grip snatch"],
  "rosca scott cross barra reta": ["cable preacher curl", "preacher curl"],
  "elevação frontal cross barra reta": ["cable front raise", "straight bar front raise"],
  "rosca martelo db neutro": ["hammer curl", "dumbbell hammer curl"],
  "tríceps corda cross": ["cable pushdown rope", "rope pushdown"],
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function norm(s) {
  return s.toLowerCase()
    .replace(/[àáâãä]/g, "a").replace(/[èéêë]/g, "e")
    .replace(/[ìíîï]/g, "i").replace(/[òóôõö]/g, "o")
    .replace(/[ùúûü]/g, "u").replace(/[ç]/g, "c").replace(/[ñ]/g, "n")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function slugToWords(slug) {
  return slug.replace(/-/g, " ").split(/\s+/).filter(Boolean);
}

function nameToWords(name) {
  return norm(name).split(/\s+/).filter(Boolean);
}

function score(nameWords, slugWords) {
  const ns = new Set(nameWords);
  const ss = new Set(slugWords);
  let overlap = 0;
  for (const w of ns) if (ss.has(w)) overlap++;
  if (overlap === 0) return 0;
  const total = new Set([...ns, ...ss]).size;
  return overlap / total;
}

function bestMatch(terms, allSlugs, threshold = 0.28) {
  let best = null;
  for (const term of terms) {
    const words = nameToWords(term);
    const scored = allSlugs
      .map(slug => ({ slug, s: score(words, slugToWords(slug)) }))
      .filter(x => x.s >= threshold)
      .sort((a, b) => b.s - a.s);
    if (scored.length && (!best || scored[0].s > best.s)) {
      best = scored[0];
    }
  }
  return best;
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function checkUrl(url, redirects = 3) {
  return new Promise(resolve => {
    const req = https.request(url, {
      method: "GET",
      headers: { "User-Agent": UA, "Range": "bytes=0-0" }
    }, res => {
      res.resume(); // discard body
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location && redirects > 0) {
        return checkUrl(res.headers.location, redirects - 1).then(resolve);
      }
      resolve(res.statusCode === 200 || res.statusCode === 206);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(6000, () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function resolveImageUrl(slug) {
  for (const ext of ["webp", "gif"]) {
    const url = `${LM_UPLOADS}/${slug}.${ext}`;
    const ok = await checkUrl(url);
    if (ok) return url;
    await sleep(80);
  }
  return null;
}

async function main() {
  const allSlugs = fs.readFileSync(SLUGS_FILE, "utf8").trim().split("\n").filter(Boolean);
  console.log(`Loaded ${allSlugs.length} liftmanual exercise slugs\n`);

  const translations = JSON.parse(fs.readFileSync(TRANSLATIONS_FILE, "utf8"));
  const customUrls = JSON.parse(fs.readFileSync(CUSTOM_URLS_FILE, "utf8"));

  const already = new Set(Object.keys(customUrls).map(k => k.toLowerCase()));
  const toProcess = Object.entries(translations).filter(([ptName]) => !already.has(ptName.toLowerCase()));

  console.log(`Exercises without custom URL: ${toProcess.length}`);
  console.log(`Already covered: ${already.size}\n`);

  let matched = 0;
  let noMatch = 0;
  let noImage = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const [ptName, enName] = toProcess[i];
    const ptKey = ptName.toLowerCase();

    const terms = FALLBACK_TERMS[ptKey] ? [...FALLBACK_TERMS[ptKey]] : [enName];

    const simplified = enName
      .replace(/\b(unilateral|bilateral|alternating|alternated|with|and|at|on|the|of)\b/gi, "")
      .replace(/[°\/]/g, " ").replace(/\s+/g, " ").trim();
    if (simplified !== enName && !terms.includes(simplified)) terms.push(simplified);
    if (!terms.includes(enName)) terms.push(enName);

    const best = bestMatch(terms, allSlugs, 0.28);

    if (!best) {
      console.log(`[${i + 1}/${toProcess.length}] NO MATCH: "${ptName}" (EN: "${enName}")`);
      noMatch++;
      continue;
    }

    process.stdout.write(`[${i + 1}/${toProcess.length}] "${ptName}" → ${best.slug} (${best.s.toFixed(2)}) ... `);

    await sleep(DELAY_MS);
    const imgUrl = await resolveImageUrl(best.slug);

    if (!imgUrl) {
      console.log("no image found");
      noImage++;
      continue;
    }

    customUrls[ptKey] = imgUrl;
    console.log(`✓ ${imgUrl.split("/").pop()}`);
    matched++;

    if (matched % 10 === 0) {
      fs.writeFileSync(CUSTOM_URLS_FILE, JSON.stringify(customUrls, null, 2));
      console.log(`  → progresso salvo (${matched} adicionados)\n`);
    }
  }

  fs.writeFileSync(CUSTOM_URLS_FILE, JSON.stringify(customUrls, null, 2));
  console.log(`\n✅ Concluído!`);
  console.log(`   matched: ${matched}`);
  console.log(`   sem match: ${noMatch}`);
  console.log(`   sem imagem: ${noImage}`);
}

main().catch(console.error);
