let state = {
    customer: null,
    config: null,
    catalogs: [],
    products: [],
    cart: [],
    orders: [],
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
    switchView('view-home');
  });

  function updateAuthUI() {
    if (state.customer) {
      document.getElementById('userNameDisplay').textContent = 'คุณ' + state.customer.name;
      document.getElementById('btnMyOrders').classList.remove('d-none');
      document.getElementById('btnLogout').classList.remove('d-none');
      document.getElementById('btnLogin').classList.add('d-none');
      
      // Load active order count badge
      google.script.run.withSuccessHandler(count => {
        const btn = document.getElementById('btnMyOrders');
        const text = document.getElementById('activeOrdersText');
        if (count > 0) {
          btn.className = "btn btn-warning";
          btn.style.color = "#ffffff";
          text.textContent = count + " ออเดอร์ ";
          btn.classList.remove('d-none');
        } else {
          btn.className = "btn btn-glass";
          btn.style.color = "";
          text.textContent = "";
          btn.classList.remove('d-none');
        }
      }).getActiveOrderCount(state.customer.id);
      
    } else {
      document.getElementById('userNameDisplay').textContent = 'คุณลูกค้า';
      document.getElementById('btnMyOrders').classList.add('d-none');
      document.getElementById('btnLogout').classList.add('d-none');
      document.getElementById('btnLogin').classList.remove('d-none');
    }
  }

  function switchView(viewId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
    
    // update specific views
    if (viewId === 'view-home' && state.products.length === 0) loadStoreData();
    if (viewId === 'view-checkout') renderCart();
    if (viewId === 'view-tracking') loadOrders();
    
    updateFloatingCart();
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

  // --- LOGIN / REGISTER ---
  function handleLogin() {
    const phone = document.getElementById('loginPhone').value.trim();
    if (phone.length < 9) return showAlert('ข้อผิดพลาด', 'กรุณาระบุเบอร์โทรศัพท์ให้ถูกต้อง', 'error');
    
    Swal.showLoading();
    google.script.run.withSuccessHandler(res => {
      Swal.close();
      if (res.success) {
        state.customer = res.data;
        localStorage.setItem('phromsila_customer', JSON.stringify(res.data));
        updateAuthUI();
        switchView('view-home');
      } else {
        // Not found, go to register
        document.getElementById('regPhone').value = phone;
        switchView('view-register');
      }
    }).loginCustomer(phone);
  }

  function handleRegister() {
    const name = document.getElementById('regName').value.trim();
    const phone = document.getElementById('regPhone').value.trim();
    const address = document.getElementById('regAddress').value.trim();
    
    if (!name || !address) return showAlert('ข้อผิดพลาด', 'กรุณาระบุชื่อและที่อยู่', 'error');
    
    Swal.showLoading();
    google.script.run.withSuccessHandler(res => {
      Swal.close();
      if (res.success) {
        state.customer = res.data;
        localStorage.setItem('phromsila_customer', JSON.stringify(res.data));
        updateAuthUI();
        switchView('view-home');
      } else {
        showAlert('ข้อผิดพลาด', 'ไม่สามารถลงทะเบียนได้', 'error');
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
    Swal.showLoading();
    google.script.run.withSuccessHandler(url => {
      window.top.location.href = url + '?page=admin';
    }).getScriptUrl();
  }

  // --- LOAD DATA ---
  function loadStoreData() {
    google.script.run.withFailureHandler(e => showAlert('Error in getConfig', e.message, 'error')).withSuccessHandler(res => {
      if (res.success) {
        state.config = res.data;
        
        // Populate Header Info
        document.getElementById('displayShopName').textContent = state.config.shop_name || 'Phromsila Shop';
        document.getElementById('displayShopPhone').textContent = state.config.mobile_no || '-';
        document.getElementById('linkShopPhone').href = state.config.mobile_no ? 'tel:' + state.config.mobile_no : '#';
        document.getElementById('displayShopLine').textContent = state.config.line_id || '-';
        document.getElementById('linkShopLine').href = state.config.line_id ? 'https://line.me/ti/p/~' + state.config.line_id : '#';
        
        // Check if shop is closed today
        const today = new Date().getDay();
        if (today == state.config.close_day) {
          Swal.fire({
            title: 'ร้านปิดทำการ',
            text: 'วันนี้ร้านปิดทำการค่ะ สามารถดูสินค้าได้แต่จะยังไม่สามารถสั่งซื้อได้นะคะ',
            icon: 'info',
            confirmButtonText: 'รับทราบ',
            confirmButtonColor: '#4A90E2',
            customClass: { popup: 'glass-panel' }
          });
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

  function renderHome() {
    // Check if there are active promos
    const now = new Date();
    const hasPromo = state.products.some(p => {
      const isPromo = p.promo_price > 0 && p.promo_price < p.price;
      const isNotExpired = !p.promo_expire || new Date(p.promo_expire) >= now;
      return isPromo && isNotExpired;
    });

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
    
    state.productLimit = 5;
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
    state.productLimit = 5;
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
        filtered = filtered.filter(p => {
          const isPromo = p.promo_price > 0 && p.promo_price < p.price;
          const isNotExpired = !p.promo_expire || new Date(p.promo_expire) >= now;
          return isPromo && isNotExpired;
        });
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
      const isPromo = p.promo_price > 0 && p.promo_price < p.price && (!p.promo_expire || new Date(p.promo_expire) >= now);
      const unit = p.unit_name || 'ชิ้น';
      const pPriceStr = parseFloat(p.price).toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:2});
      const pPromoStr = parseFloat(p.promo_price).toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:2});
      
      const unitHtml = `<span style="font-size: 0.8em; color: var(--text-light); font-weight: normal;">/${unit}</span>`;
      
      const priceHtml = isPromo
        ? `<span class="promo-price" style="color: var(--primary);">฿${pPromoStr}${unitHtml}</span> <span class="old-price">฿${pPriceStr}</span>` 
        : `<span class="product-price" style="color: var(--primary);">฿${pPriceStr}${unitHtml}</span>`;
        
      let pImg = p.image;
      if (pImg && pImg.includes('drive.google.com')) {
        const match = pImg.match(/id=([a-zA-Z0-9_-]+)/);
        if (match) pImg = 'https://lh3.googleusercontent.com/d/' + match[1];
      }
      
      const imgHtml = pImg ? `<img src="${pImg}" class="product-img" alt="${p.name}">` : `<div class="product-img" style="display:flex; align-items:center; justify-content:center; color:#ccc; font-size:2rem;"><i class="fas fa-image"></i></div>`;
      
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
      html += `<div style="text-align:center; padding: 20px;"><button class="btn btn-glass" onclick="loadMoreProducts()">แสดงเพิ่มเติม <i class="fas fa-chevron-down"></i></button></div>`;
    }
    
    prodContainer.innerHTML = html;
  }

  function loadMoreProducts() {
    state.productLimit = (state.productLimit || 5) + 5;
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
    
    const now = new Date();
    const isPromo = product.promo_price > 0 && product.promo_price < product.price && (!product.promo_expire || new Date(product.promo_expire) >= now);
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
        total: price
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
    const totalAmt = state.cart.reduce((sum, item) => sum + item.total, 0);
    
    document.getElementById('floatingCartCount').textContent = `${totalQty.toLocaleString('en-US')} รายการ`;
    document.getElementById('floatingCartTotal').textContent = `฿${totalAmt.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
  }

  function renderCart() {
    const container = document.getElementById('cartItemsContainer');
    
    if (state.cart.length === 0) {
      container.innerHTML = '<div style="text-align:center;">ไม่มีสินค้าในตะกร้า</div>';
      calculateTotal();
      return;
    }
    
    let html = '';
    state.cart.forEach((item, index) => {
      const p = state.products.find(prod => prod.id === item.product_id) || {};
      const imgHtml = p.image ? `<img src="${p.image}" class="cart-item-img">` : `<div class="cart-item-img"><i class="fas fa-image"></i></div>`;
      
      const unit = p.unit_name || 'ชิ้น';
      const itemPriceStr = parseFloat(item.price).toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:2});
      const itemTotalStr = parseFloat(item.total).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
      
      html += `
        <div class="cart-item">
          ${imgHtml}
          <div style="flex-grow:1;">
            <button class="trash-btn" onclick="removeItem(${index})"><i class="fas fa-trash-alt"></i></button>
            <div style="font-weight:600; padding-right:20px; line-height:1.2; margin-bottom:5px;">${item.name}</div>
            <div style="font-size: 0.8rem; color: var(--text-light); margin-bottom: 5px;">${unit} | ฿${itemPriceStr}</div>
            
            <div style="display:flex; justify-content:space-between; align-items:flex-end;">
              <div style="font-weight:bold; color:var(--primary); font-size:1.1rem;">฿${itemTotalStr}</div>
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
    // Add 1 hour buffer
    now.setHours(now.getHours() + 1);
    
    const h = now.getHours();
    const m = now.getMinutes();
    const currentTimeVal = h + (m/60);
    
    Array.from(timeSelect.options).forEach(opt => {
      const [optH, optM] = opt.value.split(':').map(Number);
      const optTimeVal = optH + (optM/60);
      
      const isClosed = new Date().getDay() == state.config.close_day;
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

  function calculateTotal() {
    const pickupType = document.getElementById('pickupType').value;
    const isDelivery = pickupType === 'delivery';
    document.getElementById('deliveryAddressSection').style.display = isDelivery ? 'block' : 'none';
    document.getElementById('pickupTimeSection').style.display = isDelivery ? 'block' : 'none';
    document.getElementById('deliveryFeeSection').style.display = isDelivery ? 'flex' : 'none';
    
    const subtotal = state.cart.reduce((sum, item) => sum + item.total, 0);
    document.getElementById('summarySubtotal').textContent = `฿${subtotal.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
    
    let deliveryFee = 0;
    if (isDelivery) {
      const threshold = parseFloat(state.config.free_delivery_threshold) || 200;
      const charge = parseFloat(state.config.delivery_charge) || 20;
      
      if (subtotal < threshold) {
        deliveryFee = charge;
        document.getElementById('deliveryFeeCondition').textContent = `(สั่งไม่ถึง ฿${threshold})`;
      } else {
        document.getElementById('deliveryFeeCondition').textContent = `(ส่งฟรี!)`;
      }
    } else {
      document.getElementById('deliveryFeeCondition').textContent = '';
    }
    
    document.getElementById('summaryDeliveryFee').textContent = `฿${deliveryFee.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
    
    const netTotal = subtotal + deliveryFee;
    document.getElementById('summaryTotal').textContent = `฿${netTotal.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
    
    return { subtotal, deliveryFee, netTotal };
  }

  function placeOrder() {
    if (state.cart.length === 0) return showAlert('ข้อผิดพลาด', 'ไม่มีสินค้าในตะกร้า', 'error');
    if (new Date().getDay() == state.config.close_day) return showAlert('ขออภัยค่ะ', 'วันนี้ร้านปิดทำการ ไม่สามารถสั่งซื้อได้ค่ะ', 'error');
    
    const pickupType = document.getElementById('pickupType').value;
    const rawPickupTime = document.getElementById('pickupTime').value;
    const pickupTime = pickupType === 'delivery' ? rawPickupTime : '-';
    const payment = document.getElementById('paymentType').value;
    const { subtotal, deliveryFee, netTotal } = calculateTotal();
    
    if (pickupType === 'delivery' && !state.customer.delivery_address) {
      return showAlert('ข้อผิดพลาด', 'กรุณาระบุที่อยู่จัดส่งในข้อมูลลูกค้า', 'error');
    }
    
    const orderData = {
      customer_id: state.customer.id,
      pickup_type: pickupType,
      pickup_time: pickupTime,
      payment: payment,
      delivery_fee: deliveryFee,
      total: subtotal,
      net_total: netTotal,
      pos_order_ref: ''
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
              customClass: { popup: 'glass-panel' }
            }).then(() => {
              state.cart = [];
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
  function loadOrders() {
    const container = document.getElementById('ordersContainer');
    container.innerHTML = '<div style="text-align:center; margin-top:50px;"><i class="fas fa-spinner fa-spin fa-2x text-primary"></i></div>';
    
    google.script.run.withSuccessHandler(res => {
      if (res.success) {
        state.orders = res.data.filter(o => o.customer_id === state.customer.id);
        renderOrders();
      }
    }).getOrders();
  }

  function renderOrders() {
    const container = document.getElementById('ordersContainer');
    if (state.orders.length === 0) {
      container.innerHTML = '<div style="text-align:center; padding:40px;">ไม่มีประวัติการสั่งซื้อ</div>';
      return;
    }
    
    // Sort descending
    state.orders.sort((a,b) => new Date(b.date_time) - new Date(a.date_time));
    
    let html = '';
    const statusMap = {
      'order': { label: 'รอรับออเดอร์', class: 'badge-order' },
      'preparing_order': { label: 'กำลังจัดเตรียม', class: 'badge-preparing_order' },
      'preparing_shipment': { label: 'รอจัดส่ง', class: 'badge-preparing_shipment' },
      'shipped': { label: 'จัดส่งแล้ว', class: 'badge-shipped' },
      'cancel': { label: 'ยกเลิก', class: 'badge-cancel' }
    };
    
    state.orders.forEach(o => {
      const s = statusMap[o.status] || { label: o.status, class: 'badge-order' };
      const dateStr = new Date(o.date_time).toLocaleString('th-TH');
      
      let itemsHtml = '';
      o.items.forEach(item => {
        const p = state.products.find(prod => prod.id === item.product_id);
        const name = p ? p.name : 'ไม่ระบุ';
        itemsHtml += `<div style="font-size:0.9rem; color:var(--text-light);">${item.quantity} x ${name}</div>`;
      });
      
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
                <span style="color:var(--primary); font-size:1.1rem;">฿${parseFloat(o.net_total).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
              </div>
            </div>
          </div>
        `;
      });
      
      container.innerHTML = html;
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
          Swal.showLoading();
          google.script.run.withSuccessHandler(res => {
            Swal.close();
            if(res.success) {
              loadOrders(); // reload tracking
              updateAuthUI(); // refresh badge
            } else {
              Swal.fire('ข้อผิดพลาด', 'อัปเดตไม่สำเร็จ', 'error');
            }
          }).updateOrderStatus(id, 'cancel', result.value);
        }
      });
    }