/**
 * Low-request discovery. Uses the complete, alias-normalized, deduplicated record set.
 * One spreadsheet row is one request, except when the dashboard's deduplication is enabled.
 * A song is uniquely identified by title + producer, not title alone.
 */
export function recommendHiddenGems(records, {
  count = 5,
  rng = Math.random,
  previousKeys = []
} = {}) {
  const songs = new Map();
  const producers = new Map();
  for (const row of records || []) {
    const artist = String(row?.artist || '').trim();
    const title = String(row?.song || '').trim();
    const artistKey = String(row?.artistKey || '').trim();
    const songKey = String(row?.songKey || '').trim();
    if (!artist || !title || !artistKey || !songKey) continue;
    producers.set(artistKey, (producers.get(artistKey) || 0) + 1);
    if (!songs.has(songKey)) songs.set(songKey, {
      key: songKey, label: title, artist, artistKey, songCount: 0
    });
    songs.get(songKey).songCount++;
  }
  const allSongs = Array.from(songs.values(), song => ({
    ...song,
    artistCount: producers.get(song.artistKey)
  })).sort((a, b) => a.songCount - b.songCount || a.artistCount - b.artistCount || a.key.localeCompare(b.key, 'ja'));
  const limit = Math.min(Math.max(0, Math.trunc(count) || 0), allSongs.length);
  if (!limit) return { recommendations: [], totalSongs: allSongs.length, eligibleCount: 0, cutoff: 0 };

  // First consider songs requested once or twice. If there aren't enough, gradually
  // widen to the smallest available count needed to fill up to five slots.
  const cutoff = Math.max(2, allSongs[limit - 1].songCount);
  const eligible = allSongs.filter(song => song.songCount <= cutoff);
  const previous = new Set(previousKeys);
  const remaining = [...eligible];
  const chosen = [];
  const selectedProducers = new Set();
  while (chosen.length < limit && remaining.length) {
    // A reroll offers previously unseen songs first when available. Within that
    // selection, prefer one song per producer while other producers remain.
    const fresh = remaining.filter(song => !previous.has(song.key));
    const pool = fresh.length ? fresh : remaining;
    const distinct = pool.filter(song => !selectedProducers.has(song.artistKey));
    const choices = distinct.length ? distinct : pool;
    let totalWeight = 0;
    const weights = choices.map(song => {
      // Producer popularity has a stronger influence than individual song count.
      let weight = 1 / (Math.pow(song.songCount, 0.8) * Math.pow(song.artistCount, 1.3));
      totalWeight += weight;
      return weight;
    });
    const rawRandom = Number(rng());
    let roll = Math.min(1 - Number.EPSILON, Math.max(0, Number.isFinite(rawRandom) ? rawRandom : 0)) * totalWeight;
    let index = choices.length - 1;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i];
      if (roll < 0) { index = i; break; }
    }
    const pick = choices[index];
    chosen.push(pick);
    selectedProducers.add(pick.artistKey);
    remaining.splice(remaining.findIndex(song => song.key === pick.key), 1);
  }
  return { recommendations: chosen, totalSongs: allSongs.length, eligibleCount: eligible.length, cutoff };
}
