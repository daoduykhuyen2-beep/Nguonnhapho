// ==============================================================
// NGUON NHA PHO HCM - Backend Google Apps Script v4.0
// Google Sheets + SePay Webhook + Email Automation
// UPDATED v4.0: fix addUser, webhook secret, changePass, payHistory, phone/name validate
// ==============================================================

const CFG = {
  SHEET_ID: 'YOUR_GOOGLE_SHEET_ID_HERE',
  ADMIN_EMAIL: 'daoduykhuyen2@gmail.com',
  ADMIN_PHONE: '0987645314',
  CK_PREFIX: 'NHPHCM',
  WEBHOOK_SECRET: '',  // Tuỳ chọn: điền webhook secret từ SePay nếu có
  SHEET_USERS: 'Users',
  SHEET_POSTS: 'Posts',
  SHEET_PAYMENTS: 'Payments',
  SHEET_LOG: 'Log',
  SHEET_TXIDS: 'ProcessedTxIds',

  // Giá các gói (VNĐ/tháng)
  PLAN_PRICES: {
    'verified': 99000,
    'uytin':    199000,
    'doitac':   399000
  },
  // Tên hiển thị
  PLAN_NAMES: {
    'verified': 'Đã Xác Minh',
    'uytin':    'Uy Tín',
    'doitac':   'Đối Tác NHPHCM'
  },
  // Số ngày mỗi gói
  PLAN_DAYS: {
    'verified': 30,
    'uytin':    30,
    'doitac':   30
  },
  // Số lần boost mỗi tháng
  BOOST_LIMITS: {
    'free':     0,
    'verified': 0,
    'uytin':    1,
    'doitac':   3
  },
  BOOST_PRICE: 29000,   // Giá đẩy tin lẻ (chưa dùng)
};

// ===== doPost: nhận webhook SePay hoặc action từ frontend =====
function doPost(e) {
  try {
    let data = {};
    try { data = JSON.parse(e.postData.contents); } catch(_) {}

    // --- Webhook SePay ---
    if (data.gateway !== undefined || data.transferAmount !== undefined) {
      // Kiểm tra webhook secret nếu có cấu hình
      if (CFG.WEBHOOK_SECRET && CFG.WEBHOOK_SECRET.length > 0) {
        const reqSecret = e.parameter.secret || data.secret || '';
        if (reqSecret !== CFG.WEBHOOK_SECRET) {
          return jsonResponse({ok: false, msg: 'Unauthorized webhook'});
        }
      }
      return handleSePay(data);
    }

    // --- Frontend actions ---
    const action = data.action || e.parameter.action || '';
    switch (action) {
      case 'addUser':       return addUser(data);
      case 'addPost':       return addPost(data);
      case 'updatePlan':    return updatePlan(data);
      case 'boostPost':     return boostPost(data);
      case 'resetPass':     return adminResetPass(data);
      case 'changePass':    return changePass(data);
      default:
        return jsonResponse({ok: false, msg: 'Unknown POST action: ' + action});
    }
  } catch(err) {
    writeLog('ERROR_POST', err.toString(), 'ERROR');
    return jsonResponse({ok: false, msg: err.toString()});
  }
}

// ===== doGet: truy vấn dữ liệu =====
function doGet(e) {
  try {
    const action = e.parameter.action || '';
    switch (action) {
      case 'getUsers':           return getUsers(e);
      case 'getPosts':           return getPosts(e);
      case 'getUser':            return getUserByPhone(e.parameter.phone);
      case 'checkPaymentStatus': return checkPaymentStatus(e.parameter);
      case 'getBoostPrice':      return jsonResponse({ok:true, price: CFG.BOOST_PRICE});
      case 'getPayHistory':      return getPayHistory(e.parameter.phone);
      case 'ping':               return jsonResponse({ok:true, msg:'NHPHCM API v4.0', ts: new Date().toLocaleTimeString('vi-VN') + ' ' + new Date().toLocaleDateString('vi-VN')});
      default:
        return jsonResponse({ok: false, msg: 'Unknown GET action: ' + action});
    }
  } catch(err) {
    writeLog('ERROR_GET', err.toString(), 'ERROR');
    return jsonResponse({ok: false, msg: err.toString()});
  }
}

// ===== handleSePay: xử lý webhook thanh toán từ SePay =====
function handleSePay(data) {
  const bank    = (data.gateway || data.bankAbbreviation || '').toUpperCase();
  const amount  = parseInt(data.transferAmount || data.amount || 0);
  const content = (data.description || data.memo || data.referenceCode || '').toUpperCase();
  const txId    = data.transactionId || data.referenceCode || (Date.now().toString());
  const today   = new Date();
  const todayStr = today.toLocaleDateString('vi-VN');

  writeLog('PAYMENT_IN', bank + ':' + amount + 'd | ' + content, todayStr);

  // Bỏ qua nếu nội dung không đúng prefix
  if (!content.includes(CFG.CK_PREFIX)) {
    sendEmailAdmin('Nhận CK không hợp lệ - ' + amount + 'd',
      'Nhan CK: ' + bank + ': ' + amount + 'd\nContent: ' + content + '\nKhong co prefix ' + CFG.CK_PREFIX);
    return jsonResponse({ok: true, msg: 'Payment recorded - no prefix match'});
  }

  // Chống trùng txId
  if (isDuplicateTxId(txId)) {
    writeLog('DUPLICATE_TX', txId, 'SKIP');
    return jsonResponse({ok: true, msg: 'Duplicate txId skipped'});
  }
  saveTxId(txId);

  // Tìm số điện thoại trong nội dung
  const phoneMatch = content.match(/([0-9]{10})/);
  const phone      = phoneMatch ? phoneMatch[1] : null;

  if (!phone) {
    sendEmailAdmin('Can xac nhan thanh toan - so tien khong khop:' + amount + 'd',
      'Nhan CK tu ' + bank + ': ' + amount + 'd\nNoi dung: ' + content + '\nKhong tim duoc SDT');
    writePayment(txId, bank, amount, content, 'UNKNOWN', 'UNKNOWN', 'UNKNOWN_PHONE');
    return jsonResponse({ok: true, msg: 'Payment recorded - phone not found in content'});
  }

  // Kiểm tra boost payment
  if (amount === CFG.BOOST_PRICE && content.includes('BOOST')) {
    return handleBoostPayment(phone, content, txId, amount, bank);
  }

  // Xác định gói từ số tiền
  let planKey  = null;
  for (const [key, price] of Object.entries(CFG.PLAN_PRICES)) {
    if (amount === price) { planKey = key; break; }
  }

  // Nếu không khớp đúng giá → ghi nhận để admin xử lý thủ công
  if (!planKey) {
    sendEmailAdmin('Thanh toan - so tien khong khop:' + amount + 'd',
      'Nhan CK tu ' + bank + ': ' + amount + 'd\nSDT: ' + phone + '\nNoi dung: ' + content);
    writePayment(txId, bank, amount, content, phone, 'UNKNOWN', 'AMOUNT_MISMATCH');
    return jsonResponse({ok: true, msg: 'Payment recorded - amount not matched to plan'});
  }

  // Lấy thông tin user
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const usersSheet = ss.getSheetByName(CFG.SHEET_USERS);
  const rows = usersSheet.getDataRange().getValues();
  let userRow = -1;
  let curPlan = '', curExp = '';
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === phone) { userRow = i; curPlan = rows[i][3] || ''; curExp = rows[i][5] || ''; break; }
  }

  const planDays = CFG.PLAN_DAYS[planKey] || 30;
  let newExp;
  const curDate = curExp ? new Date(curExp.split('/').reverse().join('-')) : null;

  // Nếu cùng gói và chưa hết hạn → gia hạn từ ngày hết hạn
  if (curPlan === planKey && curDate && curDate > new Date()) {
    newExp = addDaysFromDate(curDate, planDays);
  } else {
    newExp = addDays(today, planDays);
  }

  const isRenew = userRow >= 0 && (rows[userRow][3] || '') === planKey;

  if (userRow >= 0) {
    // Update user hiện có
    usersSheet.getRange(userRow + 1, 4).setValue(planKey);
    usersSheet.getRange(userRow + 1, 5).setValue(todayStr);
    usersSheet.getRange(userRow + 1, 6).setValue(newExp);
    const curBalance = parseFloat(rows[userRow][6]) || 0;
    // Reset boost count nếu đổi tháng
    const boostMonth = rows[userRow][9] || '';
    const thisMonth  = today.getMonth() + '/' + today.getFullYear();
    let newBoostUsed = parseInt(rows[userRow][7]) || 0;
    if (boostMonth !== thisMonth) { newBoostUsed = 0; }
    usersSheet.getRange(userRow + 1, 8).setValue(newBoostUsed);
    const newBoostRem = (CFG.BOOST_LIMITS[planKey] || 0) - newBoostUsed;
    usersSheet.getRange(userRow + 1, 9).setValue(Math.max(0, newBoostRem));
    usersSheet.getRange(userRow + 1, 10).setValue(thisMonth);
    usersSheet.getRange(userRow + 1, 11).setValue('active');
  } else {
    // Tạo user mới
    const thisMonth = today.getMonth() + '/' + today.getFullYear();
    usersSheet.appendRow([phone, '', '', planKey, todayStr, newExp, 0, 0, CFG.BOOST_LIMITS[planKey] || 0, thisMonth, 'active']);
    writeLog('USER_AUTO_CREATED', 'SDT:' + phone + ' via payment', todayStr);
  }

  writePayment(txId, bank, amount, content, phone, planKey, 'CONFIRMED');
  writeLog('PLAN_UPGRADED', 'SDT:' + phone + ' -> ' + planKey, 'OK');

  sendEmailAdmin('Thanh toan thanh cong - ' + (isRenew ? 'Gia han' : 'Nang cap') + ' ' + (CFG.PLAN_NAMES[planKey] || planKey),
    'SDT: ' + phone + '\nSo tien: ' + amount.toLocaleString() + 'd\nGoi: ' + (CFG.PLAN_NAMES[planKey] || planKey) +
    '\nNgay het han: ' + newExp + '\nNgan hang: ' + bank);

  return jsonResponse({ok: true, msg: 'Payment confirmed', plan: planKey, expiry: newExp});
}

// ===== handleBoostPayment =====
function handleBoostPayment(phone, content, txId, amount, bank) {
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const usersSheet = ss.getSheetByName(CFG.SHEET_USERS);
  const rows = usersSheet.getDataRange().getValues();
  let userRow = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === phone) { userRow = i; break; }
  }
  if (userRow < 0) {
    return jsonResponse({ok: false, msg: 'User not found for boost'});
  }
  const curUsed = parseInt(rows[userRow][7]) || 0;
  usersSheet.getRange(userRow + 1, 8).setValue(curUsed + 1);
  const curRem = parseInt(rows[userRow][8]) || 0;
  usersSheet.getRange(userRow + 1, 9).setValue(Math.max(0, curRem - 1));
  writePayment(txId, bank, amount, content, phone, 'BOOST', 'CONFIRMED');
  writeLog('BOOST_PAID', 'SDT:' + phone, 'OK');
  return jsonResponse({ok: true, msg: 'Boost payment confirmed'});
}

// ===== checkPaymentStatus: polling từ frontend =====
function checkPaymentStatus(params) {
  const phone  = params.phone || '';
  const amount = parseInt(params.amount || 0);
  if (!phone || !amount) return jsonResponse({ok: false, msg: 'Missing phone or amount'});

  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const paySheet = ss.getSheetByName(CFG.SHEET_PAYMENTS);
  if (!paySheet) return jsonResponse({ok: false, msg: 'No payments sheet'});

  const rows = paySheet.getDataRange().getValues();
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

  // Tìm payment gần đây khớp phone + amount
  for (let i = rows.length - 1; i >= 1; i--) {
    const row = rows[i];
    const rowPhone  = String(row[4] || '');
    const rowAmount = parseInt(row[2] || 0);
    const rowStatus = String(row[6] || '');
    const rowTime   = row[0] ? new Date(row[0]) : null;

    if (rowPhone === phone && rowAmount === amount &&
        rowStatus === 'CONFIRMED' && rowTime && rowTime > fiveMinAgo) {
      // Lấy thông tin plan hiện tại của user
      const usersSheet = ss.getSheetByName(CFG.SHEET_USERS);
      const uRows = usersSheet.getDataRange().getValues();
      let plan = '', expiry = '';
      for (let j = 1; j < uRows.length; j++) {
        if (uRows[j][0] === phone) { plan = uRows[j][3]; expiry = uRows[j][5]; break; }
      }
      return jsonResponse({ok: true, paid: true, plan: plan, expiry: expiry});
    }
  }
  return jsonResponse({ok: true, paid: false});
}

// ===== boostPost: đẩy tin theo postId =====
function boostPost(data) {
  const phone  = data.phone || '';
  const postId = data.postId || '';
  if (!phone || !postId) return jsonResponse({ok: false, msg: 'Missing phone or postId'});

  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const usersSheet = ss.getSheetByName(CFG.SHEET_USERS);
  const rows = usersSheet.getDataRange().getValues();
  let userRow = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === phone) { userRow = i; break; }
  }
  if (userRow < 0) return jsonResponse({ok: false, msg: 'User not found'});

  const today     = new Date();
  const thisMonth = today.getMonth() + '/' + today.getFullYear();
  const boostMonth = rows[userRow][9] || '';
  let boostUsed    = parseInt(rows[userRow][7]) || 0;
  let boostRem     = parseInt(rows[userRow][8]) || 0;
  const plan       = rows[userRow][3] || 'free';
  const limit      = CFG.BOOST_LIMITS[plan] || 0;

  // Reset nếu sang tháng mới
  if (boostMonth !== thisMonth) {
    boostUsed = 0;
    boostRem  = limit;
    usersSheet.getRange(userRow + 1, 10).setValue(thisMonth);
  }

  if (boostRem <= 0) {
    return jsonResponse({ok: false, msg: 'Khong con luot day tin. Nap them hoac cho thang sau.'});
  }

  // Cập nhật boost count
  usersSheet.getRange(userRow + 1, 8).setValue(boostUsed + 1);
  usersSheet.getRange(userRow + 1, 9).setValue(boostRem - 1);
  usersSheet.getRange(userRow + 1, 10).setValue(thisMonth);

  return boostPostById(postId, phone);
}

// ===== boostPostById: thực hiện đẩy tin =====
function boostPostById(postId, phone) {
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const postsSheet = ss.getSheetByName(CFG.SHEET_POSTS);
  if (!postsSheet) return jsonResponse({ok: false, msg: 'No posts sheet'});

  const rows = postsSheet.getDataRange().getValues();
  let postRow = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(postId)) { postRow = i; break; }
  }
  if (postRow < 0) return jsonResponse({ok: false, msg: 'Post not found: ' + postId});

  const now = new Date().toLocaleString('vi-VN');
  // Cập nhật timestamp để đẩy lên đầu
  postsSheet.getRange(postRow + 1, 2).setValue(now);
  postsSheet.getRange(postRow + 1, 14).setValue(now);

  writeLog('BOOST_POST', 'PostID:' + postId + ' | SDT:' + phone, 'OK');
  return jsonResponse({ok: true, msg: 'Post boosted', postId: postId, boostedAt: now});
}

// ===== isDuplicateTxId / saveTxId =====
function isDuplicateTxId(txId) {
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sheet = ss.getSheetByName(CFG.SHEET_TXIDS);
  if (!sheet) return false;
  const vals = sheet.getDataRange().getValues().flat();
  return vals.indexOf(txId) >= 0;
}
function saveTxId(txId) {
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sheet = ss.getSheetByName(CFG.SHEET_TXIDS);
  if (!sheet) return;
  sheet.appendRow([txId, new Date().toLocaleString('vi-VN')]);
}

// ===== addDays / addDaysFromDate =====
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('vi-VN');
}
function addDaysFromDate(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('vi-VN');
}

// ===== addUser: đăng ký tài khoản mới =====
function addUser(data) {
  const phone = (data.phone || '').replace(/[^0-9]/g, '');
  const name  = (data.name  || '').trim();
  const pass  = data.pass   || '';

  // Validate
  if (!phone || phone.length < 9 || phone.length > 11) {
    return jsonResponse({ok: false, msg: 'So dien thoai khong hop le (9-11 so)'});
  }
  if (!name || name.length < 2) {
    return jsonResponse({ok: false, msg: 'Ten khong hop le (it nhat 2 ky tu)'});
  }
  if (!pass || pass.length < 4) {
    return jsonResponse({ok: false, msg: 'Mat khau qua ngan (it nhat 4 ky tu)'});
  }

  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sheet = ss.getSheetByName(CFG.SHEET_USERS);
  const rows = sheet.getDataRange().getValues();

  // Kiểm tra đã tồn tại chưa
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === phone) {
      return jsonResponse({ok: false, msg: 'So dien thoai da duoc dang ky'});
    }
  }

  const today = new Date().toLocaleDateString('vi-VN');
  const thisMonth = new Date().getMonth() + '/' + new Date().getFullYear();

  // Col: phone, name, pass, plan, joinDate, expiry, balance, boostUsed, boostRem, boostMonth, status
  sheet.appendRow([phone, name, pass, 'free', today, '', 0, 0, 0, thisMonth, 'active']);
  writeLog('USER_REGISTER', 'SDT:' + phone + ' | Name:' + name, today);

  return jsonResponse({ok: true, msg: 'Dang ky thanh cong', phone: phone, name: name, plan: 'free', balance: 0, expiry: ''});
}

// ===== changePass: đổi mật khẩu =====
function changePass(data) {
  const phone   = (data.phone   || '').replace(/[^0-9]/g, '');
  const oldPass = data.oldPass  || '';
  const newPass = data.newPass  || '';

  if (!phone || !oldPass || !newPass) {
    return jsonResponse({ok: false, msg: 'Thieu thong tin'});
  }
  if (newPass.length < 4) {
    return jsonResponse({ok: false, msg: 'Mat khau moi qua ngan (it nhat 4 ky tu)'});
  }

  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sheet = ss.getSheetByName(CFG.SHEET_USERS);
  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === phone) {
      if (rows[i][2] !== oldPass) {
        return jsonResponse({ok: false, msg: 'Mat khau cu khong dung'});
      }
      sheet.getRange(i + 1, 3).setValue(newPass);
      writeLog('CHANGE_PASS', 'SDT:' + phone, new Date().toLocaleDateString('vi-VN'));
      return jsonResponse({ok: true, msg: 'Doi mat khau thanh cong'});
    }
  }
  return jsonResponse({ok: false, msg: 'Khong tim thay tai khoan'});
}

// ===== getUsers =====
function getUsers(e) {
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sheet = ss.getSheetByName(CFG.SHEET_USERS);
  const rows = sheet.getDataRange().getValues();
  const users = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    users.push({
      phone:         rows[i][0],
      name:          rows[i][1],
      plan:          rows[i][3],
      joinDate:      rows[i][4],
      expiry:        rows[i][5],
      balance:       parseFloat(rows[i][6]) || 0,
      boostUsed:     parseInt(rows[i][7]) || 0,
      boostRemaining:parseInt(rows[i][8]) || 0,
      boostMonth:    rows[i][9],
      status:        rows[i][10]
    });
  }
  return jsonResponse({ok: true, users: users});
}

// ===== getUserByPhone =====
function getUserByPhone(phone) {
  if (!phone) return jsonResponse({ok: false, msg: 'Missing phone'});
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sheet = ss.getSheetByName(CFG.SHEET_USERS);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === phone) {
      return jsonResponse({ok: true, user: {
        phone:          rows[i][0],
        name:           rows[i][1],
        plan:           rows[i][3],
        joinDate:       rows[i][4],
        expiry:         rows[i][5],
        balance:        parseFloat(rows[i][6]) || 0,
        boostUsed:      parseInt(rows[i][7]) || 0,
        boostRemaining: parseInt(rows[i][8]) || 0,
        boostMonth:     rows[i][9],
        status:         rows[i][10]
      }});
    }
  }
  return jsonResponse({ok: false, msg: 'User not found'});
}

// ===== updatePlan: cập nhật plan thủ công từ admin =====
function updatePlan(data) {
  const phone  = data.phone  || '';
  const plan   = data.plan   || '';
  const expiry = data.expiry || '';
  if (!phone || !plan) return jsonResponse({ok: false, msg: 'Missing phone or plan'});

  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sheet = ss.getSheetByName(CFG.SHEET_USERS);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === phone) {
      const today = new Date().toLocaleDateString('vi-VN');
      let newExp = expiry;
      if (!newExp) {
        const planDays = CFG.PLAN_DAYS[plan] || 30;
        const curExp = rows[i][5] || '';
        const curDate = curExp ? new Date(curExp.split('/').reverse().join('-')) : null;
        if (rows[i][3] === plan && curDate && curDate > new Date()) {
          newExp = addDaysFromDate(curDate, planDays);
        } else {
          newExp = addDays(new Date(), planDays);
        }
      }
      sheet.getRange(i + 1, 4).setValue(plan);
      sheet.getRange(i + 1, 5).setValue(today);
      sheet.getRange(i + 1, 6).setValue(newExp);
      const boostLimit = CFG.BOOST_LIMITS[plan] || 0;
      sheet.getRange(i + 1, 9).setValue(boostLimit);
      writeLog('PLAN_MANUAL_UPDATE', 'SDT:' + phone + ' -> ' + plan, today);
      return jsonResponse({ok: true, msg: 'Plan updated', plan: plan, expiry: newExp});
    }
  }
  return jsonResponse({ok: false, msg: 'User not found'});
}

// ===== adminResetPass =====
function adminResetPass(data) {
  const phone   = data.phone   || '';
  const newPass = data.newPass || '123456';
  if (!phone) return jsonResponse({ok: false, msg: 'Missing phone'});

  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sheet = ss.getSheetByName(CFG.SHEET_USERS);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === phone) {
      sheet.getRange(i + 1, 3).setValue(newPass);
      writeLog('ADMIN_RESET_PASS', 'SDT:' + phone, new Date().toLocaleDateString('vi-VN'));
      return jsonResponse({ok: true, msg: 'Password reset to: ' + newPass});
    }
  }
  return jsonResponse({ok: false, msg: 'User not found'});
}

// ===== addPost =====
function addPost(data) {
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sheet = ss.getSheetByName(CFG.SHEET_POSTS);
  const row = [
    data.id || Date.now().toString(),
    new Date().toLocaleString('vi-VN'),
    data.phone || '',
    data.name || '',
    data.title || '',
    data.price || '',
    data.area || '',
    data.address || '',
    data.district || '',
    data.desc || '',
    data.images || '',
    data.type || '',
    data.contact || '',
    new Date().toLocaleString('vi-VN'),
    'pending'
  ];
  sheet.appendRow(row);
  writeLog('POST_ADDED', 'ID:' + row[0] + ' | SDT:' + row[2], row[1]);
  return jsonResponse({ok: true, msg: 'Post added', id: row[0]});
}

// ===== getPosts =====
function getPosts(e) {
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sheet = ss.getSheetByName(CFG.SHEET_POSTS);
  if (!sheet) return jsonResponse({ok: true, posts: []});
  const rows = sheet.getDataRange().getValues();
  const posts = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    posts.push({
      id: rows[i][0], createdAt: rows[i][1], phone: rows[i][2],
      name: rows[i][3], title: rows[i][4], price: rows[i][5],
      area: rows[i][6], address: rows[i][7], district: rows[i][8],
      desc: rows[i][9], images: rows[i][10], type: rows[i][11],
      contact: rows[i][12], boostedAt: rows[i][13], status: rows[i][14]
    });
  }
  return jsonResponse({ok: true, posts: posts});
}

// ===== getPayHistory: lịch sử nạp tiền của user =====
function getPayHistory(phone) {
  if (!phone) return jsonResponse({ok: false, msg: 'Missing phone'});
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sheet = ss.getSheetByName(CFG.SHEET_PAYMENTS);
  if (!sheet) return jsonResponse({ok: true, history: []});

  const rows = sheet.getDataRange().getValues();
  const history = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][4]) === String(phone)) {
      history.push({
        txId:    rows[i][0],
        bank:    rows[i][1],
        amount:  rows[i][2],
        content: rows[i][3],
        plan:    rows[i][5],
        status:  rows[i][6],
        date:    rows[i][7]
      });
    }
  }
  // Sắp xếp mới nhất trước
  history.reverse();
  return jsonResponse({ok: true, history: history.slice(0, 20)});
}

// ===== setupSheet: tạo cấu trúc sheet lần đầu =====
function setupSheet() {
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);

  // Users sheet
  let usersSheet = ss.getSheetByName(CFG.SHEET_USERS);
  if (!usersSheet) usersSheet = ss.insertSheet(CFG.SHEET_USERS);
  if (usersSheet.getLastRow() === 0) {
    usersSheet.appendRow(['Phone','Name','Pass','Plan','JoinDate','Expiry','Balance','BoostUsed','BoostRemaining','BoostMonth','Status']);
  }

  // Posts sheet
  let postsSheet = ss.getSheetByName(CFG.SHEET_POSTS);
  if (!postsSheet) postsSheet = ss.insertSheet(CFG.SHEET_POSTS);
  if (postsSheet.getLastRow() === 0) {
    postsSheet.appendRow(['ID','CreatedAt','Phone','Name','Title','Price','Area','Address','District','Desc','Images','Type','Contact','BoostedAt','Status']);
  }

  // Payments sheet
  let paySheet = ss.getSheetByName(CFG.SHEET_PAYMENTS);
  if (!paySheet) paySheet = ss.insertSheet(CFG.SHEET_PAYMENTS);
  if (paySheet.getLastRow() === 0) {
    paySheet.appendRow(['TxId','Bank','Amount','Content','Phone','Plan','Status','Date']);
  }

  // Log sheet
  let logSheet = ss.getSheetByName(CFG.SHEET_LOG);
  if (!logSheet) logSheet = ss.insertSheet(CFG.SHEET_LOG);
  if (logSheet.getLastRow() === 0) {
    logSheet.appendRow(['Timestamp','Action','Detail','Status']);
  }

  // ProcessedTxIds sheet
  let txSheet = ss.getSheetByName(CFG.SHEET_TXIDS);
  if (!txSheet) txSheet = ss.insertSheet(CFG.SHEET_TXIDS);
  if (txSheet.getLastRow() === 0) {
    txSheet.appendRow(['TxId','ProcessedAt']);
  }

  return jsonResponse({ok: true, msg: 'Sheets setup complete'});
}

// ===== sendEmailAdmin =====
function sendEmailAdmin(subject, body) {
  try {
    MailApp.sendEmail(CFG.ADMIN_EMAIL, '[NHPHCM] ' + subject, body);
  } catch(e) {
    writeLog('EMAIL_ERROR', e.toString(), 'ERROR');
  }
}

// ===== writePayment =====
function writePayment(txId, bank, amount, content, phone, plan, status) {
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sheet = ss.getSheetByName(CFG.SHEET_PAYMENTS);
  if (!sheet) return;
  const now = new Date().toLocaleString('vi-VN');
  sheet.appendRow([txId, bank, amount, content, phone, plan, status, now]);
}

// ===== writeLog =====
function writeLog(action, detail, status) {
  try {
    const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
    const sheet = ss.getSheetByName(CFG.SHEET_LOG);
    if (!sheet) return;
    sheet.appendRow([new Date().toLocaleString('vi-VN'), action, detail, status]);
  } catch(e) { console.log('writeLog err:', e); }
}

// ===== jsonResponse =====
function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
