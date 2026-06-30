// ===== AUTH.JS - He thong dang nhap Nguon Nha Pho HCM =====
// Su dung localStorage de luu tai khoan phia client
// KEY FIX: Thong nhat storage keys: nhphcm_users, nhphcm_user

const STORAGE_USERS = 'nhphcm_users';
const STORAGE_CURRENT = 'nhphcm_user';

function openAuth(tab) {
  var overlay = document.getElementById('authOverlay');
  if (overlay) {
    overlay.style.display = 'flex';
    if (tab) switchAuth(tab);
  }
}

function closeAuth() {
  var overlay = document.getElementById('authOverlay');
  if (overlay) overlay.style.display = 'none';
}

function switchAuth(tab) {
  var loginForm = document.getElementById('formLogin');
  var regForm = document.getElementById('formReg');
  var tabLoginBtn = document.getElementById('tabLogin');
  var tabRegBtn = document.getElementById('tabReg');
  var authTitle = document.getElementById('authTitle');
  if (tab === 'login') {
    if (loginForm) loginForm.style.display = 'block';
    if (regForm) regForm.style.display = 'none';
    if (tabLoginBtn) { tabLoginBtn.style.borderBottom = '2px solid #d4a84b'; tabLoginBtn.style.color = '#d4a84b'; }
    if (tabRegBtn) { tabRegBtn.style.borderBottom = 'none'; tabRegBtn.style.color = '#aaa'; }
    if (authTitle) authTitle.textContent = 'Dang nhap';
  } else {
    if (loginForm) loginForm.style.display = 'none';
    if (regForm) regForm.style.display = 'block';
    if (tabLoginBtn) { tabLoginBtn.style.borderBottom = 'none'; tabLoginBtn.style.color = '#aaa'; }
    if (tabRegBtn) { tabRegBtn.style.borderBottom = '2px solid #d4a84b'; tabRegBtn.style.color = '#d4a84b'; }
    if (authTitle) authTitle.textContent = 'Tao tai khoan';
  }
}

function doLogin() {
  var userEl = document.getElementById('li_user');
  var passEl = document.getElementById('li_pass');
  if (!userEl || !passEl) return;
  var user = userEl.value.trim();
  var pass = passEl.value.trim();
  if (!user || !pass) { if(typeof toast==='function')toast('Vui long nhap day du thong tin!'); return; }
  var users = JSON.parse(localStorage.getItem(STORAGE_USERS) || '[]');
  var found = null;
  for (var i = 0; i < users.length; i++) {
    if ((users[i].phone === user || users[i].email === user) && users[i].pass === pass) {
      found = users[i]; break;
    }
  }
  if (!found) { if(typeof toast==='function')toast('Sai tai khoan hoac mat khau!'); return; }
  localStorage.setItem(STORAGE_CURRENT, JSON.stringify(found));
  closeAuth();
  updateNavAuth(found);
  if(typeof toast==='function')toast('Dang nhap thanh cong! Chao ' + found.name);
  if(typeof updAdminNav==='function')updAdminNav();
  if(typeof renderUPosts==='function')renderUPosts();
}

function doRegister() {
  var nameEl = document.getElementById('rg_name');
  var phoneEl = document.getElementById('rg_phone');
  var emailEl = document.getElementById('rg_email');
  var passEl = document.getElementById('rg_pass');
  var roleEl = document.getElementById('rg_role');
  var agreeEl = document.getElementById('rg_agree');
  if (!nameEl || !phoneEl || !passEl) return;
  var name = nameEl.value.trim();
  var phone = phoneEl.value.trim();
  var email = emailEl ? emailEl.value.trim() : '';
  var pass = passEl.value.trim();
  var role = roleEl ? roleEl.value : 'Chu nha';
  var agree = agreeEl ? agreeEl.checked : true;
  if (!name || !phone || !pass) { if(typeof toast==='function')toast('Vui long nhap day du thong tin bat buoc!'); return; }
  if (pass.length < 6) { if(typeof toast==='function')toast('Mat khau toi thieu 6 ky tu!'); return; }
  if (!agree) { if(typeof toast==='function')toast('Vui long dong y dieu khoan su dung!'); return; }
  var users = JSON.parse(localStorage.getItem(STORAGE_USERS) || '[]');
  for (var i = 0; i < users.length; i++) {
    if (users[i].phone === phone || (email && users[i].email === email)) {
      if(typeof toast==='function')toast('So dien thoai hoac email da duoc dang ky!'); return;
    }
  }
  var newUser = {
    name: name, phone: phone, email: email, pass: pass, role: role,
    plan: 'free', joined: new Date().toLocaleDateString('vi-VN'), ts: Date.now()
  };
  users.push(newUser);
  localStorage.setItem(STORAGE_USERS, JSON.stringify(users));
  localStorage.setItem(STORAGE_CURRENT, JSON.stringify(newUser));
  closeAuth();
  updateNavAuth(newUser);
  if(typeof toast==='function')toast('Tao tai khoan thanh cong! Chao mung ' + name);
  // Thong bao admin qua email (Formspree)
  if(typeof sendMail==='function'){
    sendMail(
      'Thanh vien moi dang ky - ' + name,
      'Ten: ' + name + ' | SDT: ' + phone + ' | Email: ' + (email||'chua co') + ' | Vai tro: ' + role + ' | Ngay: ' + new Date().toLocaleString('vi-VN')
    );
  }
  if(typeof updAdminNav==='function')updAdminNav();
}

function doLogout() {
  localStorage.removeItem(STORAGE_CURRENT);
  updateNavAuth(null);
  if(typeof toast==='function')toast('Da dang xuat!');
  if(typeof updAdminNav==='function')updAdminNav();
  if(typeof renderUPosts==='function')renderUPosts();
}

function updateNavAuth(user) {
  var btn = document.getElementById('navAuthBtn');
  if (!btn) return;
  if (user) {
    var planBadge = (user.plan && user.plan !== 'free') ? ' [' + user.plan + ']' : '';
    btn.innerHTML = user.name + planBadge;
    btn.setAttribute('onclick', 'if(confirm("Ban muon dang xuat?")){doLogout();}');
  } else {
    btn.innerHTML = 'Dang nhap';
    btn.setAttribute('onclick', "openAuth('login')");
  }
}

function getCurrentUser() {
  try { return JSON.parse(localStorage.getItem(STORAGE_CURRENT) || 'null'); }
  catch(e) { return null; }
}

// Khoi dong khi trang load xong
document.addEventListener('DOMContentLoaded', function() {
  // Migrate old keys (backward compatibility)
  try {
    var oldCurrent = localStorage.getItem('nnh_current');
    if (oldCurrent && !localStorage.getItem(STORAGE_CURRENT)) {
      localStorage.setItem(STORAGE_CURRENT, oldCurrent);
      localStorage.removeItem('nnh_current');
    }
    var oldUsers = localStorage.getItem('nnh_users');
    if (oldUsers && !localStorage.getItem(STORAGE_USERS)) {
      localStorage.setItem(STORAGE_USERS, oldUsers);
      localStorage.removeItem('nnh_users');
    }
  } catch(e) {}

  // Khoi phuc session neu co
  try {
    var cur = localStorage.getItem(STORAGE_CURRENT);
    if (cur) updateNavAuth(JSON.parse(cur));
  } catch(e) {}

  // Gan su kien cho navAuthBtn
  var btn = document.getElementById('navAuthBtn');
  if (btn) {
    btn.style.cursor = 'pointer';
    if (!btn.getAttribute('onclick')) {
      btn.setAttribute('onclick', "openAuth('login')");
    }
  }
});
