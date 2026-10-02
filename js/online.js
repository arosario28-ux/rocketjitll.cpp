// Online races for two to four players over Supabase Realtime. There is no game server:
//   - players looking for a race sit in one shared "lobby" presence channel; the first in line
//     hosts, waits a few seconds for the grid to fill, then calls up to three others;
//   - that group moves to a private channel and trades car positions about ten times a second.
// Every player simulates only their own car, so driving stays fully responsive; the other cars
// are drawn from the positions they report. Nothing here touches the database.

const SB_URL = 'https://gowgppiupdhaomzdgvuq.supabase.co';
const SB_KEY = 'sb_publishable_drRkF2vCnxJwzRmT7XK1KQ_Hr2wXELV';
const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const LOBBY = 'sc-lobby';
const MAX_PLAYERS = 4;
const GATHER_MS = 6000;       // how long a host waits for more than one opponent
const ALIVE_MS = 8000;        // a lobby entry that hasn't ticked for this long is treated as gone
const CONNECT_MS = 12000;     // how long to wait in a match for the start before looking again
const PEER_TIMEOUT = 10000;   // ms without a word from a player in a race before giving up on them

let client = null;
async function getClient() {
  if (!client) {
    const { createClient } = await import(SDK);   // loaded on demand, so solo play never needs it
    client = createClient(SB_URL, SB_KEY, { realtime: { params: { eventsPerSecond: 20 } } });
  }
  return client;
}

async function drop(channel) {
  if (channel && client) { try { await client.removeChannel(channel); } catch { /* already gone */ } }
}

// The client hands back its existing channel object for a topic it already knows, and a channel
// that has been left can't be joined again. So make sure any old one is fully gone first.
async function freshChannel(sb, topic, config) {
  for (let i = 0; i < 20; i++) {
    const stale = sb.getChannels().find((c) => c.topic === `realtime:${topic}`);
    if (!stale) break;
    if (i === 0) await drop(stale); else await new Promise((done) => setTimeout(done, 100));
  }
  return sb.channel(topic, { config });
}

// One search-and-race, from pressing the button to leaving. Everything it starts checks `dead`
// before acting, so a cancelled search can never come back to life alongside a newer one.
function openSession(profileIn, handlers) {
  const me = { id: crypto.randomUUID(), ...profileIn };
  const profile = { id: me.id, name: me.name, carId: me.carId, look: me.look };
  let dead = false;
  let lobby = null, match = null;
  let timers = [];
  let peers = new Map();    // id -> { profile, lastHeard }
  let started = false;
  let gatherSince = 0;      // when this player, as host, first saw someone to race
  let beat = 0;
  const seen = new Map();   // lobby id -> { beat, at }: who is demonstrably still there
  const strikes = new Map();   // host id -> times they called a race that never started
  const every = (ms, fn) => { timers.push(setInterval(() => { if (!dead) fn(); }, ms)); };
  const clearTimers = () => { timers.forEach(clearInterval); timers = []; };
  const send = (channel, event, payload) => channel?.send({ type: 'broadcast', event, payload }).catch(() => {});

  // ---- lobby
  function waiting() {
    // only count players whose tab is still ticking, and skip hosts that keep failing to start
    const state = lobby.presenceState(), now = Date.now();
    for (const [id, metas] of Object.entries(state)) {
      const last = seen.get(id), b = metas[0]?.beat;
      if (!last || last.beat !== b) seen.set(id, { beat: b, at: now });
    }
    return Object.keys(state)
      .filter((id) => id === me.id || (now - seen.get(id).at < ALIVE_MS && (strikes.get(id) || 0) < 2))
      .sort();
  }

  function lobbyTick() {
    if (!lobby || match) return;
    if (document.hidden) { handlers.onStatus('Paused while this tab is in the background.'); return; }
    const group = waiting().slice(0, MAX_PLAYERS);
    if (!group.includes(me.id)) { handlers.onStatus('The grid is full. You are next in line…'); return; }
    if (group.length < 2) { gatherSince = 0; handlers.onStatus('Searching for opponents…'); return; }
    if (group[0] !== me.id) { handlers.onStatus(`${group.length} players found. Waiting for the host to start…`); return; }
    // this player is first in line, so hosts
    if (!gatherSince) gatherSince = Date.now();
    const wait = GATHER_MS - (Date.now() - gatherSince);
    if (group.length < MAX_PLAYERS && wait > 0) {
      handlers.onStatus(`${group.length} players found. Starting in ${Math.ceil(wait / 1000)}s, or when four have joined…`);
      return;
    }
    const id = crypto.randomUUID();
    send(lobby, 'invite', { from: me.id, to: group.slice(1), match: id, track: me.track, laps: me.laps });
    enterMatch(id, 'host', me.id, me.track, me.laps);
  }

  async function enterLobby() {
    handlers.onStatus('Searching for opponents…');
    const sb = await getClient();
    if (dead) return;
    const ch = await freshChannel(sb, LOBBY, { presence: { key: me.id }, broadcast: { self: false } });
    if (dead) { drop(ch); return; }
    lobby = ch;
    gatherSince = 0;
    seen.clear();
    const announce = () => { if (lobby === ch && !document.hidden) ch.track({ name: me.name, beat: ++beat }); };
    ch.on('presence', { event: 'sync' }, () => { if (!dead) lobbyTick(); });
    ch.on('broadcast', { event: 'invite' }, ({ payload }) => {
      if (dead || lobby !== ch || match || document.hidden) return;
      if (!payload.to.includes(me.id) || (strikes.get(payload.from) || 0) >= 2) return;
      enterMatch(payload.match, 'guest', payload.from, payload.track, payload.laps);
    });
    ch.subscribe((status) => {
      if (dead || lobby !== ch) return;
      if (status === 'SUBSCRIBED') announce();
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') handlers.onStatus('Could not reach the matchmaking service. Retrying…');
    });
    every(2000, announce);   // a heartbeat, so others can tell this tab is alive
    every(1000, lobbyTick);
  }

  // ---- match: a private channel for the group
  async function enterMatch(id, role, hostId, track, laps) {
    clearTimers();
    const oldLobby = lobby;
    lobby = null;
    peers = new Map();
    started = false;
    const sb = await getClient();
    if (dead) { drop(oldLobby); return; }
    const ch = await freshChannel(sb, `sc-match-${id}`, { broadcast: { self: false }, presence: { key: me.id } });
    if (dead) { drop(oldLobby); drop(ch); return; }
    match = ch;
    drop(oldLobby);
    handlers.onStatus('Opponents found. Connecting…');
    const joined = Date.now();
    let grid = null, startedAt = 0;

    const heard = (pid) => { const p = peers.get(pid); if (p) p.lastHeard = Date.now(); };
    const begin = (players) => {
      if (started) return;
      started = true;
      startedAt = Date.now();
      grid = players;
      // anyone who connected but isn't on the grid is not part of this race
      for (const pid of [...peers.keys()]) if (!players.some((p) => p.id === pid)) peers.delete(pid);
      for (const p of players) if (p.id !== me.id && !peers.has(p.id)) peers.set(p.id, { profile: p, lastHeard: Date.now() });
      for (const p of peers.values()) p.lastHeard = Date.now();
      handlers.onMatched({ role, players, me: players.findIndex((p) => p.id === me.id), track, laps });
      handlers.onStart();
    };
    const backToLobby = () => {
      if (role === 'guest') strikes.set(hostId, (strikes.get(hostId) || 0) + 1);
      match = null;
      clearTimers();
      drop(ch).then(() => { if (!dead) enterLobby(); });
    };

    ch.on('broadcast', { event: 'hello' }, ({ payload }) => {
      if (dead || started) return;
      peers.set(payload.id, { profile: payload, lastHeard: Date.now() });
    });
    ch.on('broadcast', { event: 'start' }, ({ payload }) => {
      if (!dead && match === ch && payload.players.some((p) => p.id === me.id)) begin(payload.players);
    });
    ch.on('broadcast', { event: 'state' }, ({ payload }) => { if (!dead) { heard(payload.id); handlers.onPeerState(payload.id, payload); } });
    ch.on('broadcast', { event: 'finish' }, ({ payload }) => { if (!dead) { heard(payload.id); handlers.onPeerFinish(payload.id, payload); } });
    ch.on('broadcast', { event: 'bye' }, ({ payload }) => gone(payload.id));
    ch.on('presence', { event: 'leave' }, ({ key }) => {
      // a dropped connection also shows as a leave; give it a moment to come back
      setTimeout(() => { const p = peers.get(key); if (!dead && match === ch && p && Date.now() - p.lastHeard > 2500) gone(key); }, 3000);
    });
    ch.subscribe((status) => {
      if (dead || match !== ch) return;
      if (status === 'SUBSCRIBED') {
        ch.track({ role });
        send(ch, 'hello', profile);
      } else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !started) {
        backToLobby();
      }
    });

    every(1000, () => {
      if (started) {
        // the start call is repeated for a few seconds in case a player missed the first one
        if (role === 'host' && Date.now() - startedAt < 5000) send(ch, 'start', { players: grid });
        for (const [pid, p] of peers) if (Date.now() - p.lastHeard > PEER_TIMEOUT) gone(pid);
        return;
      }
      send(ch, 'hello', profile);
      const waited = Date.now() - joined;
      if (role === 'host' && waited > 3000 && peers.size) {
        // the host fixes the grid from whoever has connected, and says go
        const players = [profile, ...[...peers.values()].map((p) => p.profile).sort((a, b) => (a.id < b.id ? -1 : 1))];
        send(ch, 'start', { players });
        begin(players);
      } else if (waited > CONNECT_MS || document.hidden) {
        backToLobby();   // nobody came, the host never started, or this tab can't run a race right now
      }
    });
  }

  function gone(id) {
    if (dead || !match || !peers.has(id)) return;
    peers.delete(id);
    if (started) handlers.onPeerLeft(id);
  }

  enterLobby().catch((err) => {
    console.warn('Online play unavailable', err);
    if (!dead) handlers.onStatus('Online play is unavailable right now. Check your connection and try again.');
  });

  return {
    sendState(state) { if (!dead && started) send(match, 'state', { id: me.id, ...state }); },
    sendFinish(result) { if (!dead && started) send(match, 'finish', { id: me.id, ...result }); },
    leave() {
      if (dead) return;
      dead = true;
      clearTimers();
      if (match) send(match, 'bye', { id: me.id });
      const channels = [lobby, match];
      lobby = match = null;
      setTimeout(() => channels.forEach(drop), 200);   // give "bye" a moment to go out
    },
  };
}

// handlers: onStatus(text), onMatched({ role, players, me, track, laps }), onStart(),
//           onPeerState(id, state), onPeerFinish(id, result), onPeerLeft(id)
// `players` is the grid in order, each { id, name, carId, look }; `me` is this player's index in it.
export function createOnline(handlers) {
  let session = null;
  return {
    get active() { return !!session; },
    search(profile) { if (!session) session = openSession(profile, handlers); },
    sendState(state) { session?.sendState(state); },
    sendFinish(result) { session?.sendFinish(result); },
    // Stops searching or leaves the race, telling the other players.
    leave() { session?.leave(); session = null; },
  };
}
