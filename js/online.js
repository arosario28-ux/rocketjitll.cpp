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
const PEER_TIMEOUT = 10000;   // ms without a word from a player before giving up on them

let client = null;
async function getClient() {
  if (!client) {
    const { createClient } = await import(SDK);   // loaded on demand, so solo play never needs it
    client = createClient(SB_URL, SB_KEY, { realtime: { params: { eventsPerSecond: 20 } } });
  }
  return client;
}

// handlers: onStatus(text), onMatched({ role, players, me, track, laps }), onStart(),
//           onPeerState(id, state), onPeerFinish(id, result), onPeerLeft(id)
// `players` is the grid in order, each { id, name, carId, look }; `me` is this player's index in it.
export function createOnline(handlers) {
  let me = null;          // { id, name, carId, look, track, laps } while searching or racing
  let lobby = null, match = null;
  let gatherSince = 0;    // when this player, as host, first saw someone to race
  let peers = new Map();  // id -> { profile, lastHeard }
  let started = false;
  let timers = [];
  const every = (ms, fn) => { timers.push(setInterval(fn, ms)); };
  const clearTimers = () => { timers.forEach(clearInterval); timers = []; };
  const send = (channel, event, payload) => channel?.send({ type: 'broadcast', event, payload }).catch(() => {});
  const drop = async (channel) => { if (channel && client) { try { await client.removeChannel(channel); } catch { /* already gone */ } } };
  const profile = () => ({ id: me.id, name: me.name, carId: me.carId, look: me.look });

  // ---- lobby
  function lobbyTick() {
    if (!lobby || match) return;
    const ids = Object.keys(lobby.presenceState()).sort();
    const group = ids.slice(0, MAX_PLAYERS);
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
    send(lobby, 'invite', { to: group.slice(1), match: id, track: me.track, laps: me.laps });
    enterMatch(id, 'host', me.track, me.laps);
  }

  async function enterLobby() {
    handlers.onStatus('Searching for opponents…');
    const sb = await getClient();
    if (!me) return;   // cancelled while the SDK loaded
    gatherSince = 0;
    const ch = sb.channel(LOBBY, { config: { presence: { key: me.id }, broadcast: { self: false } } });
    lobby = ch;
    ch.on('presence', { event: 'sync' }, lobbyTick);
    ch.on('broadcast', { event: 'invite' }, ({ payload }) => {
      if (match || !payload.to.includes(me.id)) return;
      enterMatch(payload.match, 'guest', payload.track, payload.laps);
    });
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') ch.track({ name: me.name });
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') handlers.onStatus('Could not reach the matchmaking service.');
    });
    every(1000, lobbyTick);
  }

  // ---- match: a private channel for the group
  async function enterMatch(id, role, track, laps) {
    clearTimers();
    const oldLobby = lobby;
    lobby = null;
    peers = new Map();
    started = false;
    const joined = Date.now();
    const sb = await getClient();
    const ch = sb.channel(`sc-match-${id}`, { config: { broadcast: { self: false }, presence: { key: me.id } } });
    match = ch;
    drop(oldLobby);
    handlers.onStatus('Opponents found. Connecting…');

    const heard = (pid) => { const p = peers.get(pid); if (p) p.lastHeard = Date.now(); };
    const begin = (players) => {
      if (started) return;
      started = true;
      // anyone who connected but isn't on the grid is not part of this race
      for (const pid of [...peers.keys()]) if (!players.some((p) => p.id === pid)) peers.delete(pid);
      for (const p of players) if (p.id !== me.id && !peers.has(p.id)) peers.set(p.id, { profile: p, lastHeard: Date.now() });
      handlers.onMatched({ role, players, me: players.findIndex((p) => p.id === me.id), track, laps });
      handlers.onStart();
    };

    ch.on('broadcast', { event: 'hello' }, ({ payload }) => {
      if (started) return;
      peers.set(payload.id, { profile: payload, lastHeard: Date.now() });
    });
    ch.on('broadcast', { event: 'start' }, ({ payload }) => {
      if (payload.players.some((p) => p.id === me.id)) begin(payload.players);
    });
    ch.on('broadcast', { event: 'state' }, ({ payload }) => { heard(payload.id); handlers.onPeerState(payload.id, payload); });
    ch.on('broadcast', { event: 'finish' }, ({ payload }) => { heard(payload.id); handlers.onPeerFinish(payload.id, payload); });
    ch.on('broadcast', { event: 'bye' }, ({ payload }) => gone(payload.id));
    ch.on('presence', { event: 'leave' }, ({ key }) => {
      // a dropped connection also shows as a leave; give it a moment to come back
      setTimeout(() => { const p = peers.get(key); if (match === ch && p && Date.now() - p.lastHeard > 2500) gone(key); }, 3000);
    });
    ch.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      ch.track({ role });
      send(ch, 'hello', profile());
    });

    every(1000, () => {
      if (!started) {
        send(ch, 'hello', profile());
        const waited = Date.now() - joined;
        if (role === 'host' && waited > 3000 && peers.size) {
          // the host fixes the grid from whoever has connected, and says go
          const players = [profile(), ...[...peers.values()].map((p) => p.profile).sort((a, b) => (a.id < b.id ? -1 : 1))];
          send(ch, 'start', { players });
          begin(players);
        } else if (waited > 12000) {   // nobody came, or the host never started: look again
          match = null;
          clearTimers();
          drop(ch);
          enterLobby();
        }
        return;
      }
      for (const [pid, p] of peers) if (Date.now() - p.lastHeard > PEER_TIMEOUT) gone(pid);
    });
  }

  function gone(id) {
    if (!match || !peers.has(id)) return;
    peers.delete(id);
    if (started) handlers.onPeerLeft(id);
  }

  return {
    get active() { return !!me; },

    search(profileIn) {
      if (me) return;
      me = { id: crypto.randomUUID(), ...profileIn };
      enterLobby().catch((err) => {
        console.warn('Online play unavailable', err);
        handlers.onStatus('Online play is unavailable right now.');
        me = null;
      });
    },

    sendState(state) { if (me) send(match, 'state', { id: me.id, ...state }); },
    sendFinish(result) { if (me) send(match, 'finish', { id: me.id, ...result }); },

    // Stops searching or leaves the race, telling the other players.
    leave() {
      clearTimers();
      if (match && me) send(match, 'bye', { id: me.id });
      const channels = [lobby, match];
      lobby = match = me = null;
      peers = new Map();
      started = false;
      setTimeout(() => channels.forEach(drop), 200);   // give "bye" a moment to go out
    },
  };
}
