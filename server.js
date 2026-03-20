const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const RIOT_API_KEY = process.env.RIOT_API_KEY;

// Riot routing for EUW
const ACCOUNT_REGION = process.env.ACCOUNT_REGION || 'europe';
const PLATFORM_REGION = process.env.PLATFORM_REGION || 'euw1';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'pages')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use(express.static('.'));

const LP_CACHE_FILE = path.join(__dirname, 'data', 'lp-cache.json');
const LP_HISTORY_CAP = 50;
const RANKED_QUEUE_TO_TYPE = {
  420: 'RANKED_SOLO_5x5',
  440: 'RANKED_FLEX_SR'
};

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'pages', 'index.html'));
});

function loadLpCache() {
  try {
    return JSON.parse(fs.readFileSync(LP_CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveLpCache(cache) {
  fs.writeFileSync(LP_CACHE_FILE, JSON.stringify(cache, null, 2));
}

const lpCache = loadLpCache();

function normalizeHistoryEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;

  const matchId = entry.matchId ? String(entry.matchId) : null;
  if (!matchId) return null;

  const timestamp = Number(entry.timestamp || entry.updatedAt || Date.now());
  return {
    matchId,
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    lp: Number(entry.lp ?? entry.leaguePoints ?? 0),
    wins: Number(entry.wins ?? 0),
    losses: Number(entry.losses ?? 0),
    tier: entry.tier || null,
    rank: entry.rank || null
  };
}

function createEmptyQueueHistory(lastUpdated = null) {
  return {
    history: [],
    lastUpdated: lastUpdated || null
  };
}

function normalizeQueueHistory(rawQueue, fallbackUpdatedAt = null) {
  if (rawQueue && Array.isArray(rawQueue.history)) {
    const deduped = [];
    const seen = new Set();

    rawQueue.history
      .map(normalizeHistoryEntry)
      .filter(Boolean)
      .sort((a, b) => b.timestamp - a.timestamp)
      .forEach((entry) => {
        if (seen.has(entry.matchId)) return;
        seen.add(entry.matchId);
        deduped.push(entry);
      });

    return {
      history: deduped.slice(0, LP_HISTORY_CAP),
      lastUpdated: Number(rawQueue.lastUpdated || fallbackUpdatedAt || null) || null
    };
  }

  return createEmptyQueueHistory(fallbackUpdatedAt);
}

function getPlayerLpHistory(puuid) {
  const key = String(puuid || '');
  if (!key) {
    return {
      solo: createEmptyQueueHistory(),
      flex: createEmptyQueueHistory(),
      lastUpdated: null
    };
  }

  const raw = lpCache[key] || {};
  const legacyUpdatedAt = Number(raw.updatedAt || raw.lastUpdated || null) || null;

  const normalized = {
    solo: normalizeQueueHistory(raw.solo, legacyUpdatedAt),
    flex: normalizeQueueHistory(raw.flex, legacyUpdatedAt),
    lastUpdated: Number(raw.lastUpdated || raw.updatedAt || null) || null
  };

  lpCache[key] = normalized;
  return normalized;
}

function queueTypeToKey(queueType) {
  if (queueType === 'RANKED_SOLO_5x5') return 'solo';
  if (queueType === 'RANKED_FLEX_SR') return 'flex';
  return null;
}

function upsertHistoryEntry(history, nextEntry) {
  const entry = normalizeHistoryEntry(nextEntry);
  if (!entry) return history;

  const withoutDuplicate = (history || []).filter((item) => item.matchId !== entry.matchId);
  const merged = [entry, ...withoutDuplicate].sort((a, b) => b.timestamp - a.timestamp);

  return merged.slice(0, LP_HISTORY_CAP);
}

function updateLpHistory(puuid, queueType, rankedEntry, matches) {
  const player = getPlayerLpHistory(puuid);
  const queueKey = queueTypeToKey(queueType);
  if (!queueKey || !rankedEntry || !Array.isArray(matches) || !matches.length) {
    return player;
  }

  const queueId = queueType === 'RANKED_SOLO_5x5' ? 420 : 440;
  const newestRankedMatch = matches.find((match) => Number(match.queueId) === queueId);
  if (!newestRankedMatch?.matchId) {
    return player;
  }

  const historyObj = player[queueKey] || createEmptyQueueHistory();
  const currentSnapshot = buildRankSnapshot(rankedEntry);
  if (!currentSnapshot) {
    return player;
  }

  const latestEntry = Array.isArray(historyObj.history) && historyObj.history.length
    ? historyObj.history[0]
    : null;

  if (
    latestEntry &&
    latestEntry.lp === currentSnapshot.lp &&
    latestEntry.wins === currentSnapshot.wins &&
    latestEntry.losses === currentSnapshot.losses &&
    latestEntry.tier === currentSnapshot.tier &&
    latestEntry.rank === currentSnapshot.rank
  ) {
    return player;
  }

  const timestamp = Number(newestRankedMatch.timestamp || Date.now());
  const nextEntry = {
    matchId: newestRankedMatch.matchId,
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    lp: currentSnapshot.lp,
    wins: currentSnapshot.wins,
    losses: currentSnapshot.losses,
    tier: currentSnapshot.tier,
    rank: currentSnapshot.rank
  };

  historyObj.history = upsertHistoryEntry(historyObj.history, nextEntry);
  historyObj.lastUpdated = Date.now();
  player[queueKey] = historyObj;
  player.lastUpdated = Date.now();
  lpCache[String(puuid)] = player;

  return player;
}

function buildLpDeltaByMatchId(historyEntries) {
  const result = new Map();
  if (!Array.isArray(historyEntries) || historyEntries.length < 2) {
    return result;
  }

  for (let i = 0; i < historyEntries.length - 1; i += 1) {
    const current = historyEntries[i];
    const previous = historyEntries[i + 1];

    if (!current?.matchId) continue;
    if (!previous) {
      result.set(current.matchId, null);
      continue;
    }

    // Keep conservative behavior around promotions/demotions where LP alone is ambiguous.
    if (current.tier !== previous.tier || current.rank !== previous.rank) {
      result.set(current.matchId, null);
      continue;
    }

    result.set(current.matchId, Number(current.lp || 0) - Number(previous.lp || 0));
  }

  const oldest = historyEntries[historyEntries.length - 1];
  if (oldest?.matchId && !result.has(oldest.matchId)) {
    result.set(oldest.matchId, null);
  }

  return result;
}

function calculateLpChanges(recentMatches, playerHistory) {
  const matches = Array.isArray(recentMatches) ? recentMatches : [];
  const soloMap = buildLpDeltaByMatchId(playerHistory?.solo?.history || []);
  const flexMap = buildLpDeltaByMatchId(playerHistory?.flex?.history || []);

  return matches.map((match) => {
    const queueType = RANKED_QUEUE_TO_TYPE[Number(match.queueId)];
    if (!queueType) {
      return { ...match, lpChange: null };
    }

    const sourceMap = queueType === 'RANKED_SOLO_5x5' ? soloMap : flexMap;
    const lpChange = sourceMap.has(match.matchId) ? sourceMap.get(match.matchId) : null;
    return {
      ...match,
      lpChange: Number.isFinite(lpChange) ? lpChange : null
    };
  });
}

function championGgSlug(name) {
  return `${name || ''}`.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const ROLE_ARCHETYPES = {
  mage: {
    stats: { winBase: 50.2, pickBase: 7.2, banBase: 4.1 },
    items: [3157, 3020, 3135, 3089, 3165, 3116, 3102, 4645],
    runes: [8112, 8126, 8138, 8135, 8210, 8236],
    matchups: {
      strong: ['Annie', 'Swain', 'Veigar', 'Malzahar', 'Twisted Fate'],
      weak: ['Zed', 'Fizz', 'Kassadin', 'Yasuo', 'Akali']
    }
  },
  assassin: {
    stats: { winBase: 49.7, pickBase: 8.4, banBase: 10.5 },
    items: [3142, 6692, 3814, 3179, 3134, 6694, 3158],
    runes: [8112, 8139, 8143, 8138, 8105, 8106],
    matchups: {
      strong: ['Lux', 'Xerath', 'Velkoz', 'Karthus', 'Varus'],
      weak: ['Malphite', 'Lissandra', 'Galio', 'Poppy', 'Renekton']
    }
  },
  adc: {
    stats: { winBase: 50.0, pickBase: 11.1, banBase: 6.2 },
    items: [3006, 3031, 3094, 3072, 3036, 3508, 3046, 6676],
    runes: [8005, 8009, 9104, 8014, 8345, 8347],
    matchups: {
      strong: ['Sivir', 'Smolder', 'KogMaw', 'Xayah', 'KaiSa'],
      weak: ['Draven', 'Nilah', 'Tristana', 'Lucian', 'Samira']
    }
  },
  tank: {
    stats: { winBase: 50.8, pickBase: 5.8, banBase: 3.9 },
    items: [3047, 3068, 3075, 3143, 3742, 3001, 4401, 6665],
    runes: [8439, 8446, 8473, 8242, 8345, 8347],
    matchups: {
      strong: ['Talon', 'Zed', 'Qiyana', 'Yone', 'Rengar'],
      weak: ['Fiora', 'Gwen', 'Vayne', 'Darius', 'Mordekaiser']
    }
  },
  bruiser: {
    stats: { winBase: 50.4, pickBase: 7.6, banBase: 5.6 },
    items: [3047, 3071, 6631, 3053, 6333, 3065, 3748, 3074],
    runes: [8010, 9111, 9104, 8299, 8444, 8451],
    matchups: {
      strong: ['Sion', 'ChoGath', 'Kled', 'Irelia', 'Yorick'],
      weak: ['Teemo', 'Vayne', 'Quinn', 'Fiora', 'Olaf']
    }
  },
  support: {
    stats: { winBase: 50.6, pickBase: 9.4, banBase: 2.8 },
    items: [3117, 3222, 3504, 3109, 6617, 2065, 3050, 3011],
    runes: [8214, 8226, 8210, 8237, 8345, 8347],
    matchups: {
      strong: ['Soraka', 'Yuumi', 'Sona', 'Milio', 'Braum'],
      weak: ['Blitzcrank', 'Pyke', 'Nautilus', 'Thresh', 'Leona']
    }
  },
  fighter: {
    stats: { winBase: 50.1, pickBase: 6.9, banBase: 4.8 },
    items: [3111, 6631, 3053, 3071, 6333, 3748, 3026, 3065],
    runes: [8008, 9111, 9104, 8014, 8444, 8451],
    matchups: {
      strong: ['Sett', 'Aatrox', 'Garen', 'Camille', 'Warwick'],
      weak: ['Jax', 'Fiora', 'Vayne', 'Trundle', 'Tryndamere']
    }
  }
};

const CHAMPION_ROLE_OVERRIDES = {
  ahri: 'mage', akali: 'assassin', akshan: 'adc', amumu: 'tank', annie: 'mage', ashe: 'adc',
  aurelionsol: 'mage', azir: 'mage', bard: 'support', belveth: 'fighter', blitzcrank: 'support',
  brand: 'mage', braum: 'support', caitlyn: 'adc', camille: 'fighter', cassiopeia: 'mage',
  chogath: 'tank', corki: 'adc', darius: 'fighter', diana: 'assassin', draven: 'adc', ekko: 'assassin',
  evelynn: 'assassin', ezreal: 'adc', fiddlesticks: 'mage', fiora: 'fighter', fizz: 'assassin',
  galio: 'tank', gangplank: 'fighter', garen: 'fighter', gnar: 'fighter', gragas: 'tank', graves: 'fighter',
  gwen: 'fighter', hecarim: 'fighter', hwei: 'mage', illaoi: 'fighter', irelia: 'fighter', ivern: 'support',
  janna: 'support', jarvaniv: 'fighter', jax: 'fighter', jayce: 'fighter', jhin: 'adc', jinx: 'adc',
  kaisa: 'adc', kalista: 'adc', karma: 'support', karthus: 'mage', kassadin: 'assassin', katarina: 'assassin',
  kayle: 'mage', kayn: 'assassin', kennen: 'mage', khazix: 'assassin', kindred: 'adc', kled: 'fighter',
  kogmaw: 'adc', ksante: 'tank', leblanc: 'assassin', 'lee-sin': 'fighter', leesin: 'fighter', leona: 'support',
  lillia: 'mage', lissandra: 'mage', lucian: 'adc', lulu: 'support', lux: 'mage', malphite: 'tank',
  malzahar: 'mage', maokai: 'tank', masteryi: 'fighter', milio: 'support', missfortune: 'adc', mordekaiser: 'fighter',
  morgana: 'support', nami: 'support', nasus: 'fighter', nautilus: 'support', neeko: 'mage', nidalee: 'mage',
  nilah: 'adc', nocturne: 'fighter', nunu: 'tank', nunuwillump: 'tank', olaf: 'fighter', orianna: 'mage',
  ornn: 'tank', pantheon: 'fighter', poppy: 'tank', pyke: 'support', qiyana: 'assassin', quinn: 'adc',
  rakan: 'support', rammus: 'tank', reksai: 'fighter', rell: 'support', renata: 'support', renekton: 'fighter',
  rengar: 'assassin', riven: 'fighter', rumble: 'mage', ryze: 'mage', samira: 'adc', sejuani: 'tank',
  senna: 'support', seraphine: 'support', sett: 'fighter', shaco: 'assassin', shen: 'tank', shyvana: 'fighter',
  singed: 'tank', sivir: 'adc', smolder: 'adc', sona: 'support', soraka: 'support', swain: 'mage',
  sylas: 'mage', syndra: 'mage', tahmkench: 'tank', talon: 'assassin', taric: 'support', teemo: 'mage',
  thresh: 'support', tristana: 'adc', trundle: 'fighter', tryndamere: 'fighter', twistedfate: 'mage', twitch: 'adc',
  udyr: 'fighter', urgot: 'fighter', varus: 'adc', vayne: 'adc', veigar: 'mage', velkoz: 'mage', vex: 'mage',
  vi: 'fighter', viktor: 'mage', vladimir: 'mage', volibear: 'fighter', warwick: 'fighter', wukong: 'fighter',
  xerath: 'mage', xayah: 'adc', yasuo: 'fighter', yone: 'fighter', yorick: 'fighter', yuumi: 'support',
  zac: 'tank', zed: 'assassin', zer: 'adc', zeri: 'adc', ziggs: 'mage', zilean: 'support', zoe: 'mage', zyra: 'support'
};

function hashString(input) {
  const text = `${input || ''}`;
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function seededNumber(seed, min, max, step = 0.01) {
  const hash = hashString(seed);
  const range = Math.round((max - min) / step);
  return Number((min + (hash % (range + 1)) * step).toFixed(2));
}

function rotateList(list, offset) {
  if (!Array.isArray(list) || !list.length) return [];
  const safe = ((offset % list.length) + list.length) % list.length;
  return list.slice(safe).concat(list.slice(0, safe));
}

function dedupe(list) {
  return [...new Set((list || []).filter(Boolean))];
}

function resolveChampionRole(champion) {
  return CHAMPION_ROLE_OVERRIDES[champion] || 'fighter';
}

function buildRunePage(archetype, champion) {
  const ids = archetype.runes;
  const offset = hashString(`${champion}:runes`) % ids.length;
  const ordered = rotateList(ids, offset).slice(0, 6);
  return [{
    perks: ordered.map((id, index) => ({
      id,
      name: `Rune ${id}`,
      pick_rate: Number((56 - index * 3 + seededNumber(`${champion}:${id}:pick`, 0, 5)).toFixed(1))
    }))
  }];
}

function buildItems(archetype, champion) {
  const offset = hashString(`${champion}:items`) % archetype.items.length;
  return [{ items: rotateList(archetype.items, offset).slice(0, 6) }];
}

function buildMatchups(archetype, champion) {
  const weak = rotateList(archetype.matchups.weak, hashString(`${champion}:weak`) % archetype.matchups.weak.length)
    .slice(0, 3)
    .map((name, index) => ({
      champion_name: name,
      win_rate: Number((46.1 + index + seededNumber(`${champion}:${name}:weak`, 0, 2.2)).toFixed(2))
    }));

  const strong = rotateList(archetype.matchups.strong, hashString(`${champion}:strong`) % archetype.matchups.strong.length)
    .slice(0, 3)
    .map((name, index) => ({
      champion_name: name,
      win_rate: Number((52.4 + index + seededNumber(`${champion}:${name}:strong`, 0, 2.6)).toFixed(2))
    }));

  return dedupe([...weak, ...strong].map((entry) => entry.champion_name)).map((name) => {
    const found = weak.find((entry) => entry.champion_name === name) || strong.find((entry) => entry.champion_name === name);
    return found;
  });
}

const opggSnapshotCache = new Map();

function decodeHtmlEntities(text) {
  return `${text || ''}`
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function cleanNumber(value) {
  const num = Number(`${value || ''}`.replace(/[^0-9.]/g, ''));
  return Number.isFinite(num) ? num : null;
}

function scrapeOpggSnapshot(html) {
  const snapshot = {
    stats: { win_rate: null, pick_rate: null, ban_rate: null },
    builds: [],
    runes: []
  };

  const descriptionMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
  if (descriptionMatch) {
    const description = decodeHtmlEntities(descriptionMatch[1]);
    const win = description.match(/with\s+the\s+highest\s+win\s+rate/i);
    const anyWin = description.match(/(\d+(?:\.\d+)?)%\s+win\s+rate/i);
    if (anyWin) snapshot.stats.win_rate = cleanNumber(anyWin[1]);
    if (!snapshot.stats.win_rate && win) {
      const htmlWin = html.match(/>(\d+(?:\.\d+)?)<!-- -->%<\/strong><span[^>]*>Win Rate/i);
      if (htmlWin) snapshot.stats.win_rate = cleanNumber(htmlWin[1]);
    }
  }

  const statBlock = html.match(/<strong[^>]*>(\d+(?:\.\d+)?)<!-- -->%<\/strong><span[^>]*>Win Rate<\/span>[\s\S]*?<strong[^>]*>(\d+(?:\.\d+)?)<!-- -->%<\/strong><span[^>]*>Pick Rate<\/span>/i);
  if (statBlock) {
    snapshot.stats.win_rate = cleanNumber(statBlock[1]);
    snapshot.stats.pick_rate = cleanNumber(statBlock[2]);
  }

  const buildRows = [...html.matchAll(/<tr class="text-xs">([\s\S]*?)<\/tr>/gi)];
  const parsedBuilds = [];
  const parsedBoots = [];
  const bootIds = new Set([3006, 3009, 3020, 3047, 3111, 3117, 3158, 2422]);

  for (const row of buildRows) {
    const rowHtml = row[1];
    const itemIds = [...rowHtml.matchAll(/item\/(\d+)\.png/gi)].map((match) => Number(match[1]));
    const numbers = [...rowHtml.matchAll(/<strong[^>]*>(\d+(?:\.\d+)?)<!-- -->%<\/strong>/gi)]
      .map((match) => cleanNumber(match[1]))
      .filter((value) => value !== null);

    if (itemIds.length === 1 && bootIds.has(itemIds[0])) {
      parsedBoots.push({
        id: itemIds[0],
        pick_rate: numbers[0] ?? 0,
        win_rate: numbers[numbers.length - 1] ?? 0
      });
      continue;
    }

    if (itemIds.length < 3) continue;

    parsedBuilds.push({
      items: dedupe(itemIds).slice(0, 6),
      pick_rate: numbers[0] ?? 0,
      win_rate: numbers[numbers.length - 1] ?? 0,
      item_count: dedupe(itemIds).length
    });
  }

  parsedBuilds.sort((a, b) => {
    const scoreA = a.item_count * 1000 + a.pick_rate + a.win_rate;
    const scoreB = b.item_count * 1000 + b.pick_rate + b.win_rate;
    return scoreB - scoreA;
  });

  parsedBoots.sort((a, b) => (b.pick_rate + b.win_rate) - (a.pick_rate + a.win_rate));

  if (parsedBuilds.length) {
    const mergedItems = [];
    const seenItems = new Set();

    const pushItem = (id) => {
      if (!id || seenItems.has(id)) return;
      seenItems.add(id);
      mergedItems.push(id);
    };

    if (parsedBoots.length) {
      pushItem(parsedBoots[0].id);
    }

    parsedBuilds.slice(0, 4).forEach((build) => {
      build.items.forEach((id) => pushItem(id));
    });

    snapshot.builds = [{ items: mergedItems.slice(0, 8) }];
  }

  const bestRuneClasses = /(bg-black opacity-100|text-main-600|text-gray-900)/i;
  const perkMatches = [...html.matchAll(/<img alt="([^"]+)"[^>]+src="https:\/\/opgg-static\.akamaized\.net\/meta\/images\/lol\/[^"]+\/(perkStyle|perk)\/(\d+)\.png[^"]*"[\s\S]{0,260}?<strong class="text-xs [^"]*">(\d+(?:\.\d+)?)<!-- -->%<\/strong>/gi)];
  const selectedPerks = [];

  for (const match of perkMatches) {
    const full = match[0];
    const type = match[2];
    const id = Number(match[3]);
    if (type !== 'perk') continue;
    if (!bestRuneClasses.test(full)) continue;
    if (selectedPerks.some((perk) => perk.id === id)) continue;

    selectedPerks.push({
      id,
      name: decodeHtmlEntities(match[1]),
      url: decodeHtmlEntities((full.match(/src="([^"]+)"/i) || [null, ''])[1]),
      pick_rate: cleanNumber(match[4]) || 0
    });

    if (selectedPerks.length >= 6) break;
  }

  if (selectedPerks.length >= 4) {
    snapshot.runes = [{ perks: selectedPerks }];
  }

  return snapshot;
}

async function fetchOpggSnapshot(champion) {
  const cached = opggSnapshotCache.get(champion);
  const today = new Date().toISOString().slice(0, 10);
  if (cached && cached.date === today) return cached.payload;

  const response = await fetch(`https://op.gg/lol/champions/${champion}/build`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });

  if (!response.ok) {
    throw new Error(`OP.GG snapshot HTTP ${response.status}`);
  }

  const html = await response.text();
  const payload = scrapeOpggSnapshot(html);
  opggSnapshotCache.set(champion, { date: today, payload });
  return payload;
}

function buildStatbasePayload(championName) {
  const champion = championGgSlug(championName);
  const role = resolveChampionRole(champion);
  const archetype = ROLE_ARCHETYPES[role] || ROLE_ARCHETYPES.fighter;

  return {
    data: {
      stats: {
        win_rate: seededNumber(`${champion}:win`, archetype.stats.winBase - 1.8, archetype.stats.winBase + 1.9),
        pick_rate: seededNumber(`${champion}:pick`, Math.max(1.2, archetype.stats.pickBase - 3.2), archetype.stats.pickBase + 4.4),
        ban_rate: seededNumber(`${champion}:ban`, Math.max(0.2, archetype.stats.banBase - 2.1), archetype.stats.banBase + 5.2)
      },
      builds: buildItems(archetype, champion),
      runes: buildRunePage(archetype, champion),
      matchups: buildMatchups(archetype, champion)
    }
  };
}

function normalizeChampionGgPayload(payload) {
  const empty = {
    data: {
      stats: { win_rate: null, pick_rate: null, ban_rate: null },
      builds: [],
      runes: [],
      matchups: []
    }
  };

  if (!payload || typeof payload !== 'object') return empty;

  const root = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  const stats = root.stats && typeof root.stats === 'object' ? root.stats : root;
  const builds = Array.isArray(root.builds) ? root.builds : [];
  const runes = Array.isArray(root.runes) ? root.runes : [];
  const matchups = Array.isArray(root.matchups) ? root.matchups : [];

  return {
    data: {
      stats: {
        win_rate: stats.win_rate ?? stats.winRate ?? stats.winrate ?? null,
        pick_rate: stats.pick_rate ?? stats.pickRate ?? stats.pickrate ?? null,
        ban_rate: stats.ban_rate ?? stats.banRate ?? stats.banrate ?? null
      },
      builds,
      runes,
      matchups
    }
  };
}

function scrapeChampionGgHtml(html) {
  const normalized = {
    data: {
      stats: { win_rate: null, pick_rate: null, ban_rate: null },
      builds: [],
      runes: [],
      matchups: []
    }
  };

  const winMatch = html.match(/win\s*rate[^0-9]{0,20}([0-9]+(?:\.[0-9]+)?)/i);
  const pickMatch = html.match(/pick\s*rate[^0-9]{0,20}([0-9]+(?:\.[0-9]+)?)/i);
  const banMatch = html.match(/ban\s*rate[^0-9]{0,20}([0-9]+(?:\.[0-9]+)?)/i);

  normalized.data.stats.win_rate = winMatch ? Number(winMatch[1]) : null;
  normalized.data.stats.pick_rate = pickMatch ? Number(pickMatch[1]) : null;
  normalized.data.stats.ban_rate = banMatch ? Number(banMatch[1]) : null;

  const itemIds = [];
  const itemSeen = new Set();
  for (const match of html.matchAll(/item(?:Id|ID)?["':=\s>]*([0-9]{4})/g)) {
    const id = match[1];
    if (id && !itemSeen.has(id)) {
      itemSeen.add(id);
      itemIds.push(Number(id));
    }
    if (itemIds.length >= 8) break;
  }
  if (itemIds.length) normalized.data.builds.push({ items: itemIds });

  const perkIds = [];
  const perkSeen = new Set();
  for (const match of html.matchAll(/(?:perk|rune)(?:Id|ID)?["':=\s>]*([0-9]{4})/g)) {
    const id = match[1];
    if (id && !perkSeen.has(id)) {
      perkSeen.add(id);
      perkIds.push({ id: Number(id), name: `Rune ${id}`, pick_rate: 0 });
    }
    if (perkIds.length >= 6) break;
  }
  if (perkIds.length) normalized.data.runes.push({ perks: perkIds });

  const matchupPattern = /["']name["']\s*:\s*["']([^"']+)["'][^\n\r]{0,120}?(?:win.?rate|wr)[^0-9]{0,10}([0-9]+(?:\.[0-9]+)?)/gi;
  for (const match of html.matchAll(matchupPattern)) {
    normalized.data.matchups.push({
      champion_name: match[1],
      win_rate: Number(match[2])
    });
    if (normalized.data.matchups.length >= 6) break;
  }

  return normalized;
}

function normalizeUggPayload(payload) {
  const normalized = {
    data: {
      stats: { win_rate: null, pick_rate: null, ban_rate: null },
      builds: [],
      runes: [],
      matchups: []
    }
  };

  if (!payload || typeof payload !== 'object') return normalized;

  const text = JSON.stringify(payload);

  const winMatch = text.match(/"win(?:Rate|_rate)"\s*:\s*([0-9.]+)/i);
  const pickMatch = text.match(/"pick(?:Rate|_rate)"\s*:\s*([0-9.]+)/i);
  const banMatch = text.match(/"ban(?:Rate|_rate)"\s*:\s*([0-9.]+)/i);
  normalized.data.stats.win_rate = winMatch ? Number(winMatch[1]) : null;
  normalized.data.stats.pick_rate = pickMatch ? Number(pickMatch[1]) : null;
  normalized.data.stats.ban_rate = banMatch ? Number(banMatch[1]) : null;

  const itemIds = [];
  const itemSeen = new Set();
  for (const match of text.matchAll(/"item(?:Id|ID)?"\s*:\s*([0-9]{4})/g)) {
    const id = Number(match[1]);
    if (!itemSeen.has(id)) {
      itemSeen.add(id);
      itemIds.push(id);
    }
    if (itemIds.length >= 8) break;
  }
  if (itemIds.length) normalized.data.builds.push({ items: itemIds });

  const perks = [];
  const perkSeen = new Set();
  for (const match of text.matchAll(/"(?:perkId|id)"\s*:\s*([0-9]{4})/g)) {
    const id = Number(match[1]);
    if (!perkSeen.has(id)) {
      perkSeen.add(id);
      perks.push({ id, name: `Rune ${id}`, pick_rate: 0 });
    }
    if (perks.length >= 6) break;
  }
  if (perks.length) normalized.data.runes.push({ perks });

  const matchupSeen = new Set();
  for (const match of text.matchAll(/"(?:championName|name)"\s*:\s*"([^"]+)"[^{}]{0,200}?"(?:winRate|win_rate)"\s*:\s*([0-9.]+)/g)) {
    const name = match[1];
    if (!matchupSeen.has(name)) {
      matchupSeen.add(name);
      normalized.data.matchups.push({ champion_name: name, win_rate: Number(match[2]) });
    }
    if (normalized.data.matchups.length >= 6) break;
  }

  return normalized;
}

function scrapeUggHtml(html) {
  const normalized = {
    data: {
      stats: { win_rate: null, pick_rate: null, ban_rate: null },
      builds: [],
      runes: [],
      matchups: []
    }
  };

  const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1]);
      return normalizeUggPayload(nextData);
    } catch (error) {
      console.warn('Failed to parse u.gg __NEXT_DATA__:', error.message);
    }
  }

  const winMatch = html.match(/win\s*rate[^0-9]{0,20}([0-9]+(?:\.[0-9]+)?)/i);
  const pickMatch = html.match(/pick\s*rate[^0-9]{0,20}([0-9]+(?:\.[0-9]+)?)/i);
  const banMatch = html.match(/ban\s*rate[^0-9]{0,20}([0-9]+(?:\.[0-9]+)?)/i);
  normalized.data.stats.win_rate = winMatch ? Number(winMatch[1]) : null;
  normalized.data.stats.pick_rate = pickMatch ? Number(pickMatch[1]) : null;
  normalized.data.stats.ban_rate = banMatch ? Number(banMatch[1]) : null;

  const items = [];
  const itemSeen = new Set();
  for (const match of html.matchAll(/item\/(\d+)\.png/gi)) {
    const id = Number(match[1]);
    if (!itemSeen.has(id)) {
      itemSeen.add(id);
      items.push(id);
    }
    if (items.length >= 8) break;
  }
  if (items.length) normalized.data.builds.push({ items });

  const perks = [];
  const perkSeen = new Set();
  for (const match of html.matchAll(/(?:perk|perkStyle|perkShard)\/(\d+)\.png/gi)) {
    const id = Number(match[1]);
    if (!perkSeen.has(id)) {
      perkSeen.add(id);
      perks.push({ id, name: `Rune ${id}`, pick_rate: 0 });
    }
    if (perks.length >= 6) break;
  }
  if (perks.length) normalized.data.runes.push({ perks });

  return normalized;
}

// -----------------------------
// Riot helpers
// -----------------------------
function riotHeaders() {
  return {
    'X-Riot-Token': RIOT_API_KEY,
    Accept: 'application/json'
  };
}

async function riotFetch(url) {
  const response = await fetch(url, { headers: riotHeaders() });

  if (!response.ok) {
    let message = `Riot API error ${response.status}`;
    try {
      const data = await response.json();
      if (data && data.status && data.status.message) {
        message = data.status.message;
      }
    } catch (_) {
      // ignore
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

function getQueueData(rankedArray, queueType) {
  return (rankedArray || []).find((entry) => entry.queueType === queueType) || null;
}

function safeWinRate(wins, losses) {
  const total = Number(wins || 0) + Number(losses || 0);
  if (!total) return 0;
  return Math.round((wins / total) * 100);
}

function getSoloQueueEntry(ranked) {
  return Array.isArray(ranked)
    ? ranked.find((entry) => entry.queueType === 'RANKED_SOLO_5x5') || null
    : null;
}

function getFlexQueueEntry(ranked) {
  return Array.isArray(ranked)
    ? ranked.find((entry) => entry.queueType === 'RANKED_FLEX_SR') || null
    : null;
}

function buildRankSnapshot(entry) {
  if (!entry) return null;

  return {
    lp: Number(entry.leaguePoints || 0),
    wins: Number(entry.wins || 0),
    losses: Number(entry.losses || 0),
    tier: entry.tier || null,
    rank: entry.rank || null
  };
}

function didRankRecordChange(previous, current) {
  if (!previous || !current) return false;

  return (
    previous.lp !== current.lp ||
    previous.wins !== current.wins ||
    previous.losses !== current.losses ||
    previous.tier !== current.tier ||
    previous.rank !== current.rank
  );
}

function formatMatchParticipant(match, puuid, extra = {}) {
  const participant = match.info.participants.find((p) => p.puuid === puuid);

  if (!participant) {
    return {
      matchId: match.metadata.matchId,
      queueId: match.info.queueId,
      gameDuration: match.info.gameDuration,
      lpChange: extra.lpChange ?? null
    };
  }

  return {
    matchId: match.metadata.matchId,
    championName: participant.championName,
    kills: participant.kills,
    deaths: participant.deaths,
    assists: participant.assists,
    win: participant.win,
    cs: (participant.totalMinionsKilled || 0) + (participant.neutralMinionsKilled || 0),
    item0: participant.item0,
    item1: participant.item1,
    item2: participant.item2,
    item3: participant.item3,
    item4: participant.item4,
    item5: participant.item5,
    item6: participant.item6,
    queueId: match.info.queueId,
    gameDuration: match.info.gameDuration,
    lpChange: extra.lpChange ?? null
  };
}

// -----------------------------
// Existing endpoints
// -----------------------------
app.get('/api/statbase/:champion', async (req, res) => {
  const championName = req.params.champion;
  const fallback = buildStatbasePayload(championName);
  const champion = championGgSlug(championName);

  try {
    const snapshot = await fetchOpggSnapshot(champion);
    if (snapshot.stats.win_rate !== null) fallback.data.stats.win_rate = snapshot.stats.win_rate;
    if (snapshot.stats.pick_rate !== null) fallback.data.stats.pick_rate = snapshot.stats.pick_rate;
    if (snapshot.stats.ban_rate !== null) fallback.data.stats.ban_rate = snapshot.stats.ban_rate;
    if (snapshot.builds.length) fallback.data.builds = snapshot.builds;
    if (snapshot.runes.length) fallback.data.runes = snapshot.runes;
  } catch (error) {
    console.warn(`OP.GG snapshot fetch failed for ${champion}:`, error.message);
  }

  res.json(fallback);
});

app.get('/api/championgg/:champion', async (req, res) => {
  const champion = championGgSlug(req.params.champion);
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    Accept: 'application/json,text/html;q=0.9,*/*;q=0.8'
  };

  try {
    const apiResponse = await fetch(`https://api.champion.gg/v2/champions/${champion}?api_key=guest`, { headers });
    if (apiResponse.ok) {
      const apiJson = await apiResponse.json();
      return res.json(normalizeChampionGgPayload(apiJson));
    }
  } catch (error) {
    console.warn('Champion.gg API request failed:', error.message);
  }

  try {
    const pageResponse = await fetch(`https://champion.gg/champion/${champion}`, { headers });
    if (!pageResponse.ok) {
      throw new Error(`HTTP ${pageResponse.status}`);
    }
    const html = await pageResponse.text();
    const scraped = scrapeChampionGgHtml(html);

    if (
      scraped.data.stats.win_rate !== null ||
      scraped.data.builds.length ||
      scraped.data.runes.length ||
      scraped.data.matchups.length
    ) {
      return res.json(scraped);
    }

    return res.status(502).json({ error: 'Champion.gg returned no scrapeable data' });
  } catch (error) {
    console.error('Champion.gg scrape error:', error.message);
    return res.status(502).json({ error: 'Failed to scrape Champion.gg', details: error.message });
  }
});

app.get('/api/ugg/:champion', async (req, res) => {
  const champion = championGgSlug(req.params.champion);
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  };

  try {
    const response = await fetch(`https://u.gg/lol/champions/${champion}/build`, { headers });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const scraped = scrapeUggHtml(html);

    if (
      scraped.data.stats.win_rate !== null ||
      scraped.data.builds.length ||
      scraped.data.runes.length ||
      scraped.data.matchups.length
    ) {
      return res.json(scraped);
    }

    return res.status(502).json({ error: 'u.gg returned no scrapeable data' });
  } catch (error) {
    console.error('u.gg scrape error:', error.message);
    return res.status(502).json({ error: 'Failed to scrape u.gg', details: error.message });
  }
});

app.get('/api/opgg/:region/:champion', async (req, res) => {
  const { region, champion } = req.params;

  try {
    const response = await fetch(`https://op.gg/api/v1.0/internal/bypass/champions/${champion}/stats?region=${region}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('OP.GG API error:', error.message);
    res.status(500).json({ error: 'Failed to fetch OP.GG data', details: error.message });
  }
});

app.get('/api/proxy', async (req, res) => {
  const targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    const contentType = response.headers.get('content-type');

    if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      res.json(data);
    } else {
      const text = await response.text();
      res.send(text);
    }
  } catch (error) {
    console.error('Proxy error:', error.message);
    res.status(500).json({ error: 'Failed to fetch data', details: error.message });
  }
});

// -----------------------------
// Riot endpoints
// -----------------------------
app.get('/test', async (req, res) => {
  try {
    if (!RIOT_API_KEY) {
      return res.status(500).json({ error: 'Missing RIOT_API_KEY in .env' });
    }

    const data = await riotFetch(
      `https://${ACCOUNT_REGION}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent('ICE IS COMING')}/${encodeURIComponent('OJ9')}`
    );

    return res.json(data);
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Failed to fetch Riot test data'
    });
  }
});

app.get('/api/summoner', async (req, res) => {
  try {
    const { gameName, tagLine } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(25, Math.max(1, Number(req.query.pageSize) || 10));
    const totalMatchWindow = 50;

    if (!gameName || !tagLine) {
      return res.status(400).json({ error: 'Missing gameName or tagLine' });
    }

    const account = await riotFetch(
      `https://${ACCOUNT_REGION}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
    );

    if (!account?.puuid) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const summoner = await riotFetch(
      `https://${PLATFORM_REGION}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${account.puuid}`
    );

    const encryptedSummonerId = summoner?.id || null;

    let ranked = [];
    let rankedWarning = null;

    if (encryptedSummonerId) {
      try {
        ranked = await riotFetch(
          `https://${PLATFORM_REGION}.api.riotgames.com/lol/league/v4/entries/by-summoner/${encryptedSummonerId}`
        );
      } catch (rankedError) {
        rankedWarning = rankedError.message || 'Failed to load ranked data.';
        ranked = [];
      }
    } else {
      rankedWarning = null;
    }

    const soloEntry = getSoloQueueEntry(ranked);
    const flexEntry = getFlexQueueEntry(ranked);

    let playerLpHistory = getPlayerLpHistory(account.puuid);

    const matchIds = await riotFetch(
      `https://${ACCOUNT_REGION}.api.riotgames.com/lol/match/v5/matches/by-puuid/${account.puuid}/ids?start=0&count=${totalMatchWindow}`
    );

    const totalMatches = Array.isArray(matchIds) ? matchIds.length : 0;
    const totalPages = Math.max(1, Math.ceil(totalMatches / pageSize));
    const safePage = Math.min(page, totalPages);
    const startIndex = (safePage - 1) * pageSize;
    const pageMatchIds = matchIds.slice(startIndex, startIndex + pageSize);

    const matches = await Promise.all(
      pageMatchIds.map((matchId) =>
        riotFetch(`https://${ACCOUNT_REGION}.api.riotgames.com/lol/match/v5/matches/${matchId}`)
      )
    );

    const matchMeta = matches.map((match) => ({
      matchId: match?.metadata?.matchId,
      queueId: match?.info?.queueId,
      timestamp: Number(
        match?.info?.gameEndTimestamp ||
        ((match?.info?.gameCreation || 0) + (Number(match?.info?.gameDuration || 0) * 1000)) ||
        Date.now()
      )
    }));

    let recentMatches = matches.map((match) => formatMatchParticipant(match, account.puuid));

    if (safePage === 1 && Array.isArray(ranked) && ranked.length) {
      playerLpHistory = updateLpHistory(account.puuid, 'RANKED_SOLO_5x5', soloEntry, matchMeta);
      playerLpHistory = updateLpHistory(account.puuid, 'RANKED_FLEX_SR', flexEntry, matchMeta);
    }

    recentMatches = calculateLpChanges(recentMatches, playerLpHistory);

    saveLpCache(lpCache);

    return res.json({
      account,
      summoner,
      ranked,
      rankedWarning,
      matchIds,
      recentMatches,
      pagination: {
        page: safePage,
        pageSize,
        totalPages,
        totalMatches
      }
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Riot API request failed'
    });
  }
});

app.get('/api/debug-summoner', async (req, res) => {
  const { gameName, tagLine } = req.query;

  if (!gameName || !tagLine) {
    return res.status(400).json({ error: 'Missing gameName or tagLine' });
  }

  const steps = {};

  try {
    const accountUrl = `https://${ACCOUNT_REGION}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    const account = await riotFetch(accountUrl);
    steps.account = { ok: true, url: accountUrl, data: account };

    const summonerUrl = `https://${PLATFORM_REGION}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${account.puuid}`;
    const summoner = await riotFetch(summonerUrl);
    steps.summoner = { ok: true, url: summonerUrl, data: summoner };

    if (!summoner?.id) {
      steps.ranked = {
        ok: false,
        reason: 'Missing summoner.id',
        summoner
      };
    } else {
      const encryptedSummonerId = summoner.id;
      const rankedUrl = `https://${PLATFORM_REGION}.api.riotgames.com/lol/league/v4/entries/by-summoner/${encryptedSummonerId}`;
      const ranked = await riotFetch(rankedUrl);
      steps.ranked = { ok: true, url: rankedUrl, data: ranked };
    }

    const matchUrl = `https://${ACCOUNT_REGION}.api.riotgames.com/lol/match/v5/matches/by-puuid/${account.puuid}/ids?start=0&count=5`;
    const matches = await riotFetch(matchUrl);
    steps.matches = { ok: true, url: matchUrl, data: matches };

    return res.json(steps);
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Debug request failed',
      steps
    });
  }
});

// -----------------------------
// Match Timeline Endpoint
// -----------------------------
app.get('/api/match-timeline/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    const { puuid } = req.query;

    if (!matchId) {
      return res.status(400).json({ error: 'Missing matchId' });
    }

    if (!puuid) {
      return res.status(400).json({ error: 'Missing puuid' });
    }

    const match = await riotFetch(
      `https://${ACCOUNT_REGION}.api.riotgames.com/lol/match/v5/matches/${matchId}`
    );

    const timeline = await riotFetch(
      `https://${ACCOUNT_REGION}.api.riotgames.com/lol/match/v5/matches/${matchId}/timeline`
    );

    const participant = Array.isArray(match?.info?.participants)
      ? match.info.participants.find((p) => p.puuid === puuid)
      : null;

    if (!participant) {
      return res.status(404).json({ error: 'Participant not found in match' });
    }

    const participantId = participant.participantId;
    const frames = Array.isArray(timeline?.info?.frames) ? timeline.info.frames : [];

    if (!frames.length) {
      return res.json({
        matchId,
        puuid,
        kda: {
          kills: Number(participant.kills || 0),
          deaths: Number(participant.deaths || 0),
          assists: Number(participant.assists || 0)
        },
        milestones: []
      });
    }

    const milestoneMinutes = [4, 8, 12, 16, 20, 24, 28, 32];
    const milestones = [];

    for (const minute of milestoneMinutes) {
      const frame = frames.find((f) => Math.floor((f.timestamp || 0) / 60000) >= minute);
      if (!frame) continue;

      const pf =
        frame.participantFrames?.[String(participantId)] ??
        frame.participantFrames?.[participantId];

      if (!pf) continue;

      milestones.push({
        minute,
        level: Number(pf.level || 0),
        cs: Number(pf.minionsKilled || 0) + Number(pf.jungleMinionsKilled || 0),
        totalGold: Number(pf.totalGold || 0)
      });
    }

    return res.json({
      matchId,
      puuid,
      kda: {
        kills: Number(participant.kills || 0),
        deaths: Number(participant.deaths || 0),
        assists: Number(participant.assists || 0)
      },
      milestones
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'Failed to load timeline'
    });
  }
});

app.get('/debug-key', (req, res) => {
  const key = (process.env.RIOT_API_KEY || '').trim();

  res.json({
    exists: !!key,
    startsWithRGAPI: key.startsWith('RGAPI-'),
    length: key.length,
    preview: key ? key.slice(0, 10) + '...' : null
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Open http://localhost:${PORT}/index.html to view your app`);
  console.log(`Riot key loaded: ${RIOT_API_KEY ? 'yes' : 'no'}`);
});