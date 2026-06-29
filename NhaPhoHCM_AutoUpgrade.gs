
// ============================================================
// NGUON NHA PHO HCM — Hệ thống tự động nâng cấp gói
// Google Apps Script — Dán vào script.google.com
// ============================================================

// ===== CẤU HÌNH — Anh chỉ cần sửa phần này =====
const CONFIG = {
  // Google Sheet ID (lấy từ URL sheet của anh)
  SHEET_ID: 'YOUR_GOOGLE_SHEET_ID',
  
  // Zalo OA Access Token (lấy từ developers.zalo.me)
  ZALO_TOKEN: 'YOUR_ZALO_OA_TOKEN',
  
  // Số Zalo cá nhân Mr. Duy để nhận thông báo admin
  ADMIN_ZALO: '0987645314',
  
  // Tên các sheet
  SHEET_USERS: 'Users',
  SHEET_PAYMENTS: 'Payments',
  SHEET_LOG: 'Log',
  
  // Từ khóa nhận diện email ngân hàng
  TCB_SENDER: 'no-reply@techcombank.com.vn',
  VCB_SENDER: 'no-reply@vietcombank.com.vn',
  
  // Nội dung CK prefix để nhận diện
  CK_PREFIX: 'NHPHCM',
  
  // Giá các gói (đồng)
  PLAN_PRICES: {
    'BASIC': 199000,
    'PRO':   499000,
    'VIP':   999000,
  },
  
  // Quyền lợi từng gói
  PLAN_POSTS: {
    'FREE':  2,
    'BASIC': 10,
    'PRO':   30,
    'VIP':   9999,
  }
};

// ===== BƯỚC 1: TẠO GOOGLE SHEET VỚI ĐỦ CỘT =====
function setupSheet() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  
  // Sheet Users
  let usersSheet = ss.getSheetByName(CONFIG.SHEET_USERS);
  if (!usersSheet) usersSheet = ss.insertSheet(CONFIG.SHEET_USERS);
  usersSheet.getRange(1, 1, 1, 10).setValues([[
    'SĐT', 'Họ tên', 'Email', 'Gói hiện tại', 
    'Ngày kích hoạt', 'Ngày hết hạn', 'Tổng đã nạp',
    'Số tin còn lại', 'Trạng thái', 'Ghi chú'
  ]]);
  usersSheet.getRange(1,1,1,10).setFontWeight('bold').setBackground('#0d1b2a').setFontColor('#c9922a');
  
  // Sheet Payments
  let paySheet = ss.getSheetByName(CONFIG.SHEET_PAYMENTS);
  if (!paySheet) paySheet = ss.insertSheet(CONFIG.SHEET_PAYMENTS);
  paySheet.getRange(1, 1, 1, 9).setValues([[
    'Thời gian', 'Ngân hàng', 'Số tiền', 'Nội dung CK',
    'SĐT khách', 'Gói nhận', 'Trạng thái', 'Mã GD', 'Ghi chú'
  ]]);
  paySheet.getRange(1,1,1,9).setFontWeight('bold').setBackground('#0d1b2a').setFontColor('#c9922a');
  
  // Sheet Log
  let logSheet = ss.getSheetByName(CONFIG.SHEET_LOG);
  if (!logSheet) logSheet = ss.insertSheet(CONFIG.SHEET_LOG);
  logSheet.getRange(1, 1, 1, 4).setValues([['Thời gian', 'Sự kiện', 'Chi tiết', 'Kết quả']]);
  logSheet.getRange(1,1,1,4).setFontWeight('bold').setBackground('#0d1b2a').setFontColor('#c9922a');
  
  Logger.log('✅ Sheet đã được tạo xong!');
  SpreadsheetApp.getUi().alert('✅ Đã tạo xong Google Sheet! Kiểm tra các tab: Users, Payments, Log');
}

// ===== BƯỚC 2: HÀM ĐỌC EMAIL NGÂN HÀNG =====
function checkBankEmails() {
  const now = new Date();
  writeLog('CHECK_EMAIL', 'Bắt đầu kiểm tra email ngân hàng', '');
  
  // Tìm email TCB chưa đọc trong 24h qua
  checkTechcombankEmails();
  checkVietcombankEmails();
}

function checkTechcombankEmails() {
  // Techcombank gửi email thông báo CK đến
  const query = 'from:(' + CONFIG.TCB_SENDER + ') subject:(Thong bao giao dich OR Biến động số dư) is:unread newer_than:1d';
  const threads = GmailApp.search(query);
  
  threads.forEach(thread => {
    const messages = thread.getMessages();
    messages.forEach(msg => {
      if (msg.isUnread()) {
        const body = msg.getPlainBody();
        const subject = msg.getSubject();
        parseTransactionEmail(body, subject, 'Techcombank');
        msg.markRead();
      }
    });
  });
}

function checkVietcombankEmails() {
  const query = 'from:(' + CONFIG.VCB_SENDER + ') subject:(Thong bao OR bien dong) is:unread newer_than:1d';
  const threads = GmailApp.search(query);
  
  threads.forEach(thread => {
    const messages = thread.getMessages();
    messages.forEach(msg => {
      if (msg.isUnread()) {
        const body = msg.getPlainBody();
        const subject = msg.getSubject();
        parseTransactionEmail(body, subject, 'Vietcombank');
        msg.markRead();
      }
    });
  });
}

// ===== BƯỚC 3: PHÂN TÍCH NỘI DUNG EMAIL =====
function parseTransactionEmail(body, subject, bank) {
  try {
    // Tìm số tiền — pattern: + X,XXX,XXX VND hoặc Số tiền: X
    const amountPatterns = [
      /[+]?\s*([\d,\.]+)\s*VND/i,
      /So tien[:\s]+([\d,\.]+)/i,
      /Amount[:\s]+([\d,\.]+)/i,
      /GD[:\s]+\+([\d,\.]+)/i,
    ];
    
    let amount = 0;
    for (const pattern of amountPatterns) {
      const match = body.match(pattern);
      if (match) {
        amount = parseInt(match[1].replace(/[,\.]/g, '').replace(/(\d+)\d{3}$/, '$1000'));
        if (amount > 10000) break; // Loại bỏ số không hợp lệ
      }
    }
    
    // Tìm nội dung CK
    const contentPatterns = [
      /Noi dung[:\s]+([^
]+)/i,
      /Description[:\s]+([^
]+)/i,
      /ND[:\s]+([^
]+)/i,
      /Ghi chu[:\s]+([^
]+)/i,
    ];
    
    let content = '';
    for (const pattern of contentPatterns) {
      const match = body.match(pattern);
      if (match) { content = match[1].trim(); break; }
    }
    
    // Chỉ xử lý nếu nội dung có prefix NHPHCM
    if (!content.toUpperCase().includes(CONFIG.CK_PREFIX)) {
      writeLog('SKIP', bank, 'Nội dung không phải NHPHCM: ' + content);
      return;
    }
    
    // Tìm SĐT từ nội dung — format: NHPHCM BASIC 0987645314
    const phoneMatch = content.match(/0[3-9]\d{8}/);
    const phone = phoneMatch ? phoneMatch[0] : '';
    
    // Tìm tên gói từ nội dung
    let planName = '';
    if (content.toUpperCase().includes('VIP')) planName = 'VIP';
    else if (content.toUpperCase().includes('PRO')) planName = 'PRO';
    else if (content.toUpperCase().includes('BASIC')) planName = 'BASIC';
    else {
      // Nhận diện qua số tiền
      planName = detectPlanByAmount(amount);
    }
    
    if (!planName) {
      writeLog('UNKNOWN_PLAN', bank, 'Không nhận diện được gói — Amount: ' + amount + ' Content: ' + content);
      notifyAdmin('⚠️ CK không rõ gói', bank + ' — ' + amount + 'đ — ' + content);
      return;
    }
    
    // Lưu payment record
    const txId = 'TX' + Date.now();
    savePayment(new Date(), bank, amount, content, phone, planName, 'SUCCESS', txId);
    
    // Nâng cấp tài khoản
    if (phone) {
      upgradeUserPlan(phone, planName, amount, txId);
    } else {
      writeLog('NO_PHONE', bank, 'Có CK nhưng không tìm được SĐT — ' + content);
      notifyAdmin('⚠️ CK không có SĐT', bank + ' — ' + planName + ' — ' + amount + 'đ\nND: ' + content);
    }
    
  } catch(e) {
    writeLog('ERROR', 'parseTransactionEmail', e.toString());
  }
}

function detectPlanByAmount(amount) {
  // Cho phép sai lệch ±5000đ (phí chuyển khoản)
  const tolerance = 5000;
  for (const [plan, price] of Object.entries(CONFIG.PLAN_PRICES)) {
    if (Math.abs(amount - price) <= tolerance) return plan;
    // Kiểm tra gói năm (x12 x0.8)
    const yearPrice = price * 12 * 0.8;
    if (Math.abs(amount - yearPrice) <= tolerance) return plan + '_YEAR';
  }
  return '';
}

// ===== BƯỚC 4: NÂNG CẤP TÀI KHOẢN =====
function upgradeUserPlan(phone, planName, amount, txId) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_USERS);
  const data = sheet.getDataRange().getValues();
  
  const cleanPlan = planName.replace('_YEAR','');
  const isYear = planName.includes('_YEAR');
  const now = new Date();
  const expiry = new Date(now);
  expiry.setMonth(expiry.getMonth() + (isYear ? 12 : 1));
  
  const posts = CONFIG.PLAN_POSTS[cleanPlan] || 2;
  
  // Tìm user theo SĐT
  let found = false;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].toString().replace(/\D/g,'') === phone.replace(/\D/g,'')) {
      // Cập nhật dòng existing
      sheet.getRange(i+1, 4).setValue(cleanPlan);
      sheet.getRange(i+1, 5).setValue(Utilities.formatDate(now, 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy HH:mm'));
      sheet.getRange(i+1, 6).setValue(Utilities.formatDate(expiry, 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy'));
      sheet.getRange(i+1, 7).setValue((parseFloat(data[i][6])||0) + amount);
      sheet.getRange(i+1, 8).setValue(posts === 9999 ? 'Không giới hạn' : posts);
      sheet.getRange(i+1, 9).setValue('ACTIVE');
      sheet.getRange(i+1, 10).setValue('TX: ' + txId);
      // Highlight dòng vừa nâng cấp
      sheet.getRange(i+1, 1, 1, 10).setBackground('#fef3dc');
      found = true;
      writeLog('UPGRADED', phone, cleanPlan + ' — ' + amount + 'đ — Hết hạn: ' + Utilities.formatDate(expiry, 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy'));
      break;
    }
  }
  
  if (!found) {
    // Thêm user mới
    sheet.appendRow([
      phone, '(Chưa cập nhật)', '', cleanPlan,
      Utilities.formatDate(now, 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy HH:mm'),
      Utilities.formatDate(expiry, 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy'),
      amount,
      posts === 9999 ? 'Không giới hạn' : posts,
      'ACTIVE',
      'Tự động — TX: ' + txId
    ]);
    writeLog('NEW_USER', phone, 'Tạo mới — ' + cleanPlan);
  }
  
  // Gửi thông báo Zalo cho khách
  sendZaloNotification(phone, cleanPlan, expiry, posts, isYear);
  
  // Thông báo cho admin
  notifyAdmin(
    '✅ Nâng cấp thành công!',
    '👤 SĐT: ' + phone +
    '\n💎 Gói: ' + cleanPlan + (isYear?' (Năm)':'') +
    '\n💰 Số tiền: ' + amount.toLocaleString('vi-VN') + 'đ' +
    '\n📅 Hết hạn: ' + Utilities.formatDate(expiry, 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy') +
    '\n🔖 Mã GD: ' + txId
  );
}

// ===== BƯỚC 5: GỬI ZALO THÔNG BÁO =====
function sendZaloNotification(phone, plan, expiry, posts, isYear) {
  const planEmoji = {FREE:'🆓', BASIC:'⭐', PRO:'💜', VIP:'👑'};
  const expiryStr = Utilities.formatDate(expiry, 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy');
  
  const message = 
    '🎉 KÍCH HOẠT GÓI THÀNH CÔNG!\n' +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    (planEmoji[plan]||'💎') + ' Gói ' + plan + (isYear?' (Cả năm)':'') + '\n' +
    '📋 Số tin đăng: ' + (posts===9999?'Không giới hạn':posts+' tin/tháng') + '\n' +
    '📅 Hiệu lực đến: ' + expiryStr + '\n' +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    '✅ Anh/chị có thể đăng tin ngay tại:\n' +
    'nguonnhaphohcm.vn\n\n' +
    'Cần hỗ trợ liên hệ Mr. Duy: 0987.645.314';
  
  // Gửi qua Zalo OA API
  if (CONFIG.ZALO_TOKEN && CONFIG.ZALO_TOKEN !== 'YOUR_ZALO_OA_TOKEN') {
    try {
      const url = 'https://openapi.zalo.me/v2.0/oa/message';
      const payload = {
        recipient: { user_id: phone },
        message: { text: message }
      };
      const options = {
        method: 'post',
        headers: {
          'access_token': CONFIG.ZALO_TOKEN,
          'Content-Type': 'application/json'
        },
        payload: JSON.stringify(payload)
      };
      UrlFetchApp.fetch(url, options);
      writeLog('ZALO_SENT', phone, 'Gửi thông báo thành công');
    } catch(e) {
      writeLog('ZALO_ERROR', phone, e.toString());
    }
  } else {
    writeLog('ZALO_SKIP', phone, 'Chưa cấu hình Zalo Token');
  }
}

function notifyAdmin(title, detail) {
  // Gửi email cho admin
  try {
    GmailApp.sendEmail(
      Session.getEffectiveUser().getEmail(),
      '🏠 NHPHCM — ' + title,
      detail + '\n\n---\nHệ thống tự động — Nguồn Nhà Phố HCM'
    );
  } catch(e) {}
  writeLog('ADMIN_NOTIFY', title, detail);
}

// ===== BƯỚC 6: LƯU PAYMENT LOG =====
function savePayment(time, bank, amount, content, phone, plan, status, txId) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_PAYMENTS);
  sheet.appendRow([
    Utilities.formatDate(time, 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy HH:mm:ss'),
    bank, amount, content, phone, plan, status, txId, ''
  ]);
  // Màu theo trạng thái
  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow, 7).setBackground(status==='SUCCESS'?'#d1fae5':'#fee2e2');
}

function writeLog(event, detail, result) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_LOG);
  sheet.appendRow([
    Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy HH:mm:ss'),
    event, detail, result
  ]);
}

// ===== BƯỚC 7: KIỂM TRA GÓI HẾT HẠN =====
function checkExpiredPlans() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_USERS);
  const data = sheet.getDataRange().getValues();
  const today = new Date();
  
  for (let i = 1; i < data.length; i++) {
    const plan = data[i][3];
    const expiryStr = data[i][5];
    const phone = data[i][0];
    const status = data[i][8];
    
    if (!expiryStr || plan === 'FREE' || status === 'EXPIRED') continue;
    
    const expiry = new Date(expiryStr.split('/').reverse().join('-'));
    const daysLeft = Math.floor((expiry - today) / (1000*60*60*24));
    
    if (daysLeft <= 3 && daysLeft > 0) {
      // Sắp hết hạn — nhắc gia hạn
      sendZaloNotification_Renew(phone.toString(), plan, daysLeft);
    } else if (daysLeft <= 0) {
      // Đã hết hạn — hạ xuống Free
      sheet.getRange(i+1, 4).setValue('FREE');
      sheet.getRange(i+1, 8).setValue(CONFIG.PLAN_POSTS['FREE']);
      sheet.getRange(i+1, 9).setValue('EXPIRED');
      sheet.getRange(i+1, 1, 1, 10).setBackground('#fee2e2');
      writeLog('EXPIRED', phone.toString(), 'Gói ' + plan + ' đã hết hạn — hạ Free');
    }
  }
}

function sendZaloNotification_Renew(phone, plan, daysLeft) {
  const message = 
    '⚠️ NHẮC GIA HẠN GÓI\n' +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    'Gói ' + plan + ' của anh/chị sắp hết hạn!\n' +
    '⏰ Còn ' + daysLeft + ' ngày\n\n' +
    'Gia hạn ngay để không bị gián đoạn:\n' +
    'nguonnhaphohcm.vn → Gói & Giá\n\n' +
    'Hỗ trợ: 0987.645.314';
  
  writeLog('RENEW_REMIND', phone, 'Còn ' + daysLeft + ' ngày');
  // Gửi Zalo tương tự hàm trên
}

// ===== BƯỚC 8: API ENDPOINT ĐỂ WEBSITE GỌI =====
function doGet(e) {
  const action = e.parameter.action;
  const phone = e.parameter.phone;
  const token = e.parameter.token;
  
  // Xác thực token đơn giản
  if (token !== 'NHPHCM2026SECRET') {
    return ContentService.createTextOutput(JSON.stringify({error: 'Unauthorized'}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  if (action === 'checkPlan') {
    const result = getUserPlan(phone);
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  if (action === 'stats') {
    const result = getStats();
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  return ContentService.createTextOutput(JSON.stringify({status:'ok'}))
    .setMimeType(ContentService.MimeType.JSON);
}

function getUserPlan(phone) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_USERS);
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].toString().replace(/\D/g,'') === phone.replace(/\D/g,'')) {
      return {
        found: true,
        phone: data[i][0],
        name: data[i][1],
        plan: data[i][3],
        expiry: data[i][5],
        posts: data[i][7],
        status: data[i][8]
      };
    }
  }
  return { found: false, plan: 'FREE', posts: 2 };
}

function getStats() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const users = ss.getSheetByName(CONFIG.SHEET_USERS).getDataRange().getValues();
  const pays = ss.getSheetByName(CONFIG.SHEET_PAYMENTS).getDataRange().getValues();
  
  let totalRevenue = 0;
  let planCounts = {FREE:0, BASIC:0, PRO:0, VIP:0};
  
  for (let i = 1; i < users.length; i++) {
    const plan = users[i][3] || 'FREE';
    planCounts[plan] = (planCounts[plan]||0) + 1;
    totalRevenue += parseFloat(users[i][6])||0;
  }
  
  return {
    totalUsers: users.length - 1,
    totalRevenue: totalRevenue,
    planCounts: planCounts,
    totalTransactions: pays.length - 1
  };
}

// ===== SETUP TRIGGER TỰ ĐỘNG =====
function setupTriggers() {
  // Xóa trigger cũ
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  
  // Kiểm tra email mỗi 15 phút
  ScriptApp.newTrigger('checkBankEmails')
    .timeBased()
    .everyMinutes(15)
    .create();
  
  // Kiểm tra gói hết hạn mỗi ngày lúc 8:00 sáng
  ScriptApp.newTrigger('checkExpiredPlans')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();
  
  Logger.log('✅ Đã tạo triggers thành công!');
  SpreadsheetApp.getUi().alert('✅ Triggers đã được tạo!\n\n• Kiểm tra email mỗi 15 phút\n• Kiểm tra hết hạn mỗi ngày lúc 8:00 sáng');
}

// ===== MENU TÙY CHỈNH TRONG SHEET =====
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🏠 NHPHCM Admin')
    .addItem('1. Tạo Sheet', 'setupSheet')
    .addItem('2. Tạo Triggers', 'setupTriggers')
    .addSeparator()
    .addItem('Kiểm tra email ngay', 'checkBankEmails')
    .addItem('Kiểm tra gói hết hạn', 'checkExpiredPlans')
    .addSeparator()
    .addItem('Xem thống kê', 'showStats')
    .addToUi();
}

function showStats() {
  const stats = getStats();
  SpreadsheetApp.getUi().alert(
    '📊 THỐNG KÊ NHPHCM\n\n' +
    '👥 Tổng users: ' + stats.totalUsers + '\n' +
    '💰 Tổng doanh thu: ' + stats.totalRevenue.toLocaleString() + 'đ\n' +
    '📋 Tổng GD: ' + stats.totalTransactions + '\n\n' +
    '🆓 Free: ' + (stats.planCounts.FREE||0) + ' users\n' +
    '⭐ Basic: ' + (stats.planCounts.BASIC||0) + ' users\n' +
    '💜 Pro: ' + (stats.planCounts.PRO||0) + ' users\n' +
    '👑 VIP: ' + (stats.planCounts.VIP||0) + ' users'
  );
}
