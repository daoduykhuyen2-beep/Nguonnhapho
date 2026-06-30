// ============================================================
// NGUON NHA PHO HCM - Backend Google Apps Script v3.0
// Google Sheets + SePay Webhook + Email Automation
// UPDATED v3.0: checkPaymentStatus, boostPost theo ID, chong dup txId,
//               BOOST_PRICE, boostCount theo thang, tu gia han
// ============================================================
// SETUP:
// 1. Tao Google Sheet > copy Sheet ID vao CFG.SHEET_ID
// 2. Extensions > Apps Script > paste code nay > Luu
// 3. Chay ham setupSheet() mot lan
// 4. Deploy > New deployment > Web app > Anyone > copy URL
// 5. Cap nhat GAS_URL trong index.html
// 6. SePay.vn > Webhook > URL = URL deploy, POST, event = transfer in
// ============================================================

const CFG = {
  SHEET_ID: 'YOUR_GOOGLE_SHEET_ID_HERE',
  ADMIN_EMAIL: 'daoduykhuyen2@gmail.com',
  ADMIN_PHONE: '0987645314',
  CK_PREFIX: 'NHPHCM',
  SHEET_USERS: 'Users',
  SHEET_POSTS: 'Posts',
  SHEET_PAYMENTS: 'Payments',
  SHEET_LOG: 'Log',
  SHEET_TXIDS: 'ProcessedTxIds',
  PLAN_PRICES: {
    'verified': 99000,
    'trusted': 199000,
    'partner': 399000
  },
  PLAN_DAYS: { 'verified': 30, 'trusted': 30, 'partner': 30 },
  PLAN_NAMES: {
    'free': 'Tai Khoan Free',
    'verified': 'Da Xac Minh',
    'trusted': 'Uy Tin',
    'partner': 'Doi Tac NHPHCM'
  },
  BOOST_PRICE: 29000,
  BOOST_DAYS_FEATURED: 7,
  BOOST_LIMITS: { 'verified': 2, 'trusted': 5, 'partner': 10 },
  WARN_DAYS_BEFORE_EXPIRE: 7
};

// ============================================================
// MAIN HANDLER
// ============================================================
function doPost(e) {
  try {
    let data = {};
    try { data = JSON.parse(e.postData.contents || '{}'); } catch(pe) {}
    const action = data.action || (e.parameter && e.parameter.action) || '';
    if (data.transferAmount !== undefined || data.amount !== undefined) {
      return handleSePay(data);
    }
    switch(action) {
      case 'addUser':    return addUser(data);
      case 'addPost':    return addPost(data);
      case 'updatePlan': return updatePlan(data);
      case 'boostPost':  return boostPost(data);
      case 'resetPass':  return adminResetPass(data);
      default: return jsonResponse({ok: false, msg: 'Unknown action: ' + action});
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
      case 'getUsers':           return getUsers();
      case 'getPosts':           return getPosts();
      case 'getUser':            return getUserByPhone(e.parameter.phone);
      case 'checkPaymentStatus': return checkPaymentStatus(e.parameter);
      case 'getBoostPrice':      return jsonResponse({ok:true, price:CFG.BOOST_PRICE, days:CFG.BOOST_DAYS_FEATURED});
      case 'ping':               return jsonResponse({ok:true, msg:'NHPHCM API v3.0', ts:new Date().toLocaleString('vi-VN')});
      default:                   return jsonResponse({ok:false, msg:'Unknown action: '+action});
    }
  } catch(err) { return jsonResponse({ok:false, msg:err.message}); }
}

// ============================================================
// SEPAY WEBHOOK
// ============================================================
function handleSePay(data) {
  const amount  = parseInt(data.transferAmount || data.amount || 0);
  const content = (data.description || data.memo || '').toUpperCase();
  const txId    = data.referenceCode || data.transactionId || ('TX_' + Date.now());
  const bank    = data.gateway || data.bankAbbreviation || 'SePay';
  const today   = new Date().toLocaleDateString('vi-VN');

  writeLog('PAYMENT_IN', bank + ': ' + amount + 'd | ' + content, 'PROCESSING');

  if (!content.includes(CFG.CK_PREFIX)) {
    writeLog('PAYMENT_SKIP', 'No prefix: ' + content, 'SKIP');
    return jsonResponse({ok:false, msg:'Not NHPHCM payment'});
  }

  // Chong duplicate txId
  if (isDuplicateTxId(txId)) {
    writeLog('PAYMENT_DUP', 'Duplicate txId: ' + txId, 'SKIP');
    return jsonResponse({ok:false, msg:'Duplicate transaction'});
  }
  saveTxId(txId);

  const phoneMatch = content.match(/([0-9]{10})/);
  const phone = phoneMatch ? phoneMatch[1] : null;

  if (!phone) {
    sendEmailAdmin('Can xu huong thu cong - ' + amount + 'd',
      'Nhan CK ' + amount + 'd tu ' + bank + '\nNoi dung: ' + content + '\nMa GD: ' + txId);
    return jsonResponse({ok:true, msg:'Recorded - manual processing needed'});
  }

  // Kiem tra boost payment
  if (amount === CFG.BOOST_PRICE && content.includes('BOOST')) {
    return handleBoostPayment(phone, content, txId, amount, bank);
  }

  // Xac dinh goi theo so tien
  let planKey = null;
  for (const [key, price] of Object.entries(CFG.PLAN_PRICES)) {
    if (amount === price) { planKey = key; break; }
  }

  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const usersSheet = ss.getSheetByName(CFG.SHEET_USERS);
  const rows = usersSheet.getDataRange().getValues();
  let userRow = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === phone) { userRow = i; break; }
  }

  if (planKey) {
    const planName = CFG.PLAN_NAMES[planKey] || planKey;
    let newExp = addDays(today, CFG.PLAN_DAYS[planKey]);

    // Tu gia han: neu dang dung goi nay va chua het han -> cong them tu ngay cu
    if (userRow >= 0) {
      const curPlan = rows[userRow][3] || 'free';
      const curExp  = rows[userRow][5] || '';
      if (curPlan === planKey && curExp) {
        try {
          const p = curExp.split('/');
          const curDate = new Date(parseInt(p[2]), parseInt(p[1])-1, parseInt(p[0]));
          if (curDate > new Date()) {
            newExp = addDaysFromDate(curDate, CFG.PLAN_DAYS[planKey]);
          }
        } catch(de) {}
      }
      usersSheet.getRange(userRow+1, 4).setValue(planKey);
      usersSheet.getRange(userRow+1, 5).setValue(today);
      usersSheet.getRange(userRow+1, 6).setValue(newExp);
      usersSheet.getRange(userRow+1, 7).setValue((parseFloat(rows[userRow][6])||0) + amount);
      usersSheet.getRange(userRow+1, 9).setValue('active');
    } else {
      usersSheet.appendRow([phone,'','',planKey,today,newExp,amount,0,'active','',0,'']);
      writeLog('USER_AUTO_CREATED', 'SDT: '+phone+' via payment', 'OK');
    }

    writePayment(txId, bank, amount, content, phone, planKey, 'CONFIRMED', today);
    writeLog('PLAN_UPGRADED', 'SDT: '+phone+' -> '+planKey, 'OK');

    const isRenew = userRow >= 0 && (rows[userRow][3]||'') === planKey;
    sendEmailAdmin('Thanh toan thanh cong - ' + (userRow>=0?rows[userRow][1]:phone) + ' [' + planName + ']',
      'SDT: '+phone+'\nSo tien: '+amount.toLocaleString()+'d\nGoi: '+planName+'\nHan: '+(isRenew?'Gia han den ':'Moi den ')+newExp);

    return jsonResponse({ok:true, msg:'Payment confirmed', plan:planKey, expiry:newExp, phone:phone, isRenew:isRenew});
  } else {
    writePayment(txId, bank, amount, content, phone, 'UNKNOWN', 'PENDING', today);
    sendEmailAdmin('Thanh toan - so tien khong khop: '+amount+'d',
      'SDT: '+phone+'\nSo tien: '+amount+'d\nNoi dung: '+content+'\nCac goi: verified=99k, trusted=199k, partner=399k, boost=29k');
    return jsonResponse({ok:true, msg:'Payment recorded - amount does not match any plan', amount:amount});
  }
}

function handleBoostPayment(phone, content, txId, amount, bank) {
  const postMatch = content.match(/POST([A-Z0-9]+)/);
  const postId = postMatch ? postMatch[1] : null;
  if (!postId) {
    writeLog('BOOST_NO_ID','SDT: '+phone+' boost but no postId: '+content,'PENDING');
    sendEmailAdmin('Boost payment - can xu ly thu cong','SDT: '+phone+'\nNoi dung: '+content+'\nSo tien: '+amount+'d');
    return jsonResponse({ok:true, msg:'Boost payment recorded - manual processing'});
  }
  return boostPostById(postId, phone, txId);
}

// ============================================================
// checkPaymentStatus - Frontend poll xac nhan thanh toan
// ============================================================
function checkPaymentStatus(params) {
  const phone  = params.phone || '';
  const amount = parseInt(params.amount || 0);
  if (!phone) return jsonResponse({ok:false, msg:'Missing phone'});

  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const paySheet = ss.getSheetByName(CFG.SHEET_PAYMENTS);
  const rows = paySheet.getDataRange().getValues();

  for (let i = rows.length-1; i >= 1; i--) {
    const rowPhone  = String(rows[i][4]||'');
    const rowAmount = parseInt(rows[i][2]||0);
    const rowStatus = rows[i][6]||'';
    if (rowPhone === phone && rowStatus === 'CONFIRMED') {
      if (amount > 0 && rowAmount !== amount) continue;
      const uSheet = ss.getSheetByName(CFG.SHEET_USERS);
      const urows = uSheet.getDataRange().getValues();
      let expiry = '', plan = '', boostCount = 0;
      for (let j=1; j<urows.length; j++) {
        if (urows[j][0] === phone) { expiry=urows[j][5]; plan=urows[j][3]; boostCount=parseInt(urows[j][10]||0); break; }
      }
      return jsonResponse({ok:true, status:'confirmed', plan:plan, expiry:expiry, amount:rowAmount, boostCount:boostCount});
    }
  }
  return jsonResponse({ok:true, status:'pending', msg:'Payment not yet confirmed'});
}

// ============================================================
// boostPost - Day tin (chon bai cu the)
// ============================================================
function boostPost(data) {
  const postId = data.postId;
  const phone  = data.phone;
  if (!postId || !phone) return jsonResponse({ok:false, msg:'Missing postId or phone'});

  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const uSheet = ss.getSheetByName(CFG.SHEET_USERS);
  const urows = uSheet.getDataRange().getValues();
  let userRow = -1;
  for (let i=1; i<urows.length; i++) {
    if (urows[i][0]===phone) { userRow=i; break; }
  }
  if (userRow<0) return jsonResponse({ok:false, msg:'User not found'});

  const plan = urows[userRow][3]||'free';
  if (plan==='free') return jsonResponse({ok:false, msg:'Goi Free khong ho tro day tin. Vui long nang cap goi Verified tro len.'});

  const limit = CFG.BOOST_LIMITS[plan]||0;
  const currentMonth = new Date().toISOString().substring(0,7);
  const boostMonth   = String(urows[userRow][9]||'');
  const usedBoosts   = boostMonth===currentMonth ? parseInt(urows[userRow][10]||0) : 0;

  if (usedBoosts >= limit) {
    return jsonResponse({ok:false, msg:'Da het luot day tin thang nay ('+usedBoosts+'/'+limit+'). Lien he dau thang sau.', remaining:0});
  }

  const result = boostPostById(postId, phone, 'PLAN_BOOST');
  return result;
}

function boostPostById(postId, phone, txId) {
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const pSheet = ss.getSheetByName(CFG.SHEET_POSTS);
  const rows = pSheet.getDataRange().getValues();
  let postRow = -1;
  for (let i=1; i<rows.length; i++) {
    if (String(rows[i][0])===String(postId)) { postRow=i; break; }
  }
  if (postRow<0) return jsonResponse({ok:false, msg:'Post not found: '+postId});

  const boostExpiry = addDays(new Date().toLocaleDateString('vi-VN'), CFG.BOOST_DAYS_FEATURED);
  pSheet.getRange(postRow+1, 13).setValue(boostExpiry);
  pSheet.getRange(postRow+1, 14).setValue('boosted');

  const uSheet = ss.getSheetByName(CFG.SHEET_USERS);
  const urows = uSheet.getDataRange().getValues();
  for (let i=1; i<urows.length; i++) {
    if (urows[i][0]===phone) {
      const curMonth = new Date().toISOString().substring(0,7);
      const oldMonth = String(urows[i][9]||'');
      const oldCount = oldMonth===curMonth ? parseInt(urows[i][10]||0) : 0;
      uSheet.getRange(i+1,10).setValue(curMonth);
      uSheet.getRange(i+1,11).setValue(oldCount+1);
      const limit = CFG.BOOST_LIMITS[urows[i][3]||'free']||0;
      uSheet.getRange(i+1,12).setValue(oldCount+1 >= limit ? 0 : limit-(oldCount+1));
      break;
    }
  }

  writeLog('BOOST','PostID: '+postId+' by '+phone+' txId: '+txId,'OK');
  return jsonResponse({ok:true, msg:'Post boosted! '+CFG.BOOST_DAYS_FEATURED+' ngay featured.', postId:postId, boostExpiry:boostExpiry});
}

// ============================================================
// Chong duplicate txId
// ============================================================
function isDuplicateTxId(txId) {
  try {
    const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
    const sheet = ss.getSheetByName(CFG.SHEET_TXIDS);
    if (!sheet) return false;
    const rows = sheet.getDataRange().getValues();
    for (let i=1; i<rows.length; i++) {
      if (String(rows[i][0])===String(txId)) return true;
    }
    return false;
  } catch(e) { return false; }
}

function saveTxId(txId) {
  try {
    const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
    let sheet = ss.getSheetByName(CFG.SHEET_TXIDS);
    if (!sheet) { sheet=ss.insertSheet(CFG.SHEET_TXIDS); sheet.appendRow(['TxId','Timestamp']); }
    sheet.appendRow([txId, new Date().toLocaleString('vi-VN')]);
  } catch(e) { writeLog('TXID_SAVE_ERR',e.message,'FAIL'); }
}

// ============================================================
// Tinh ngay
// ============================================================
function addDays(dateStr, days) {
  try {
    const p = dateStr.split('/');
    const d = new Date(parseInt(p[2]), parseInt(p[1])-1, parseInt(p[0]));
    d.setDate(d.getDate()+days);
    return d.toLocaleDateString('vi-VN');
  } catch(e) {
    const d = new Date();
    d.setDate(d.getDate()+days);
    return d.toLocaleDateString('vi-VN');
  }
}

function addDaysFromDate(dateObj, days) {
  const d = new Date(dateObj);
  d.setDate(d.getDate()+days);
  return d.toLocaleDateString('vi-VN');
}

// ============================================================
// USER MANAGEMENT
// ============================================================
function addUser(data) {
  try {
    const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
    const sheet = ss.getSheetByName(CFG.SHEET_USERS);
    const today = new Date().toLocaleDateString('vi-VN');
    sheet.appendRow([data.phone,data.name,data.email||'','free',today,'',0,0,'active','',0,0,data.role||'Chu nha']);
    writeLog('USER_ADD', data.name+'|'+data.phone, 'OK');
    sendEmailAdmin('Thanh vien moi dang ky - '+data.name,
      'Ten: '+data.name+'\nSDT: '+data.phone+'\nEmail: '+(data.email||'chua co')+'\nVai tro: '+(data.role||'Chu nha')+'\nNgay: '+today);
    return jsonResponse({ok:true, user:{phone:data.phone,name:data.name,email:data.email}});
  } catch(e) {
    writeLog('USER_ADD_ERR',e.message,'FAIL');
    return jsonResponse({ok:false, msg:e.message});
  }
}

function getUsers() {
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const users = ss.getSheetByName(CFG.SHEET_USERS).getDataRange().getValues().slice(1).map(r => ({
    phone:r[0], name:r[1], email:r[2], plan:r[3], joined:r[4], expiry:r[5],
    total:r[6], posts:r[7], status:r[8], boostMonth:r[9], boostCount:r[10], boostRemaining:r[11], role:r[12]
  }));
  return jsonResponse({ok:true, users});
}

function getUserByPhone(phone) {
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const rows = ss.getSheetByName(CFG.SHEET_USERS).getDataRange().getValues().slice(1);
  const u = rows.find(r => r[0]===phone);
  if (!u) return jsonResponse({ok:false, msg:'Not found'});
  return jsonResponse({ok:true, user:{
    phone:u[0],name:u[1],email:u[2],plan:u[3],joined:u[4],expiry:u[5],
    total:u[6],posts:u[7],status:u[8],boostMonth:u[9],boostCount:u[10],boostRemaining:u[11],role:u[12]
  }});
}

function updatePlan(data) {
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sheet = ss.getSheetByName(CFG.SHEET_USERS);
  const rows = sheet.getDataRange().getValues();
  for (let i=1; i<rows.length; i++) {
    if (rows[i][0]===data.phone) {
      sheet.getRange(i+1,4).setValue(data.plan);
      if (data.expiry) sheet.getRange(i+1,6).setValue(data.expiry);
      writeLog('PLAN_UPDATE', data.phone+' -> '+data.plan, 'OK');
      return jsonResponse({ok:true});
    }
  }
  return jsonResponse({ok:false, msg:'User not found'});
}

function adminResetPass(data) {
  if (data.adminKey !== CFG.ADMIN_PHONE) return jsonResponse({ok:false, msg:'Unauthorized'});
  const newPass = Math.random().toString(36).substring(2,8).toUpperCase();
  sendEmailAdmin('Admin Reset Mat Khau - '+data.phone, 'SDT: '+data.phone+'\nMat khau moi: '+newPass);
  writeLog('PASS_RESET', data.phone, 'OK');
  return jsonResponse({ok:true, newPass});
}

// ============================================================
// POST MANAGEMENT
// ============================================================
function addPost(data) {
  try {
    const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
    const sheet = ss.getSheetByName(CFG.SHEET_POSTS);
    const postId = 'POST'+Date.now();
    const today = new Date().toLocaleDateString('vi-VN');
    sheet.appendRow([postId,data.name||'',data.phone||'',data.company||'',data.price||'',
      data.area||'',data.desc||'',(data.imgs||[]).join(','),today,data.status||'public',0,
      data.type||'nguoi so huu','','']);
    writeLog('POST_ADD',(data.company||'')+'|'+(data.phone||''),'OK');
    return jsonResponse({ok:true, postId:postId, ngayDang:today});
  } catch(e) { return jsonResponse({ok:false, msg:e.message}); }
}

function getPosts() {
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);
  const posts = ss.getSheetByName(CFG.SHEET_POSTS).getDataRange().getValues().slice(1).map(r => ({
    id:r[0],name:r[1],phone:r[2],company:r[3],price:r[4],area:r[5],desc:r[6],imgs:r[7],
    date:r[8],status:r[9],views:r[10],type:r[11],boostExpiry:r[12],boostStatus:r[13]
  }));
  return jsonResponse({ok:true, posts});
}

// ============================================================
// SETUP SHEET - Chay 1 lan
// ============================================================
function setupSheet() {
  const ss = SpreadsheetApp.openById(CFG.SHEET_ID);

  let us = ss.getSheetByName(CFG.SHEET_USERS)||ss.insertSheet(CFG.SHEET_USERS);
  us.getRange(1,1,1,13).setValues([['Phone','Name','Email','Plan','JoinDate','Expiry','TotalPaid','Posts','Status','BoostMonth','BoostUsed','BoostRemaining','Role']]);

  let ps = ss.getSheetByName(CFG.SHEET_POSTS)||ss.insertSheet(CFG.SHEET_POSTS);
  ps.getRange(1,1,1,14).setValues([['PostId','Name','Phone','Company','Price','Area','Desc','Imgs','Date','Status','Views','Type','BoostExpiry','BoostStatus']]);

  let pays = ss.getSheetByName(CFG.SHEET_PAYMENTS)||ss.insertSheet(CFG.SHEET_PAYMENTS);
  pays.getRange(1,1,1,8).setValues([['Date','Bank','Amount','Content','Phone','Plan','Status','TxId']]);

  let log = ss.getSheetByName(CFG.SHEET_LOG)||ss.insertSheet(CFG.SHEET_LOG);
  log.getRange(1,1,1,4).setValues([['Timestamp','Event','Detail','Result']]);

  let tx = ss.getSheetByName(CFG.SHEET_TXIDS)||ss.insertSheet(CFG.SHEET_TXIDS);
  tx.getRange(1,1,1,2).setValues([['TxId','Timestamp']]);

  SpreadsheetApp.getUi().alert('Thiet lap xong! 5 sheets: Users, Posts, Payments, Log, ProcessedTxIds\n\nTiep theo:\n1. Deploy > New deployment > Web app\n2. Execute as: Me | Access: Anyone\n3. Copy URL -> cap nhat GAS_URL trong index.html\n4. Cai SePay webhook voi URL nay');
}

// ============================================================
// TIEN ICH
// ============================================================
function sendEmailAdmin(subject, body) {
  try {
    MailApp.sendEmail({to:CFG.ADMIN_EMAIL, subject:'[NHPHCM] '+subject, body:body+'\n\n---\nNguon Nha Pho HCM\n'+new Date().toLocaleString('vi-VN')});
  } catch(e) { writeLog('EMAIL_ERR',e.message,'FAIL'); }
}

function writePayment(txId, bank, amount, content, phone, plan, status, date) {
  try {
    SpreadsheetApp.openById(CFG.SHEET_ID).getSheetByName(CFG.SHEET_PAYMENTS).appendRow([date,bank,amount,content,phone,plan,status,txId]);
  } catch(e) { writeLog('writePayment err: '+e.message,'','FAIL'); }
}

function writeLog(event, detail, result) {
  try {
    SpreadsheetApp.openById(CFG.SHEET_ID).getSheetByName(CFG.SHEET_LOG).appendRow([new Date().toLocaleString('vi-VN'),event,detail,result||'']);
  } catch(e) { Logger.log('writeLog err: '+e.message); }
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
