// ============================================================
// NGUON NHA PHO HCM — Backend Google Apps Script v2.0
// Google Sheets + SePay Webhook + Email Automation
// ============================================================
// HUONG DAN SETUP (doc ky truoc khi chay):
//
// BUOC 1: Tao Google Sheet
//   - Vao drive.google.com, tao Sheet moi
//   - Copy Sheet ID tu URL (phan /d/XXXXX/edit)
//   - Dan vao CFG.SHEET_ID duoi day
//
// BUOC 2: Mo Apps Script
//   - Trong Sheet: Extensions > Apps Script
//   - Xoa code cu, dan toan bo code nay vao
//   - Luu (Ctrl+S)
//
// BUOC 3: Setup Sheet structure
//   - Chay ham setupSheet() mot lan (Click Run > setupSheet)
//   - Cho phep cac quyen can thiet
//
// BUOC 4: Deploy Web App
//   - Deploy > New deployment
//   - Type: Web app
//   - Execute as: Me (tai khoan Gmail cua ban)
//   - Who has access: Anyone
//   - Nhan Deploy, copy URL
//
// BUOC 5: Cap nhat website
//   - Mo index.html tren GitHub
//   - Tim dong: const GAS_URL='YOUR_GAS_WEB_APP_URL'
//   - Thay bang URL vua copy
//   - Commit & push
//
// BUOC 6: Cau hinh SePay Webhook
//   - Dang nhap SePay.vn
//   - Vao Webhook settings
//   - Webhook URL = URL deploy cua ban (buoc 4)
//   - Method: POST
//   - Bat tat ca event: Transfer In
// ============================================================

// === CAU HINH - CHI SUA PHAN NAY ===
const CFG = {
  SHEET_ID: 'YOUR_GOOGLE_SHEET_ID_HERE',
  ADMIN_EMAIL: 'daoduykhuyen2@gmail.com',
  ADMIN_PHONE: '0987645314',
  CK_PREFIX: 'NHPHCM',
  SHEET_USERS: 'Users',
  SHEET_POSTS: 'Posts',
  SHEET_PAYMENTS: 'Payments',
  SHEET_LOG: 'Log',
  // Gia goi (VND) - Khach chuyen dung so nay
  PLAN_PRICES: {
    'verified': 99000,   // Goi Da Xac Minh - 99k/thang
    'trusted': 199000,   // Goi Uy Tin - 199k/thang
    'partner': 399000    // Goi Doi Tac - 399k/thang
  },
  PLAN_DAYS: {
    'verified': 30,
    'trusted': 30,
    'partner': 30
  },
  PLAN_NAMES: {
    'free': 'Tai Khoan Free',
    'verified': 'Da Xac Minh',
    'trusted': 'Uy Tin',
    'partner': 'Doi Tac NHPHCM'
  }
};

// ============================================================
// WEBHOOK HANDLER - Nhan request tu SePay & Website
// ============================================================
function doPost(e) {
  try {
    let data = {};
    try { data = JSON.parse(e.postData.contents || '{}'); } catch(pe) {}
    const action = data.action || (e.parameter && e.parameter.action) || '';

    // === SePay Webhook ===
    // SePay gui data voi: transferAmount, description, gateway, referenceCode
    if (data.transferAmount !== undefined || data.amount !== undefined) {
      return handleSePay(data);
    }

    // === Website API calls ===
    switch(action) {
      case 'addUser': return addUser(data);
      case 'addPost': return addPost(data);
      case 'updatePlan': return updatePlan(data);
      case 'boostPost': return boostPost(data);
      case 'resetPass': return adminResetPass(data);
      default:
        return jsonResponse({ok: false, msg: 'Unknown action: ' + action});
    }
  } catch(err) {
    writeLog('ERROR', 'doPost: ' + err.message, 'FAIL');
    return jsonResponse({ok: false, msg: err.message});
  }
}

function doGet(e) {
  const action = (e.parameter && e.parameter.action) || 'ping';
  try {
    switch(action) {
      case 'getUsers': return getUsers();
      case 'getPosts': return getPosts();
      case 'getUser': return getUserByPhone(e.parameter.phone);
      case 'ping': return jsonResponse({ok: true, msg: 'NHPHCM API v2.0', ts: new Date().toLocaleString('vi-VN')});
      default: return jsonResponse({ok: false, msg: 'Unknown action: ' + action});
    }
  } catch(err) {
    return jsonResponse({ok: false, msg: err.message});
  }
}

// ============================================================
// SEPAY WEBHOOK - Xu ly thanh toan tu dong
// ============================================================
function handleSePay(data) {
  const amount = parseInt(data.transferAmount || data.amount || 0);
  const content = (data.description || data.content || '').toUpperCase().trim();
  const txId = data.referenceCode || data.id || ('TX_' + Date.now());
  const bank = data.gateway || data.bankShortName || 'SePay';
  
  writeLog('PAYMENT_IN', bank + ': ' + amount.toLocaleString() + 'd | ' + content, 'RECEIVED');

  // Kiem tra prefix NHPHCM
  if (!content.includes(CFG.CK_PREFIX)) {
    writeLog('PAYMENT_SKIP', 'No prefix: ' + content, 'SKIPPED');
    return jsonResponse({ok: true, msg: 'Not NHPHCM payment, ignored'});
  }

  // Tim so dien thoai trong noi dung CK
  const phoneMatch = content.match(/(0[3-9][0-9]{8})/);
  const phone = phoneMatch ? phoneMatch[1] : null;

  if (!phone) {
    sendEmailAdmin(
      'Can xu ly thu cong - ' + amount.toLocaleString() + 'd',
      'Nhan CK ' + amount.toLocaleString() + 'd tu ' + bank +
      '\nNoi dung: ' + content +
      '\nMa GD: ' + txId +
      '\nKhong tim duoc SDT. Vui long xu ly thu cong!'
    );
    writePayment(txId, bank, amount, content, 'UNKNOWN', '', 'MANUAL_REQUIRED');
    return jsonResponse({ok: true, msg: 'Manual processing needed - email sent to admin'});
  }

  // Xac dinh goi tu so tien
  let planGranted = null;
  for (const [plan, price] of Object.entries(CFG.PLAN_PRICES)) {
    if (Math.abs(amount - price) <= 5000) {
      planGranted = plan;
      break;
    }
  }

  if (!planGranted) {
    sendEmailAdmin(
      'So tien khong khop goi - SDT: ' + phone,
      'SDT: ' + phone + ' | CK: ' + amount.toLocaleString() + 'd | Noi dung: ' + content +
      '\n\nGoi hien co:\n- Da Xac Minh: 99.000d\n- Uy Tin: 199.000d\n- Doi Tac: 399.000d\n\nVui long lien he khach de xac nhan goi!'
    );
    writePayment(txId, bank, amount, content, phone, 'UNKNOWN', 'AMOUNT_MISMATCH');
    return jsonResponse({ok: true, msg: 'Amount mismatch - admin notified'});
  }

  // Tim user theo SDT
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const usersSheet = ss.getSheetByName(CFG.SHEET_USERS);
  const rows = usersSheet.getDataRange().getValues();
  let userRow = -1;
  let userName = 'Khach ' + phone;
  let userEmail = '';

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === phone) {
      userRow = i + 1;
      userName = rows[i][1] || userName;
      userEmail = rows[i][2] || '';
      break;
    }
  }

  // Tinh ngay het han
  const today = new Date();
  const expDate = new Date(today);
  expDate.setDate(today.getDate() + (CFG.PLAN_DAYS[planGranted] || 30));
  const expStr = expDate.toLocaleDateString('vi-VN');
  const todayStr = today.toLocaleDateString('vi-VN');
  const planName = CFG.PLAN_NAMES[planGranted] || planGranted;

  if (userRow > 0) {
    // Cap nhat goi
    usersSheet.getRange(userRow, 4).setValue(planGranted);
    usersSheet.getRange(userRow, 5).setValue(todayStr);
    usersSheet.getRange(userRow, 6).setValue(expStr);
    const prevTotal = parseFloat(rows[userRow-1][6]) || 0;
    usersSheet.getRange(userRow, 7).setValue(prevTotal + amount);
    usersSheet.getRange(userRow, 9).setValue('active');
  } else {
    // Tao user moi
    usersSheet.appendRow([phone, userName, userEmail, planGranted, todayStr, expStr, amount, 10, 'active', 'Auto - payment']);
    writeLog('USER_AUTO_CREATED', 'SDT: ' + phone + ' via payment', 'OK');
  }

  writePayment(txId, bank, amount, content, phone, planGranted, 'SUCCESS');
  writeLog('PLAN_UPGRADED', 'SDT: ' + phone + ' -> ' + planGranted + ' | ' + amount.toLocaleString() + 'd', 'OK');

  // Email thong bao admin
  sendEmailAdmin(
    'Thanh toan thanh cong - ' + userName + ' [' + planName + ']',
    'Khach hang: ' + userName +
    '\nSDT: ' + phone +
    '\nSo tien: ' + amount.toLocaleString() + 'd' +
    '\nGoi: ' + planName +
    '\nHan: ' + expStr +
    '\nMa GD: ' + txId +
    '\nNgan hang: ' + bank
  );

  // Email xac nhan cho khach
  if (userEmail) {
    try {
      MailApp.sendEmail({
        to: userEmail,
        subject: 'Nguon Nha Pho HCM - Kich hoat goi ' + planName + ' thanh cong!',
        body: 'Xin chao ' + userName + ',\n\n' +
              'Da nhan duoc thanh toan va kich hoat goi thanh cong!\n\n' +
              'Thong tin goi:\n' +
              '- Goi: ' + planName + '\n' +
              '- Ngay kich hoat: ' + todayStr + '\n' +
              '- Ngay het han: ' + expStr + '\n' +
              '- So tien: ' + amount.toLocaleString() + 'd\n\n' +
              'Dang nhap tai: https://nguonnhaphohcm.vn\n\n' +
              'Tran trong,\nNguon Nha Pho HCM\n' +
              'Mr. Duy Khuyen: 0987.645.314'
      });
    } catch(emailErr) {
      writeLog('EMAIL_CUSTOMER_ERR', emailErr.message, 'WARN');
    }
  }

  return jsonResponse({ok: true, plan: planGranted, phone, expires: expStr});
}

// ============================================================
// USERS API
// ============================================================
function addUser(data) {
  try {
    const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
    const sheet = ss.getSheetByName(CFG.SHEET_USERS);
    const rows = sheet.getDataRange().getValues();
    
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === data.phone) {
        return jsonResponse({ok: false, msg: 'SDT da duoc dang ky', code: 'DUPLICATE_PHONE'});
      }
      if (data.email && rows[i][2] === data.email) {
        return jsonResponse({ok: false, msg: 'Email da duoc dang ky', code: 'DUPLICATE_EMAIL'});
      }
    }
    
    const todayStr = new Date().toLocaleDateString('vi-VN');
    sheet.appendRow([
      data.phone, data.name, data.email || '', 'free',
      todayStr, '', 0, 2, 'active', data.role || 'Chu nha'
    ]);
    
    writeLog('USER_ADD', data.name + ' | ' + data.phone, 'OK');
    sendEmailAdmin(
      'Thanh vien moi dang ky - ' + data.name,
      'Ten: ' + data.name + '\nSDT: ' + data.phone + '\nEmail: ' + (data.email || 'chua co') +
      '\nVai tro: ' + (data.role || 'Chu nha') + '\nNgay: ' + todayStr
    );
    
    return jsonResponse({
      ok: true,
      user: {phone: data.phone, name: data.name, email: data.email || '', plan: 'free', role: data.role || 'Chu nha', joined: todayStr}
    });
  } catch(e) {
    writeLog('USER_ADD_ERR', e.message, 'FAIL');
    return jsonResponse({ok: false, msg: e.message});
  }
}

function getUsers() {
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const rows = ss.getSheetByName(CFG.SHEET_USERS).getDataRange().getValues();
  const users = rows.slice(1).map(r => ({
    phone: String(r[0]), name: r[1], email: r[2] || '', plan: r[3] || 'free',
    activated: r[4] || '', expires: r[5] || '', total_paid: r[6] || 0,
    posts_left: r[7] || 0, status: r[8] || 'active', role: r[9] || 'Chu nha'
  })).filter(u => u.phone);
  return jsonResponse({ok: true, count: users.length, users});
}

function getUserByPhone(phone) {
  if (!phone) return jsonResponse({ok: false, msg: 'Missing phone'});
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const rows = ss.getSheetByName(CFG.SHEET_USERS).getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === phone) {
      return jsonResponse({ok: true, user: {
        phone: String(rows[i][0]), name: rows[i][1], email: rows[i][2] || '',
        plan: rows[i][3] || 'free', activated: rows[i][4] || '',
        expires: rows[i][5] || '', total_paid: rows[i][6] || 0,
        posts_left: rows[i][7] || 0, status: rows[i][8] || 'active', role: rows[i][9] || 'Chu nha'
      }});
    }
  }
  return jsonResponse({ok: false, msg: 'User not found'});
}

function updatePlan(data) {
  if (!data.phone || !data.plan) return jsonResponse({ok: false, msg: 'Missing phone or plan'});
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sheet = ss.getSheetByName(CFG.SHEET_USERS);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === data.phone) {
      sheet.getRange(i+1, 4).setValue(data.plan);
      sheet.getRange(i+1, 5).setValue(new Date().toLocaleDateString('vi-VN'));
      if (data.expires) sheet.getRange(i+1, 6).setValue(data.expires);
      writeLog('PLAN_UPDATE_ADMIN', data.phone + ' -> ' + data.plan, 'OK');
      return jsonResponse({ok: true});
    }
  }
  return jsonResponse({ok: false, msg: 'User not found'});
}

function adminResetPass(data) {
  if (!data.phone) return jsonResponse({ok: false, msg: 'Missing phone'});
  const newPass = 'NHPHCM' + Math.random().toString(36).slice(2, 8).toUpperCase();
  // Note: password is stored in localStorage on client side
  // GAS just notifies admin
  sendEmailAdmin('Admin Reset Mat Khau - ' + data.phone,
    'SDT: ' + data.phone + '\nMat khau moi: ' + newPass + '\nAdmin: ' + (data.adminName || 'Admin'));
  writeLog('PASS_RESET', data.phone, 'OK');
  return jsonResponse({ok: true, newPass});
}

// ============================================================
// POSTS API
// ============================================================
function addPost(data) {
  try {
    const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
    const sheet = ss.getSheetByName(CFG.SHEET_POSTS);
    const id = data.id || ('up_' + Date.now() + '_' + Math.random().toString(36).slice(2,6));
    const todayStr = new Date().toLocaleDateString('vi-VN');
    sheet.appendRow([
      id, data.name || '', data.phone || '', data.pty || '', data.district || '',
      data.price || '', data.area || '', data.desc || '', (data.imgs || []).join('|'),
      todayStr, data.status || 'public', 0, data.type || 'owner', data.email || ''
    ]);
    writeLog('POST_ADD', (data.pty||'') + ' | ' + (data.district||'') + ' | ' + (data.phone||''), 'OK');
    return jsonResponse({ok: true, id, posted: todayStr});
  } catch(e) {
    return jsonResponse({ok: false, msg: e.message});
  }
}

function getPosts() {
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const rows = ss.getSheetByName(CFG.SHEET_POSTS).getDataRange().getValues();
  const posts = rows.slice(1)
    .filter(r => r[0] && r[10] === 'public')
    .map(r => ({
      id: r[0], name: r[1], phone: r[2], pty: r[3], district: r[4],
      price: r[5], area: r[6], desc: r[7],
      imgs: String(r[8] || '').split('|').filter(Boolean),
      ts_str: r[9], status: r[10], boosted: r[11] || 0, type: r[12] || 'owner', email: r[13] || ''
    }));
  return jsonResponse({ok: true, count: posts.length, posts});
}

function boostPost(data) {
  if (!data.postId) return jsonResponse({ok: false, msg: 'Missing postId'});
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sheet = ss.getSheetByName(CFG.SHEET_POSTS);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === data.postId) {
      sheet.getRange(i+1, 12).setValue((rows[i][11] || 0) + 1);
      return jsonResponse({ok: true});
    }
  }
  return jsonResponse({ok: false, msg: 'Post not found'});
}

// ============================================================
// SETUP - Chay mot lan de tao cau truc sheet
// ============================================================
function setupSheet() {
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const DARK = '#0d1b2a'; const GOLD = '#c9922a';
  
  const createSheet = (name, headers) => {
    let s = ss.getSheetByName(name);
    if (!s) s = ss.insertSheet(name);
    else s.clearContents();
    s.getRange(1,1,1,headers.length).setValues([headers]);
    s.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground(DARK).setFontColor(GOLD);
    s.setFrozenRows(1);
    return s;
  };
  
  createSheet(CFG.SHEET_USERS, ['SDT','Ho ten','Email','Goi','Ngay KH','Het han','Tong nap','Tin con','Trang thai','Vai tro']);
  createSheet(CFG.SHEET_POSTS, ['ID','Ten','SDT','Loai BDS','Quan','Gia','DT','Mo ta','Anh (pipe)','Ngay dang','Trang thai','Day','Loai TK','Email']);
  createSheet(CFG.SHEET_PAYMENTS, ['Ma GD','Ngan hang','So tien','Noi dung CK','SDT','Goi','Trang thai','Thoi gian']);
  createSheet(CFG.SHEET_LOG, ['Thoi gian','Su kien','Chi tiet','Ket qua']);
  
  SpreadsheetApp.getUi().alert(
    'Setup xong!\n\n' +
    'Da tao 4 sheets: Users, Posts, Payments, Log\n\n' +
    'Buoc tiep theo:\n' +
    '1. Deploy > New deployment > Web app\n' +
    '2. Execute as: Me | Who can access: Anyone\n' +
    '3. Copy URL deploy\n' +
    '4. Cap nhat GAS_URL trong index.html tren GitHub\n' +
    '5. Cau hinh SePay webhook voi URL do'
  );
}

// ============================================================
// UTILITIES
// ============================================================
function sendEmailAdmin(subject, body) {
  try {
    MailApp.sendEmail({
      to: CFG.ADMIN_EMAIL,
      subject: '[NHPHCM] ' + subject,
      body: body + '\n\n---\nNguon Nha Pho HCM System\n' + new Date().toLocaleString('vi-VN')
    });
  } catch(e) {
    Logger.log('Email admin err: ' + e.message);
  }
}

function writePayment(txId, bank, amount, content, phone, plan, status) {
  try {
    const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
    ss.getSheetByName(CFG.SHEET_PAYMENTS).appendRow([
      txId, bank, amount, content, phone, plan, status, new Date().toLocaleString('vi-VN')
    ]);
  } catch(e) { Logger.log('writePayment err: ' + e.message); }
}

function writeLog(event, detail, result) {
  try {
    const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
    ss.getSheetByName(CFG.SHEET_LOG).appendRow([
      new Date().toLocaleString('vi-VN'), event, detail, result || ''
    ]);
  } catch(e) { Logger.log('writeLog err: ' + e.message); }
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
