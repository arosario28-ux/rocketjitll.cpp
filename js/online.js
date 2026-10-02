// Online head-to-head over Supabase Realtime. There is no game server:
//   - players looking for a race sit in one shared "lobby" presence channel and pair off;
//   - each pair then moves to a private channel and trades car positions about ten times a second.
// Every player simulates only their own car, so driving stays fully responsive; the other car
// is drawn from the positions it reports. Nothing here touches the database.

const SB_URL = 'https://gowgppiupdhaomzdgvuq.supabase.co';
const SB_KEY = 'sb_publishable_drRkF2vCnxJwzRmT7XK1KQ_Hr2wXELV';
const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const LOBBY = 'sc-lobby';
const PEER_TIMEOUT = 10000;   // ms without a word from the other player before giving up on them

let client = null;
async function getClient() {
  if (!client) {
    const { createClient } = await import(SDK);   // loaded on demand, so solo play never needs it
    client = createClient(SB_URL, SB_KEY, { realtime: { params: { eventsPerSecond: 20 } } });
  }
  return client;
}

// handlers: onStatus(text), onMatched({ role, peer, track, laps }), onStart(), onPeerState(state),
//           onPeerFinish(result), onPeerLeft()
export function createOnline(handlers) {
  let me = null;        // { id, name, carId, look, track, laps } while searching or racing
  let lobby = null, match = null;
  let invite = null;    // { to, match, at } while waiting for an answer
  let peer = null, started = false, lastHeard = 0;
  let timers = [];
  const every = (ms, fn) => { timers.push(setInterval(fn, ms)); };
  const clearTimers = () => { timers.forEach(clearInterval); timers = []; };
  const send = (channel, event, payload) => channel?.send({ type: 'broadcast', event, payload }).catch(() => {});
  const drop = async (channel) => { if (channel && client) { try { await client.removeChannel(channel); } catch { /* already gone */ } } };

  // ---- lobby: pair the waiting players off, two by two, in id order
  function lobbyTick() {
    if (!lobby || match) return;
    const ids = Object.keys(lobby.presenceState()).sort();
    const i = ids.indexOf(me.id);
    if (i < 0 || i % 2 === 1 || !ids[i + 1]) return;   // odd ones wait to be invited
    if (invite && invite.to === ids[i + 1] && Date.now() - invite.at < 3000) return;
    invite = { to: ids[i + 1], match: crypto.randomUUID(), at: Date.now() };
    send(lobby, 'invite', { from: me.id, to: invite.to, match: invite.match, track: me.track, laps: me.laps });
  }

  async function enterLobby() {
    handlers.onStatus('Searching for an opponent…');
    const sb = await getClient();
    if (!me) return;   // cancelled while the SDK loaded
    const ch = sb.channel(LOBBY, { config: { presence: { key: me.id }, broadcast: { self: false } } });
    lobby = ch;
    ch.on('presence', { event: 'sync' }, lobbyTick);
    ch.on('broadcast', { event: 'invite' }, ({ payload }) => {
      if (match || payload.to !== me.id) return;
      send(ch, 'accept', { to: payload.from, match: payload.match });
      enterMatch(payload.match, 'guest', payload.track, payload.laps);
    });
    ch.on('broadcast', { event: 'accept' }, ({ payload }) => {
      if (match || !invite || payload.to !== me.id || payload.match !== invite.match) return;
      enterMatch(invite.match, 'host', me.track, me.laps);
    });
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') ch.track({ name: me.name });
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') handlers.onStatus('Could not reach the matchmaking service.');
    });
    every(2500, lobbyTick);
  }

  // ---- match: a private channel for the two players
  async function enterMatch(id, role, track, laps) {
    clearTimers();
    const oldLobby = lobby;
    lobby = null;
    invite = null;
    peer = null;
    started = false;
    lastHeard = Date.now();
    const sb = await getClient();
    const ch = sb.channel(`sc-match-${id}`, { config: { broadcast: { self: false }, presence: { key: me.id } } });
    match = ch;
    drop(oldLobby);
    handlers.onStatus('Opponent found. Connecting…');

    const hello = () => send(ch, 'hello', { name: me.name, carId: me.carId, look: me.look });
    const begin = () => {
      if (started) return;
      started = true;
      handlers.onStart();
    };
    ch.on('broadcast', { event: 'hello' }, ({ payload }) => {
      lastHeard = Date.now();
      if (peer) return;
      peer = payload;
      hello();   // make sure they have ours too
      handlers.onMatched({ role, peer, track, laps });
      // the host calls the start once both sides have had a moment to load each other's car
      if (role === 'host') setTimeout(() => { if (match === ch) { send(ch, 'start', {}); begin(); } }, 2500);
    });
    ch.on('broadcast', { event: 'start' }, () => { lastHeard = Date.now(); if (peer) begin(); });
    ch.on('broadcast', { event: 'state' }, ({ payload }) => { lastHeard = Date.now(); handlers.onPeerState(payload); });
    ch.on('broadcast', { event: 'finish' }, ({ payload }) => { lastHeard = Date.now(); handlers.onPeerFinish(payload); });
    ch.on('broadcast', { event: 'bye' }, () => peerGone());
    ch.on('presence', { event: 'leave' }, () => { if (peer) setTimeout(() => { if (match === ch && Date.now() - lastHeard > 2500) peerGone(); }, 3000); });
    ch.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      ch.track({ role });
      hello();
    });
    every(1000, () => {
      if (!peer) hello();
      if (Date.now() - lastHeard > PEER_TIMEOUT) peerGone();
    });
  }

  function peerGone() {
    if (!match) return;
    if (!peer) {            // they never showed up: go back to looking
      const ch = match;
      match = null;
      clearTimers();
      drop(ch);
      enterLobby();
      return;
    }
    clearTimers();
    handlers.onPeerLeft();
  }

  return {
    get searching() { return !!me && !peer; },
    get active() { return !!me; },

    search(profile) {
      if (me) return;
      me = { id: crypto.randomUUID(), ...profile };
      enterLobby().catch((err) => {
        console.warn('Online play unavailable', err);
        handlers.onStatus('Online play is unavailable right now.');
        me = null;
      });
    },

    sendState(state) { send(match, 'state', state); },
    sendFinish(result) { send(match, 'finish', result); },

    // Stops searching or leaves the match, telling the other player.
    leave() {
      clearTimers();
      if (match) send(match, 'bye', {});
      const channels = [lobby, match];
      lobby = match = me = peer = invite = null;
      started = false;
      setTimeout(() => channels.forEach(drop), 200);   // give "bye" a moment to go out
    },
  };
}
