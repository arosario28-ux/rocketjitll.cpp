// Player accounts: a username and passcode, stored in Supabase.
// The browser never touches the tables directly. It calls database functions
// (register_player, login_player, ...) that check the passcode against a bcrypt hash
// and hand back a session token, which is what gets remembered between visits.

const SB_URL = 'https://gowgppiupdhaomzdgvuq.supabase.co';
const SB_KEY = 'sb_publishable_drRkF2vCnxJwzRmT7XK1KQ_Hr2wXELV';
const TOKEN_KEY = 'sc_session';

async function rpc(name, body) {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`Account request ${name} failed`, err);
    return { error: 'Could not reach the server. Try again.' };
  }
}

let session = null;      // { token, username, isDev, specialCars, save } while signed in
let saveTimer = null;
let pendingSave = null;

function adopt(reply) {
  if (reply.error) return reply;
  session = { token: reply.token, username: reply.username, isDev: reply.is_dev, specialCars: reply.cars || [], save: reply.save };
  try { localStorage.setItem(TOKEN_KEY, reply.token); } catch { /* storage blocked: session lasts for this visit */ }
  return session;
}

function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!session || !pendingSave) return;
  const save = pendingSave;
  pendingSave = null;
  rpc('save_progress', { p_token: session.token, p_save: save });
}

export const account = {
  get current() { return session; },

  // Picks up the session left by a previous visit, if it is still valid.
  async resume() {
    let token = null;
    try { token = localStorage.getItem(TOKEN_KEY); } catch { /* storage blocked */ }
    if (!token) return null;
    const reply = adopt(await rpc('get_profile', { p_token: token }));
    if (reply.error) {
      try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
      return null;
    }
    return reply;
  },

  async register(username, passcode) { return adopt(await rpc('register_player', { p_username: username, p_passcode: passcode })); },
  async login(username, passcode) { return adopt(await rpc('login_player', { p_username: username, p_passcode: passcode })); },

  async redeemDevCode(code) {
    if (!session) return { error: 'Log in first.' };
    const reply = await rpc('redeem_dev_code', { p_token: session.token, p_code: code });
    if (!reply.error) session.isDev = true;
    return reply;
  },

  // Progress changes in bursts (a paint job is several clicks), so writes are batched.
  queueSave(save) {
    if (!session) return;
    pendingSave = session.save = save;
    if (!saveTimer) saveTimer = setTimeout(flushSave, 1500);
  },

  logout() {
    flushSave();
    if (session) rpc('logout_player', { p_token: session.token });
    session = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
  },
};

addEventListener('pagehide', flushSave);
