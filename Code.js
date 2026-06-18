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
      'removeOrderItem': removeOrderItem
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
  const sheet = getSheet(sheetName);
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
      obj[headers[j]] = val;
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
    return "https://lh3.googleusercontent.com/d/" + file.getId();
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
  if (data.id) {
    // Update
    const items = getSheetDataAsObjects('product_catalog');
    const index = items.findIndex(c => c.id === data.id);
    if (index >= 0) {
      const rowIndex = items[index]._rowIndex;
      sheet.getRange(rowIndex, 2, 1, 2).setValues([[data.name, data.active]]);
    }
  } else {
    // Insert
    data.id = getUuid();
    sheet.appendRow([data.id, data.name, data.active]);
  }
  return { success: true, data: data };
}

function deleteCatalog(id) {
  const sheet = getSheet('product_catalog');
  const items = getSheetDataAsObjects('product_catalog');
  const index = items.findIndex(c => c.id === id);
  if (index >= 0) {
    sheet.deleteRow(items[index]._rowIndex);
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
      
      if (ucMatch) {
        p.image = `https://drive.google.com/thumbnail?id=${ucMatch[1]}&sz=w1000`;
      } else if (viewMatch) {
        p.image = `https://drive.google.com/thumbnail?id=${viewMatch[1]}&sz=w1000`;
      }
    }
  });
  return { success: true, data: products };
}

function saveProduct(data) {
  const sheet = getSheet('product');
  if (data.id) {
    // Update
    const items = getSheetDataAsObjects('product');
    const index = items.findIndex(p => p.id === data.id);
    if (index >= 0) {
      const rowIndex = items[index]._rowIndex;
      sheet.getRange(rowIndex, 2, 1, 9).setValues([[
        data.catalog_id, data.sku_code, data.name, data.image, 
        data.price, data.unit_name, data.promo_price, data.promo_expire, data.active
      ]]);
    }
  } else {
    // Insert
    data.id = getUuid();
    sheet.appendRow([
      data.id, data.catalog_id, data.sku_code, data.name, data.image,
      data.price, data.unit_name, data.promo_price, data.promo_expire, data.active
    ]);
  }
  return { success: true, data: data };
}

function deleteProduct(id) {
  const sheet = getSheet('product');
  const items = getSheetDataAsObjects('product');
  const index = items.findIndex(p => p.id === id);
  if (index >= 0) {
    sheet.deleteRow(items[index]._rowIndex);
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
  if (data.id) {
    const items = getSheetDataAsObjects('customer');
    const index = items.findIndex(c => c.id === data.id);
    if (index >= 0) {
      const rowIndex = items[index]._rowIndex;
      const safePhone = data.mobile_no ? "'" + data.mobile_no.toString().replace(/^'/, '') : "";
      sheet.getRange(rowIndex, 2, 1, 6).setValues([[
        data.name, safePhone, data.delivery_address,
        data.delivery_count_accumulate, data.delivery_count_usage, data.active
      ]]);
    }
  } else {
    data.id = getUuid();
    const safePhone = data.mobile_no ? "'" + data.mobile_no.toString().replace(/^'/, '') : "";
    sheet.appendRow([
      data.id, data.name, safePhone, data.delivery_address,
      data.delivery_count_accumulate || 0, data.delivery_count_usage || 0, data.active !== false
    ]);
  }
  return { success: true, data: data };
}

function deleteCustomer(id) {
  const sheet = getSheet('customer');
  const items = getSheetDataAsObjects('customer');
  const index = items.findIndex(p => p.id === id);
  if (index >= 0) {
    sheet.deleteRow(items[index]._rowIndex);
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
  const items = getSheetDataAsObjects('order');
  const index = items.findIndex(o => o.id === id);
  if (index >= 0) {
    const row = items[index]._rowIndex;
    // status is in column 13
    sheet.getRange(row, 13).setValue(status);
    if (status === 'cancel' && reason) {
      sheet.getRange(row, 14).setValue(reason);
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
  
  return { success: true, orderNo: orderNo };
}
// fix  
// force push  
// fix ref error  
// fix  
// fix handlers  

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
