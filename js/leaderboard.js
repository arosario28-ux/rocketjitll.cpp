// Global lap-time leaderboard (one board per track), stored in Supabase and reached over its REST API.
// The key below is the project's publishable (client-side) key; row level
// security on `lap_times` only allows reading rows and inserting new ones.

const SB_URL = 'https://gowgppiupdhaomzdgvuq.supabase.co';
const SB_KEY = 'sb_publishable_drRkF2vCnxJwzRmT7XK1KQ_Hr2wXELV';
const ENDPOINT = `${SB_URL}/rest/v1/lap_times`;

export async function fetchBoard(track) {
  try {
    const res = await fetch(`${ENDPOINT}?select=player_name,lap_ms&track=eq.${encodeURIComponent(track)}&order=lap_ms.asc&limit=10`, {
      headers: { apikey: SB_KEY },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('Leaderboard fetch failed', err);
    return null;
  }
}

export async function submitLap(name, lapMs, track) {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { apikey: SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ player_name: name.slice(0, 16), lap_ms: Math.round(lapMs), track }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (err) {
    console.warn('Leaderboard submit failed', err);
    return false;
  }
}
