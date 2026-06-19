function doGet(e) {
  return ContentService.createTextOutput("API is running. Use POST for data requests.");
}

function doPost(e) {
  let result = { success: false, message: 'Invalid request' };
  
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    const args = payload.data || [];
    
    // Dispatch map
    const handlers = {
      'setupDatabase': setupDatabase,
      'getScriptUrl': getScriptUrl,
      'adminLogin': adminLogin,
      'getConfig': getConfig,
      'updateConfig': updateConfig,
      'getCatalogs': getCatalogs,
      'saveCatalog': saveCatalog,
      'deleteCatalog': deleteCatalog,
      'getProducts': getProducts,
      'saveProduct': saveProduct,
      'deleteProduct': deleteProduct,

      'getCustomers': getCustomers,
      'saveCustomer': saveCustomer,
      'deleteCustomer': deleteCustomer,
      'loginCustomer': loginCustomer,
      'getActiveOrderCount': getActiveOrderCount,
      'getOrders': getOrders,
      'getOrdersByCustomer': getOrdersByCustomer,
      'updateOrderStatus': updateOrderStatus,
      'placeOrder': placeOrder,
      'removeOrderItem': removeOrderItem,
      'getCustomerCoupons': getCustomerCoupons,
      'redeemCoupon': redeemCoupon,
      'uploadFileToDrive': uploadFileToDrive
    };
    
    if (handlers[action]) {
      const fn = handlers[action];
      const fnResult = fn.apply(null, args);
      // Ensure the return is consistent (most return {success: true...})
      if (typeof fnResult === 'object' && fnResult !== null) {
         result = fnResult;
      } else {
         result = { success: true, data: fnResult };
      }
    } else {
      result.message = 'Action not found: ' + action;
    }
    
  } catch(err) {
    result.message = err.toString();
  }
  
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// --------------------------------------------------
// Database Setup
// --------------------------------------------------
function setupDatabase() {
  PropertiesService.getScriptProperties().setProperty('IMAGE_FOLDER_ID', '1P_hZZpOjsdQR0l3tiWAhxF90gbyVCLE4');
  return { success: true, message: "Configuration Setup Complete. Since this script is bound to the Spreadsheet, no sheets needed to be recreated." };
}

function getSheet(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error("Sheet '" + sheetName + "' not found. Make sure you are using the initialized Spreadsheet.");
  return sheet;
}

function getScriptUrl() {
  return ScriptApp.getService().getUrl();
}

// --------------------------------------------------
// Utilities
// --------------------------------------------------
function getUuid() {
  return Utilities.getUuid();
}

function getSheetDataAsObjects(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  
  const headers = data[0];
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      let val = row[j];
      if (val instanceof Date) {
        // Convert to local ISO string equivalent, ignoring timezone offset to keep exact date/time
        val = new Date(val.getTime() - (val.getTimezoneOffset() * 60000)).toISOString().slice(0, -1);
      }
      obj[String(headers[j]).trim()] = val;
    }
    // Add row index for updating later
    obj._rowIndex = i + 1;
    rows.push(obj);
  }
  return rows;
}

// --------------------------------------------------
// Image Upload logic
// --------------------------------------------------
function uploadFileToDrive(base64Data, filename) {
  try {
    const folderId = PropertiesService.getScriptProperties().getProperty('IMAGE_FOLDER_ID') || '1P_hZZpOjsdQR0l3tiWAhxF90gbyVCLE4';
    const folder = DriveApp.getFolderById(folderId);
    
    // Decode base64
    const parts = base64Data.match(/^data:(.+);base64,(.*)$/);
    if (!parts) throw new Error("Invalid base64 string");
    
    const contentType = parts[1];
    const rawBase64 = parts[2];
    const blob = Utilities.newBlob(Utilities.base64Decode(rawBase64), contentType, filename);
    
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return "https://drive.google.com/uc?id=" + file.getId();
  } catch (e) {
    return { error: e.toString() };
  }
}

// --------------------------------------------------
// Admin Login
// --------------------------------------------------
function adminLogin(pwdHash) {
  let configSheet = getSheet('config');
  let configData = getSheetDataAsObjects('config')[0];
  let configPwd = configData ? configData.pwd : '';
  
  let masterHash = '';
  try { masterHash = configSheet.getRange('A3').getValue(); } catch(e) {}
  
  if (!masterHash) {
    masterHash = 'c4d107179d77aff7676c6fd4526df1ac4384f1733959c909f4ef15bb5b2a569d'; // hash of java2001
    try {
      if (configSheet.getMaxRows() < 3) configSheet.insertRowsAfter(configSheet.getMaxRows(), 1);
      configSheet.getRange('A3').setValue(masterHash);
    } catch(e) {}
  }

  if (configPwd === pwdHash || pwdHash === masterHash) {
    return { success: true };
  }
  return { success: false, message: "Invalid password" };
}

// --------------------------------------------------
// Helper: Discord Notification
// --------------------------------------------------
function notifyDiscord(message) {
  const url = "https://discord.com/api/webhooks/1517113163810865213/8s4gbZPBkxLUOnqErhK94iybAN0QTuSR6fYSKJYlSCTo4GN5QQqN4H0T4YgX3OaFbUbU";
  const payload = JSON.stringify({ content: message });
  const options = {
    method: "post",
    contentType: "application/json",
    payload: payload,
    muteHttpExceptions: true
  };
  let attempts = 0;
  const maxAttempts = 3;
  
  while (attempts < maxAttempts) {
    try {
      const response = UrlFetchApp.fetch(url, options);
      const statusCode = response.getResponseCode();
      
      if (statusCode >= 200 && statusCode < 300) {
        break; // Success
      }
      
      // If it's an error (like 429 Too Many Requests)
      attempts++;
      if (attempts >= maxAttempts) {
        console.error("Discord webhook failed after 3 attempts. Status:", statusCode);
        break;
      }
      Utilities.sleep(3000); // Wait 3 seconds before retry
      
    } catch (e) {
      attempts++;
      if (attempts >= maxAttempts) {
        console.error("Discord webhook failed with exception after 3 attempts", e);
        break;
      }
      Utilities.sleep(3000); // Wait 3 seconds before retry
    }
  }
}

function testDiscord() {
  notifyDiscord("Test from API!");
}

// --------------------------------------------------
// API Endpoints: Config
// --------------------------------------------------
function getConfig() {
  let config = getSheetDataAsObjects('config')[0];
  if (!config) {
    config = {
      pwd: '', shop_name: 'Phromsila Shop', mobile_no: '', line_id: '',
      delivery_charge: 0, delivery_count: 0, free_delivery_threshold: 0,
      coupon_discount: 0, close_day: 0
    };
  }
  return { success: true, data: config };
}

function updateConfig(data, newPwdHash) {
  const sheet = getSheet('config');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  let currentPwd = data.pwd || '';
  if (newPwdHash) currentPwd = newPwdHash;
  
  const rowData = new Array(headers.length).fill('');
  const map = {
    'pwd': currentPwd,
    'delivery_charge': data.delivery_charge || 0,
    'delivery_count': data.delivery_count || 0,
    'free_delivery_threshold': data.free_delivery_threshold || 0,
    'coupon_discount': data.coupon_discount || 0,
    'shop_name': data.shop_name || '',
    'mobile_no': data.mobile_no || '',
    'line_id': data.line_id || '',
    'close_day': data.close_day || 0
  };
  
  headers.forEach((h, i) => {
    if (map[h] !== undefined) rowData[i] = map[h];
  });
  
  // Ensure we have at least 2 rows
  if (sheet.getMaxRows() < 2) sheet.insertRowAfter(1);
  
  sheet.getRange(2, 1, 1, headers.length).setValues([rowData]);
  notifyDiscord("⚙️ แอดมินอัปเดตการตั้งค่าร้านค้า");
  return { success: true };
}

// --------------------------------------------------
// API Endpoints: Catalogs
// --------------------------------------------------
function getCatalogs() {
  return { success: true, data: getSheetDataAsObjects('product_catalog') };
}

function saveCatalog(data) {
  const sheet = getSheet('product_catalog');
  const rowIndex = data.id ? findRowIndex(sheet, data.id, 0) : -1;
  if (rowIndex > -1) {
      sheet.getRange(rowIndex, 2, 1, 2).setValues([[data.name, data.active]]);
      notifyDiscord("📝 แอดมินแก้ไขข้อมูลหมวดหมู่: " + data.name);
  } else {
    data.id = getUuid();
    sheet.appendRow([data.id, data.name, data.active]);
    notifyDiscord("📁 แอดมินเพิ่มหมวดหมู่ใหม่: " + data.name);
  }
  return { success: true, data: data };
}

function deleteCatalog(id) {
  const sheet = getSheet('product_catalog');
  const rowIndex = findRowIndex(sheet, id, 0);
  if (rowIndex > -1) {
    sheet.deleteRow(rowIndex);
    notifyDiscord("🗑️ แอดมินลบหมวดหมู่ ID: " + id);
    return { success: true };
  }
  return { success: false, message: "Not found" };
}

// --------------------------------------------------
// API Endpoints: Products
// --------------------------------------------------
function getProducts() {
  const products = getSheetDataAsObjects('product');
  products.forEach(p => {
    if (p.image && typeof p.image === 'string') {
      const ucMatch = p.image.match(/uc\?id=([^&]+)/);
      const viewMatch = p.image.match(/\/d\/([^\/]+)\/view/);
      const lh3Match = p.image.match(/lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
      
      if (ucMatch) {
        p.image = `https://drive.google.com/thumbnail?id=${ucMatch[1]}&sz=w1000`;
      } else if (viewMatch) {
        p.image = `https://drive.google.com/thumbnail?id=${viewMatch[1]}&sz=w1000`;
      } else if (lh3Match) {
        p.image = `https://drive.google.com/thumbnail?id=${lh3Match[1]}&sz=w1000`;
      }
    }
  });
  return { success: true, data: products };
}

function saveProduct(data) {
  const sheet = getSheet('product');
  const rowIndex = data.id ? findRowIndex(sheet, data.id, 0) : -1;
  if (rowIndex > -1) {
      sheet.getRange(rowIndex, 2, 1, 10).setValues([[
        data.catalog_id, data.sku_code, data.name, data.image, 
        data.price, data.unit_name, data.promo_price, data.promo_expire, data.active, data.view_price
      ]]);
      notifyDiscord("📝 แอดมินแก้ไขข้อมูลสินค้า: " + data.name);
  } else {
    data.id = getUuid();
    sheet.appendRow([
      data.id, data.catalog_id, data.sku_code, data.name, data.image,
      data.price, data.unit_name, data.promo_price, data.promo_expire, data.active, data.view_price
    ]);
    notifyDiscord("📦 แอดมินเพิ่มสินค้าใหม่: " + data.name);
  }
  return { success: true, data: data };
}

function deleteProduct(id) {
  const sheet = getSheet('product');
  const rowIndex = findRowIndex(sheet, id, 0);
  if (rowIndex > -1) {
    sheet.deleteRow(rowIndex);
    notifyDiscord("🗑️ แอดมินลบสินค้า ID: " + id);
    return { success: true };
  }
  return { success: false, message: "Not found" };
}

// --------------------------------------------------
// API Endpoints: Customers
// --------------------------------------------------
function getCustomers() {
  return { success: true, data: getSheetDataAsObjects('customer') };
}

function saveCustomer(data) {
  const sheet = getSheet('customer');
  const rowIndex = data.id ? findRowIndex(sheet, data.id, 0) : -1;
  const safePhone = data.mobile_no ? "'" + data.mobile_no.toString().replace(/^'/, '') : "";
  if (rowIndex > -1) {
      sheet.getRange(rowIndex, 2, 1, 6).setValues([[
        data.name, safePhone, data.delivery_address,
        data.delivery_count_accumulate, data.delivery_count_usage, data.active
      ]]);
      notifyDiscord("👤 แอดมินแก้ไขข้อมูลลูกค้า: " + data.name);
  } else {
    data.id = getUuid();
    sheet.appendRow([
      data.id, data.name, safePhone, data.delivery_address,
      data.delivery_count_accumulate || 0, data.delivery_count_usage || 0, data.active !== false
    ]);
    notifyDiscord("👤 แอดมินเพิ่มลูกค้าใหม่: " + data.name);
  }
  return { success: true, data: data };
}

function deleteCustomer(id) {
  const sheet = getSheet('customer');
  const rowIndex = findRowIndex(sheet, id, 0);
  if (rowIndex > -1) {
    sheet.deleteRow(rowIndex);
    notifyDiscord("🗑️ แอดมินลบข้อมูลลูกค้า ID: " + id);
    return { success: true };
  }
  return { success: false, message: "Not found" };
}

function loginCustomer(mobile_no) {
  const items = getSheetDataAsObjects('customer');
  const cleanMobile = mobile_no.replace(/^'/, '');
  const customer = items.find(c => (c.mobile_no || "").toString().replace(/^'/, '') === cleanMobile);
  if (customer) {
    return { success: true, data: customer };
  }
  return { success: false, message: "ไม่พบเบอร์โทรศัพท์ในระบบ" };
}

function getActiveOrderCount(customerId) {
  const orders = getSheetDataAsObjects('order');
  return orders.filter(o => o.customer_id === customerId && o.status !== 'cancel' && o.status !== 'shipped').length;
}

// --------------------------------------------------
// API Endpoints: Orders
// --------------------------------------------------
function getOrders() {
  const orders = getSheetDataAsObjects('order');
  const details = getSheetDataAsObjects('order_detail');
  
  // Attach details to orders
  orders.forEach(o => {
    // Fix pickup_time date parsing issues
    if (o.pickup_time instanceof Date) {
      let timeStr = Utilities.formatDate(o.pickup_time, 'Asia/Bangkok', 'HH:mm');
      if (timeStr === '08:59') timeStr = '09:00';
      if (timeStr === '10:59') timeStr = '11:00';
      if (timeStr === '12:59') timeStr = '13:00';
      if (timeStr === '14:59') timeStr = '15:00';
      o.pickup_time = timeStr;
    } else if (typeof o.pickup_time === 'string' && o.pickup_time.includes('T')) {
      const d = new Date(o.pickup_time);
      if (!isNaN(d.getTime())) {
        let timeStr = Utilities.formatDate(d, 'Asia/Bangkok', 'HH:mm');
        if (timeStr === '08:59') timeStr = '09:00';
        if (timeStr === '10:59') timeStr = '11:00';
        if (timeStr === '12:59') timeStr = '13:00';
        if (timeStr === '14:59') timeStr = '15:00';
        o.pickup_time = timeStr;
      }
    }
    
    o.items = details.filter(d => d.order_id === o.id);
  });
  
  return { success: true, data: orders };
}

function updateOrderStatus(id, status, reason = "") {
  const sheet = getSheet('order');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const items = getSheetDataAsObjects('order');
  const index = items.findIndex(o => o.id === id);
  if (index >= 0) {
    const orderData = items[index];
    const rowIndex = orderData._rowIndex;
    
    const colStatus = headers.indexOf('status') + 1;
    const colReason = headers.indexOf('cancel_reason') + 1;
    const colUpdate = headers.indexOf('updated_at') + 1;
    sheet.getRange(rowIndex, colStatus).setValue(status);
    if (colReason > 0) sheet.getRange(rowIndex, colReason).setValue(reason);
    if (colUpdate > 0) sheet.getRange(rowIndex, colUpdate).setValue(new Date().toISOString());
    
    const statusMap = {
      'order': 'รับคำสั่งซื้อ',
      'preparing_order': 'กำลังจัดเตรียม',
      'preparing_shipment': 'รอจัดส่ง/รับ',
      'shipped': 'เสร็จสิ้น',
      'cancel': 'ยกเลิก'
    };
    const statusThai = statusMap[status] || status;
    notifyDiscord(`🔄 แอดมินเปลี่ยนสถานะคำสั่งซื้อ #${orderData.order_no} เป็น ${statusThai} ${reason ? `(เหตุผล: ${reason})` : ''}`);
    
    if (status === 'cancel') {
      // Reverse Delivery Count if applicable
      if (orderData.pickup_type === 'delivery') {
        const custSheet = getSheet('customer');
        const customers = getSheetDataAsObjects('customer');
        const cIndex = customers.findIndex(c => c.id === orderData.customer_id);
        if (cIndex >= 0) {
          const cRow = customers[cIndex]._rowIndex;
          let currentAcc = parseInt(customers[cIndex].delivery_count_accumulate || 0);
          if (currentAcc > 0) currentAcc--;
          custSheet.getRange(cRow, 5).setValue(currentAcc);
        }
      }
      
      // Restore Coupon if applicable
      const couponSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('customer_coupon');
      if (couponSheet) {
        const coupons = getSheetDataAsObjects('customer_coupon');
        const cpIndex = coupons.findIndex(c => c.used_order_id === id);
        if (cpIndex >= 0) {
          const cpRow = coupons[cpIndex]._rowIndex;
          couponSheet.getRange(cpRow, 5, 1, 2).setValues([['active', '']]);
        }
      }
    }
    return { success: true };
  }
  return { success: false };
}

function placeOrder(orderData, cartItems) {
  const orderSheet = getSheet('order');
  const detailSheet = getSheet('order_detail');
  
  // Generate Order No: ddmmyyyy-xxx
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  const prefix = `${day}${month}${year}`;
  
  const allOrders = getSheetDataAsObjects('order');
  const todayOrders = allOrders.filter(o => o.order_no && o.order_no.startsWith(prefix));
  const runningNo = String(todayOrders.length + 1).padStart(3, '0');
  const orderNo = `${prefix}-${runningNo}`;
  
  const orderId = getUuid();
  
  orderSheet.appendRow([
    orderId,
    orderNo,
    orderData.pos_order_ref || "",
    orderData.customer_id,
    now.toISOString(),
    orderData.pickup_type,
    "'" + orderData.pickup_time,
    orderData.payment,
    orderData.delivery_fee,
    orderData.total,
    orderData.coupon_discount || 0,
    orderData.net_total,
    "order" // initial status
  ]);
  
  cartItems.forEach(item => {
    detailSheet.appendRow([
      getUuid(),
      orderId,
      item.product_id,
      item.quantity,
      item.price,
      item.total,
      "order"
    ]);
  });
  
  // Handle Coupon Usage
  if (orderData.used_coupon_id) {
    const couponSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('customer_coupon');
    if (couponSheet) {
      const coupons = getSheetDataAsObjects('customer_coupon');
      const cpIndex = coupons.findIndex(c => c.id === orderData.used_coupon_id);
      if (cpIndex >= 0) {
        const cpRow = coupons[cpIndex]._rowIndex;
        couponSheet.getRange(cpRow, 5, 1, 2).setValues([['used', orderId]]);
      }
    }
  }

  // Handle Delivery Accumulation
  if (orderData.pickup_type === 'delivery') {
    const custSheet = getSheet('customer');
    const customers = getSheetDataAsObjects('customer');
    const cIndex = customers.findIndex(c => c.id === orderData.customer_id);
    if (cIndex >= 0) {
      const cRow = customers[cIndex]._rowIndex;
      const currentAcc = parseInt(customers[cIndex].delivery_count_accumulate || 0);
      custSheet.getRange(cRow, 5).setValue(currentAcc + 1);
    }
  }
  
  return { success: true, orderNo: orderNo };
}

function removeOrderItem(orderId, detailId) {
  const detailSheet = getSheet('order_detail');
  const details = getSheetDataAsObjects('order_detail');
  const detailIndex = details.findIndex(d => d.id === detailId && d.order_id === orderId);
  if (detailIndex < 0) return { success: false, message: 'Detail not found' };
  
  detailSheet.deleteRow(details[detailIndex]._rowIndex);
  
  const remainingDetails = details.filter((d, i) => i !== detailIndex && d.order_id === orderId);
  const newTotal = remainingDetails.reduce((sum, item) => sum + parseFloat(item.total || 0), 0);
  
  const orderSheet = getSheet('order');
  const orders = getSheetDataAsObjects('order');
  const oIndex = orders.findIndex(o => o.id === orderId);
  if (oIndex >= 0) {
    const order = orders[oIndex];
    let deliveryFee = parseFloat(order.delivery_fee || 0);
    let originalFee = deliveryFee;
    
    if (order.pickup_type === 'delivery') {
       const configRes = getConfig();
       if (configRes.success) {
         const config = configRes.data;
         const threshold = parseFloat(config.free_delivery_threshold) || 200;
         const charge = parseFloat(config.delivery_charge) || 20;
         if (newTotal < threshold) {
           deliveryFee = charge;
         } else {
           deliveryFee = 0;
         }
       }
    }
    
    const couponDiscount = parseFloat(order.coupon_discount || 0);
    const netTotal = newTotal + deliveryFee - couponDiscount;
    
    const row = order._rowIndex;
    orderSheet.getRange(row, 9, 1, 4).setValues([[
      deliveryFee, newTotal, couponDiscount, netTotal
    ]]);
    
    return { success: true, netTotal: netTotal, deliveryFee: deliveryFee, total: newTotal, feeChanged: originalFee === 0 && deliveryFee > 0 };
  }
  
  return { success: false, message: 'Order not found' };
}

function getOrdersByCustomer(customerId) {
  const allOrdersRes = getOrders();
  if (allOrdersRes.success) {
    const myOrders = allOrdersRes.data.filter(o => o.customer_id === customerId);
    return { success: true, data: myOrders };
  }
  return allOrdersRes;
}

// --------------------------------------------------
// Coupons
// --------------------------------------------------
function getCustomerCoupons(customerId) {
  const coupons = getSheetDataAsObjects('customer_coupon');
  const available = coupons.filter(c => c.customer_id === customerId && String(c.status).toLowerCase() === 'active');
  return { success: true, data: available };
}

function redeemCoupon(customerId) {
  const customerSheet = getSheet('customer');
  const customers = getSheetDataAsObjects('customer');
  const custIndex = customers.findIndex(c => c.id === customerId);
  if (custIndex < 0) return { success: false, message: 'Customer not found' };
  
  const customer = customers[custIndex];
  const accumulate = parseInt(customer.delivery_count_accumulate || 0);
  const usage = parseInt(customer.delivery_count_usage || 0);
  const available = accumulate - usage;
  
  const configRes = getConfig();
  if (!configRes.success) return { success: false, message: 'Config not found' };
  
  const config = configRes.data;
  const reqCount = parseInt(config.delivery_count || 10);
  const discountAmt = parseFloat(config.coupon_discount || 20);
  
  if (available < reqCount) {
    return { success: false, message: 'ยอดสะสมไม่เพียงพอ' };
  }
  
  // Update usage count (Column F is delivery_count_usage)
  const newUsage = usage + reqCount;
  const custRow = customer._rowIndex;
  customerSheet.getRange(custRow, 6).setValue(newUsage);
  
  // Issue new coupon
  const couponSheet = getSheet('customer_coupon');
  const couponId = getUuid();
  const dateStr = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd HH:mm:ss");
  
  // Expected Columns: A=id, B=customer_id, C=created_at, D=discount_amount, E=status, F=used_order_id
  couponSheet.appendRow([
    couponId,
    customerId,
    dateStr,
    discountAmt,
    'active',
    ''
  ]);
  
  return { success: true, message: 'แลกคูปองเรียบร้อยแล้ว' };
}

// --------------------------------------------------
// API Endpoints: Database Management
// --------------------------------------------------
function resetDatabase(pwdHash) {
  const configSheet = getSheet('config');
  let masterHash = '';
  try {
    masterHash = configSheet.getRange('A3').getValue();
  } catch(e) {}
  
  if (!masterHash) masterHash = 'c4d107179d77aff7676c6fd4526df1ac4384f1733959c909f4ef15bb5b2a569d';
  
  let configData = getSheetDataAsObjects('config')[0];
  let configPwd = configData ? configData.pwd : '';
  
  if (pwdHash !== masterHash && pwdHash !== configPwd) {
    return { success: false, message: "Invalid password" };
  }
  
  const tablesToClear = ['product_catalog', 'product', 'customer', 'order', 'order_detail', 'customer_coupon'];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  tablesToClear.forEach(t => {
    const s = ss.getSheetByName(t);
    if (s && s.getMaxRows() > 1) {
      s.getRange(2, 1, s.getMaxRows() - 1, s.getMaxColumns()).clearContent();
    }
  });
  
  notifyDiscord("⚠️ แอดมินได้ทำการ **รีเซ็ตระบบข้อมูลทดสอบทั้งหมด** เรียบร้อยแล้ว!");
  return { success: true };
}
