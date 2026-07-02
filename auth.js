// ===== AUTH.JS v4.0 - He thong dang nhap Nguon Nha Pho HCM =====
// v4.0: Dang nhap bang SDT hoac email, doi MK admin, cap nhat thong tin ca nhan
// Su dung GAS Cache de luu session token 8 tieng
// ================================================================

const STORAGE_USERS   = 'nhphcm_users';
const STORAGE_CURRENT = 'nhphcm_user';
const STORAGE_TOKEN   = 'nhphcm_token';
const WARN_DAYS       = 7;

// GAS URL
const GAS_URL = (typeof window !== 'undefined' && window.GAS_URL)
  ? window.GAS_URL
  : 'https://script.google.com/macros/s/AKfycbzzcQIyuC3JGu3Nxfmbhea247Bb7oMxAVpXEuLpakI_aYPvJG8A8Ldq8JAoHe2j9BUd/exec';

// ================================================================
// HASH MAT KHAU - dong bo voi GAS hashPassword
// ================================================================
function hashPass(pass) {
  let hash = 0;
  const str = 'NHPHCM_SALT_2024_' + pass;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

// ================================================================
// STORAGE HELPERS
// ================================================================
function getUsers() {
  try { return JSON.parse(localStorage.getItem(STORAGE_USERS) || '[]'); }
  catch(e) { return []; }
}
function saveUsers(users) {
  localStorage.setItem(STORAGE_USERS, JSON.stringify(users));
}
function getCurrentUser() {
  try { return JSON.parse(localStorage.getItem(STORAGE_CURRENT) || 'null'); }
  catch(e) { return null; }
}
function setCurrentUser(user) {
  localStorage.setItem(STORAGE_CURRENT, JSON.stringify(user));
}

// ================================================================
// SESSION TOKEN - verify voi GAS backend
// ================================================================
async function verifyWithGAS(token) {
  if (!token) return false;
  try {
    const res = await fetch(GAS_URL + '?action=verify&token=' + encodeURIComponent(token));
    const data = await res.json();
    return data.ok === true && data.valid === true;
  } catch(e) {
    console.warn('[AUTH] GAS verify failed, fallback local:', e.message);
    return !!getCurrentUser();
  }
}

// ================================================================
// CHECK AUTH - goi o moi trang can bao ve
// ================================================================
async function checkAuth(redirectUrl) {
  const redirect = redirectUrl || 'index.html';
  const token = localStorage.getItem(STORAGE_TOKEN);
  const user = getCurrentUser();
  if (!user) { localStorage.clear(); window.location.href = redirect; return false; }
  if (token) {
    const valid = await verifyWithGAS(token);
    if (!valid) { logout(true); window.location.href = redirect; return false; }
  }
  if (user.expires) {
    const exp = new Date(user.expires);
    const diff = Math.ceil((exp - new Date()) / (1000*60*60*24));
    if (diff <= 0) { alert('\u26a0\ufe0f Goi het han. Vui long gia han.'); logout(true); window.location.href = redirect; return false; }
    if (diff <= WARN_DAYS) showExpiryWarning(diff, exp);
  }
  return true;
}

// ================================================================
// LOGIN - ho tro SDT hoac email
// ================================================================
async function login(identifier, password) {
  const users = getUsers();
  const normId  = (identifier||'').trim().toLowerCase();
  const normPhone = normalizePhone(identifier);
  const hashed  = hashPass(password);

  // Tim user theo SDT hoac email
  let user = users.find(u => {
    const byPhone = normalizePhone(u.phone||'') === normPhone && normPhone;
    const byEmail = (u.email||'').toLowerCase().trim() === normId && normId.includes('@');
    return byPhone || byEmail;
  });

  // Neu khong co local, thu GAS
  if (!user && normPhone) {
    try {
      const res = await fetch(GAS_URL + '?action=getUser&phone=' + encodeURIComponent(normPhone));
      const data = await res.json();
      if (data.ok && data.user) {
        user = data.user;
        const arr = getUsers(); arr.push(user); saveUsers(arr);
      }
    } catch(e) {}
  }
  if (!user && normId.includes('@')) {
    try {
      const res = await fetch(GAS_URL + '?action=getUserByEmail&email=' + encodeURIComponent(normId));
      const data = await res.json();
      if (data.ok && data.user) {
        user = data.user;
        const arr = getUsers(); arr.push(user); saveUsers(arr);
      }
    } catch(e) {}
  }

  if (!user) return { ok: false, msg: 'Khong tim thay tai khoan voi SDT/email nay.' };
  if (user.status === 'banned') return { ok: false, msg: 'Tai khoan da bi khoa.' };

  // Kiem tra admin hardcode - MK: Gi\u1ea1huy2024@
  const ADMIN_PHONES = ['0987645314'];
  const ADMIN_EMAIL  = 'daoduykhuyen2@gmail.com';
  const ADMIN_PASS   = 'Gi\u1ea1huy2024@';
  const isAdminId = ADMIN_PHONES.includes(normalizePhone(user.phone||'')) || (user.email||'').toLowerCase() === ADMIN_EMAIL;
  const isAdminPass = (password === ADMIN_PASS || hashed === hashPass(ADMIN_PASS));
  const isAdminHardcode = isAdminId && isAdminPass;

  const passOk = isAdminHardcode || user.password === hashed || user.pass === hashed;
  if (!passOk) return { ok: false, msg: 'Mat khau khong dung.' };

  if (isAdminHardcode) user.urole = 'admin';

  // Tao session token
  const token = 'tk_' + Date.now() + '_' + Math.random().toString(36).substr(2,9);
  localStorage.setItem(STORAGE_TOKEN, token);
  try {
    await fetch(GAS_URL + '?action=createSession&token=' + encodeURIComponent(token) + '&phone=' + encodeURIComponent(user.phone||''));
  } catch(e) {}

  setCurrentUser(user);
  const arr = getUsers();
  const idx = arr.findIndex(u => normalizePhone(u.phone||'') === normalizePhone(user.phone||''));
  if (idx >= 0) arr[idx] = user; else arr.push(user);
  saveUsers(arr);
  return { ok: true, user };
}

// ================================================================
// LOGOUT
// ================================================================
function logout(silent) {
  const token = localStorage.getItem(STORAGE_TOKEN);
  if (token) { try { fetch(GAS_URL + '?action=destroySession&token=' + encodeURIComponent(token)); } catch(e) {} }
  localStorage.removeItem(STORAGE_CURRENT);
  localStorage.removeItem(STORAGE_TOKEN);
  if (!silent) window.location.href = 'index.html';
}

// ================================================================
// UPDATE PROFILE - cap nhat ten, SDT, email
// ================================================================
async function updateProfile(data) {
  const user = getCurrentUser();
  if (!user) return { ok: false, msg: 'Chua dang nhap' };
  const updated = { ...user };
  if (data.ten  && data.ten.trim())   updated.ten   = data.ten.trim();
  if (data.phone && data.phone.trim()) updated.phone = normalizePhone(data.phone.trim());
  if (data.email && data.email.trim()) updated.email = data.email.trim().toLowerCase();
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ action: 'updateProfile', phone: user.phone, ten: data.ten, email: data.email, newPhone: data.phone })
    });
    const result = await res.json();
    if (!result.ok) return result;
  } catch(e) { console.warn('[AUTH] updateProfile GAS error:', e.message); }
  setCurrentUser(updated);
  const arr = getUsers();
  const idx = arr.findIndex(u => normalizePhone(u.phone||'') === normalizePhone(user.phone||''));
  if (idx >= 0) arr[idx] = updated; else arr.push(updated);
  saveUsers(arr);
  return { ok: true, user: updated };
}

// ================================================================
// CHANGE PASSWORD
// ================================================================
async function changePassword(oldPass, newPass) {
  const user = getCurrentUser();
  if (!user) return { ok: false, msg: 'Chua dang nhap' };
  const hashedOld = hashPass(oldPass);
  if (user.password !== hashedOld && user.pass !== hashedOld) return { ok: false, msg: 'Mat khau cu khong dung' };
  const hashedNew = hashPass(newPass);
  try {
    await fetch(GAS_URL, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ action:'changePass', phone:user.phone, oldPass, newPass })
    });
  } catch(e) {}
  user.password = hashedNew; user.pass = hashedNew;
  setCurrentUser(user);
  const arr = getUsers();
  const idx = arr.findIndex(u => normalizePhone(u.phone||'') === normalizePhone(user.phone||''));
  if (idx >= 0) { arr[idx].password = hashedNew; arr[idx].pass = hashedNew; }
  saveUsers(arr);
  return { ok: true };
}

// ================================================================
// HELPERS
// ================================================================
function normalizePhone(p) {
  if (!p) return '';
  p = p.toString().replace(/\D/g,'');
  if (p.startsWith('84')) p = '0' + p.slice(2);
  return p;
}

function showExpiryWarning(days, exp) {
  const banner = document.getElementById('expiry-banner');
  if (banner) {
    banner.textContent = '\u26a0\ufe0f Goi het han sau ' + days + ' ngay (' + exp.toLocaleDateString('vi-VN') + '). Gia han ngay!';
    banner.style.display = 'block';
  }
}

function isAdmin() {
  const u = getCurrentUser();
  return u && u.urole === 'admin';
}

function isLoggedIn() {
  return !!getCurrentUser();
}
