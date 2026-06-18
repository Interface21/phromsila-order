let adminState = {
    config: null,
    catalogs: [],
    products: [],
    customers: [],
    orders: [],
    chartInstance: null,
    pollingTimer: null,
    lastOrderCount: 0,
    currentOrderTarget: null // for modal
  };

  // --- Auth & Crypto ---
  async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function handleAdminLogin() {
    const pwd = document.getElementById('adminPwd').value;
    if(!pwd) return Swal.fire('Error', 'Please enter password', 'error');
    
    const btn = document.getElementById('btnAdminLogin');
    const originalText = btn.innerHTML;
    if (btn) {
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> กำลังเข้าระบบ...';
      btn.disabled = true;
    }
    
    Swal.showLoading();
    const hash = await sha256(pwd);
    
    google.script.run.withFailureHandler(e => {
      if (btn) {
        btn.innerHTML = originalText;
        btn.disabled = false;
      }
      Swal.close();
      Swal.fire('Error', e.message || e.toString(), 'error');
    }).withSuccessHandler(res => {
      if (btn) {
        btn.innerHTML = originalText;
        btn.disabled = false;
      }
      if (res.success) {
        Swal.close();
        document.getElementById('view-login').style.display = 'none';
        document.getElementById('sidebar').classList.remove('d-none');
        document.getElementById('mainContent').classList.remove('d-none');
        loadAllData();
        startPolling();
      } else {
        Swal.fire('Error', 'รหัสผ่านไม่ถูกต้อง', 'error');
      }
    }).adminLogin(hash);
  }

  function goToShop() {
    window.location.href = 'index.html';
  }

  function logout() {
    goToShop();
  }

  // --- Navigation & Core ---
  function navTo(view) {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    event.currentTarget.classList.add('active');
    
    document.querySelectorAll('.main-content .view-section').forEach(el => el.classList.remove('active'));
    document.getElementById('view-' + view).classList.add('active');
    
    if (view === 'dashboard') renderDashboard();
    if (view === 'orders') {
      renderOrders();
      document.getElementById('newOrderBadge').classList.add('d-none');
    }
  }

  function loadAllData() {
    google.script.run.withSuccessHandler(res => { if(res.success) { adminState.config = res.data; populateConfig(); } }).getConfig();
    google.script.run.withSuccessHandler(res => { if(res.success) { adminState.catalogs = res.data; renderCatalogs(); } }).getCatalogs();
    google.script.run.withSuccessHandler(res => { if(res.success) { adminState.products = res.data; renderProducts(); } }).getProducts();
    google.script.run.withSuccessHandler(res => { if(res.success) { adminState.customers = res.data; renderCustomers(); } }).getCustomers();
    fetchOrders(true); // initial fetch
  }

  // --- Smart Polling for Orders ---
  let isAdminPageVisible = true;
  let adminPollInterval = 15000;
  
  document.addEventListener('visibilitychange', () => {
    isAdminPageVisible = !document.hidden;
    if (isAdminPageVisible && !document.getElementById('view-login').classList.contains('active') && !document.getElementById('view-login').style.display) {
      // Fetch immediately if logged in and returning to tab
      fetchOrders(false);
    }
  });

  function startPolling() {
    stopPolling();
    scheduleNextAdminPoll();
  }
  
  function stopPolling() {
    if (adminState.pollingTimer) clearTimeout(adminState.pollingTimer);
    adminState.pollingTimer = null;
  }
  
  function scheduleNextAdminPoll() {
    stopPolling();
    adminState.pollingTimer = setTimeout(() => {
      adminPollInterval = isAdminPageVisible ? 15000 : 3 * 60 * 1000;
      
      if (isAdminPageVisible) {
        fetchOrders(false);
      }
      
      scheduleNextAdminPoll();
    }, adminPollInterval);
  }

  function fetchOrders(isInitial) {
    google.script.run.withSuccessHandler(res => {
      if (res.success) {
        const oldLen = adminState.orders.length;
        adminState.orders = res.data;
        
        if (!isInitial && adminState.orders.length > oldLen) {
          // New order arrived!
          Swal.fire({
            title: 'ออเดอร์ใหม่!',
            text: 'มีรายการสั่งซื้อใหม่เข้ามา',
            icon: 'info',
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 3000
          });
          const badge = document.getElementById('newOrderBadge');
          badge.textContent = adminState.orders.length - oldLen;
          badge.classList.remove('d-none');
        }
        
        if (document.getElementById('view-orders').classList.contains('active')) {
          renderOrders();
        }
        if (document.getElementById('view-dashboard').classList.contains('active')) {
          renderDashboard();
        }
      }
    }).getOrders();
  }

  // --- Dashboard ---
  let salesChartInst = null;
  let ordersChartInst = null;
  let pickupChartInst = null;

  function renderDashboard() {
    const today = new Date().toLocaleDateString('en-GB'); 
    const todayOrders = adminState.orders.filter(o => new Date(o.date_time).toLocaleDateString('en-GB') === today);
    
    const validOrders = todayOrders.filter(o => o.status !== 'cancel');
    const totalSales = validOrders.reduce((sum, o) => sum + parseFloat(o.net_total), 0);
    document.getElementById('dashSales').textContent = `฿${totalSales.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
    document.getElementById('dashOrders').textContent = validOrders.length.toLocaleString('en-US');
    
    const pendingStatuses = ['order', 'preparing_order', 'preparing_shipment'];
    const pendingOrders = adminState.orders.filter(o => pendingStatuses.includes(o.status)).length;
    const completedOrders = todayOrders.filter(o => o.status === 'shipped').length;
    document.getElementById('dashPending').textContent = pendingOrders.toLocaleString('en-US');
    document.getElementById('dashCompleted').textContent = completedOrders.toLocaleString('en-US');

    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      last7Days.push(d.toLocaleDateString('en-GB'));
    }

    const salesTrend = [];
    const ordersTrend = [];
    last7Days.forEach(dateStr => {
      const dayOrders = adminState.orders.filter(o => new Date(o.date_time).toLocaleDateString('en-GB') === dateStr && o.status !== 'cancel');
      salesTrend.push(dayOrders.reduce((sum, o) => sum + parseFloat(o.net_total), 0));
      ordersTrend.push(dayOrders.length);
    });

    const thLabels = last7Days.map(d => {
      const parts = d.split('/');
      return `${parts[0]}/${parts[1]}`;
    });

    if (salesChartInst) salesChartInst.destroy();
    if (ordersChartInst) ordersChartInst.destroy();
    if (pickupChartInst) pickupChartInst.destroy();

    const wSales = document.getElementById('salesChartWrapper');
    if (wSales) wSales.innerHTML = '<canvas id="salesTrendChart"></canvas>';
    
    const wOrders = document.getElementById('ordersChartWrapper');
    if (wOrders) wOrders.innerHTML = '<canvas id="ordersTrendChart"></canvas>';
    
    const wPickup = document.getElementById('pickupChartWrapper');
    if (wPickup) wPickup.innerHTML = '<canvas id="pickupRatioChart"></canvas>';
    const ctxSales = document.getElementById('salesTrendChart');
    if (ctxSales) {
      salesChartInst = new Chart(ctxSales.getContext('2d'), {
        type: 'bar',
        data: {
          labels: thLabels,
          datasets: [{
            label: 'ยอดขาย (บาท)',
            data: salesTrend,
            backgroundColor: '#10b981',
            borderRadius: 4
          }]
        },
        options: { 
          responsive: true, 
          maintainAspectRatio: false,
          plugins: { legend: { display: false } }
        }
      });
    }

    const ctxOrders = document.getElementById('ordersTrendChart');
    if (ctxOrders) {
      ordersChartInst = new Chart(ctxOrders.getContext('2d'), {
        type: 'line',
        data: {
          labels: thLabels,
          datasets: [{
            label: 'จำนวนออเดอร์',
            data: ordersTrend,
            borderColor: '#4A90E2',
            backgroundColor: 'rgba(74, 144, 226, 0.1)',
            fill: true,
            tension: 0.3,
            pointBackgroundColor: '#4A90E2'
          }]
        },
        options: { 
          responsive: true, 
          maintainAspectRatio: false,
          plugins: { legend: { display: false } }
        }
      });
    }

    const recentOrders = adminState.orders.filter(o => {
      const oDate = new Date(o.date_time).toLocaleDateString('en-GB');
      return last7Days.includes(oDate) && o.status !== 'cancel';
    });

    const itemCounts = {};
    recentOrders.forEach(o => {
      o.items.forEach(item => {
        if (!itemCounts[item.product_id]) itemCounts[item.product_id] = 0;
        itemCounts[item.product_id] += parseInt(item.quantity);
      });
    });

    const topItems = Object.keys(itemCounts)
      .map(id => {
        const p = adminState.products.find(prod => prod.id === id);
        return { name: p ? p.name : 'ไม่ระบุ', qty: itemCounts[id] };
      })
      .sort((a,b) => b.qty - a.qty)
      .slice(0, 5);

    let topSellersHtml = '';
    if (topItems.length === 0) {
      topSellersHtml = '<div style="text-align:center; color:var(--text-light); padding:20px;">ไม่มีข้อมูล</div>';
    } else {
      topItems.forEach((item, idx) => {
        topSellersHtml += `
          <div style="display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid #f1f5f9;">
            <div><span style="display:inline-block; width:24px; height:24px; background:#f1f5f9; text-align:center; border-radius:50%; font-weight:bold; color:var(--primary); line-height:24px; margin-right:10px;">${idx+1}</span> ${item.name}</div>
            <div style="font-weight:bold; color:var(--text-dark);">${item.qty} ชิ้น</div>
          </div>
        `;
      });
    }
    const topSellersList = document.getElementById('topSellersList');
    if (topSellersList) topSellersList.innerHTML = topSellersHtml;

    let deliveryCount = 0;
    let shopCount = 0;
    recentOrders.forEach(o => {
      if (o.pickup_type === 'delivery') deliveryCount++;
      else shopCount++;
    });

    const ctxPickup = document.getElementById('pickupRatioChart');
    if (ctxPickup) {
      pickupChartInst = new Chart(ctxPickup.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: ['จัดส่ง', 'รับที่ร้าน'],
          datasets: [{
            data: [deliveryCount, shopCount],
            backgroundColor: ['#4A90E2', '#f59e0b']
          }]
        },
        options: { 
          responsive: true, 
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom' } }
        }
      });
    }
  }

  window.removeOrderItem = function(orderId, detailId, itemName) {
    Swal.fire({
      title: 'ลบรายการสินค้า?',
      text: `คุณต้องการลบ "${itemName}" ออกจากคำสั่งซื้อใช่หรือไม่? ยอดเงินจะถูกคำนวณใหม่`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'ลบสินค้า',
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#ef4444',
    }).then(result => {
      if(result.isConfirmed) {
        Swal.fire({title: 'กำลังลบ...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
        
        google.script.run.withSuccessHandler(res => {
           if(res.success) {
             let msg = 'ลบสินค้าและคำนวณยอดเงินใหม่เรียบร้อย';
             let type = 'success';
             if (res.feeChanged) {
               msg = 'การลบสินค้านี้ทำให้ยอดรวมไม่ถึงเกณฑ์ส่งฟรี ระบบได้คิดค่าจัดส่งเพิ่มแล้ว กรุณาโทรแจ้งยืนยันกับลูกค้า';
               type = 'warning';
             }
             
             Swal.fire({
               title: 'สำเร็จ',
               text: msg,
               icon: type,
               confirmButtonText: 'รับทราบ'
             }).then(() => {
                // Reload orders
                google.script.run.withSuccessHandler(res2 => {
                  if (res2.success) {
                    adminState.orders = res2.data;
                    if (document.getElementById('view-orders').classList.contains('active')) {
                      renderOrders();
                    }
                    if (document.getElementById('view-dashboard').classList.contains('active')) {
                      renderDashboard();
                    }
                    openOrderModal(orderId);
                  }
                }).getOrders();
             });
           } else {
             showAlert('ข้อผิดพลาด', res.message || 'ไม่สามารถลบสินค้าได้', 'error');
           }
        }).removeOrderItem(orderId, detailId);
      }
    });
  }

  function getColorForStatus(s) {
    const map = {
      'order': '#4A90E2',
      'preparing_order': '#f59e0b',
      'preparing_shipment': '#ea580c',
      'shipped': '#10b981',
      'cancel': '#ef4444'
    };
    return map[s] || '#ccc';
  }

  // --- Orders (Kanban) ---
  function renderOrders() {
    const filter = document.getElementById('filterRound').value;
    
    let filteredOrders = adminState.orders;
    const today = new Date().toLocaleDateString('en-GB');
    
    filteredOrders = filteredOrders.filter(o => {
      const oDate = new Date(o.date_time).toLocaleDateString('en-GB');
      if (oDate === today) return true;
      if (o.status !== 'shipped' && o.status !== 'cancel') return true;
      return false;
    });
    
    if (filter !== 'all') {
      filteredOrders = filteredOrders.filter(o => o.pickup_time === filter);
    }
    
    const cols = ['order', 'preparing_order', 'preparing_shipment', 'shipped', 'cancel'];
    cols.forEach(c => {
      const container = document.querySelector(`#col-${c} .kanban-list`);
      container.innerHTML = '';
      
      const items = filteredOrders.filter(o => o.status === c);
      items.forEach(o => {
        const div = document.createElement('div');
        const oDate = new Date(o.date_time).toLocaleDateString('en-GB');
        const oDateTh = new Date(o.date_time).toLocaleDateString('th-TH');
        const isPast = oDate !== today;
        
        div.className = 'order-card glass';
        if (isPast) {
          div.setAttribute('style', 'background-color: #fff1f2 !important; border: 1px solid #fecdd3 !important;');
        }
        
        div.innerHTML = `
          <div style="font-weight:bold;">${o.order_no}</div>
          <div style="font-size:0.8rem; color:var(--text-light); margin:5px 0;">
            ${isPast ? `<span style="color:#ef4444; font-weight:bold;">${oDateTh}</span> ` : ''}${new Date(o.date_time).toLocaleTimeString('th-TH')} | ${o.pickup_time || '-'}
          </div>
          <div>ยอด: ฿${parseFloat(o.net_total).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</div>
        `;
        div.onclick = () => openOrderModal(o.id);
        container.appendChild(div);
      });
    });
  }

  function openOrderModal(id) {
    const o = adminState.orders.find(x => x.id === id);
    if (!o) return;
    adminState.currentOrderTarget = o.id;
    
    document.getElementById('ord_no').textContent = `คำสั่งซื้อ: ${o.order_no}`;
    
    const cust = adminState.customers.find(c => c.id === o.customer_id);
    const custName = cust ? cust.name : 'ไม่ระบุ';
    
    let paymentText = '<span style="color:#3b82f6; font-weight:bold;">โอนเงิน / สแกนคิวอาร์โค้ด</span>';
    if (o.payment === 'cash') paymentText = '<span style="color:#eab308; font-weight:bold;">เงินสดปลายทาง</span>';
    else if (o.payment === 'thaiplus') paymentText = '<span style="color:#8b5cf6; font-weight:bold;">โครงการรัฐ</span>';
    const custPhone = cust && cust.mobile_no ? `<span class="badge badge-order" style="margin-left:5px; display:inline-flex; align-items:center; gap:4px; font-weight:normal;"><i class="fas fa-phone-alt"></i> ${cust.mobile_no}</span>` : '';
    const deliveryAddr = o.pickup_type === 'delivery' ? `<br>ที่อยู่จัดส่ง: ${cust ? (cust.delivery_address || 'ไม่ระบุ') : 'ไม่ระบุ'}` : '';
    
    document.getElementById('ord_info').innerHTML = `
      ลูกค้า: ${custName} ${custPhone} <br>
      รูปแบบ: ${o.pickup_type === 'delivery' ? 'จัดส่ง' : 'รับที่ร้าน'} ${deliveryAddr} <br>
      ${o.pickup_time === '-' ? '' : 'รอบ: ' + o.pickup_time + '<br>'}
      วิธีชำระเงิน: ${paymentText}
      ${o.status === 'cancel' && o.cancel_reason ? '<br><span style="color:#ef4444; font-weight:bold;">เหตุผลยกเลิก: ' + o.cancel_reason + '</span>' : ''}
    `;
    
    let itemsHtml = '<table class="glass-table"><thead><tr><th style="width: 40px; text-align:center;"></th><th>รายการ</th><th>จำนวน</th><th style="text-align:right;">ราคา</th></tr></thead><tbody>';
    o.items.forEach(item => {
      const p = adminState.products.find(prod => prod.id === item.product_id);
      const unit = p ? (p.unit_name || 'ชิ้น') : 'ชิ้น';
      
      const canDelete = o.status !== 'shipped' && o.status !== 'cancel';
      const delBtn = canDelete ? `<button style="background: transparent; padding: 4px 8px; font-size: 0.9rem; border-radius: 6px; border: none; cursor: pointer; color: #94a3b8; transition: all 0.2s;" onmouseover="this.style.color='#ef4444'; this.style.background='#fee2e2';" onmouseout="this.style.color='#94a3b8'; this.style.background='transparent';" onclick="removeOrderItem('${o.id}', '${item.id}', '${p ? p.name : 'สินค้านี้'}')" title="ลบรายการนี้"><i class="fas fa-trash-alt"></i></button>` : '';
      
      itemsHtml += `<tr><td style="text-align:center;">${delBtn}</td><td>${p ? p.name : 'ไม่ระบุ'}</td><td>${item.quantity} ${unit}</td><td style="text-align:right;">฿${parseFloat(item.total).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</td></tr>`;
    });
    itemsHtml += '</tbody></table>';
    
    document.getElementById('ord_items').innerHTML = itemsHtml;
    
    let discountHtml = '';
    const discount = parseFloat(o.coupon_discount || 0);
    if (discount > 0) {
      discountHtml = `
        <div style="display: flex; justify-content: flex-end; gap: 20px; margin-bottom: 8px; width: 250px;">
          <span>ส่วนลดรวม:</span>
          <span style="width: 90px; text-align: right; color: #ef4444;">-฿${discount.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
        </div>
      `;
    }

    let summaryHtml = `
      <div style="font-size: 0.95rem; color: var(--text-light); text-align: right; display: flex; flex-direction: column; align-items: flex-end;">
        <div style="display: flex; justify-content: flex-end; gap: 20px; margin-bottom: 8px; width: 250px;">
          <span>รวมค่าสินค้า:</span>
          <span style="width: 90px; text-align: right;">฿${parseFloat(o.total || 0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 20px; margin-bottom: 8px; width: 250px;">
          <span>ค่าจัดส่ง:</span>
          <span style="width: 90px; text-align: right;">${parseFloat(o.delivery_fee || 0) > 0 ? '฿' + parseFloat(o.delivery_fee).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}) : '<span style="color:#10b981;">ส่งฟรี!</span>'}</span>
        </div>
        ${discountHtml}
        <div style="display: flex; justify-content: flex-end; gap: 20px; margin-bottom: 5px; color: var(--primary); font-weight: bold; font-size: 1.15rem; border-top: 1px dashed rgba(0,0,0,0.1); padding-top: 10px; width: 250px;">
          <span>ยอดสุทธิ:</span>
          <span style="width: 90px; text-align: right;">฿${parseFloat(o.net_total).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
        </div>
      </div>
    `;
    
    document.getElementById('ord_total').innerHTML = summaryHtml;
    
    // Reset all buttons to gray
    const statuses = ['order', 'preparing_order', 'preparing_shipment', 'shipped', 'cancel'];
    statuses.forEach(s => {
      const btn = document.getElementById('btnStatus_' + s);
      if(btn) {
         btn.style.background = '#e2e8f0';
         btn.style.color = '#475569';
         btn.style.boxShadow = 'none';
         btn.style.border = 'none';
      }
    });
    // Highlight current status
    const activeBtn = document.getElementById('btnStatus_' + o.status);
    if (activeBtn) {
       activeBtn.style.color = '#ffffff';
       if (o.status === 'order') activeBtn.style.background = '#4A90E2';
       else if (o.status === 'preparing_order') activeBtn.style.background = '#f59e0b';
       else if (o.status === 'preparing_shipment') activeBtn.style.background = '#ea580c';
       else if (o.status === 'shipped') activeBtn.style.background = '#10b981';
       else if (o.status === 'cancel') activeBtn.style.background = '#ef4444';
    }
    
    // Lock buttons if finished or canceled
    const isLocked = o.status === 'shipped' || o.status === 'cancel';
    statuses.forEach(s => {
      const btn = document.getElementById('btnStatus_' + s);
      if(btn) {
         btn.disabled = isLocked;
         if (isLocked) {
           btn.style.opacity = '0.6';
           btn.style.cursor = 'not-allowed';
         } else {
           btn.style.opacity = '1';
           btn.style.cursor = 'pointer';
         }
      }
    });
    
    document.getElementById('modal-order').classList.add('active');
  }

  function changeOrderStatus(newStatus) {
    if (!newStatus) return;
    if (newStatus === 'cancel') {
      Swal.fire({
        title: 'ระบุเหตุผลการยกเลิก',
        input: 'text',
        inputPlaceholder: 'ใส่เหตุผลที่นี่...',
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
          executeChangeStatus(newStatus, result.value);
        }
      });
    } else {
      executeChangeStatus(newStatus, '');
    }
  }

  function executeChangeStatus(newStatus, reason) {
    Swal.showLoading();
    google.script.run.withSuccessHandler(res => {
      Swal.close();
      if(res.success) {
        closeModal('modal-order');
        fetchOrders(true); // reload
      } else {
        Swal.fire('ข้อผิดพลาด', 'อัปเดตไม่สำเร็จ', 'error');
      }
    }).updateOrderStatus(adminState.currentOrderTarget, newStatus, reason);
  }

  // --- Catalogs ---
  function renderCatalogs() {
    const tbody = document.getElementById('catalogTableBody');
    tbody.innerHTML = '';
    adminState.catalogPage = adminState.catalogPage || 1;
    const limit = 10;
    const startIndex = (adminState.catalogPage - 1) * limit;
    const displayed = adminState.catalogs.slice(startIndex, startIndex + limit);
    
    displayed.forEach(c => {
      tbody.innerHTML += `
        <tr>
          <td>${c.name}</td>
          <td>
            <label class="switch">
              <input type="checkbox" ${c.active ? 'checked' : ''} onchange="toggleCatalogActive('${c.id}', this)">
              <span class="slider"></span>
            </label>
          </td>
          <td>
            <button class="btn btn-glass" onclick="editCatalog('${c.id}')"><i class="fas fa-edit"></i></button>
            <button class="btn btn-danger" onclick="deleteCatalog('${c.id}')"><i class="fas fa-trash"></i></button>
          </td>
        </tr>
      `;
    });
    
    // Pagination
    const totalPages = Math.ceil(adminState.catalogs.length / limit);
    let pageHtml = '';
    for(let i=1; i<=totalPages; i++) {
      pageHtml += `<button class="btn ${i === adminState.catalogPage ? 'btn-primary' : 'btn-glass'}" style="padding:5px 10px; margin: 0 2px;" onclick="adminState.catalogPage=${i}; renderCatalogs()">${i}</button>`;
    }
    document.getElementById('catalogPagination').innerHTML = totalPages > 1 ? pageHtml : '';
    
    // populate select in product modal
    const opts = adminState.catalogs.filter(c => c.active).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    document.getElementById('prod_catalog_id').innerHTML = opts;
    
    // populate filter dropdown
    const filterSelect = document.getElementById('filterProductCatalog');
    const currentFilter = filterSelect.value;
    filterSelect.innerHTML = `<option value="all">ทุกหมวดหมู่</option>` + opts;
    if (adminState.catalogs.find(c => c.id === currentFilter)) {
      filterSelect.value = currentFilter;
    } else {
      filterSelect.value = 'all';
    }
  }

  function openCatalogModal() {
    document.getElementById('cat_id').value = '';
    document.getElementById('cat_name').value = '';
    document.getElementById('cat_active').value = 'true';
    document.getElementById('modal-catalog').classList.add('active');
  }

  function editCatalog(id) {
    const c = adminState.catalogs.find(x => x.id === id);
    if (!c) return;
    document.getElementById('cat_id').value = c.id;
    document.getElementById('cat_name').value = c.name;
    document.getElementById('cat_active').checked = c.active;
    document.getElementById('modal-catalog').classList.add('active');
  }

  function saveCatalog() {
    const data = {
      id: document.getElementById('cat_id').value,
      name: document.getElementById('cat_name').value,
      active: document.getElementById('cat_active').checked
    };
    Swal.showLoading();
    google.script.run.withSuccessHandler(res => {
      Swal.close();
      if(res.success) {
        closeModal('modal-catalog');
        google.script.run.withSuccessHandler(r => { adminState.catalogs = r.data; renderCatalogs(); }).getCatalogs();
      }
    }).saveCatalog(data);
  }

  function deleteCatalog(id) {
    if(!confirm('คุณแน่ใจหรือไม่ที่จะลบรายการนี้?')) return;
    Swal.showLoading();
    google.script.run.withSuccessHandler(res => {
      Swal.close();
      if(res.success) {
        google.script.run.withSuccessHandler(r => { adminState.catalogs = r.data; renderCatalogs(); }).getCatalogs();
      }
    }).deleteCatalog(id);
  }

  // --- Products ---
  function renderProducts() {
    const tbody = document.getElementById('productTableBody');
    tbody.innerHTML = '';
    
    const filterCat = document.getElementById('filterProductCatalog').value;
    const searchQ = document.getElementById('searchProductAdmin') ? document.getElementById('searchProductAdmin').value.toLowerCase() : '';
    let filteredProducts = adminState.products;
    
    if (searchQ) {
      filteredProducts = filteredProducts.filter(p => p.name.toLowerCase().includes(searchQ));
    }
    if (filterCat !== 'all') {
      filteredProducts = filteredProducts.filter(p => p.catalog_id === filterCat);
    }
    
    adminState.productPage = adminState.productPage || 1;
    const limit = 10;
    const startIndex = (adminState.productPage - 1) * limit;
    const displayed = filteredProducts.slice(startIndex, startIndex + limit);
    
    displayed.forEach(p => {
      const cat = adminState.catalogs.find(c => c.id === p.catalog_id);
      const unit = p.unit_name || 'ชิ้น';
      const imgHtml = p.image ? `<img src="${p.image}" width="40" height="40" style="border-radius:8px; object-fit:cover;">` : `<div style="width:40px; height:40px; border-radius:8px; background:#ddd; display:flex; align-items:center; justify-content:center; color:#888;"><i class="fas fa-image"></i></div>`;
      tbody.innerHTML += `
        <tr>
          <td>${imgHtml}</td>
          <td>${p.name}</td>
          <td>${cat ? cat.name : '-'}</td>
          <td>฿${parseFloat(p.price).toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:2})}/${unit}</td>
          <td>${p.promo_price > 0 ? '฿'+parseFloat(p.promo_price).toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:2})+'/'+unit : '-'}</td>
          <td>
            <label class="switch">
              <input type="checkbox" ${p.active ? 'checked' : ''} onchange="toggleProductActive('${p.id}', this)">
              <span class="slider"></span>
            </label>
          </td>
          <td>
            <button class="btn btn-glass" onclick="editProduct('${p.id}')"><i class="fas fa-edit"></i></button>
            <button class="btn btn-danger" onclick="deleteProduct('${p.id}')"><i class="fas fa-trash"></i></button>
          </td>
        </tr>
      `;
    });
    
    // Pagination
    const totalPages = Math.ceil(filteredProducts.length / limit);
    let pageHtml = '';
    for(let i=1; i<=totalPages; i++) {
      pageHtml += `<button class="btn ${i === adminState.productPage ? 'btn-primary' : 'btn-glass'}" style="padding:5px 10px; margin: 0 2px;" onclick="adminState.productPage=${i}; renderProducts()">${i}</button>`;
    }
    const pagDiv = document.getElementById('productPagination');
    if(pagDiv) pagDiv.innerHTML = totalPages > 1 ? pageHtml : '';
  }

  function openProductModal() {
    document.getElementById('prod_id').value = '';
    
    const filterCat = document.getElementById('filterProductCatalog').value;
    if (filterCat !== 'all') {
      document.getElementById('prod_catalog_id').value = filterCat;
    }
    
    document.getElementById('prod_name').value = '';
    document.getElementById('prod_price').value = '';
    document.getElementById('prod_promo_price').value = '0';
    document.getElementById('prod_promo_expire').value = '';
    document.getElementById('prod_image_url').value = '';
    if (document.getElementById('prod_image_file')) document.getElementById('prod_image_file').value = '';
    document.getElementById('img_preview').innerHTML = '';
    document.getElementById('modal-product').classList.add('active');
  }

  function editProduct(id) {
    const p = adminState.products.find(x => x.id === id);
    if (!p) return;
    document.getElementById('prod_id').value = p.id;
    document.getElementById('prod_catalog_id').value = p.catalog_id;
    document.getElementById('prod_name').value = p.name;
    document.getElementById('prod_price').value = p.price;
    document.getElementById('prod_promo_price').value = p.promo_price;
    if (p.promo_expire) {
      const d = new Date(p.promo_expire);
      if (!isNaN(d.getTime())) {
        document.getElementById('prod_promo_expire').value = p.promo_expire.split('T')[0];
      } else {
        document.getElementById('prod_promo_expire').value = '';
      }
    }
    document.getElementById('prod_active').checked = p.active;
    document.getElementById('prod_image_url').value = p.image;
    document.getElementById('img_preview').innerHTML = `<img src="${p.image}" width="100" style="border-radius:8px;">`;
    document.getElementById('modal-product').classList.add('active');
  }

  function saveProduct() {
    const fileInput = document.getElementById('prod_image_file');
    if (fileInput.files.length > 0) {
      // Upload image first
      const file = fileInput.files[0];
      const reader = new FileReader();
      reader.onloadend = function() {
        Swal.showLoading();
        google.script.run.withSuccessHandler(res => {
          if(!res.success) { Swal.fire('ข้อผิดพลาด', res.data || 'อัปโหลดรูปภาพไม่สำเร็จ', 'error'); return; }
          document.getElementById('prod_image_url').value = res.data;
          submitProductData();
        }).uploadFileToDrive(reader.result, file.name);
      };
      reader.readAsDataURL(file);
    } else {
      submitProductData();
    }
  }

  function submitProductData() {
    const data = {
      id: document.getElementById('prod_id').value,
      catalog_id: document.getElementById('prod_catalog_id').value,
      name: document.getElementById('prod_name').value,
      price: document.getElementById('prod_price').value,
      promo_price: document.getElementById('prod_promo_price').value || 0,
      promo_expire: document.getElementById('prod_promo_expire').value || '',
      image: document.getElementById('prod_image_url').value,
      active: document.getElementById('prod_active').checked,
      sku_code: '',
      unit_name: 'ชิ้น'
    };
    Swal.showLoading();
    google.script.run.withSuccessHandler(res => {
      Swal.close();
      if(res.success) {
        closeModal('modal-product');
        google.script.run.withSuccessHandler(r => { adminState.products = r.data; renderProducts(); }).getProducts();
      }
    }).saveProduct(data);
  }

  function deleteProduct(id) {
    if(!confirm('คุณแน่ใจหรือไม่ที่จะลบสินค้านี้?')) return;
    Swal.showLoading();
    google.script.run.withSuccessHandler(res => {
      Swal.close();
      if(res.success) {
        google.script.run.withSuccessHandler(r => { adminState.products = r.data; renderProducts(); }).getProducts();
      }
    }).deleteProduct(id);
  }

  // --- Customers ---
  function renderCustomers() {
    const tbody = document.getElementById('customerTableBody');
    tbody.innerHTML = '';
    
    const searchQ = document.getElementById('searchCustomerAdmin') ? document.getElementById('searchCustomerAdmin').value.toLowerCase() : '';
    let filteredCustomers = adminState.customers;
    
    if (searchQ) {
      filteredCustomers = filteredCustomers.filter(c => 
        (c.name && c.name.toLowerCase().includes(searchQ)) || 
        (c.mobile_no && c.mobile_no.toLowerCase().includes(searchQ))
      );
    }
    
    adminState.customerPage = adminState.customerPage || 1;
    const limit = 10;
    const startIndex = (adminState.customerPage - 1) * limit;
    const displayed = filteredCustomers.slice(startIndex, startIndex + limit);
    
    displayed.forEach(c => {
      tbody.innerHTML += `
        <tr>
          <td>${c.name}</td>
          <td>${c.mobile_no}</td>
          <td>${c.delivery_address || '-'}</td>
          <td>
            <label class="switch">
              <input type="checkbox" ${c.active ? 'checked' : ''} onchange="toggleCustomerActive('${c.id}', this)">
              <span class="slider"></span>
            </label>
          </td>
          <td>
            <button class="btn btn-glass" onclick="editCustomer('${c.id}')"><i class="fas fa-edit"></i></button>
          </td>
        </tr>
      `;
    });
    
    // Pagination
    const totalPages = Math.ceil(filteredCustomers.length / limit);
    let pageHtml = '';
    for(let i=1; i<=totalPages; i++) {
      pageHtml += `<button class="btn ${i === adminState.customerPage ? 'btn-primary' : 'btn-glass'}" style="padding:5px 10px; margin: 0 2px;" onclick="adminState.customerPage=${i}; renderCustomers()">${i}</button>`;
    }
    const pagDiv = document.getElementById('customerPagination');
    if(pagDiv) pagDiv.innerHTML = totalPages > 1 ? pageHtml : '';
  }

  function editCustomer(id) {
    const c = adminState.customers.find(x => x.id === id);
    if (!c) return;
    document.getElementById('cust_id').value = c.id;
    document.getElementById('cust_name').value = c.name;
    document.getElementById('cust_phone').value = c.mobile_no;
    document.getElementById('cust_address').value = c.delivery_address || '';
    document.getElementById('cust_banned').checked = !c.active; // banned = not active
    document.getElementById('modal-customer').classList.add('active');
  }

  function saveCustomer() {
    const data = {
      id: document.getElementById('cust_id').value,
      name: document.getElementById('cust_name').value,
      mobile_no: document.getElementById('cust_phone').value,
      delivery_address: document.getElementById('cust_address').value,
      active: !document.getElementById('cust_banned').checked
    };
    
    // Merge with existing data
    const c = adminState.customers.find(x => x.id === data.id);
    if (c) {
      data.delivery_count_accumulate = c.delivery_count_accumulate || 0;
      data.delivery_count_usage = c.delivery_count_usage || 0;
    }

    Swal.showLoading();
    google.script.run.withSuccessHandler(res => {
      Swal.close();
      if(res.success) {
        closeModal('modal-customer');
        google.script.run.withSuccessHandler(r => { adminState.customers = r.data; renderCustomers(); }).getCustomers();
      }
    }).saveCustomer(data);
  }

  function toggleCustomerActive(id, el) {
    const c = adminState.customers.find(x => x.id === id);
    if (!c) return;
    c.active = el.checked;
    google.script.run.saveCustomer(c);
  }

  // --- Coupons ---
  function renderCoupons() {
    const tbody = document.getElementById('couponTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const searchQ = document.getElementById('searchCouponAdmin') ? document.getElementById('searchCouponAdmin').value.toLowerCase() : '';
    
    // Filter customers who have accumulate > 0
    let filteredCustomers = adminState.customers.filter(c => parseInt(c.delivery_count_accumulate || 0) > 0);
    
    if (searchQ) {
      filteredCustomers = filteredCustomers.filter(c => 
        (c.name && c.name.toLowerCase().includes(searchQ)) || 
        (c.mobile_no && c.mobile_no.toLowerCase().includes(searchQ))
      );
    }
    
    adminState.couponPage = adminState.couponPage || 1;
    const limit = 10;
    const startIndex = (adminState.couponPage - 1) * limit;
    const displayed = filteredCustomers.slice(startIndex, startIndex + limit);
    
    const reqCount = parseInt(adminState.config.delivery_count || 10);
    
    displayed.forEach(c => {
      const accumulate = parseInt(c.delivery_count_accumulate || 0);
      const usage = parseInt(c.delivery_count_usage || 0);
      const available = accumulate - usage;
      
      const canRedeem = available >= reqCount;
      const redeemBtn = canRedeem ? `<button class="btn btn-primary" style="padding: 4px 10px; font-size: 0.8rem;" onclick="redeemCouponForCustomer('${c.id}')"><i class="fas fa-gift"></i> แลกคูปอง</button>` : `<span style="font-size: 0.8rem; color: #94a3b8;">ยังไม่ถึงเกณฑ์</span>`;
      
      tbody.innerHTML += `
        <tr>
          <td>${c.name}</td>
          <td>${c.mobile_no}</td>
          <td>${accumulate}</td>
          <td style="color: ${canRedeem ? 'var(--success)' : 'var(--text-dark)'}; font-weight: bold;">${available}</td>
          <td>${redeemBtn}</td>
        </tr>
      `;
    });
    
    const totalPages = Math.ceil(filteredCustomers.length / limit);
    let pageHtml = '';
    for(let i=1; i<=totalPages; i++) {
      pageHtml += `<button class="btn ${i === adminState.couponPage ? 'btn-primary' : 'btn-glass'}" style="padding:5px 10px; margin: 0 2px;" onclick="adminState.couponPage=${i}; renderCoupons()">${i}</button>`;
    }
    const pagDiv = document.getElementById('couponPagination');
    if(pagDiv) pagDiv.innerHTML = totalPages > 1 ? pageHtml : '';
  }

  function redeemCouponForCustomer(customerId) {
    Swal.fire({
      title: 'ยืนยันแลกคูปอง?',
      text: "คุณต้องการแลกคูปองส่วนลดให้ลูกค้าท่านนี้ใช่หรือไม่?",
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'ยืนยัน',
      cancelButtonText: 'ยกเลิก'
    }).then((result) => {
      if (result.isConfirmed) {
        Swal.showLoading();
        google.script.run.withFailureHandler(e => {
          Swal.close();
          Swal.fire('Error', e.message || e.toString(), 'error');
        }).withSuccessHandler(res => {
          if (res.success) {
            Swal.fire('สำเร็จ', 'แลกคูปองให้ลูกค้าเรียบร้อยแล้ว', 'success');
            google.script.run.withSuccessHandler(r => { adminState.customers = r.data; renderCoupons(); renderCustomers(); }).getCustomers();
          } else {
            Swal.fire('Error', res.message || 'เกิดข้อผิดพลาด', 'error');
          }
        }).redeemCoupon(customerId);
      }
    });
  }

  function toggleProductActive(id, el) {
    const p = adminState.products.find(x => x.id === id);
    if (!p) return;
    p.active = el.checked;
    google.script.run.saveProduct(p);
  }

  function toggleCatalogActive(id, el) {
    const c = adminState.catalogs.find(x => x.id === id);
    if (!c) return;
    c.active = el.checked;
    google.script.run.saveCatalog(c);
  }

  // --- Config ---
  function populateConfig() {
    const c = adminState.config;
    if(!c) return;
    document.getElementById('cfg_shop_name').value = c.shop_name || '';
    document.getElementById('cfg_mobile_no').value = c.mobile_no || '';
    document.getElementById('cfg_line_id').value = c.line_id || '';
    document.getElementById('cfg_delivery_charge').value = c.delivery_charge || 0;
    document.getElementById('cfg_free_delivery_threshold').value = c.free_delivery_threshold || 0;
    document.getElementById('cfg_delivery_count').value = c.delivery_count || 10;
    document.getElementById('cfg_coupon_discount').value = c.coupon_discount || 20;
    
    const closeDays = String(c.close_day != null ? c.close_day : '').split(',');
    document.querySelectorAll('.chk-close-day').forEach(chk => {
      chk.checked = closeDays.includes(chk.value);
    });
  }

  async function saveConfig() {
    const newPwd = document.getElementById('cfg_new_pwd').value;
    let pwdHash = null;
    if (newPwd) {
      pwdHash = await sha256(newPwd);
    }
    
    const selectedDays = Array.from(document.querySelectorAll('.chk-close-day:checked')).map(chk => chk.value).join(',');

    const data = {
      shop_name: document.getElementById('cfg_shop_name').value,
      mobile_no: document.getElementById('cfg_mobile_no').value,
      line_id: document.getElementById('cfg_line_id').value,
      delivery_charge: document.getElementById('cfg_delivery_charge').value,
      free_delivery_threshold: document.getElementById('cfg_free_delivery_threshold').value,
      delivery_count: document.getElementById('cfg_delivery_count').value,
      coupon_discount: document.getElementById('cfg_coupon_discount').value,
      close_day: selectedDays,
      pwd: adminState.config.pwd
    };
    
    Swal.showLoading();
    google.script.run.withSuccessHandler(res => {
      if(res.success) {
        Swal.fire('สำเร็จ', 'บันทึกการตั้งค่าเรียบร้อยแล้ว', 'success');
        document.getElementById('cfg_new_pwd').value = '';
        google.script.run.withSuccessHandler(r => { if(r.success) adminState.config = r.data; }).getConfig();
      } else {
        Swal.fire('ข้อผิดพลาด', 'บันทึกไม่สำเร็จ', 'error');
      }
    }).updateConfig(data, pwdHash);
  }

  // --- Utils ---
  function closeModal(id) {
    document.getElementById(id).classList.remove('active');
  }

  // --- Events ---
  document.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      const activeModal = document.querySelector('.custom-modal.active');
      if (activeModal) {
        // Prevent default form submission if any
        e.preventDefault();
        const primaryBtn = activeModal.querySelector('.btn-primary');
        if (primaryBtn) primaryBtn.click();
      }
    }
  });