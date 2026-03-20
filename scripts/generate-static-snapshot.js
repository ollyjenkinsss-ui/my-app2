const fs = require('fs');
const path = require('path');

async function main() {
  const versions = await fetch('https://ddragon.leagueoflegends.com/api/versions.json').then((r) => r.json());
  const version = Array.isArray(versions) && versions[0];
  if (!version) {
    throw new Error('Could not resolve latest Data Dragon version');
  }

  const championsPayload = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`).then((r) => r.json());
  const champions = Object.values(championsPayload?.data || {});
  const snapshot = {};

  for (const champion of champions) {
    const id = champion.id;
    const slug = `${id}`.toLowerCase().replace(/[^a-z]/g, '');
    const response = await fetch(`http://localhost:3001/api/statbase/${slug}`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to fetch statbase for ${id}: HTTP ${response.status}`);
    }
    const data = await response.json();
    snapshot[slug] = data;
    snapshot[id] = data;
  }

  const outPath = path.join(process.cwd(), 'assets', 'js', 'statbase-data.js');
  const content = `window.STATBASE_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)};\n`;
  fs.writeFileSync(outPath, content, 'utf8');
  console.log(`Wrote static snapshot to ${outPath} with ${champions.length} champions.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
