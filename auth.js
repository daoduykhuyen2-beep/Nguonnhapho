// ===== AUTH.JS v3.0 - He thong dang nhap Nguon Nha Pho HCM =====
// v3.0: Them verify session qua GAS backend (chong bypass localStorage)
// Su dung GAS Cache de luu session token 8 tieng
// ================================================================

const STORAGE_USERS   = 'nhphcm_users';
const STORAGE_CURRENT = 'nhphcm_user';
const STORAGE_TOKEN   = 'nhphcm_token';
const WARN_DAYS       = 7;

// GAS URL - thay bang URL deploy cua ban neu khac
const GAS_URL = (typeof window !== 'undefined' && window.GAS_URL)
  ? window.GAS_URL
  : 'https://script.google.com/macros/s/AKfycbzzcQIyuC3JGu3Nxfmbhea247Bb7oMxAVpXEuLpakI_aYPvJG8A8Ldq8JAoHe2j9BUd/exec';

// ================================================================
// HASH MAT KHAU - don gian (dong bo voi GAS hashPassword)
// ================================================================
function hashPass(pass) {
  // Simple hash de tranh luu plain text
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
    const res  = await fetch(GAS_URL + '?action=verify&token=' + encodeURIComponent(token));
    const data = await res.json();
    return data.ok === true && data.valid === true;
  } catch(e) {
    // Neu khong ket duoc GAS, fall back check localStorage (offline mode)
    console.warn('[AUTH] GAS verify failed, using local fallback:', e.message);
    return !!getCurrentUser();
  }
}

// ================================================================
// CHECK AUTH - goi o dau moi trang can bao ve
// Su dung: await checkAuth(); hoac checkAuth().then(...)
// ================================================================
async function checkAuth(redirectUrl) {
  const redirect = redirectUrl || 'index.html';
  const token    = localStorage.getItem(STORAGE_TOKEN);
  const user     = getCurrentUser();

  // 1. Khong co user local -> chuyen login ngay
  if (!user) {
    localStorage.clear();
    window.location.href = redirect;
    return false;
  }

  // 2. Verify voi GAS (neu co token)
  if (token) {
    const valid = await verifyWithGAS(token);
    if (!valid) {
      console.warn('[AUTH] Session expired or invalid, logging out');
      logout(true);
      window.location.href = redirect;
      return false;
    }
  }

  // 3. Kiem tra het han goi
  if (user.expires) {
    const exp  = new Date(user.expires);
    const now  = new Date();
    const diff = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
    if (diff <= 0) {
      alert('\u26a0\ufe0f Goi dich vu cua ban da het han. Vui long lien he de gia han.');
      logout(true);
      window.location.href = redirect;
      return false;
    }
    if (diff <= WARN_DAYS) {
      showExpiryWarning(diff, exp);
    }
  }

  return true;
}

// ================================================================
// LOGIN
// ================================================================
async function login(phone, password) {
  const users    = getUsers();
  const normPhone = normalizePhone(phone);
  const hashed   = hashPass(password);

  // Tim user theo so dien thoai
  const user = users.find(u => normalizePhone(u.phone) === normPhone);
  if (!user) {
    return { ok: false, msg: 'Khong tim thay so dien thoai' };
  }

  // Kiem tra mat khau (ho tro ca plain text cu va hash moi)
  const passOk = (user.password === password) || (user.password === hashed) ||
                 (user.passwordHash && user.passwordHash === hashed);
  if (!passOk) {
    return { ok: false, msg: 'Sai mat khau' };
  }

  // Lay session token tu GAS
  let gasToken = null;
  try {
    const res  = await fetch(GAS_URL, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ action: 'login', phone: normPhone, password: password })
    });
    const data = await res.json();
    if (data.ok && data.token) {
      gasToken = data.token;
      localStorage.setItem(STORAGE_TOKEN, gasToken);
    }
  } catch(e) {
    console.warn('[AUTH] GAS login failed, using local session:', e.message);
  }

  // Luu thong tin user
  setCurrentUser({
    phone   : normPhone,
    name    : user.name || '',
    plan    : user.plan || 'free',
    expires : user.expires || null,
    role    : user.role || 'user',
    gasToken: gasToken
  });

  return { ok: true, user: user };
}

// ================================================================
// LOGOUT
// ================================================================
async function logout(skipGAS) {
  // Xoa session tren GAS truoc
  if (!skipGAS) {
    const token = localStorage.getItem(STORAGE_TOKEN);
    if (token) {
      try {
        await fetch(GAS_URL, {
          method : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body   : JSON.stringify({ action: 'logout', token: token })
        });
      } catch(e) {}
    }
  }
  // Xoa local storage
  localStorage.removeItem(STORAGE_CURRENT);
  localStorage.removeItem(STORAGE_TOKEN);
}

// ================================================================
// NORMALIZE PHONE
// ================================================================
function normalizePhone(phone) {
  if (!phone) return '';
  let s = String(phone).replace(/\D/g, '');
  if (s.startsWith('84')) s = '0' + s.slice(2);
  if (s.length === 9) s = '0' + s;
  return s;
}

// ================================================================
// EXPIRY WARNING
// ================================================================
function showExpiryWarning(daysLeft, expDate) {
  const existing = document.getElementById('expiry-banner');
  if (existing) return;
  const banner = document.createElement('div');
  banner.id = 'expiry-banner';
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#ff9800;color:#000;text-align:center;padding:10px;z-index:9999;font-weight:bold;';
  const expStr = expDate ? expDate.toLocaleDateString('vi-VN') : '';
  banner.innerHTML = '\u26a0\ufe0f Goi dich vu het han sau <b>' + daysLeft + ' ngay</b> (' + expStr + '). <a href="mailto:nhaphohcm@gmail.com" style="color:#000;text-decoration:underline">Lien he gia han</a> &nbsp; <button onclick="this.parentElement.remove()" style="background:none;border:1px solid #000;cursor:pointer;padding:2px 8px">X</button>';
  document.body.prepend(banner);
}

// ================================================================
// SYNC USERS TU GAS (cap nhat du lieu moi nhat)
// ================================================================
async function syncUsersFromGAS() {
  try {
    const res   = await fetch(GAS_URL + '?action=getUsers');
    const data  = await res.json();
    if (data.ok && Array.isArray(data.users)) {
      saveUsers(data.users);
      return data.users;
    }
  } catch(e) {
    console.warn('[AUTH] syncUsers failed:', e.message);
  }
  return getUsers();
}
