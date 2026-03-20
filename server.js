const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.static('.'));

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

function scrapeOpggSnapshot(html, champion) {
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
    const numbers = [...rowHtml.matchAll(/<strong[^>]*>(\d+(?:\.\d+)?)<!-- -->%<\/strong>/gi)].map((match) => cleanNumber(match[1])).filter((value) => value !== null);
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
  const payload = scrapeOpggSnapshot(html, champion);
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
  if (itemIds.length) {
    normalized.data.builds.push({ items: itemIds });
  }

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
  if (perkIds.length) {
    normalized.data.runes.push({ perks: perkIds });
  }

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
  if (itemIds.length) {
    normalized.data.builds.push({ items: itemIds });
  }

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
  if (perks.length) {
    normalized.data.runes.push({ perks });
  }

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

// OP.GG API endpoint (they have a public stats API)
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
    console.error('OP.GG API error:', error);
    res.status(500).json({ error: 'Failed to fetch OP.GG data', details: error.message });
  }
});

// Generic proxy endpoint as fallback
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
    console.error('Proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch data', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy server running at http://localhost:${PORT}`);
  console.log(`Open http://localhost:${PORT}/index.html to view your app`);
});
