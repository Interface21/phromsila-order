let state = {
    customer: null,
    config: null,
    catalogs: [],
    products: [],
    cart: [],
    orders: [],
    coupons: [],
    currentCategory: 'promo',
    searchQuery: ''
  };

  // --- INIT APP ---
  document.addEventListener('DOMContentLoaded', () => {
    const savedCustomer = localStorage.getItem('phromsila_customer');
    if (savedCustomer) {
      try {
        state.customer = JSON.parse(savedCustomer);
      } catch (e) {
        localStorage.removeItem('phromsila_customer');
      }
    }
    updateAuthUI();
    
    // Always load config and data on startup
    if (state.products.length === 0) {
      loadStoreData();
    }
    
    // Always show home view by default
    switchView('view-home');
  });

  function updateAuthUI() {
    if (state.customer) {
      document.getElementById('userNameDisplay').textContent = 'คุณ' + state.customer.name;
      document.getElementById('btnMyOrders').classList.remove('d-none');
      
      const btnRewards = document.getElementById('btnMyRewards');
      if (btnRewards) {
        const reqCount = state.config && state.config.delivery_count !== undefined && state.config.delivery_count !== "" ? parseInt(state.config.delivery_count) : 10;
        const couponValue = state.config && state.config.coupon_discount !== undefined && state.config.coupon_discount !== "" ? parseInt(state.config.coupon_discount) : 20;
        if (reqCount > 0 && couponValue > 0) {
          btnRewards.classList.remove('d-none');
        } else {
          btnRewards.classList.add('d-none');
        }
      }
      
      document.getElementById('btnLogout').classList.remove('d-none');
      document.getElementById('btnLogin').classList.add('d-none');
      
      const bellContainer = document.getElementById('notificationBellContainer');
      if (bellContainer) bellContainer.classList.remove('d-none');
      
      // Load active order count badge
      google.script.run.withSuccessHandler(res => {
        if (!state.customer) return;
        if (!res.success) return;
        const count = res.data;
        const btn = document.getElementById('btnMyOrders');
        const text = document.getElementById('activeOrdersText');
        text.textContent = count + " ";
        if (count > 0) {
          btn.className = "btn btn-warning";
          btn.style.color = "#ffffff";
        } else {
          btn.className = "btn btn-glass";
          btn.style.color = "";
        }
        btn.classList.remove('d-none');
      }).getActiveOrderCount(state.customer.id);
      
      // Refresh customer data silently to pick up DB changes
      google.script.run.withSuccessHandler(cRes => {
        if (cRes.success) {
          state.customer = cRes.data;
          localStorage.setItem('phromsila_customer', JSON.stringify(cRes.data));
        }
      }).loginCustomer(state.customer.mobile_no);
      
      loadCustomerCoupons();
      startNotificationPolling();
    } else {
      document.getElementById('userNameDisplay').textContent = 'คุณลูกค้า';
      document.getElementById('btnMyOrders').classList.add('d-none');
      document.getElementById('btnLogout').classList.add('d-none');
      document.getElementById('btnLogin').classList.remove('d-none');
      
      const bellContainer = document.getElementById('notificationBellContainer');
      if (bellContainer) bellContainer.classList.add('d-none');
      stopNotificationPolling();
    }
  }

  // --- NOTIFICATION SYSTEM ---
  let notificationTimer = null;
  let isPageVisible = true;
  let lastActiveTime = Date.now();
  let currentPollInterval = 30000;
  
  document.addEventListener('visibilitychange', () => {
    isPageVisible = !document.hidden;
    if (isPageVisible && state.customer) {
      lastActiveTime = Date.now();
      checkOrderUpdates();
    }
  });

  ['click', 'touchstart', 'scroll', 'keypress'].forEach(evt => {
    document.addEventListener(evt, () => {
      lastActiveTime = Date.now();
    }, {passive: true});
  });
  
  function startNotificationPolling() {
    stopNotificationPolling();
    renderNotifications();
    checkOrderUpdates();
    scheduleNextPoll();
  }
  
  function scheduleNextPoll() {
    stopNotificationPolling();
    notificationTimer = setTimeout(() => {
      if (!state.customer) return; // Stop if logged out
      
      const idleTime = Date.now() - lastActiveTime;
      const text = document.getElementById('activeOrdersText');
      const activeCount = text ? (parseInt(text.textContent) || 0) : 0;
      
      if (!isPageVisible || idleTime > 5 * 60 * 1000) {
        // Sleep mode: check every 5 minutes just in case
        currentPollInterval = 5 * 60 * 1000;
      } else if (activeCount === 0) {
        // No active orders: check every 3 minutes
        currentPollInterval = 3 * 60 * 1000;
      } else {
        // Active mode: check every 30 seconds
        currentPollInterval = 30000;
      }
      
      if (isPageVisible && idleTime <= 15 * 60 * 1000) {
        checkOrderUpdates();
      }
      
      scheduleNextPoll();
    }, currentPollInterval);
  }
  
  function stopNotificationPolling() {
    if (notificationTimer) clearTimeout(notificationTimer);
    notificationTimer = null;
  }
  
  window.toggleNotifications = function() {
    const dd = document.getElementById('notificationDropdown');
    if (dd) {
      dd.classList.toggle('d-none');
      if (!dd.classList.contains('d-none')) {
        const localData = JSON.parse(localStorage.getItem('phromsila_notif') || '{"notifications":[], "orderStatuses":{}}');
        let changed = false;
        localData.notifications.forEach(n => {
          if (!n.read) { n.read = true; changed = true; }
        });
        if (changed) {
          localStorage.setItem('phromsila_notif', JSON.stringify(localData));
          renderNotifications();
        }
      }
    }
  };

  // Close notifications when clicking outside
  document.addEventListener('click', (e) => {
    const dd = document.getElementById('notificationDropdown');
    const bellBtn = document.querySelector('button[onclick="toggleNotifications()"]');
    if (dd && !dd.classList.contains('d-none')) {
      if (!dd.contains(e.target) && (!bellBtn || !bellBtn.contains(e.target))) {
        dd.classList.add('d-none');
      }
    }
  });
  
  function checkOrderUpdates() {
    if (!state.customer) return;
    google.script.run.withSuccessHandler(res => {
      if (!res.success) return;
      processOrderNotifications(res.data);
    }).getOrdersByCustomer(state.customer.id);
  }
  
  function processOrderNotifications(serverOrders) {
    const localData = JSON.parse(localStorage.getItem('phromsila_notif') || '{"notifications":[], "orderStatuses":{}, "orderTotals":{}}');
    if (!localData.orderTotals) localData.orderTotals = {};
    let hasNew = false;
    
    serverOrders.forEach(o => {
      const oldStatus = localData.orderStatuses[o.id];
      const oldTotal = localData.orderTotals[o.id];
      
      if (oldStatus && oldStatus !== o.status) {
        let title = '';
        if (o.status === 'preparing_order') title = 'กำลังจัดเตรียมสินค้า';
        else if (o.status === 'preparing_shipment') title = 'รอจัดส่ง/รับสินค้า';
        else if (o.status === 'shipped') title = 'จัดส่ง/รับสินค้าเรียบร้อยแล้ว';
        else if (o.status === 'cancel') title = 'คำสั่งซื้อถูกยกเลิก';
        
        if (title) {
          localData.notifications.unshift({
            id: 'notif_' + Date.now() + '_' + Math.random(),
            order_no: o.order_no,
            title: title,
            body: `ออเดอร์ ${o.order_no} เปลี่ยนสถานะเป็น: ${title}`,
            date: new Date().toISOString(),
            read: false
          });
          hasNew = true;
          
          Swal.fire({
            title: 'อัปเดตสถานะ!',
            text: `ออเดอร์ ${o.order_no} เปลี่ยนสถานะเป็น: ${title}`,
            icon: 'info',
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 3000
          });
        }
      }
      
      if (oldTotal && oldTotal !== o.net_total && o.status !== 'shipped' && o.status !== 'cancel' && o.status !== 'completed') {
        const title = 'อัปเดตยอดเงิน';
        const body = `ยอดเงินสุทธิของออเดอร์ ${o.order_no} เปลี่ยนแปลงเป็น ฿${parseFloat(o.net_total).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
        localData.notifications.unshift({
          id: 'notif_' + Date.now() + '_' + Math.random(),
          order_no: o.order_no,
          title: title,
          body: body,
          date: new Date().toISOString(),
          read: false
        });
        hasNew = true;
        
        Swal.fire({
          title: title,
          text: body,
          icon: 'warning',
          toast: true,
          position: 'top-end',
          showConfirmButton: false,
          timer: 4000
        });
      }
      
      localData.orderStatuses[o.id] = o.status;
      localData.orderTotals[o.id] = o.net_total;
    });
    
    const activeCount = serverOrders.filter(o => o.status !== 'cancel' && o.status !== 'shipped' && o.status !== 'completed').length;
    const btn = document.getElementById('btnMyOrders');
    const text = document.getElementById('activeOrdersText');
    if (text) text.textContent = activeCount + " ";
    if (btn) btn.className = activeCount > 0 ? "btn btn-warning" : "btn btn-glass";
    
    if (hasNew || Object.keys(localData.orderStatuses).length > 0) {
      localStorage.setItem('phromsila_notif', JSON.stringify(localData));
      if (hasNew) renderNotifications();
    }
  }
  
  function renderNotifications() {
    const localData = JSON.parse(localStorage.getItem('phromsila_notif') || '{"notifications":[], "orderStatuses":{}}');
    const list = document.getElementById('notificationList');
    const badge = document.getElementById('notificationBadge');
    
    if (!list || !badge) return;
    
    const unreadCount = localData.notifications.filter(n => !n.read).length;
    if (unreadCount > 0) {
      badge.textContent = unreadCount;
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }
    
    if (localData.notifications.length === 0) {
      list.innerHTML = '<div style="text-align: center; color: var(--text-light); font-size: 0.9rem; padding: 10px;">ไม่มีแจ้งเตือนใหม่</div>';
      return;
    }
    
    if (localData.notifications.length > 20) {
      localData.notifications = localData.notifications.slice(0, 20);
      localStorage.setItem('phromsila_notif', JSON.stringify(localData));
    }
    
    let html = '';
    localData.notifications.forEach(n => {
      const bg = n.read ? '' : 'background: rgba(74, 144, 226, 0.1); border-left: 3px solid var(--primary);';
      const timeStr = new Date(n.date).toLocaleTimeString('th-TH', {hour: '2-digit', minute:'2-digit'});
      html += `
        <div style="padding: 12px 10px; border-radius: 8px; margin-bottom: 4px; ${bg}">
          <div style="font-weight: bold; font-size: 0.9rem; color: var(--text-dark);">${n.title}</div>
          <div style="font-size: 0.8rem; color: var(--text-light); margin-top: 2px;">${n.body}</div>
          <div style="font-size: 0.7rem; color: #9ca3af; margin-top: 4px; text-align: right;">${timeStr}</div>
        </div>
      `;
    });
    list.innerHTML = html;
  }

  function switchView(viewId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
    
    // update specific views
    if (viewId === 'view-home' && state.products.length === 0) loadStoreData();
    if (viewId === 'view-checkout') renderCart();
    if (viewId === 'view-tracking') {
      switchOrderTab('active');
      loadOrders();
    }
    
    updateFloatingCart();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showAlert(title, text, icon) {
    Swal.fire({
      title: title,
      text: text,
      icon: icon,
      confirmButtonColor: '#4A90E2',
      customClass: { popup: 'glass-panel' }
    });
  }

  // --- REWARDS & COUPONS ---
  function loadCustomerCoupons() {
    if (!state.customer) return;
    google.script.run.withSuccessHandler(res => {
      if (res.success) {
        state.coupons = res.data || [];
        updateCheckoutCouponUI();
      }
    }).getCustomerCoupons(state.customer.id);
  }

  function toggleRewardsModal() {
    const modal = document.getElementById('rewardsModal');
    const overlay = document.getElementById('rewardsModalOverlay');
    if (!modal || !overlay) return;
    
    if (modal.classList.contains('d-none')) {
      renderRewardsModal();
      modal.classList.remove('d-none');
      overlay.classList.remove('d-none');
    } else {
      modal.classList.add('d-none');
      overlay.classList.add('d-none');
    }
  }

  function renderRewardsModal() {
    if (!state.customer || !state.config) return;
    const reqCount = state.config && state.config.delivery_count !== undefined && state.config.delivery_count !== "" ? parseInt(state.config.delivery_count) : 10;
    const discountAmt = parseFloat(state.config.coupon_discount || 0);
    
    const accumulate = parseInt(state.customer.delivery_count_accumulate || 0);
    const usage = parseInt(state.customer.delivery_count_usage || 0);
    const available = accumulate - usage;
    
    document.getElementById('rewardsPointsDisplay').textContent = available;
    document.getElementById('rewardsConditionDisplay').textContent = `* ครบ ${reqCount} ครั้ง แลกคูปองลด ${discountAmt}฿ ได้ 1 ใบ`;
    
    const btnRedeem = document.getElementById('btnRedeemCoupon');
    if (available >= reqCount) {
      btnRedeem.disabled = false;
      btnRedeem.textContent = 'แลกคูปองส่วนลด';
    } else {
      btnRedeem.disabled = true;
      btnRedeem.textContent = `ขาดอีก ${reqCount - available} ครั้ง`;
    }
    
    // Render My Coupons
    const list = document.getElementById('myCouponsList');
    if (state.coupons && state.coupons.length > 0) {
      list.innerHTML = state.coupons.map(c => `
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid var(--primary); padding: 10px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
          <div style="font-weight: bold; color: #334155;">ส่วนลด ฿${c.discount_amount}</div>
          <div style="font-size: 0.8rem; color: var(--primary);">พร้อมใช้งาน</div>
        </div>
      `).join('');
    } else {
      list.innerHTML = `<div style="text-align: center; color: var(--text-light); font-size: 0.9rem; padding: 10px;">ไม่มีคูปองที่ใช้ได้</div>`;
    }
  }

  function redeemCouponCustomer() {
    if (!state.customer) return;
    Swal.fire({title: 'กำลังประมวลผล', text: 'กรุณารอสักครู่...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
    google.script.run.withFailureHandler(e => {
      showAlert('Error', e.message || e.toString(), 'error');
    }).withSuccessHandler(res => {
      if (res.success) {
        // Refresh customer data & coupons
        google.script.run.withSuccessHandler(cRes => {
          if (cRes.success) {
            state.customer = cRes.data;
            localStorage.setItem('phromsila_customer', JSON.stringify(cRes.data));
            loadCustomerCoupons();
            renderRewardsModal();
            showAlert('สำเร็จ', 'แลกคูปองเรียบร้อยแล้ว!', 'success');
          }
        }).loginCustomer(state.customer.mobile_no);
      } else {
        showAlert('Error', res.message, 'error');
      }
    }).redeemCoupon(state.customer.id);
  }

  function updateCheckoutCouponUI() {
    const section = document.getElementById('checkoutCouponSection');
    const select = document.getElementById('checkoutCouponSelect');
    if (!section || !select) return;
    
    const reqCount = state.config && state.config.delivery_count !== undefined && state.config.delivery_count !== "" ? parseInt(state.config.delivery_count) : 10;
    const couponValue = state.config && state.config.coupon_discount !== undefined && state.config.coupon_discount !== "" ? parseInt(state.config.coupon_discount) : 20;
    
    if (reqCount === 0 || couponValue === 0) {
      section.classList.add('d-none');
      select.innerHTML = '<option value="">ไม่ใช้คูปอง</option>';
      if (typeof calculateTotal === 'function') calculateTotal();
      return;
    }
    
    if (state.coupons && state.coupons.length > 0) {
      section.classList.remove('d-none');
      let html = '<option value="">ไม่ใช้คูปอง</option>';
      state.coupons.forEach(c => {
        html += `<option value="${c.id}" data-discount="${c.discount_amount}">คูปองส่วนลด ฿${c.discount_amount}</option>`;
      });
      select.innerHTML = html;
    } else {
      section.classList.add('d-none');
      select.innerHTML = '<option value="">ไม่ใช้คูปอง</option>';
    }
    if (typeof calculateTotal === 'function') calculateTotal();
  }

  // --- LOGIN / REGISTER ---
  function handleLogin() {
    const phone = document.getElementById('loginPhone').value.trim();
    if (phone.length < 9) return showAlert('ข้อผิดพลาด', 'กรุณาระบุเบอร์โทรศัพท์ให้ถูกต้อง', 'error');
    
    const btn = document.getElementById('btnCustomerLogin');
    const originalText = btn ? btn.innerHTML : 'เข้าสู่ระบบ';
    if (btn) {
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> กำลังเข้าระบบ...';
      btn.disabled = true;
    }
    
    Swal.fire({title: 'กำลังประมวลผล', text: 'กรุณารอสักครู่...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
    google.script.run.withFailureHandler(e => {
      if (btn) {
        btn.innerHTML = originalText;
        btn.disabled = false;
      }
      showAlert('Error', e.message || e.toString(), 'error');
    }).withSuccessHandler(res => {
      if (btn) {
        btn.innerHTML = originalText;
        btn.disabled = false;
      }
      if (res.success) {
        Swal.close();
        state.customer = res.data;
        localStorage.setItem('phromsila_customer', JSON.stringify(res.data));
        updateAuthUI();
        switchView('view-home');
      } else {
        Swal.close();
        // Not found, go to register
        document.getElementById('regPhone').value = phone;
        switchView('view-register');
      }
    }).loginCustomer(phone);
  }

  function handleRegister() {
    const btn = document.getElementById('btnCustomerRegister') || document.querySelector('button[onclick="handleRegister()"]');
    if (btn) {
      if (btn.disabled) return;
      btn.disabled = true;
    }
    
    const name = document.getElementById('regName').value.trim();
    const phone = document.getElementById('regPhone').value.trim();
    const address = document.getElementById('regAddress').value.trim();
    
    if (!name || !phone || !address) {
      if (btn) btn.disabled = false;
      return showAlert('ข้อผิดพลาด', 'กรุณากรอกข้อมูลให้ครบถ้วน (ชื่อ, เบอร์โทรศัพท์, ที่อยู่)', 'error');
    }
    
    Swal.fire({title: 'กำลังประมวลผล', text: 'กรุณารอสักครู่...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
    google.script.run.withSuccessHandler(res => {
      if (btn) btn.disabled = false;
      Swal.close();
      if (res.success) {
        state.customer = res.data;
        localStorage.setItem('phromsila_customer', JSON.stringify(res.data));
        updateAuthUI();
        switchView('view-home');
      } else {
        showAlert('ข้อผิดพลาด', res.message || 'ไม่สามารถลงทะเบียนได้', 'error');
      }
    }).saveCustomer({ name: name, mobile_no: phone, delivery_address: address, active: true });
  }

  function handleLogout() {
    localStorage.removeItem('phromsila_customer');
    state.customer = null;
    state.cart = [];
    updateFloatingCart();
    updateAuthUI();
    switchView('view-home');
  }

  function goToAdmin() {
    window.location.href = 'admin.html';
  }

  // --- LOAD DATA ---
  function loadStoreData() {
    google.script.run.withFailureHandler(e => showAlert('Error in getConfig', e.message, 'error')).withSuccessHandler(res => {
      if (res.success) {
        state.config = res.data;
        updateAuthUI(); // Refresh UI after config is loaded
        
        // Populate Header Info
        const shopName = state.config.shop_name || 'Phromsila Shop';
        document.getElementById('displayShopName').textContent = shopName;
        const loginShopNameEl = document.getElementById('displayShopNameLogin');
        if (loginShopNameEl) loginShopNameEl.textContent = shopName;
        
        document.getElementById('displayShopPhone').textContent = state.config.mobile_no || '-';
        document.getElementById('linkShopPhone').href = state.config.mobile_no ? 'tel:' + state.config.mobile_no : '#';
        document.getElementById('displayShopLine').textContent = state.config.line_id || '-';
        document.getElementById('linkShopLine').href = state.config.line_id ? 'https://line.me/ti/p/~' + state.config.line_id : '#';
        
        // Check if shop is closed today
        const today = new Date().getDay();
        const closeDaysStr = state.config.close_day != null ? state.config.close_day : '';
        if (String(closeDaysStr).split(',').includes(String(today))) {
          document.getElementById('shopClosedBanner').classList.remove('d-none');
        }
        
        // Hide coupons if disabled
        const reqCount = state.config && state.config.delivery_count !== undefined && state.config.delivery_count !== "" ? parseInt(state.config.delivery_count) : 10;
        const couponValue = state.config && state.config.coupon_discount !== undefined && state.config.coupon_discount !== "" ? parseInt(state.config.coupon_discount) : 20;
        const menuRewards = document.getElementById('menuRewards');
        if (reqCount === 0 || couponValue === 0) {
          if (menuRewards) menuRewards.classList.add('d-none');
        } else {
          if (menuRewards) menuRewards.classList.remove('d-none');
        }

        // load catalogs
        google.script.run.withFailureHandler(e => showAlert('Error in getCatalogs', e.message, 'error')).withSuccessHandler(cRes => {
          if (cRes.success) {
            state.catalogs = cRes.data.filter(c => c.active);
            // load products
            google.script.run.withFailureHandler(e => showAlert('Error in getProducts', e.message, 'error')).withSuccessHandler(pRes => {
              if (pRes.success) {
                state.products = pRes.data.filter(p => p.active);
                try {
                  renderHome();
                } catch(renderErr) {
                  showAlert('Error in renderHome', renderErr.message, 'error');
                }
              }
            }).getProducts();
          }
        }).getCatalogs();
      }
    }).getConfig();
  }

  function isProductPromoActive(p) {
    if (!(p.promo_price > 0 && p.promo_price < p.price)) return false;
    if (!p.promo_expire) return true;
    const expireDate = new Date(p.promo_expire);
    expireDate.setHours(23, 59, 59, 999);
    return new Date() <= expireDate;
  }

  function renderHome() {
    // Check if there are active promos
    const now = new Date();
    const hasPromo = state.products.some(p => isProductPromoActive(p));

    // Determine catalogs that have at least one active product
    const activeCatalogs = state.catalogs.filter(cat => state.products.some(p => p.catalog_id === cat.id));

    if (!hasPromo && state.currentCategory === 'promo') {
      state.currentCategory = activeCatalogs.length > 0 ? activeCatalogs[0].id : '';
    }

    // Render Categories as Selectbox
    const catSelect = document.getElementById('categorySelect');
    if (catSelect) {
       let catHtml = '';
       if (hasPromo) {
         catHtml += `<option value="promo" ${state.currentCategory === 'promo' ? 'selected' : ''}>โปรโมชั่น</option>`;
       }
       activeCatalogs.forEach(cat => {
         const isSelected = state.currentCategory === cat.id ? 'selected' : '';
         catHtml += `<option value="${cat.id}" ${isSelected}>${cat.name}</option>`;
       });
       catSelect.innerHTML = catHtml;
    }
    
    state.productLimit = 10;
    filterProducts();
  }

  function toggleSearchMode(isSearch) {
    if (isSearch) {
      document.getElementById('categorySelect').classList.add('d-none');
      document.getElementById('btnOpenSearch').classList.add('d-none');
      document.getElementById('btnOpenCat').classList.remove('d-none');
      document.getElementById('searchWrapper').classList.remove('d-none');
      document.getElementById('searchInput').focus();
    } else {
      document.getElementById('categorySelect').classList.remove('d-none');
      document.getElementById('btnOpenSearch').classList.remove('d-none');
      document.getElementById('btnOpenCat').classList.add('d-none');
      document.getElementById('searchWrapper').classList.add('d-none');
      // Clear search and refresh
      const searchInput = document.getElementById('searchInput');
      if (searchInput.value) {
        searchInput.value = '';
        filterProducts();
      }
    }
  }

  function setCategory(catId) {
    state.currentCategory = catId;
    state.productLimit = 10;
    renderHome(); // Re-render to update active tab
  }

  function filterProducts() {
    state.searchQuery = document.getElementById('searchInput').value;
    let filtered = state.products;
    const now = new Date();
    
    if (state.searchQuery) {
      filtered = filtered.filter(p => p.name.toLowerCase().includes(state.searchQuery.toLowerCase()));
    } else {
      if (state.currentCategory === 'promo') {
        filtered = filtered.filter(p => isProductPromoActive(p));
      } else {
        filtered = filtered.filter(p => p.catalog_id === state.currentCategory);
      }
    }
    
    const prodContainer = document.getElementById('productContainer');
    if (filtered.length === 0) {
      prodContainer.innerHTML = `<div style="text-align:center; padding: 40px; color:var(--text-light)">ไม่พบสินค้า</div>`;
      return;
    }
    
    let html = '';
    const displayedProducts = filtered.slice(0, state.productLimit || 10);
    
    displayedProducts.forEach(p => {
      const isPromo = isProductPromoActive(p);
      const unit = p.unit_name || 'ชิ้น';
      const pPriceStr = parseFloat(p.price).toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:2});
      const pPromoStr = parseFloat(p.promo_price).toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:2});
      
      const unitHtml = `<span style="font-size: 0.8em; color: var(--text-light); font-weight: normal;">/${unit}</span>`;
      
      let priceHtml;
      const viewPrice = p.view_price !== false && String(p.view_price).toUpperCase() !== 'FALSE';
      if (!viewPrice) {
        priceHtml = `<span style="color: #f59e0b; font-size: 0.85rem; font-weight: bold;">ราคาตามตกลงกับทางร้าน</span>`;
      } else {
        priceHtml = isPromo
          ? `<span class="promo-price" style="color: var(--primary);">฿${pPromoStr}${unitHtml}</span> <span class="old-price">฿${pPriceStr}</span>` 
          : `<span class="product-price" style="color: var(--primary);">฿${pPriceStr}${unitHtml}</span>`;
      }
      let pImg = p.image;
      if (pImg && pImg.includes('drive.google.com')) {
        const match = pImg.match(/id=([a-zA-Z0-9_-]+)/);
        if (match) pImg = 'https://lh3.googleusercontent.com/d/' + match[1];
      }
      
      const imgHtml = pImg ? `<img src="${pImg}" class="product-img" alt="${p.name}">` : `<div class="product-img" style="display:flex; align-items:center; justify-content:center; color:#ccc; font-size:2rem;"><i class="fas fa-image"></i></div>`;
      
      let promoBadge = '';
      if (isPromo && p.promo_expire) {
        const expireDate = new Date(p.promo_expire);
        expireDate.setHours(23, 59, 59, 999);
        const diffTime = expireDate - now;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const thaiMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
        const thaiDate = expireDate.getDate() + ' ' + thaiMonths[expireDate.getMonth()] + ' ' + (expireDate.getFullYear() + 543).toString().substr(-2);
        
        const badgeColor = diffDays <= 3 ? '#ef4444' : '#f59e0b';
        promoBadge = `<div style="position: absolute; top: -10px; left: -10px; background: ${badgeColor}; color: white; padding: 3px 8px; border-radius: 12px; font-size: 0.7rem; font-weight: bold; box-shadow: 0 2px 5px rgba(0,0,0,0.2); z-index: 10;">เหลือ ${diffDays} วัน (ถึง ${thaiDate})</div>`;
      }

      const inCart = state.cart.find(c => c.product_id === p.id);
      let actionHtml = '';
      if (inCart) {
        actionHtml = `
          <div class="qty-control">
            <button class="qty-btn outline" onclick="updateQtyFromProduct('${p.id}', -1)"><i class="fas fa-minus"></i></button>
            <span style="font-weight:bold; color:var(--primary); min-width: 15px; text-align:center;">${inCart.quantity}</span>
            <button class="qty-btn outline" onclick="updateQtyFromProduct('${p.id}', 1)"><i class="fas fa-plus"></i></button>
          </div>
        `;
      } else {
        actionHtml = `
          <button class="btn btn-primary add-to-cart-btn" onclick="addToCart('${p.id}')">
            <i class="fas fa-plus"></i>
          </button>
        `;
      }
        
      html += `
        <div class="product-card glass">
          ${promoBadge}
          ${imgHtml}
          <div class="product-info">
            <div class="product-title">${p.name}</div>
            <div>${priceHtml}</div>
          </div>
          <div>${actionHtml}</div>
        </div>
      `;
    });
    
    if (filtered.length > displayedProducts.length) {
      html += `<div style="text-align:center; padding: 20px; grid-column: 1 / -1;"><button class="btn btn-glass" onclick="loadMoreProducts()" style="width:100%; border:1px solid var(--primary); color:var(--primary);">โหลดสินค้าเพิ่มเติม <i class="fas fa-chevron-down"></i></button></div>`;
    }
    
    prodContainer.innerHTML = html;
  }

  function loadMoreProducts() {
    state.productLimit = (state.productLimit || 10) + 10;
    filterProducts();
  }

  // --- CART ---
  function addToCart(productId) {
    if (!state.customer) {
      Swal.fire({
        title: 'กรุณาเข้าสู่ระบบ',
        text: 'คุณต้องเข้าสู่ระบบหรือลงทะเบียนเพื่อสั่งซื้อสินค้าค่ะ',
        icon: 'info',
        confirmButtonText: 'เข้าสู่ระบบ / ลงทะเบียน',
        confirmButtonColor: '#4A90E2',
        customClass: { popup: 'glass-panel' }
      }).then(() => {
        switchView('view-login');
      });
      return;
    }
    
    const product = state.products.find(p => p.id === productId);
    if (!product) return;
    
    const isPromo = isProductPromoActive(product);
    const price = isPromo ? product.promo_price : product.price;
    
    const existing = state.cart.find(item => item.product_id === productId);
    if (existing) {
      existing.quantity += 1;
      existing.total = existing.quantity * price;
    } else {
      state.cart.push({
        product_id: productId,
        name: product.name,
        price: price,
        quantity: 1,
        total: price,
        view_price: product.view_price !== false && String(product.view_price).toUpperCase() !== 'FALSE'
      });
    }
    
    
    updateFloatingCart();
    filterProducts();
  }
  
  function updateQtyFromProduct(productId, change) {
    const index = state.cart.findIndex(c => c.product_id === productId);
    if (index > -1) {
      updateQty(index, change);
      filterProducts();
    }
  }

  function removeItem(index) {
    state.cart.splice(index, 1);
    renderCart();
    updateFloatingCart();
    filterProducts();
  }

  function updateFloatingCart() {
    const cartEl = document.getElementById('floatingCart');
    const isCheckout = document.getElementById('view-checkout').classList.contains('active');
    
    if (state.cart.length === 0 || isCheckout) {
      cartEl.classList.add('d-none');
      return;
    }
    cartEl.classList.remove('d-none');
    
    const totalQty = state.cart.reduce((sum, item) => sum + item.quantity, 0);
    
    let hasHiddenPrice = false;
    let visibleTotalAmt = 0;
    state.cart.forEach(item => {
      if (item.view_price === false) {
        hasHiddenPrice = true;
      } else {
        visibleTotalAmt += item.total;
      }
    });
    
    document.getElementById('floatingCartCount').textContent = `${totalQty.toLocaleString('en-US')} รายการ`;
    
    const totalEl = document.getElementById('floatingCartTotal');
    if (hasHiddenPrice) {
      if (visibleTotalAmt > 0) {
        totalEl.innerHTML = `<span style="font-size:0.8rem;">฿${visibleTotalAmt.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})} + </span>ราคาตามตกลง`;
      } else {
        totalEl.textContent = 'ราคาตามตกลง';
      }
    } else {
      totalEl.textContent = `฿${visibleTotalAmt.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
    }
  }

  function renderCart() {
    const container = document.getElementById('cartItemsContainer');
    const btnClearCart = document.getElementById('btnClearCart');
    
    if (state.cart.length === 0) {
      if (btnClearCart) btnClearCart.style.display = 'none';
      container.innerHTML = '<div style="text-align:center;">ไม่มีสินค้าในตะกร้า</div>';
      calculateTotal();
      return;
    }
    
    if (btnClearCart) btnClearCart.style.display = 'block';
    
    let html = '';
    state.cart.forEach((item, index) => {
      const p = state.products.find(prod => prod.id === item.product_id) || {};
      const imgHtml = p.image ? `<img src="${p.image}" class="cart-item-img">` : `<div class="cart-item-img"><i class="fas fa-image"></i></div>`;
      
      const unit = p.unit_name || 'ชิ้น';
      let itemPriceStr = parseFloat(item.price).toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:2});
      let itemTotalStr = parseFloat(item.total).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
      
      let priceDisplay = `฿${itemPriceStr}`;
      let totalDisplay = `฿${itemTotalStr}`;
      
      if (item.view_price === false) {
        priceDisplay = `<span style="color: #f59e0b; font-weight: bold;">ราคาตามตกลง</span>`;
        totalDisplay = `<span style="color: #f59e0b; font-weight: bold; font-size: 0.9rem;">(ตามตกลง)</span>`;
      }
      
      html += `
        <div class="cart-item">
          ${imgHtml}
          <div style="flex-grow:1;">
            <button class="trash-btn" onclick="removeItem(${index})"><i class="fas fa-trash-alt"></i></button>
            <div style="font-weight:600; padding-right:20px; line-height:1.2; margin-bottom:5px;">${item.name}</div>
            <div style="font-size: 0.8rem; color: var(--text-light); margin-bottom: 5px;">${unit} | ${priceDisplay}</div>
            
            <div style="display:flex; justify-content:space-between; align-items:flex-end;">
              <div style="font-weight:bold; color:var(--primary); font-size:1.1rem;">${totalDisplay}</div>
              <div class="qty-control">
                <button class="qty-btn" onclick="updateQty(${index}, -1)"><i class="fas fa-minus"></i></button>
                <span style="font-weight:bold; color:var(--primary); min-width: 15px; text-align:center;">${item.quantity}</span>
                <button class="qty-btn" onclick="updateQty(${index}, 1)"><i class="fas fa-plus"></i></button>
              </div>
            </div>
          </div>
        </div>
      `;
    });
    container.innerHTML = html;
    
    document.getElementById('checkoutAddress').value = state.customer.delivery_address || '';
    
    // Filter available pickup times based on current time + 1 hour
    updateAvailableTimes();
    
    calculateTotal();
  }

  function updateQty(index, change) {
    const item = state.cart[index];
    item.quantity += change;
    if (item.quantity <= 0) {
      state.cart.splice(index, 1);
    } else {
      item.total = item.quantity * item.price;
    }
    renderCart();
    updateFloatingCart();
    filterProducts();
  }

  function updateAvailableTimes() {
    const timeSelect = document.getElementById('pickupTime');
    const now = new Date();
    // Add 30 minutes buffer
    now.setMinutes(now.getMinutes() + 30);
    
    const h = now.getHours();
    const m = now.getMinutes();
    const currentTimeVal = h + (m/60);
    
    Array.from(timeSelect.options).forEach(opt => {
      const [optH, optM] = opt.value.split(':').map(Number);
      const optTimeVal = optH + (optM/60);
      
      const closeDaysStr = state.config.close_day != null ? state.config.close_day : '';
      const isClosed = String(closeDaysStr).split(',').includes(String(new Date().getDay()));
      if (isClosed || optTimeVal < currentTimeVal) {
        opt.disabled = true;
      } else {
        opt.disabled = false;
      }
    });
    
    // Select first available
    const firstAvail = Array.from(timeSelect.options).find(o => !o.disabled);
    if (firstAvail) timeSelect.value = firstAvail.value;
  }

  function clearCart() {
    Swal.fire({
      title: 'ยืนยันการล้างตะกร้า?',
      text: "คุณต้องการลบสินค้าทั้งหมดออกจากตะกร้าใช่หรือไม่",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'ล้างตะกร้า',
      cancelButtonText: 'ยกเลิก',
      customClass: { popup: 'glass-panel' }
    }).then((result) => {
      if (result.isConfirmed) {
        state.cart = [];
        renderCart();
        updateFloatingCart();
        filterProducts();
        switchView('view-home');
        Swal.fire({
          title: 'ล้างตะกร้าแล้ว',
          icon: 'success',
          toast: true,
          position: 'top-end',
          showConfirmButton: false,
          timer: 1500
        });
      }
    });
  }

  function calculateTotal() {
    const pickupTypeSelect = document.getElementById('pickupType');
    const warningEl = document.getElementById('lateDeliveryWarning');
    const now = new Date();
    const currentTimeVal = now.getHours() + (now.getMinutes() / 60);

    if (currentTimeVal >= 14.5) {
      Array.from(pickupTypeSelect.options).forEach(opt => {
        if (opt.value === 'delivery') opt.disabled = true;
      });
      if (pickupTypeSelect.value === 'delivery') {
        pickupTypeSelect.value = 'shop';
        if (currentTimeVal < 15.0) {
          Swal.fire('แจ้งเตือน', 'เลยเวลา 14:30 น. แล้ว ไม่สามารถจัดส่งในรอบสุดท้าย (15:00 น.) ได้ค่ะ ต้องรับที่ร้านเท่านั้น', 'warning');
        }
      }
      if (warningEl) warningEl.classList.remove('d-none');
    } else {
      Array.from(pickupTypeSelect.options).forEach(opt => {
        if (opt.value === 'delivery') opt.disabled = false;
      });
      if (warningEl) warningEl.classList.add('d-none');
    }

    const pickupType = pickupTypeSelect.value;
    const isDelivery = pickupType === 'delivery';
    document.getElementById('deliveryAddressSection').style.display = isDelivery ? 'block' : 'none';
    document.getElementById('pickupTimeSection').style.display = isDelivery ? 'block' : 'none';
    document.getElementById('deliveryFeeSection').style.display = isDelivery ? 'flex' : 'none';
    
    let subtotalDisplay = 0;
    let trueSubtotal = 0;
    let hasHiddenPrice = false;
    
    state.cart.forEach(item => {
      trueSubtotal += item.total;
      if (item.view_price !== false) {
        subtotalDisplay += item.total;
      } else {
        hasHiddenPrice = true;
      }
    });
    
    const noteEl = document.getElementById('hiddenPriceNote');
    if (noteEl) {
      if (hasHiddenPrice) noteEl.classList.remove('d-none');
      else noteEl.classList.add('d-none');
    }
    
    document.getElementById('summarySubtotal').textContent = `฿${subtotalDisplay.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
    
    let deliveryFee = 0;
    if (isDelivery) {
      const threshold = parseFloat(state.config.free_delivery_threshold) || 200;
      const charge = parseFloat(state.config.delivery_charge) || 20;
      
      if (trueSubtotal < threshold) {
        deliveryFee = charge;
        document.getElementById('deliveryFeeCondition').textContent = `(สั่งไม่ถึง ฿${threshold})`;
      } else {
        document.getElementById('deliveryFeeCondition').textContent = `(ส่งฟรี!)`;
      }
    } else {
      document.getElementById('deliveryFeeCondition').textContent = '';
    }
    
    document.getElementById('summaryDeliveryFee').textContent = `฿${deliveryFee.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
    
    const couponSelect = document.getElementById('checkoutCouponSelect');
    let couponDiscount = 0;
    let usedCouponId = '';
    if (couponSelect && couponSelect.value) {
      usedCouponId = couponSelect.value;
      const opt = couponSelect.options[couponSelect.selectedIndex];
      couponDiscount = parseFloat(opt.getAttribute('data-discount') || 0);
    }
    
    if (couponDiscount > 0) {
      document.getElementById('couponDiscountSection').classList.remove('d-none');
      document.getElementById('summaryCouponDiscount').textContent = `-฿${couponDiscount.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
    } else {
      document.getElementById('couponDiscountSection').classList.add('d-none');
    }
    
    const displayNetTotal = Math.max(0, subtotalDisplay + deliveryFee - couponDiscount);
    const trueNetTotal = Math.max(0, trueSubtotal + deliveryFee - couponDiscount);
    
    document.getElementById('summaryTotal').textContent = `฿${displayNetTotal.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
    
    return { subtotal: trueSubtotal, subtotalDisplay, deliveryFee, couponDiscount, usedCouponId, netTotal: trueNetTotal, displayNetTotal };
  }

  function placeOrder() {
    if (state.cart.length === 0) return showAlert('ข้อผิดพลาด', 'ไม่มีสินค้าในตะกร้า', 'error');
    const closeDaysStr = state.config.close_day != null ? state.config.close_day : '';
    if (String(closeDaysStr).split(',').includes(String(new Date().getDay()))) return showAlert('ขออภัย', 'วันนี้ร้านปิดทำการ ไม่สามารถสั่งซื้อได้', 'error');
    
    const now = new Date();
    const currentTimeVal = now.getHours() + (now.getMinutes() / 60);
    if (currentTimeVal >= 18.5) {
      return showAlert('ขออภัย', 'ไม่สามารถสั่งสินค้าของวันนี้ได้แล้ว เนื่องจากร้านปิด 19.00 น.', 'error');
    }
    
    const pickupType = document.getElementById('pickupType').value;
    const rawPickupTime = document.getElementById('pickupTime').value;
    const pickupTime = pickupType === 'delivery' ? rawPickupTime : '-';
    const payment = document.getElementById('paymentType').value;
    const { subtotal, deliveryFee, couponDiscount, usedCouponId, netTotal } = calculateTotal();
    
    let finalAddress = state.customer.delivery_address || '';
    if (pickupType === 'delivery') {
      const checkoutAddress = document.getElementById('checkoutAddress').value.trim();
      if (!checkoutAddress) {
        return showAlert('ข้อผิดพลาด', 'กรุณาระบุที่อยู่จัดส่ง', 'error');
      }
      if (checkoutAddress !== state.customer.delivery_address) {
        state.customer.delivery_address = checkoutAddress;
        localStorage.setItem('phromsila_customer', JSON.stringify(state.customer));
        google.script.run.saveCustomer(state.customer);
      }
      finalAddress = checkoutAddress;
    }
    
    const orderData = {
      customer_id: state.customer.id,
      pickup_type: pickupType,
      pickup_time: pickupTime,
      payment: payment,
      delivery_fee: deliveryFee,
      total: subtotal,
      coupon_discount: couponDiscount,
      used_coupon_id: usedCouponId,
      net_total: netTotal,
      pos_order_ref: '',
      remark: document.getElementById('orderRemark') ? document.getElementById('orderRemark').value.trim() : ''
    };
    
    Swal.fire({
      title: 'ยืนยันการสั่งซื้อ?',
      text: "คุณตรวจสอบรายการสินค้าและยอดเงินถูกต้องแล้วใช่หรือไม่?",
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#4A90E2',
      cancelButtonColor: '#e11d48',
      confirmButtonText: 'ยืนยัน',
      cancelButtonText: 'ยกเลิก'
    }).then((result) => {
      if (result.isConfirmed) {
        Swal.fire({
          title: 'กำลังยืนยันการสั่งซื้อ...',
          allowOutsideClick: false,
          didOpen: () => Swal.showLoading()
        });
        
        google.script.run.withSuccessHandler(res => {
          if (res.success) {
            Swal.fire({
              title: 'สั่งซื้อสำเร็จ!',
              text: `หมายเลขคำสั่งซื้อ: ${res.orderNo}`,
              icon: 'success',
              confirmButtonColor: '#4A90E2',
              confirmButtonText: 'ตกลง',
              allowOutsideClick: false
            }).then(() => {
              state.cart = [];
              updateFloatingCart();
              filterProducts();
              switchView('view-tracking');
            });
          } else {
            showAlert('ข้อผิดพลาด', 'ไม่สามารถบันทึกคำสั่งซื้อได้', 'error');
          }
        }).placeOrder(orderData, state.cart);
      }
    });
  }


  // --- TRACKING ---
  let currentOrderTab = 'active';
  let historyLimit = 5;

  function switchOrderTab(tab) {
    currentOrderTab = tab;
    document.getElementById('tabActive').style.color = tab === 'active' ? 'var(--primary)' : 'var(--text-light)';
    document.getElementById('tabActive').style.fontWeight = tab === 'active' ? 'bold' : 'normal';
    document.getElementById('tabActive').style.borderBottom = tab === 'active' ? '2px solid var(--primary)' : 'none';
    
    document.getElementById('tabHistory').style.color = tab === 'history' ? 'var(--primary)' : 'var(--text-light)';
    document.getElementById('tabHistory').style.fontWeight = tab === 'history' ? 'bold' : 'normal';
    document.getElementById('tabHistory').style.borderBottom = tab === 'history' ? '2px solid var(--primary)' : 'none';

    document.getElementById('ordersContainer').style.display = tab === 'active' ? 'block' : 'none';
    document.getElementById('historyOrdersContainer').style.display = tab === 'history' ? 'block' : 'none';
    
    renderOrders();
  }

  function loadMoreHistory() {
    historyLimit += 5;
    renderOrders();
  }

  function loadOrders() {
    const activeContainer = document.getElementById('ordersContainer');
    const historyContainer = document.getElementById('historyOrdersContainer');
    const loadMoreBtn = document.getElementById('loadMoreHistoryBtn');
    
    if (currentOrderTab === 'active') {
      activeContainer.innerHTML = '<div style="text-align:center; margin-top:50px;"><i class="fas fa-spinner fa-spin fa-2x text-primary"></i></div>';
    } else if (historyContainer) {
      historyContainer.innerHTML = '<div style="text-align:center; margin-top:50px;"><i class="fas fa-spinner fa-spin fa-2x text-primary"></i></div>';
    }
    if (loadMoreBtn) loadMoreBtn.style.display = 'none';
    
    google.script.run.withSuccessHandler(res => {
      if (res.success) {
        state.orders = res.data.filter(o => o.customer_id === state.customer.id);
        renderOrders();
      }
    }).getOrders();
  }

  function renderOrders() {
    const activeContainer = document.getElementById('ordersContainer');
    const historyContainer = document.getElementById('historyOrdersContainer');
    const loadMoreBtn = document.getElementById('loadMoreHistoryBtn');
    
    // Sort descending
    state.orders.sort((a,b) => new Date(b.date_time) - new Date(a.date_time));
    
    const activeOrders = state.orders.filter(o => !['shipped', 'cancel'].includes(o.status));
    const historyOrders = state.orders.filter(o => ['shipped', 'cancel'].includes(o.status));

    const statusMap = {
      'order': { label: 'รอรับออเดอร์', class: 'badge-order' },
      'preparing_order': { label: 'กำลังจัดเตรียม', class: 'badge-preparing_order' },
      'preparing_shipment': { label: 'รอจัดส่ง', class: 'badge-preparing_shipment' },
      'shipped': { label: 'จัดส่งแล้ว', class: 'badge-shipped' },
      'cancel': { label: 'ยกเลิก', class: 'badge-cancel' }
    };

    function generateHtml(orderList) {
      if (orderList.length === 0) return '<div style="text-align:center; padding:40px;">ไม่มีข้อมูล</div>';
      let html = '';
      orderList.forEach(o => {
        const s = statusMap[o.status] || { label: o.status, class: 'badge-order' };
        const dateStr = new Date(o.date_time).toLocaleString('th-TH');
        
        let hasHiddenPrice = false;
        let subtotalDisplay = 0;
        let itemsHtml = '';
        o.items.forEach(item => {
          const p = state.products.find(prod => prod.id === item.product_id);
          const name = p ? p.name : '(สินค้านี้ถูกลบแล้ว)';
          let itemStr = `${item.quantity} x ${name}`;
          if (p && (p.view_price === false || String(p.view_price).toUpperCase() === 'FALSE')) {
            hasHiddenPrice = true;
            itemStr += ` <span style="color:#f59e0b; font-size:0.8rem;">(ตามตกลง)</span>`;
          } else {
            subtotalDisplay += (item.quantity * item.price);
          }
          itemsHtml += `<div style="font-size:0.9rem; color:var(--text-light);">${itemStr}</div>`;
        });
        
        let displayNetTotal = Math.max(0, subtotalDisplay + Number(o.delivery_fee) - Number(o.coupon_discount));
        let totalHtml = `฿${parseFloat(displayNetTotal).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
        if (hasHiddenPrice) {
          totalHtml += ` <br><span style="color:#f59e0b; font-size:0.8rem; font-weight:normal;">(ไม่รวมราคาสินค้าตามตกลง)</span>`;
        }
        
        const pickupMethod = o.pickup_type === 'delivery' ? '<span style="color:#4A90E2; font-weight:bold;">จัดส่ง</span>' : '<span style="color:#f59e0b; font-weight:bold;">รับที่ร้าน</span>';
        const pickupTime = o.pickup_time === '-' ? '' : ` (${o.pickup_time})`;
        
        let cancelBtn = '';
        if (o.status === 'order') {
          cancelBtn = `<button class="btn btn-danger" style="padding: 5px 10px; font-size: 0.8rem; background: #ef4444;" onclick="cancelOrder('${o.id}')">ยกเลิกสั่งซื้อ</button>`;
        }
        
        let cancelReasonHtml = '';
        if (o.status === 'cancel' && o.cancel_reason) {
          cancelReasonHtml = `<div style="color:#ef4444; font-size:0.8rem; margin-bottom:10px;"><strong>เหตุผลที่ยกเลิก:</strong> ${o.cancel_reason}</div>`;
        }
        
        html += `
          <div class="glass-panel" style="padding: 15px; margin-bottom: 15px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
              <div style="font-weight:bold;">เลขที่ ${o.order_no}</div>
              <div class="badge ${s.class}">${s.label}</div>
            </div>
            <div style="font-size:0.8rem; color:var(--text-light); margin-bottom:10px;">${dateStr} | ${pickupMethod}${pickupTime}</div>
            ${cancelReasonHtml}
            <div style="margin-bottom:10px;">
              ${itemsHtml}
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; font-weight:bold; margin-top:10px; border-top:1px solid rgba(0,0,0,0.05); padding-top:10px;">
              <div>${cancelBtn}</div>
              <div style="text-align:right;">
                <span>ยอดสุทธิ </span>
                <span style="color:var(--primary); font-size:1.1rem;">${totalHtml}</span>
              </div>
            </div>
          </div>
        `;
      });
      return html;
    }

    if (activeContainer) activeContainer.innerHTML = generateHtml(activeOrders);
    
    if (historyContainer) {
      const visibleHistory = historyOrders.slice(0, historyLimit);
      historyContainer.innerHTML = generateHtml(visibleHistory);

      if (currentOrderTab === 'history' && historyOrders.length > historyLimit) {
        if (loadMoreBtn) loadMoreBtn.style.display = 'block';
      } else {
        if (loadMoreBtn) loadMoreBtn.style.display = 'none';
      }
    }
  }

    function cancelOrder(id) {
      Swal.fire({
        title: 'ยืนยันการยกเลิก',
        text: 'คุณต้องการยกเลิกคำสั่งซื้อนี้ใช่หรือไม่? กรุณาระบุเหตุผล',
        input: 'text',
        inputPlaceholder: 'ใส่เหตุผลการยกเลิก...',
        showCancelButton: true,
        confirmButtonText: 'ยืนยันยกเลิก',
        cancelButtonText: 'ปิด',
        preConfirm: (reason) => {
          if (!reason) {
            Swal.showValidationMessage('กรุณาระบุเหตุผล');
          }
          return reason;
        }
      }).then((result) => {
        if (result.isConfirmed) {
          Swal.fire({title: 'กำลังประมวลผล', text: 'กรุณารอสักครู่...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
          google.script.run.withSuccessHandler(res => {
            if(res.success) {
              Swal.close();
              loadOrders(); // reload tracking
              updateAuthUI(); // refresh badge
            } else {
              Swal.fire('ข้อผิดพลาด', 'อัปเดตไม่สำเร็จ', 'error');
            }
          }).updateOrderStatus(id, 'cancel', result.value);
        }
      });
    }