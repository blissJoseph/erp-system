const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { openDatabase, seed } = require('../src/db');
const { createApp } = require('../src/app');

let server, base;
before(async () => {
  const db = openDatabase(':memory:');
  seed(db);
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}/api`;
});
after(() => server.close());

const call = async (path, method = 'GET', body) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: res.status, data: res.status === 204 ? null : await res.json() };
};

test('product CRUD', async () => {
  const created = await call('/products', 'POST', { sku: 'T-1', name: 'Test', unit_price: 10, cost: 5, stock: 2 });
  assert.equal(created.status, 201);
  const updated = await call(`/products/${created.data.id}`, 'PUT', { name: 'Renamed' });
  assert.equal(updated.data.name, 'Renamed');
  assert.equal((await call('/products', 'POST', { name: 'No SKU' })).status, 400);
  assert.equal((await call(`/products/${created.data.id}`, 'DELETE')).status, 204);
  assert.equal((await call(`/products/${created.data.id}`)).status, 404);
});

test('sales order deducts stock on confirm and restores on cancel', async () => {
  const product = (await call('/products', 'POST', { sku: 'S-1', name: 'Widget', unit_price: 3, cost: 1, stock: 5 })).data;
  const order = (await call('/sales-orders', 'POST', { customer_id: 1, items: [{ product_id: product.id, quantity: 4 }] })).data;
  assert.equal(order.total, 12);
  assert.equal(order.status, 'draft');

  await call(`/sales-orders/${order.id}/status`, 'POST', { status: 'confirmed' });
  assert.equal((await call(`/products/${product.id}`)).data.stock, 1);

  await call(`/sales-orders/${order.id}/status`, 'POST', { status: 'cancelled' });
  assert.equal((await call(`/products/${product.id}`)).data.stock, 5);
});

test('sales order cannot confirm without enough stock', async () => {
  const product = (await call('/products', 'POST', { sku: 'S-2', name: 'Scarce', unit_price: 1, stock: 1 })).data;
  const order = (await call('/sales-orders', 'POST', { customer_id: 1, items: [{ product_id: product.id, quantity: 3 }] })).data;
  const res = await call(`/sales-orders/${order.id}/status`, 'POST', { status: 'confirmed' });
  assert.equal(res.status, 400);
  assert.equal((await call(`/products/${product.id}`)).data.stock, 1);
});

test('purchase order adds stock when received', async () => {
  const product = (await call('/products', 'POST', { sku: 'P-X', name: 'Bolt', cost: 2, stock: 0 })).data;
  const order = (await call('/purchase-orders', 'POST', { supplier_id: 1, items: [{ product_id: product.id, quantity: 10 }] })).data;
  assert.equal(order.total, 20);
  assert.equal((await call(`/purchase-orders/${order.id}/status`, 'POST', { status: 'received' })).status, 400); // must be ordered first
  await call(`/purchase-orders/${order.id}/status`, 'POST', { status: 'ordered' });
  await call(`/purchase-orders/${order.id}/status`, 'POST', { status: 'received' });
  assert.equal((await call(`/products/${product.id}`)).data.stock, 10);
});

test('dashboard returns summary', async () => {
  const { data } = await call('/dashboard');
  assert.ok(data.products > 0);
  assert.ok(Array.isArray(data.low_stock));
});
