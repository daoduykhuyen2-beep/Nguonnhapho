// ===== AUTH.JS v2.0 - He thong dang nhap Nguon Nha Pho HCM =====
// Su dung localStorage de luu tai khoan phia client
// UPDATED v2.0: hash password, kiem tra het han goi, canh bao gia han,
//               dong bo voi GAS backend, hien thi boost count
// ================================================================

const STORAGE_USERS   = 'nhphcm_users';
const STORAGE_CURRENT = 'nhphcm_user';
const WARN_DAYS       = 7; // Canh bao khi con X ngay het han

// ================================================================
// HASH MAT KHAU - don gian (co the nang len SHA-256 sau)
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
  return 'H' + Math.abs(hash).toString(36).toUpperCase();
}

// ================================================================
// KIEM TRA HET HAN GOI
// ================================================================
function getExpiryInfo(user) {
  if (!user || !user.expiry || user.plan === 'free') {
    return { isExpired: false, daysLeft: null, willExpireSoon: false };
  }
  try {
    const parts = user.expiry.split('/');
    const expDate = new Date(parseInt(parts[2]), parseInt(parts[1])-1, parseInt(parts[0]));
    const now = new Date();
    now.setHours(0,0,0,0);
    expDate.setHours(0,0,0,0);
    const msPerDay = 1000 * 60 * 60 * 24;
    const daysLeft = Math.round((expDate - now) / msPerDay);
    return {
      isExpired: daysLeft < 0,
      daysLeft: daysLeft,
      willExpireSoon: daysLeft >= 0 && daysLeft <= WARN_DAYS,
      expDate: expDate
    };
  } catch(e) {
    return { isExpired: false, daysLeft: null, willExpireSoon: false };
  }
}

// ================================================================
// HIEN THI CANH BAO HET HAN
// ================================================================
function showExpiryBanner(user) {
  // Xoa banner cu
  const oldBanner = document.getElementById('expiry-banner');
  if (oldBanner) oldBanner.remove();

  if (!user || user.plan === 'free' || !user.expiry) return;

  const info = getExpiryInfo(user);
  if (!info.isExpired && !info.willExpireSoon) return;

  const banner = document.createElement('div');
  banner.id = 'expiry-banner';

  if (info.isExpired) {
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#dc3545;color:#fff;padding:10px 16px;text-align:center;font-size:14px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:12px;';
    banner.innerHTML = '&#128680; Goi <strong>' + (user.plan||'').toUpperCase() + '</strong> da het han! Vui long gia han de tiep tuc su dung day du tinh nang. <button onclick="goToPayment()" style="background:#fff;color:#dc3545;border:none;border-radius:4px;padding:4px 12px;cursor:pointer;font-weight:700;">Gia han ngay</button> <button onclick="this.parentElement.remove()" style="background:transparent;color:#fff;border:1px solid #fff;border-radius:4px;padding:4px 8px;cursor:pointer;">&#10005;</button>';
  } else if (info.willExpireSoon) {
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#f0a500;color:#fff;padding:10px 16px;text-align:center;font-size:14px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:12px;';
    banner.innerHTML = '&#9203; Goi <strong>' + (user.plan||'').toUpperCase() + '</strong> con <strong>' + info.daysLeft + ' ngay</strong> nua het han (' + user.expiry + '). <button onclick="goToPayment()" style="background:#fff;color:#f0a500;border:none;border-radius:4px;padding:4px 12px;cursor:pointer;font-weight:700;">Gia han ngay</button> <button onclick="this.parentElement.remove()" style="background:transparent;color:#fff;border:1px solid #fff;border-radius:4px;padding:4px 8px;cursor:pointer;">&#10005;</button>';
  }

  document.body.insertBefore(banner, document.body.firstChild);

  // Them padding-top cho body
  document.body.style.paddingTop = (parseInt(document.body.style.paddingTop||0) + 48) + 'px';
}

function goToPayment() {
  // Mo trang gia han
  if (typeof swPT === 'function') swPT('topup');
  const payLink = document.querySelector('a[href="#pricing"], [data-page="pricing"]');
  if (payLink) payLink.click();
  else {
    const nl = document.getElementById('nl-pricing');
    if (nl) nl.click();
  }
}

// ================================================================
// OPEN / CLOSE AUTH OVERLAY
// ================================================================
function openAuth(tab) {
  var overlay = document.getElementById('authOv') || document.getElementById('authOverlay');
  if (overlay) {
    overlay.style.display = 'flex';
    if (tab) switchAuth(tab);
  }
}

function closeAuth() {
  var overlay = document.getElementById('authOv') || document.getElementById('authOverlay');
  if (overlay) overlay.style.display = 'none';
}

function switchAuth(tab) {
  var loginForm  = document.getElementById('f-login') || document.getElementById('formLogin');
  var regForm    = document.getElementById('f-reg')   || document.getElementById('formReg');
  var tabLoginBtn = document.getElementById('at-li')  || document.getElementById('tabLogin');
  var tabRegBtn   = document.getElementById('at-rg')  || document.getElementById('tabReg');
  var authTitle   = document.getElementById('auth-ttl') || document.getElementById('authTitle');

  if (tab === 'login') {
    if (loginForm)  loginForm.style.display  = 'block';
    if (regForm)    regForm.style.display    = 'none';
    if (tabLoginBtn) { tabLoginBtn.style.borderBottom='2px solid #d4a84b'; tabLoginBtn.style.color='#d4a84b'; }
    if (tabRegBtn)   { tabRegBtn.style.borderBottom='none'; tabRegBtn.style.color='#aaa'; }
    if (authTitle)   authTitle.textContent = 'Dang nhap';
  } else {
    if (loginForm)  loginForm.style.display  = 'none';
    if (regForm)    regForm.style.display    = 'block';
    if (tabLoginBtn) { tabLoginBtn.style.borderBottom='none'; tabLoginBtn.style.color='#aaa'; }
    if (tabRegBtn)   { tabRegBtn.style.borderBottom='2px solid #d4a84b'; tabRegBtn.style.color='#d4a84b'; }
    if (authTitle)   authTitle.textContent = 'Dang ky tai khoan';
  }
}

// ================================================================
// DANG NHAP
// ================================================================
function doLogin() {
  var userEl = document.getElementById('li_user') || document.getElementById('loginUser');
  var passEl = document.getElementById('li_pass') || document.getElementById('loginPass');
  if (!userEl || !passEl) return;

  var userVal = userEl.value.trim();
  var passVal = passEl.value.trim();
  if (!userVal || !passVal) { if(typeof toast==='function') toast('Vui long nhap day du thong tin!'); return; }

  var users = JSON.parse(localStorage.getItem(STORAGE_USERS) || '[]');
  var found = null;
  var hashedPass = hashPass(passVal);

  for (var i=0; i<users.length; i++) {
    var u = users[i];
    // Support ca hash va plain text (backward compat)
    var passOk = (u.pass === hashedPass) || (u.pass === passVal);
    if ((u.phone === userVal || u.email === userVal) && passOk) {
      // Neu pass la plain text, tu dong hash lai
      if (u.pass === passVal && passVal !== hashedPass) {
        u.pass = hashedPass;
        users[i] = u;
        localStorage.setItem(STORAGE_USERS, JSON.stringify(users));
      }
      found = u; break;
    }
  }

  if (!found) { if(typeof toast==='function') toast('Sai tai khoan hoac mat khau!'); return; }

  // Kiem tra het han va tu dong reset ve free neu het han qua 30 ngay
  const expInfo = getExpiryInfo(found);
  if (expInfo.isExpired && expInfo.daysLeft < -30 && found.plan !== 'free') {
    found.plan = 'free';
    for (var j=0; j<users.length; j++) {
      if (users[j].phone === found.phone) { users[j].plan = 'free'; break; }
    }
    localStorage.setItem(STORAGE_USERS, JSON.stringify(users));
  }

  localStorage.setItem(STORAGE_CURRENT, JSON.stringify(found));
  closeAuth();
  updNav(found);
  showExpiryBanner(found);
  if(typeof toast==='function') toast('Dang nhap thanh cong! Chao ' + found.name);
  if(typeof updAdminNav==='function') updAdminNav();
  if(typeof renderUPosts==='function') renderUPosts();
  if(typeof updDash==='function') updDash();
}

// ================================================================
// DANG KY
// ================================================================
function doReg() {
  var nameEl  = document.getElementById('rg_name')  || document.getElementById('regName');
  var phoneEl = document.getElementById('rg_phone') || document.getElementById('regPhone');
  var emailEl = document.getElementById('rg_email') || document.getElementById('regEmail');
  var passEl  = document.getElementById('rg_pass')  || document.getElementById('regPass');
  var roleEl  = document.getElementById('rg_role')  || document.getElementById('regRole');
  var agreeEl = document.getElementById('rg_agree') || document.getElementById('regAgree');

  if (!nameEl || !phoneEl || !passEl) return;
  var name  = nameEl.value.trim();
  var phone = phoneEl.value.trim();
  var email = emailEl ? emailEl.value.trim() : '';
  var pass  = passEl.value.trim();
  var role  = roleEl  ? roleEl.value  : 'Chu nha';
  var agree = agreeEl ? agreeEl.checked : true;

  if (!name || !phone || !pass) { if(typeof toast==='function') toast('Vui long nhap day du thong tin bat buoc!'); return; }
  if (pass.length < 6)          { if(typeof toast==='function') toast('Mat khau toi thieu 6 ky tu!'); return; }
  if (!agree)                    { if(typeof toast==='function') toast('Vui long dong y dieu khoan su dung!'); return; }

  // Validate SDT
  if (!/^[0-9]{10}$/.test(phone)) { if(typeof toast==='function') toast('So dien thoai phai co 10 chu so!'); return; }

  var users = JSON.parse(localStorage.getItem(STORAGE_USERS) || '[]');
  for (var i=0; i<users.length; i++) {
    if (users[i].phone === phone || (email && users[i].email === email)) {
      if(typeof toast==='function') toast('So dien thoai hoac email da duoc dang ky!'); return;
    }
  }

  var newUser = {
    name: name, phone: phone, email: email, pass: hashPass(pass), role: role,
    plan: 'free', expiry: '', boostCount: 0, boostMonth: '',
    joined: new Date().toLocaleDateString('vi-VN'), ts: Date.now()
  };

  users.push(newUser);
  localStorage.setItem(STORAGE_USERS, JSON.stringify(users));
  localStorage.setItem(STORAGE_CURRENT, JSON.stringify(newUser));
  closeAuth();
  updNav(newUser);
  if(typeof toast==='function') toast('Tao tai khoan thanh cong! Chao mung ' + name);

  // Thong bao admin qua GAS
  if (typeof GAS_URL !== 'undefined' && GAS_URL && !GAS_URL.includes('YOUR_')) {
    fetch(GAS_URL, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({action:'addUser', name:name, phone:phone, email:email, role:role})
    }).catch(e => console.log('GAS addUser err:', e));
  }

  if(typeof updAdminNav==='function') updAdminNav();
  if(typeof updDash==='function') updDash();
}

// ================================================================
// DANG XUAT
// ================================================================
function doLogout() {
  localStorage.removeItem(STORAGE_CURRENT);
  updNav(null);
  // Xoa expiry banner
  const banner = document.getElementById('expiry-banner');
  if (banner) { banner.remove(); document.body.style.paddingTop = ''; }
  if(typeof toast==='function') toast('Da dang xuat!');
  if(typeof updAdminNav==='function') updAdminNav();
  if(typeof renderUPosts==='function') renderUPosts();
  if(typeof updDash==='function') updDash();
}

// ================================================================
// CAP NHAT NAV BAR
// ================================================================
function updNav(user) {
  var btn = document.getElementById('navAuthBtn') || document.getElementById('nav-auth-btn');
  if (!btn) return;
  if (user) {
    var planBadge = (user.plan && user.plan !== 'free') ? ' ['+user.plan.toUpperCase()+']' : '';
    var expInfo = getExpiryInfo(user);
    var expBadge = expInfo.isExpired ? ' &#128680;' : (expInfo.willExpireSoon ? ' &#9203;' : '');
    btn.innerHTML = '<span>' + user.name + planBadge + expBadge + '</span>';
    btn.onclick = function() {
      // Toggle user menu
      var menu = document.getElementById('user-dropdown-menu');
      if (menu) { menu.style.display = menu.style.display==='block' ? 'none' : 'block'; }
      else if(typeof updDash==='function') { updDash(); goPage('dashboard'); }
    };
  } else {
    btn.innerHTML = 'Dang nhap / Dang ky';
    btn.onclick = function() { openAuth('login'); };
  }
}

// ================================================================
// CAP NHAT DASHBOARD
// ================================================================
function updDash() {
  const user = JSON.parse(localStorage.getItem(STORAGE_CURRENT) || 'null');
  if (!user) return;

  // Ten, avatar
  var dName = document.getElementById('d-name');
  var dAva  = document.getElementById('d-ava');
  if (dName) dName.textContent = user.name || '';
  if (dAva)  dAva.textContent  = (user.name||'U')[0].toUpperCase();

  // Info line
  var dInfo = document.getElementById('d-info');
  if (dInfo) dInfo.textContent = (user.phone||'') + (user.email ? ' · ' + user.email : '');

  // Badge goi
  var dBadge = document.getElementById('d-badge');
  if (dBadge) {
    const planMap = {free:'Free', verified:'Da Xac Minh', trusted:'Uy Tin', partner:'Doi Tac'};
    dBadge.textContent = planMap[user.plan||'free'] || user.plan || 'Free';
    dBadge.className = 'plan-badge plan-' + (user.plan||'free');
  }

  // So ngay con lai + canh bao het han
  var dRem = document.getElementById('d-rem');
  if (dRem) {
    if (!user.expiry || user.plan === 'free') {
      dRem.innerHTML = '<span class="text-muted">Goi Free - khong gioi han</span>';
    } else {
      const info = getExpiryInfo(user);
      if (info.isExpired) {
        dRem.innerHTML = '<span style="color:#dc3545;font-weight:700;">&#128680; Da het han (' + user.expiry + ') - <a href="#" onclick="goToPayment();return false;" style="color:#dc3545;">Gia han ngay</a></span>';
      } else if (info.willExpireSoon) {
        dRem.innerHTML = '<span style="color:#f0a500;font-weight:700;">&#9203; Con ' + info.daysLeft + ' ngay (het han: ' + user.expiry + ') - <a href="#" onclick="goToPayment();return false;" style="color:#f0a500;">Gia han ngay</a></span>';
      } else {
        dRem.innerHTML = '<span style="color:#28a745;">&#9989; Con lai: <strong>' + info.daysLeft + ' ngay</strong> (het han: ' + user.expiry + ')</span>';
      }
    }
  }

  // Boost info
  var dAct = document.getElementById('d-act');
  if (dAct) {
    const boostLimits = {free:0, verified:2, trusted:5, partner:10};
    const limit = boostLimits[user.plan||'free'] || 0;
    const used  = user.boostCount || 0;
    const remaining = Math.max(0, limit - used);
    if (limit === 0) {
      dAct.innerHTML = 'Luot day tin: <strong>0/0</strong> (Nang cap goi de dung tinh nang day tin)';
    } else {
      dAct.innerHTML = 'Luot day tin thang nay: <strong>' + used + '/' + limit + '</strong> (Con lai: <strong>' + remaining + '</strong>)';
    }
  }

  showExpiryBanner(user);
}

// ================================================================
// DONG BO THONG TIN USER TU GAS BACKEND
// ================================================================
function syncUserFromGAS(phone) {
  if (typeof GAS_URL === 'undefined' || !GAS_URL || GAS_URL.includes('YOUR_')) return;
  fetch(GAS_URL + '?action=getUser&phone=' + phone)
    .then(r => r.json())
    .then(d => {
      if (d.ok && d.user) {
        const gasUser = d.user;
        // Cap nhat thong tin tu GAS (plan, expiry, boostCount)
        var users = JSON.parse(localStorage.getItem(STORAGE_USERS) || '[]');
        for (var i=0; i<users.length; i++) {
          if (users[i].phone === phone) {
            if (gasUser.plan) users[i].plan = gasUser.plan;
            if (gasUser.expiry) users[i].expiry = gasUser.expiry;
            if (gasUser.boostCount !== undefined) users[i].boostCount = gasUser.boostCount;
            if (gasUser.boostMonth) users[i].boostMonth = gasUser.boostMonth;
            break;
          }
        }
        localStorage.setItem(STORAGE_USERS, JSON.stringify(users));

        var cur = JSON.parse(localStorage.getItem(STORAGE_CURRENT)||'null');
        if (cur && cur.phone === phone) {
          if (gasUser.plan) cur.plan = gasUser.plan;
          if (gasUser.expiry) cur.expiry = gasUser.expiry;
          if (gasUser.boostCount !== undefined) cur.boostCount = gasUser.boostCount;
          if (gasUser.boostMonth) cur.boostMonth = gasUser.boostMonth;
          localStorage.setItem(STORAGE_CURRENT, JSON.stringify(cur));
          updDash();
          showExpiryBanner(cur);
        }
      }
    })
    .catch(e => console.log('syncUserFromGAS err:', e));
}

// ================================================================
// KHOI TAO KHI LOAD TRANG
// ================================================================
document.addEventListener('DOMContentLoaded', function() {
  var user = JSON.parse(localStorage.getItem(STORAGE_CURRENT) || 'null');
  if (user) {
    updNav(user);
    showExpiryBanner(user);
    // Dong bo thong tin moi nhat tu GAS
    if (user.phone) {
      setTimeout(function() { syncUserFromGAS(user.phone); }, 2000);
    }
  } else {
    updNav(null);
  }
});
