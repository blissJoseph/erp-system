// Single-page front end for the ERP draft (no build step).
const $ = (sel) => document.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.className = ''), 2500);
}

// ---------- Master data definitions ----------
const MASTER = {
  products: {
    title: 'Products', singular: 'Product',
    fields: [
      { key: 'sku', label: 'SKU', required: true },
      { key: 'name', label: 'Name', required: true },
      { key: 'category', label: 'Category' },
      { key: 'unit_price', label: 'Sale price', type: 'number', num: true },
      { key: 'cost', label: 'Cost', type: 'number', num: true },
      { key: 'stock', label: 'Stock', type: 'number', num: true, int: true },
      { key: 'reorder_level', label: 'Reorder level', type: 'number', num: true, int: true },
    ],
    cell: (f, row) => (f.key === 'stock' && row.stock <= row.reorder_level ? `<span class="low">${row.stock} ⚠</span>` : null),
  },
  customers: { title: 'Customers', singular: 'Customer', fields: contactFields() },
  suppliers: { title: 'Suppliers', singular: 'Supplier', fields: contactFields() },
  employees: {
    title: 'Employees', singular: 'Employee',
    fields: [
      { key: 'name', label: 'Name', required: true },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'department', label: 'Department' },
      { key: 'position', label: 'Position' },
      { key: 'salary', label: 'Salary', type: 'number', num: true },
      { key: 'hire_date', label: 'Hire date', type: 'date' },
    ],
  },
};
function contactFields() {
  return [
    { key: 'name', label: 'Name', required: true },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'phone', label: 'Phone' },
    { key: 'address', label: 'Address' },
  ];
}

const ORDERS = {
  'sales-orders': {
    title: 'Sales Orders', kind: 'sales', partyKey: 'customer_id', partyLabel: 'Customer', partyRes: 'customers', priceKey: 'unit_price',
    next: { draft: ['confirmed', 'cancelled'], confirmed: ['shipped', 'cancelled'] },
  },
  'purchase-orders': {
    title: 'Purchase Orders', kind: 'purchase', partyKey: 'supplier_id', partyLabel: 'Supplier', partyRes: 'suppliers', priceKey: 'cost',
    next: { draft: ['ordered', 'cancelled'], ordered: ['received', 'cancelled'] },
  },
};
const ACTION_LABEL = { confirmed: 'Confirm', shipped: 'Ship', ordered: 'Order', received: 'Receive', cancelled: 'Cancel' };

// ---------- Modal ----------
let modalSubmit = null;
function openModal(title, bodyHtml, onSubmit) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHtml;
  $('#modal-error').textContent = '';
  modalSubmit = onSubmit;
  $('#modal').showModal();
}
$('#modal-cancel').onclick = () => $('#modal').close();
$('#modal-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await modalSubmit(); $('#modal').close(); } catch (err) { $('#modal-error').textContent = err.message; }
});

// ---------- Views ----------
async function renderDashboard() {
  setHeader('Dashboard');
  const d = await api('/dashboard');
  const card = (label, value) => `<div class="card"><div class="label">${label}</div><div class="value">${value}</div></div>`;
  $('#view').innerHTML = `
    <div class="cards">
      ${card('Revenue (confirmed)', money(d.revenue))}
      ${card('Purchases (received)', money(d.purchases))}
      ${card('Inventory value (cost)', money(d.inventory_value))}
      ${card('Open sales orders', d.open_sales)}
      ${card('Open purchase orders', d.open_purchases)}
      ${card('Products', d.products)}
      ${card('Customers', d.customers)}
      ${card('Suppliers', d.suppliers)}
      ${card('Employees', d.employees)}
    </div>
    <div class="panel"><h3>Low stock alerts</h3>
      ${d.low_stock.length ? `<table><thead><tr><th>SKU</th><th>Product</th><th class="num">Stock</th><th class="num">Reorder level</th></tr></thead><tbody>
        ${d.low_stock.map((p) => `<tr><td>${esc(p.sku)}</td><td>${esc(p.name)}</td><td class="num low">${p.stock}</td><td class="num">${p.reorder_level}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">All products are above their reorder level.</div>'}
    </div>`;
}

async function renderMaster(res) {
  const def = MASTER[res];
  setHeader(def.title, `<button class="btn primary" id="add">+ New ${def.singular}</button>`);
  $('#add').onclick = () => editMaster(res, null);
  const rows = await api('/' + res);
  if (!rows.length) { $('#view').innerHTML = `<div class="panel"><div class="empty">No ${def.title.toLowerCase()} yet.</div></div>`; return; }
  $('#view').innerHTML = `<div class="panel"><table>
    <thead><tr>${def.fields.map((f) => `<th class="${f.num ? 'num' : ''}">${f.label}</th>`).join('')}<th></th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      ${def.fields.map((f) => {
        const custom = def.cell && def.cell(f, r);
        const val = custom ?? (f.num && !f.int ? money(r[f.key]) : esc(r[f.key]));
        return `<td class="${f.num ? 'num' : ''}">${val}</td>`;
      }).join('')}
      <td class="actions"><button class="btn sm" data-edit="${r.id}">Edit</button> <button class="btn sm danger" data-del="${r.id}">Delete</button></td>
    </tr>`).join('')}</tbody></table></div>`;
  $('#view').querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => editMaster(res, rows.find((r) => r.id == b.dataset.edit))));
  $('#view').querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Delete this record?')) return;
    try { await api(`/${res}/${b.dataset.del}`, { method: 'DELETE' }); toast('Deleted'); route(); } catch (e) { toast(e.message, true); }
  }));
}

function editMaster(res, row) {
  const def = MASTER[res];
  const body = def.fields.map((f) => `<div class="field"><label>${f.label}${f.required ? ' *' : ''}</label>
    <input name="${f.key}" type="${f.type || 'text'}" ${f.type === 'number' ? 'step="any"' : ''} ${f.required ? 'required' : ''} value="${esc(row ? row[f.key] : '')}"></div>`).join('');
  openModal((row ? 'Edit ' : 'New ') + def.singular, body, async () => {
    const data = {};
    for (const f of def.fields) {
      const v = $(`#modal-body [name="${f.key}"]`).value.trim();
      data[f.key] = f.type === 'number' ? (v === '' ? 0 : Number(v)) : v;
    }
    await api(row ? `/${res}/${row.id}` : `/${res}`, { method: row ? 'PUT' : 'POST', body: data });
    toast('Saved');
    route();
  });
}

async function renderOrders(res) {
  const def = ORDERS[res];
  setHeader(def.title, `<button class="btn primary" id="add">+ New order</button>`);
  $('#add').onclick = () => newOrder(res);
  const rows = await api('/' + res);
  if (!rows.length) { $('#view').innerHTML = `<div class="panel"><div class="empty">No orders yet.</div></div>`; return; }
  $('#view').innerHTML = `<div class="panel"><table>
    <thead><tr><th>No.</th><th>Date</th><th>${def.partyLabel}</th><th>Status</th><th class="num">Total</th><th></th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td>${def.kind === 'sales' ? 'SO' : 'PO'}-${String(r.id).padStart(5, '0')}</td>
      <td>${esc(r.order_date)}</td><td>${esc(r.party_name)}</td>
      <td><span class="badge ${r.status}">${r.status}</span></td>
      <td class="num">${money(r.total)}</td>
      <td class="actions">
        <button class="btn sm" data-view="${r.id}">View</button>
        ${(def.next[r.status] || []).map((s) => `<button class="btn sm ${s === 'cancelled' ? 'danger' : ''}" data-id="${r.id}" data-status="${s}">${ACTION_LABEL[s]}</button>`).join(' ')}
        ${r.status === 'draft' || r.status === 'cancelled' ? `<button class="btn sm danger" data-del="${r.id}">Delete</button>` : ''}
      </td></tr>`).join('')}</tbody></table></div>`;
  $('#view').querySelectorAll('[data-status]').forEach((b) => (b.onclick = async () => {
    try { await api(`/${res}/${b.dataset.id}/status`, { method: 'POST', body: { status: b.dataset.status } }); toast('Status updated'); route(); }
    catch (e) { toast(e.message, true); }
  }));
  $('#view').querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Delete this order?')) return;
    try { await api(`/${res}/${b.dataset.del}`, { method: 'DELETE' }); toast('Deleted'); route(); } catch (e) { toast(e.message, true); }
  }));
  $('#view').querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => viewOrder(res, b.dataset.view)));
}

async function viewOrder(res, id) {
  const o = await api(`/${res}/${id}`);
  const def = ORDERS[res];
  openModal(`${def.kind === 'sales' ? 'SO' : 'PO'}-${String(o.id).padStart(5, '0')}`, `
    <p>${def.partyLabel}: <b>${esc(o.party_name)}</b> · ${esc(o.order_date)} · <span class="badge ${o.status}">${o.status}</span></p>
    <div class="panel"><table><thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th></tr></thead>
    <tbody>${o.items.map((i) => `<tr><td>${esc(i.sku)} ${esc(i.product_name)}</td><td class="num">${i.quantity}</td><td class="num">${money(i.unit_price)}</td><td class="num">${money(i.quantity * i.unit_price)}</td></tr>`).join('')}
    <tr><td colspan="3"><b>Total</b></td><td class="num"><b>${money(o.total)}</b></td></tr></tbody></table></div>`, async () => {});
  $('#modal-save').style.display = 'none';
  $('#modal').addEventListener('close', () => ($('#modal-save').style.display = ''), { once: true });
}

async function newOrder(res) {
  const def = ORDERS[res];
  const [parties, products] = await Promise.all([api('/' + def.partyRes), api('/products')]);
  if (!parties.length || !products.length) { toast(`Add a ${def.partyLabel.toLowerCase()} and a product first`, true); return; }
  const productOptions = products.map((p) => `<option value="${p.id}" data-price="${p[def.priceKey]}">${esc(p.sku)} — ${esc(p.name)} (stock ${p.stock})</option>`).join('');
  const itemRow = () => `<div class="item-row">
    <select name="product">${productOptions}</select>
    <input name="qty" type="number" min="1" step="1" value="1" required>
    <input name="price" type="number" step="any" min="0" placeholder="Price">
    <button type="button" class="btn sm danger" data-remove>×</button></div>`;
  openModal(`New ${def.title.slice(0, -1).toLowerCase()}`, `
    <div class="field"><label>${def.partyLabel} *</label><select name="party">${parties.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Order date</label><input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
    <div class="field"><label>Items (product · qty · unit price)</label><div id="items">${itemRow()}</div>
    <button type="button" class="btn sm" id="add-item">+ Add item</button></div>`, async () => {
    const items = [...document.querySelectorAll('#items .item-row')].map((r) => ({
      product_id: Number(r.querySelector('[name=product]').value),
      quantity: Number(r.querySelector('[name=qty]').value),
      unit_price: r.querySelector('[name=price]').value,
    }));
    await api('/' + res, { method: 'POST', body: { [def.partyKey]: Number($('#modal-body [name=party]').value), order_date: $('#modal-body [name=date]').value, items } });
    toast('Order created');
    route();
  });
  const fillPrice = (row) => {
    const sel = row.querySelector('[name=product]');
    row.querySelector('[name=price]').value = sel.selectedOptions[0].dataset.price;
  };
  const wire = () => document.querySelectorAll('#items .item-row').forEach((row) => {
    if (row._wired) return;
    row._wired = true;
    fillPrice(row);
    row.querySelector('[name=product]').onchange = () => fillPrice(row);
    row.querySelector('[data-remove]').onclick = () => { if (document.querySelectorAll('#items .item-row').length > 1) row.remove(); };
  });
  wire();
  $('#add-item').onclick = () => { $('#items').insertAdjacentHTML('beforeend', itemRow()); wire(); };
}

// ---------- Router ----------
function setHeader(title, actions = '') {
  $('#title').textContent = title;
  $('#actions').innerHTML = actions;
  document.title = `${title} · ERP`;
}

async function route() {
  const page = location.hash.slice(1) || 'dashboard';
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + page));
  try {
    if (MASTER[page]) await renderMaster(page);
    else if (ORDERS[page]) await renderOrders(page);
    else await renderDashboard();
  } catch (e) {
    $('#view').innerHTML = `<div class="panel"><div class="empty">Error: ${esc(e.message)}</div></div>`;
  }
}
window.addEventListener('hashchange', route);
route();
