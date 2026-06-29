// ===== AUTH.JS - He thong dang nhap Nguon Nha Pho HCM =====
// Su dung localStorage de luu tai khoan phia client

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
    if (!user || !pass) { toast('Vui long nhap day du thong tin!'); return; }
    var users = JSON.parse(localStorage.getItem('nnh_users') || '[]');
    var found = null;
    for (var i = 0; i < users.length; i++) {
          if ((users[i].phone === user || users[i].email === user) && users[i].pass === pass) {
                  found = users[i]; break;
          }
    }
    if (!found) { toast('Sai tai khoan hoac mat khau!'); return; }
    localStorage.setItem('nnh_current', JSON.stringify(found));
    closeAuth();
    updateNavAuth(found);
    toast('Dang nhap thanh cong! Chao ' + found.name);
}

function doRegister() {
    var nameEl = document.getElementById('rg_name');
    var phoneEl = document.getElementById('rg_phone');
    var emailEl = document.getElementById('rg_email');
    var passEl = document.getElementById('rg_pass');
    var agreeEl = document.getElementById('rg_agree');
    if (!nameEl || !phoneEl || !passEl) return;
    var name = nameEl.value.trim();
    var phone = phoneEl.value.trim();
    var email = emailEl ? emailEl.value.trim() : '';
    var pass = passEl.value.trim();
    var agree = agreeEl ? agreeEl.checked : true;
    if (!name || !phone || !pass) { toast('Vui long nhap day du thong tin bat buoc!'); return; }
    if (pass.length < 8) { toast('Mat khau toi thieu 8 ky tu!'); return; }
    if (!agree) { toast('Vui long dong y dieu khoan su dung!'); return; }
    var users = JSON.parse(localStorage.getItem('nnh_users') || '[]');
    for (var i = 0; i < users.length; i++) {
          if (users[i].phone === phone || (email && users[i].email === email)) {
                  toast('So dien thoai hoac email da duoc dang ky!'); return;
          }
    }
    var newUser = { name: name, phone: phone, email: email, pass: pass, joined: new Date().toLocaleDateString('vi-VN') };
    users.push(newUser);
    localStorage.setItem('nnh_users', JSON.stringify(users));
    localStorage.setItem('nnh_current', JSON.stringify(newUser));
    closeAuth();
    updateNavAuth(newUser);
    toast('Tao tai khoan thanh cong! Chao mung ' + name);
}

function doLogout() {
    localStorage.removeItem('nnh_current');
    updateNavAuth(null);
    toast('Da dang xuat!');
}

function updateNavAuth(user) {
    var btn = document.getElementById('navAuthBtn');
    if (!btn) return;
    if (user) {
          btn.innerHTML = 'Xin chao, ' + user.name;
          btn.setAttribute('onclick', 'if(confirm("Ban muon dang xuat?")){doLogout();}');
    } else {
          btn.innerHTML = 'Dang nhap';
          btn.setAttribute('onclick', "openAuth('login')");
    }
}

// Khoi dong khi trang load xong
document.addEventListener('DOMContentLoaded', function() {
    // Khoi phuc session neu co
                            try {
                                  var cur = localStorage.getItem('nnh_current');
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

                            // Dong overlay khi click ra ngoai
                            var overlay = document.getElementById('authOverlay');
    if (overlay) {
          overlay.addEventListener('click', function(e) {
                  if (e.target === overlay) closeAuth();
          });
    }
});
