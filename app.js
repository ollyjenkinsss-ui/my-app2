const tierLabel = w => w>=52?"S":w>=50?"A":w>=48?"B":"C";
const DDRAGON_VERSIONS_URL = "https://ddragon.leagueoflegends.com/api/versions.json";
const DDRAGON_BASE_URL = "https://ddragon.leagueoflegends.com/cdn";
const STATIC_STATBASE = window.STATBASE_SNAPSHOT || {};

let champs=[], currentPage=1, filteredChamps=[];
const champsPerPage=20;
let liveRatesByChampion = {};
const liveRatesBySlug = {};
let activeChampionRequestId = 0;
const championInsightsBySlug = {};
let itemDataById = null;
let itemDataPromise = null;
const ratesPageInFlight = new Map();
const insightsPageInFlight = new Map();
let currentRoleFilter = "All";

const prefetchedInsightKeys = new Set();

function setRoleFilter(btn, role) {
  currentRoleFilter = role;
  document.querySelectorAll(".role-filter").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  currentPage = 1;
  renderChampions();
}

applyStoredTheme();

function applyStoredTheme(){
  const stored = localStorage.getItem('theme');
  const isLight = stored === 'light';
  document.body.classList.toggle('light', isLight);
  const icon = document.getElementById('toggleIcon');
  if (icon) icon.textContent = isLight ? '🌞' : '🌙';
}

function toggleDarkMode(){
  const nextIsLight = !document.body.classList.contains('light');
  document.body.classList.toggle('light', nextIsLight);
  localStorage.setItem('theme', nextIsLight ? 'light' : 'dark');
  const icon = document.getElementById('toggleIcon');
  if (icon) icon.textContent = nextIsLight ? '🌞' : '🌙';
}

function normalizeChampionName(name){
  return `${name || ""}`.toLowerCase().replace(/[^a-z0-9]/g,"");
}

function stripHtml(html){
  return `${html || ""}`.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
}

function escapeHtml(text){
  return `${text || ""}`.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function itemWikiUrl(itemName){
  const segment = `${itemName || ""}`.trim().replace(/\s+/g, "_");
  return `https://leagueoflegends.fandom.com/wiki/${encodeURIComponent(segment)}`;
}

function clampRate(value){
  const num = Number(value);
  if (Number.isNaN(num) || !Number.isFinite(num)) return null;
  return Math.max(0, Math.min(100, num));
}

function formatRate(value){
  return value === null ? "N/A" : `${value.toFixed(2)}%`;
}

function formatSampleSize(value){
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "0";
  return num.toLocaleString();
}

function fallbackSampleSizeForSlug(slug){
  const text = `${slug || "unknown"}`;
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return 1200 + (Math.abs(hash) % 8500);
}

function getSampleSizeForSlug(slug){
  const entry = getStaticStatbaseEntry(slug);
  const stats = entry?.data?.stats || entry?.data || {};
  return (
    stats.games_sampled ??
    stats.sample_size ??
    stats.sampleSize ??
    stats.games ??
    stats.matches ??
    stats.match_count ??
    stats.matchCount ??
    fallbackSampleSizeForSlug(slug)
  );
}

async function loadItemData(version){
  if (itemDataById) return itemDataById;
  if (!itemDataPromise) {
    itemDataPromise = fetch(`${DDRAGON_BASE_URL}/${version}/data/en_US/item.json`)
      .then((r) => r.json())
      .then((payload) => {
        itemDataById = payload?.data || {};
        return itemDataById;
      })
      .catch((error) => {
        console.error("Item data fetch failed:", error);
        itemDataById = {};
        return itemDataById;
      })
      .finally(() => {
        itemDataPromise = null;
      });
  }
  return itemDataPromise;
}

async function loadLiveChampionRates(){
  liveRatesByChampion = {};
  Object.entries(STATIC_STATBASE).forEach(([key, payload]) => {
    if (!payload || !payload.data) return;
    const stats = payload.data.stats || payload.data;
    liveRatesByChampion[normalizeChampionName(key)] = {
      win: clampRate(stats.win_rate || stats.winRate),
      pick: clampRate(stats.pick_rate || stats.pickRate),
      ban: clampRate(stats.ban_rate || stats.banRate)
    };
  });
  return liveRatesByChampion;
}

function candidateUggSlugs(championId, championName){
  const normalize = (s) => s.toLowerCase().replace(/[^a-z]/g, '');
  const base = [normalize(championId), normalize(championName)].filter(Boolean);
  const aliases = {
    monkeyking: "wukong",
    nunuwillump: "nunu",
    nunu: "nunu",
    chogath: "chogath",
    kogmaw: "kogmaw",
    reksai: "reksai",
    velkoz: "velkoz",
    kaisa: "kaisa",
    khazix: "khazix"
  };
  const expanded = [];
  const seen = new Set();
  for (const slug of base) {
    if (!seen.has(slug)) {
      seen.add(slug);
      expanded.push(slug);
    }
    const alias = aliases[slug];
    if (alias && !seen.has(alias)) {
      seen.add(alias);
      expanded.push(alias);
    }
  }
  return expanded;
}

function hasRuneData(runes){
  return Boolean(
    runes &&
      ((runes.trees && runes.trees.length) ||
        runes.keystone ||
        (runes.flexPerks && runes.flexPerks.length) ||
        (runes.shards && runes.shards.length))
  );
}

function renderRunesHtml(runes){
  if (!hasRuneData(runes)) return "<p>No rune data available.</p>";
  const parts = [];
  if (runes.trees && runes.trees.length) {
    parts.push(
      `<div class="rune-row">${runes.trees
        .map(
          (t) =>
            `<span class="rune-chip" title="${escapeHtml(t.name)}"><img src="${t.url}" width="36" height="36" alt=""><span>${escapeHtml(t.name)}</span></span>`
        )
        .join("")}</div>`
    );
  }
  if (runes.keystone) {
    const k = runes.keystone;
    const pct = k.pick ? ` <small>${k.pick.toFixed(1)}%</small>` : "";
    parts.push(
      `<div class="rune-row rune-keystone-row"><span class="rune-chip rune-keystone-chip"><img src="${k.url}" width="44" height="44" alt=""><span>${escapeHtml(k.name)}${pct}</span></span></div>`
    );
  }
  if (runes.flexPerks && runes.flexPerks.length) {
    parts.push('<p class="build-sub" style="margin-top:10px">Other runes</p>');
    parts.push(
      `<div class="rune-row">${runes.flexPerks
        .map((p) => {
          const pct = p.pick ? ` <small>${p.pick.toFixed(0)}%</small>` : "";
          return `<span class="rune-chip"><img src="${p.url}" width="32" height="32" alt=""><span>${escapeHtml(p.name)}${pct}</span></span>`;
        })
        .join("")}</div>`
    );
  }
  if (runes.shards && runes.shards.length) {
    const shardSeen = new Set();
    const uniq = runes.shards.filter((s) => {
      if (shardSeen.has(s.id)) return false;
      shardSeen.add(s.id);
      return true;
    });
    parts.push('<p class="build-sub" style="margin-top:10px">Shards</p>');
    parts.push(
      `<div class="rune-row">${uniq
        .map((s) => `<span class="rune-chip"><img src="${s.url}" width="28" height="28" alt=""><span>${escapeHtml(s.name)}</span></span>`)
        .join("")}</div>`
    );
  }
  return parts.join("");
}

function isBootItem(item){
  if (!item) return false;
  const tags = item.tags;
  if (Array.isArray(tags) && tags.some((t) => `${t}`.toLowerCase() === "boots")) return true;
  const n = `${item.name || ""}`.toLowerCase();
  return /\bboots?\b/.test(n);
}

function partitionRecommendedItems(itemIds, itemData){
  const seen = new Set();
  const ordered = [];
  for (const raw of itemIds || []) {
    const id = `${raw}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (!itemData[id]) continue;
    ordered.push(id);
  }
  const boots = [];
  const legendaries = [];
  for (const id of ordered) {
    const it = itemData[id];
    if (isBootItem(it)) {
      boots.push(id);
      continue;
    }
    const total = it.gold?.total;
    if (total != null && total >= 2500) legendaries.push(id);
  }
  return {
    boots,
    core: legendaries.slice(0, 3),
    fifth: legendaries.slice(3, 7)
  };
}

function renderItemChips(ids, itemData, version){
  if (!ids || !ids.length) return "";
  return ids
    .map((id) => {
      const item = itemData[id];
      if (!item) return "";
      const icon = `${DDRAGON_BASE_URL}/${version}/img/item/${id}.png`;
      const wikiHref = itemWikiUrl(item.name);
      const safeTitle = `Open ${item.name} on League of Legends Wiki`.replace(/"/g, "&quot;");
      const g = item.gold?.total ?? "—";
      return `<a class="item-chip" href="${wikiHref}" target="_blank" rel="noopener noreferrer" title="${safeTitle}"><img src="${icon}" alt="${escapeHtml(item.name)}"><span>${escapeHtml(item.name)} (${g}g)</span></a>`;
    })
    .filter(Boolean)
    .join("");
}

function parseInsightsFromOpgg(data){
  const empty = {
    itemIds: [],
    worst: [],
    best: [],
    runes: { trees: [], keystone: null, flexPerks: [], shards: [] }
  };

  try {
    if (!data || !data.data) return empty;

    const champData = data.data;
    const itemIds = [];

    if (champData.builds && champData.builds.length > 0) {
      const build = champData.builds[0];
      if (build.items) {
        build.items.forEach(itemId => {
          if (itemId && itemIds.length < 15) {
            itemIds.push(String(itemId));
          }
        });
      }
    }

    const matchupRows = [];
    if (champData.matchups) {
      champData.matchups.forEach(m => {
        if (m.champion_name && m.win_rate !== undefined) {
          matchupRows.push({
            champion: m.champion_name,
            winRate: Number(m.win_rate),
            slug: normalizeChampionName(m.champion_name)
          });
        }
      });
    }

    const sorted = matchupRows.sort((a, b) => a.winRate - b.winRate);
    const worst = sorted.slice(0, 3);
    const best = [...sorted].reverse().slice(0, 3);

    const runes = { trees: [], keystone: null, flexPerks: [], shards: [] };
    if (champData.runes && champData.runes.length > 0) {
      const runeSet = champData.runes[0];
      if (runeSet.perks) {
        const perks = runeSet.perks.map(p => ({
          id: String(p.id),
          name: p.name || '',
          url: p.url || `https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/${p.id}.png`,
          pick: p.pick_rate || 0
        }));

        if (perks.length > 0) {
          runes.keystone = perks[0];
          runes.flexPerks = perks.slice(1, 7);
        }
      }
    }

    return { itemIds, worst, best, runes };
  } catch (e) {
    console.warn("Failed to parse OP.GG data:", e);
    return empty;
  }
}

function getStaticStatbaseEntry(slug){
  if (!slug) return null;
  return STATIC_STATBASE[slug] || STATIC_STATBASE[`${slug}`.toLowerCase()] || null;
}

async function fetchRatesForSlug(slug){
  if (liveRatesBySlug[slug]) return liveRatesBySlug[slug];
  let p = ratesPageInFlight.get(slug);
  if (!p) {
    p = Promise.resolve()
      .then(() => {
        const data = getStaticStatbaseEntry(slug);
        if (!data || !data.data) return null;
        const stats = data.data.stats || data.data;
        const rates = {
          win: clampRate(stats.win_rate || stats.winRate),
          pick: clampRate(stats.pick_rate || stats.pickRate),
          ban: clampRate(stats.ban_rate || stats.banRate)
        };
        liveRatesBySlug[slug] = rates;
        return rates;
      })
      .catch((err) => {
        console.warn(`Failed to load rates for ${slug}:`, err);
        return null;
      })
      .finally(() => ratesPageInFlight.delete(slug));
    ratesPageInFlight.set(slug, p);
  }
  return p;
}

async function fetchChampionRatesFromPage(championId, championName){
  const slugs = candidateUggSlugs(championId, championName);
  for (const slug of slugs){
    if (liveRatesBySlug[slug]) return liveRatesBySlug[slug];
    const rates = await fetchRatesForSlug(slug);
    if (rates) return rates;
  }
  return null;
}

async function fetchInsightsForSlug(slug){
  if (championInsightsBySlug[slug]) return championInsightsBySlug[slug];
  let p = insightsPageInFlight.get(slug);
  if (!p) {
    p = Promise.resolve()
      .then(() => {
        const data = getStaticStatbaseEntry(slug);
        const insights = parseInsightsFromOpgg(data);
        championInsightsBySlug[slug] = insights;
        return insights;
      })
      .catch((err) => {
        console.warn(`Failed to load insights for ${slug}:`, err);
        return {
          itemIds: [],
          worst: [],
          best: [],
          runes: { trees: [], keystone: null, flexPerks: [], shards: [] }
        };
      })
      .finally(() => insightsPageInFlight.delete(slug));
    insightsPageInFlight.set(slug, p);
  }
  return p;
}

async function fetchChampionInsightsFromPage(championId, championName){
  const slugs = candidateUggSlugs(championId, championName);
  for (const slug of slugs){
    const cached = championInsightsBySlug[slug];
    if (cached && (cached.itemIds?.length || cached.worst?.length || hasRuneData(cached.runes))) return cached;
    const data = await fetchInsightsForSlug(slug);
    if (data.itemIds?.length || data.worst?.length || hasRuneData(data.runes)) return data;
  }
  const lastSlug = slugs[slugs.length - 1];
  if (lastSlug && championInsightsBySlug[lastSlug]) return championInsightsBySlug[lastSlug];
  return {
    itemIds: [],
    worst: [],
    best: [],
    runes: { trees: [], keystone: null, flexPerks: [], shards: [] }
  };
}

function renderMatchupChip(matchup){
  const target = champs.find((c) => normalizeChampionName(c.id) === matchup.slug || normalizeChampionName(c.name) === matchup.slug);
  const image = target ? target.image : 'https://via.placeholder.com/22?text=?';
  const content = `<img src="${image}" alt="${escapeHtml(matchup.champion)}"><span>${escapeHtml(matchup.champion)} ${Number(matchup.winRate).toFixed(2)}%</span>`;
  if (!target) return `<span class="matchup-chip">${content}</span>`;
  return `<span class="matchup-chip matchup-chip-clickable" tabindex="0" role="button" data-champion-id="${target.id}">${content}</span>`;
}

function prefetchChampionBuildData(c){
  const key = normalizeChampionName(c.id);
  if (prefetchedInsightKeys.has(key)) return;
  prefetchedInsightKeys.add(key);
  fetchChampionInsightsFromPage(c.id, c.name).catch(() => {});
  if (c.version) loadItemData(c.version).catch(() => {});
}

async function loadChamps(){
  try{
    const versions = await (await fetch(DDRAGON_VERSIONS_URL)).json();
    const latestVersion = Array.isArray(versions) && versions[0] ? versions[0] : null;
    if (!latestVersion) throw new Error("Could not resolve latest Data Dragon version.");

    const championListUrl = `${DDRAGON_BASE_URL}/${latestVersion}/data/en_US/champion.json`;
    const payload = await (await fetch(championListUrl)).json();
    const data = payload && payload.data ? Object.values(payload.data) : [];

    champs = data
      .map(ch=>({
        id: ch.id,
        name: ch.name,
        key: Number(ch.key),
        version: latestVersion,
        image: `${DDRAGON_BASE_URL}/${latestVersion}/img/champion/${ch.id}.png`
      }))
      .sort((a,b)=>a.name.localeCompare(b.name));
    renderChampions();
    loadLiveChampionRates().catch(() => console.warn("Live rates unavailable"));
    loadItemData(latestVersion).catch(() => console.warn("Item data unavailable"));
  }catch(e){
    document.getElementById("list").innerText="Failed to load champions.";
    console.error(e);
  }
}

function renderChampions(){
  const searchText = document.getElementById("search").value.toLowerCase();
  filteredChamps = champs.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(searchText);
    if (!matchesSearch) return false;
    if (currentRoleFilter === "All") return true;
    // Look up role from CHAMPION_EXTRAS
    const extrasKey = Object.keys(window.CHAMPION_EXTRAS || {}).find(k =>
      k.toLowerCase() === normalizeChampionName(c.name) || k.toLowerCase() === normalizeChampionName(c.id)
    );
    const extras = extrasKey && window.CHAMPION_EXTRAS[extrasKey];
    if (!extras) return false;
    // Role may be e.g. "Top", "Jungle / Support", "Mid / Bot" etc – check includes
    return (extras.role || "").toLowerCase().includes(currentRoleFilter.toLowerCase());
  });

  const totalPages = Math.ceil(filteredChamps.length / champsPerPage);
  if(currentPage > totalPages) currentPage = totalPages || 1;

  const start = (currentPage-1)*champsPerPage;
  const end = start + champsPerPage;
  const list = document.getElementById("list");
  list.innerHTML = "";

  filteredChamps.slice(start, end).forEach(c=>{
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `<img src="${c.image}" alt="${c.name}" onerror="this.src='https://via.placeholder.com/36?text=?'">${c.name}`;
    div.onclick = ()=>showChampion(c);
    div.addEventListener("mouseenter", () => prefetchChampionBuildData(c), { passive: true });
    list.appendChild(div);
  });

  document.getElementById("pageInfo").innerText = `Page ${currentPage} / ${totalPages || 1}`;
  document.getElementById("prevPage").disabled = currentPage === 1;
  document.getElementById("nextPage").disabled = currentPage === totalPages || totalPages === 0;
}

function changePage(dir){
  currentPage += dir;
  renderChampions();
  document.getElementById("list").scrollTop = 0;
}

async function showChampion(c){ 
  const requestId = ++activeChampionRequestId;
  const d=document.getElementById("details"); 
  const contentDiv=document.getElementById("content");
  contentDiv.classList.add('show');
  
  // Update dynamic background
  let bgEl = document.getElementById("dynamic-bg");
  if (!bgEl) {
    bgEl = document.createElement("div");
    bgEl.id = "dynamic-bg";
    bgEl.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; z-index:-1; background-size:cover; background-position:center top; transition:background-image 0.5s ease-in-out, opacity 0.5s ease; opacity:0.15; pointer-events:none; background-repeat:no-repeat;";
    document.body.prepend(bgEl);
  }
  const splashUrl = `${DDRAGON_BASE_URL}/img/champion/splash/${c.id}_0.jpg`;
  bgEl.style.backgroundImage = `url('${splashUrl}')`;
  
  d.innerHTML=`
    <div class="skeleton skeleton-title"></div>
    <div class="rates-strip">
      <div><p>Win rate</p><div class="skeleton skeleton-bar"></div><div class="skeleton skeleton-text short"></div></div>
      <div><p>Pick rate</p><div class="skeleton skeleton-bar"></div><div class="skeleton skeleton-text short"></div></div>
      <div><p>Ban rate</p><div class="skeleton skeleton-bar"></div><div class="skeleton skeleton-text short"></div></div>
    </div>
    <div class="details-top">
      <div class="champ-column">
        <div class="skeleton skeleton-image"></div>
        <div class="skeleton skeleton-text"></div>
        <div class="skeleton skeleton-text"></div>
        <div class="skeleton skeleton-text"></div>
      </div>
      <div class="side-insights">
        <div class="skeleton skeleton-title" style="margin-top:0"></div>
        <div class="skeleton skeleton-text"></div>
        <div class="skeleton skeleton-text"></div>
        <div class="skeleton skeleton-title" style="margin-top:20px"></div>
        <div class="skeleton skeleton-text"></div>
      </div>
    </div>`;

  try{
    const champData = await (await fetch(`${DDRAGON_BASE_URL}/${c.version}/data/en_US/champion/${c.id}.json`)).json();
    if (requestId !== activeChampionRequestId) return;
    const champion = champData?.data?.[c.id];
    if (!champion) throw new Error("Champion detail data missing.");
    const initial = liveRatesByChampion[normalizeChampionName(champion.name)] || liveRatesByChampion[normalizeChampionName(c.id)] || null;
    const win = initial && initial.win !== null ? initial.win : null;
    const pick = initial && initial.pick !== null ? initial.pick : null;
    const ban = initial && initial.ban !== null ? initial.ban : null;
    const sampleSize = getSampleSizeForSlug(normalizeChampionName(c.id)) ?? getSampleSizeForSlug(champion.name);
    const tierTarget = win === null ? 50 : win;
    const abilities=[...(champion.passive?[{
      key:"Passive",
      name:champion.passive.name,
      tooltip: stripHtml(champion.passive.description || "No description available.")
    }]:[])];
    champion.spells.forEach((s,i)=>abilities.push({
      key:["Q","W","E","R"][i],
      name:s.name,
      tooltip: stripHtml(s.description || "No description available.")
    }));
    
    // Extras
    const extrasKey = Object.keys(window.CHAMPION_EXTRAS || {}).find(k => k.toLowerCase() === normalizeChampionName(champion.name)) || champion.name;
    const extras = (window.CHAMPION_EXTRAS && window.CHAMPION_EXTRAS[extrasKey]) || { role: "Flex", tiltRisk: "Balanced", combo: "Situational" };
    
    let tiltRiskClass = "";
    if (extras.tiltRisk.includes("Strong Early")) tiltRiskClass = "tilt-risk-strong";
    else if (extras.tiltRisk.includes("Weak Early")) tiltRiskClass = "tilt-risk-weak";

    const extrasHtml = `
      <div class="extras-row">
        <div class="extras-badge"><span class="extras-label">Role</span><span class="extras-value">${extras.role}</span></div>
        <div class="extras-badge"><span class="extras-label">Tilt Risk</span><span class="extras-value ${tiltRiskClass}">${extras.tiltRisk}</span></div>
        <div class="extras-badge"><span class="extras-label">Most Used Combo</span><span class="extras-value">${extras.combo}</span></div>
      </div>
    `;

    const padKey = String(champion.key).padStart(4, '0');

    d.innerHTML=`
      <h2>${champion.name} (${tierLabel(tierTarget)})</h2>
      ${extrasHtml}
      <div class="rates-strip">
        <div>
          <p>Win rate</p>
          <div class="bar"><div id="winRateBar" class="fill win" style="width:0%"></div></div>
          <p id="winRateValue" class="rates-strip-num">${formatRate(win)}</p>
        </div>
        <div>
          <p>Pick rate</p>
          <div class="bar"><div id="pickRateBar" class="fill pick" style="width:0%"></div></div>
          <p id="pickRateValue" class="rates-strip-num">${formatRate(pick)}</p>
        </div>
        <div>
          <p>Ban rate</p>
          <div class="bar"><div id="banRateBar" class="fill ban" style="width:0%"></div></div>
          <p id="banRateValue" class="rates-strip-num">${formatRate(ban)}</p>
        </div>
      </div>
      <p class="sample-size-line">Games sampled: ${formatSampleSize(sampleSize)}</p>
      <div class="details-top">
        <div class="champ-column">
          <div class="champ-portrait">
            <a class="champ-portrait-link" href="champion.html?id=${encodeURIComponent(c.id)}&v=${encodeURIComponent(c.version)}" title="Open full champion profile">
              <img src="${c.image}" alt="${champion.name}">
            </a>
          </div>
          <h3 class="abilities-heading">Abilities</h3>
          <ul class="abilities-list-vertical">${abilities.map(a => {
            const vidKey = a.key === "Passive" ? "P1" : `${a.key}1`;
            const vidUrl = `https://d28xe8vt774jo5.cloudfront.net/champion-abilities/${padKey}/ability_${padKey}_${vidKey}.mp4`;
            return `
            <li class="ability-hover-container">
              <span class="ability-name" title="${a.tooltip.replace(/"/g,"&quot;")}">${a.key} — ${a.name}</span>
              <video class="ability-preview-video" src="${vidUrl}" autoplay loop muted playsinline></video>
            </li>`;
          }).join("")}</ul>
        </div>
        <div class="side-insights">
          <h3>Recommended runes</h3>
          <div id="recommendedRunes" class="rune-insights"><p>Loading runes…</p></div>
          <h3>Recommended build</h3>
          <p class="build-sub">Boots</p>
          <div id="recommendedBoots" class="item-row"><p>Loading…</p></div>
          <p class="build-sub">Core (2500+ gold)</p>
          <div id="recommendedCore" class="item-row"><p>Loading…</p></div>
          <p class="build-sub">5th item (flex)</p>
          <div id="recommendedFifth" class="item-row"><p>Loading…</p></div>
          <div class="insight-block">
            <h3>Matchups</h3>
            <p>Worst</p><div id="worstMatchups" class="matchup-row"><p>Loading...</p></div>
            <p>Best</p><div id="bestMatchups" class="matchup-row"><p>Loading...</p></div>
          </div>
        </div>
      </div>`;

    // Trigger animation frame for bars smoothly
    requestAnimationFrame(() => {
      if (document.getElementById("winRateBar")) document.getElementById("winRateBar").style.width = `${win ?? 0}%`;
      if (document.getElementById("pickRateBar")) document.getElementById("pickRateBar").style.width = `${pick ?? 0}%`;
      if (document.getElementById("banRateBar")) document.getElementById("banRateBar").style.width = `${ban ?? 0}%`;
    });

    (async () => {
      try {
        const [rates, insights, itemData] = await Promise.all([
          fetchChampionRatesFromPage(c.id, champion.name),
          fetchChampionInsightsFromPage(c.id, champion.name),
          loadItemData(c.version)
        ]);
        if (requestId !== activeChampionRequestId) return;
        const runesEl = document.getElementById("recommendedRunes");
        const bootsEl = document.getElementById("recommendedBoots");
        const coreEl = document.getElementById("recommendedCore");
        const fifthEl = document.getElementById("recommendedFifth");
        const worstEl = document.getElementById("worstMatchups");
        const bestEl = document.getElementById("bestMatchups");

        updateRateDisplay(rates);

        if (runesEl) runesEl.innerHTML = renderRunesHtml(insights.runes);

        const { boots, core, fifth } = partitionRecommendedItems(insights.itemIds, itemData);

        if (bootsEl) {
          bootsEl.innerHTML = boots.length
            ? renderItemChips(boots, itemData, c.version)
            : "<p>No boot data available.</p>";
        }
        if (coreEl) {
          coreEl.innerHTML = core.length
            ? renderItemChips(core, itemData, c.version)
            : "<p>No core items found.</p>";
        }
        if (fifthEl) {
          fifthEl.innerHTML = fifth.length
            ? renderItemChips(fifth, itemData, c.version)
            : "<p>No flex items found.</p>";
        }
        if (worstEl) {
          worstEl.innerHTML = insights.worst.length
            ? insights.worst.map((m) => renderMatchupChip(m)).join("")
            : "<p>No matchup data available.</p>";
        }
        if (bestEl) {
          bestEl.innerHTML = insights.best.length
            ? insights.best.map((m) => renderMatchupChip(m)).join("")
            : "<p>No matchup data available.</p>";
        }
      } catch (error) {
        if (requestId !== activeChampionRequestId) return;
        console.error("Failed to load build data:", error);
        const runesEl = document.getElementById("recommendedRunes");
        const bootsEl = document.getElementById("recommendedBoots");
        const coreEl = document.getElementById("recommendedCore");
        const fifthEl = document.getElementById("recommendedFifth");
        const worstEl = document.getElementById("worstMatchups");
        const bestEl = document.getElementById("bestMatchups");
        if (runesEl) runesEl.innerHTML = "<p>No rune data available.</p>";
        if (bootsEl) bootsEl.innerHTML = "<p>No boot data available.</p>";
        if (coreEl) coreEl.innerHTML = "<p>No core items found.</p>";
        if (fifthEl) fifthEl.innerHTML = "<p>No flex items found.</p>";
        if (worstEl) worstEl.innerHTML = "<p>No matchup data available.</p>";
        if (bestEl) bestEl.innerHTML = "<p>No matchup data available.</p>";
      }
    })();
  }catch(e){
    if (requestId !== activeChampionRequestId) return;
    d.innerText="Failed to load details.";
    console.error(e);
  }
}

function updateRateDisplay(rates){
  const win = rates && rates.win !== null ? rates.win : null;
  const pick = rates && rates.pick !== null ? rates.pick : null;
  const ban = rates && rates.ban !== null ? rates.ban : null;
  const winBar = document.getElementById("winRateBar");
  const pickBar = document.getElementById("pickRateBar");
  const banBar = document.getElementById("banRateBar");
  const winValue = document.getElementById("winRateValue");
  const pickValue = document.getElementById("pickRateValue");
  const banValue = document.getElementById("banRateValue");
  if (winBar) {
    winBar.style.width = `${win ?? 0}%`;
    winBar.textContent = "";
  }
  if (pickBar) {
    pickBar.style.width = `${pick ?? 0}%`;
    pickBar.textContent = "";
  }
  if (banBar) {
    banBar.style.width = `${ban ?? 0}%`;
    banBar.textContent = "";
  }

  if (winValue) winValue.textContent = formatRate(win);
  if (pickValue) pickValue.textContent = formatRate(pick);
  if (banValue) banValue.textContent = formatRate(ban);
}

function updateSearchClearVisibility(){
  const search = document.getElementById("search");
  const clear = document.getElementById("searchClear");
  if (!search || !clear) return;
  clear.classList.toggle("visible", Boolean(search.value));
}

document.getElementById("search").oninput = ()=>{
  currentPage=1;
  updateSearchClearVisibility();
  renderChampions();
};

document.getElementById("searchClear").onclick = ()=>{
  const search = document.getElementById("search");
  if (!search) return;
  search.value = "";
  currentPage = 1;
  updateSearchClearVisibility();
  renderChampions();
  search.focus();
};

document.getElementById("content").addEventListener("click", (e) => {
  const chip = e.target.closest(".matchup-chip-clickable");
  if (!chip || !chip.dataset.championId) return;
  const target = champs.find((c) => c.id === chip.dataset.championId);
  if (target) showChampion(target);
});

document.getElementById("content").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const chip = e.target.closest(".matchup-chip-clickable");
  if (!chip || !chip.dataset.championId) return;
  e.preventDefault();
  const target = champs.find((c) => c.id === chip.dataset.championId);
  if (target) showChampion(target);
});

updateSearchClearVisibility();
loadChamps();
