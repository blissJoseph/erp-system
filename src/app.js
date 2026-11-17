// HTTP API for the ERP draft.
const express = require('express');
const path = require('node:path');

// Simple master-data tables: allowed columns and required ones.
const RESOURCES = {
  products: { cols: ['sku', 'name', 'category', 'unit_price', 'cost', 'stock', 'reorder_level'], required: ['sku', 'name'] },
  customers: { cols: ['name', 'email', 'phone', 'address'], required: ['name'] },
  suppliers: { cols: ['name', 'email', 'phone', 'address'], required: ['name'] },
  employees: { cols: ['name', 'email', 'department', 'position', 'salary', 'hire_date'], required: ['name'] },
};

// Order types: sales orders take stock out, purchase orders bring it in.
const ORDERS = {
  sales: {
    table: 'sales_orders', items: 'sales_order_items', party: 'customer_id', partyTable: 'customers',
    // Allowed status changes. Stock moves (by `sign`) when the order reaches `stockOn`,
    // and moves back if a stock-affecting order is cancelled.
    transitions: { draft: ['confirmed', 'cancelled'], confirmed: ['shipped', 'cancelled'], shipped: [], cancelled: [] },
    stockOn: 'confirmed', sign: -1,
  },
  purchase: {
    table: 'purchase_orders', items: 'purchase_order_items', party: 'supplier_id', partyTable: 'suppliers',
    transitions: { draft: ['ordered', 'cancelled'], ordered: ['received', 'cancelled'], received: [], cancelled: [] },
    stockOn: 'received', sign: +1,
  },
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function tx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function createApp(db) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // ---------- Master data CRUD ----------
  for (const [name, { cols, required }] of Object.entries(RESOURCES)) {
    const pick = (body) => {
      const row = {};
      for (const c of cols) if (body[c] !== undefined) row[c] = body[c] === '' ? null : body[c];
      return row;
    };
    app.get(`/api/${name}`, (req, res) => {
      res.json(db.prepare(`SELECT * FROM ${name} ORDER BY id DESC`).all());
    });
    app.get(`/api/${name}/:id`, (req, res) => {
      const row = db.prepare(`SELECT * FROM ${name} WHERE id = ?`).get(req.params.id);
      if (!row) throw new HttpError(404, 'Not found');
      res.json(row);
    });
    app.post(`/api/${name}`, (req, res) => {
      const row = pick(req.body);
      for (const r of required) if (row[r] == null) throw new HttpError(400, `${r} is required`);
      const keys = Object.keys(row);
      const info = db.prepare(`INSERT INTO ${name} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
        .run(...keys.map((k) => row[k]));
      res.status(201).json(db.prepare(`SELECT * FROM ${name} WHERE id = ?`).get(info.lastInsertRowid));
    });
    app.put(`/api/${name}/:id`, (req, res) => {
      const row = pick(req.body);
      for (const r of required) if (r in row && row[r] == null) throw new HttpError(400, `${r} is required`);
      const keys = Object.keys(row);
      if (!keys.length) throw new HttpError(400, 'No fields to update');
      const info = db.prepare(`UPDATE ${name} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
        .run(...keys.map((k) => row[k]), req.params.id);
      if (!info.changes) throw new HttpError(404, 'Not found');
      res.json(db.prepare(`SELECT * FROM ${name} WHERE id = ?`).get(req.params.id));
    });
    app.delete(`/api/${name}/:id`, (req, res) => {
      const info = db.prepare(`DELETE FROM ${name} WHERE id = ?`).run(req.params.id);
      if (!info.changes) throw new HttpError(404, 'Not found');
      res.status(204).end();
    });
  }

  // ---------- Orders ----------
  for (const [kind, o] of Object.entries(ORDERS)) {
    const base = `/api/${kind}-orders`;
    const getOrder = (id) => {
      const order = db.prepare(
        `SELECT o.*, p.name AS party_name FROM ${o.table} o JOIN ${o.partyTable} p ON p.id = o.${o.party} WHERE o.id = ?`
      ).get(id);
      if (!order) return null;
      order.items = db.prepare(
        `SELECT i.*, pr.name AS product_name, pr.sku FROM ${o.items} i JOIN products pr ON pr.id = i.product_id WHERE i.order_id = ?`
      ).all(id);
      return order;
    };

    app.get(base, (req, res) => {
      res.json(db.prepare(
        `SELECT o.*, p.name AS party_name FROM ${o.table} o JOIN ${o.partyTable} p ON p.id = o.${o.party} ORDER BY o.id DESC`
      ).all());
    });
    app.get(`${base}/:id`, (req, res) => {
      const order = getOrder(req.params.id);
      if (!order) throw new HttpError(404, 'Not found');
      res.json(order);
    });
    app.post(base, (req, res) => {
      const partyId = req.body[o.party];
      const items = Array.isArray(req.body.items) ? req.body.items : [];
      if (!partyId) throw new HttpError(400, `${o.party} is required`);
      if (!items.length) throw new HttpError(400, 'At least one item is required');
      if (!db.prepare(`SELECT id FROM ${o.partyTable} WHERE id = ?`).get(partyId)) throw new HttpError(400, 'Unknown party');
      const id = tx(db, () => {
        const date = req.body.order_date || new Date().toISOString().slice(0, 10);
        const orderId = db.prepare(`INSERT INTO ${o.table} (${o.party}, order_date) VALUES (?, ?)`).run(partyId, date).lastInsertRowid;
        let total = 0;
        for (const it of items) {
          const qty = Number(it.quantity);
          if (!Number.isInteger(qty) || qty <= 0) throw new HttpError(400, 'Quantity must be a positive integer');
          const product = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
          if (!product) throw new HttpError(400, `Unknown product ${it.product_id}`);
          const price = it.unit_price != null && it.unit_price !== ''
            ? Number(it.unit_price)
            : (kind === 'sales' ? product.unit_price : product.cost);
          db.prepare(`INSERT INTO ${o.items} (order_id, product_id, quantity, unit_price) VALUES (?,?,?,?)`).run(orderId, product.id, qty, price);
          total += qty * price;
        }
        db.prepare(`UPDATE ${o.table} SET total = ? WHERE id = ?`).run(Math.round(total * 100) / 100, orderId);
        return orderId;
      });
      res.status(201).json(getOrder(id));
    });

    // Change status; moves stock when entering / leaving the stock-affecting status.
    app.post(`${base}/:id/status`, (req, res) => {
      const next = req.body.status;
      tx(db, () => {
        const order = getOrder(req.params.id);
        if (!order) throw new HttpError(404, 'Not found');
        if (!(o.transitions[order.status] || []).includes(next)) {
          throw new HttpError(400, `Cannot change status from ${order.status} to ${next}`);
        }
        const stockApplied = (s) => s === o.stockOn || (kind === 'sales' && s === 'shipped');
        let direction = 0;
        if (!stockApplied(order.status) && stockApplied(next)) direction = o.sign;
        if (stockApplied(order.status) && next === 'cancelled') direction = -o.sign;
        if (direction) {
          for (const it of order.items) {
            const delta = direction * it.quantity;
            if (delta < 0) {
              const { stock } = db.prepare('SELECT stock FROM products WHERE id = ?').get(it.product_id);
              if (stock + delta < 0) throw new HttpError(400, `Not enough stock for ${it.product_name} (have ${stock}, need ${-delta})`);
            }
            db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(delta, it.product_id);
          }
        }
        db.prepare(`UPDATE ${o.table} SET status = ? WHERE id = ?`).run(next, order.id);
      });
      res.json(getOrder(req.params.id));
    });

    app.delete(`${base}/:id`, (req, res) => {
      const order = db.prepare(`SELECT status FROM ${o.table} WHERE id = ?`).get(req.params.id);
      if (!order) throw new HttpError(404, 'Not found');
      if (order.status !== 'draft' && order.status !== 'cancelled') throw new HttpError(400, 'Only draft or cancelled orders can be deleted');
      db.prepare(`DELETE FROM ${o.table} WHERE id = ?`).run(req.params.id);
      res.status(204).end();
    });
  }

  // ---------- Dashboard ----------
  app.get('/api/dashboard', (req, res) => {
    const one = (sql) => db.prepare(sql).get();
    res.json({
      products: one('SELECT COUNT(*) AS n FROM products').n,
      customers: one('SELECT COUNT(*) AS n FROM customers').n,
      suppliers: one('SELECT COUNT(*) AS n FROM suppliers').n,
      employees: one('SELECT COUNT(*) AS n FROM employees').n,
      inventory_value: one('SELECT COALESCE(SUM(stock * cost), 0) AS v FROM products').v,
      revenue: one("SELECT COALESCE(SUM(total), 0) AS v FROM sales_orders WHERE status IN ('confirmed','shipped')").v,
      purchases: one("SELECT COALESCE(SUM(total), 0) AS v FROM purchase_orders WHERE status = 'received'").v,
      open_sales: one("SELECT COUNT(*) AS n FROM sales_orders WHERE status IN ('draft','confirmed')").n,
      open_purchases: one("SELECT COUNT(*) AS n FROM purchase_orders WHERE status IN ('draft','ordered')").n,
      low_stock: db.prepare('SELECT id, sku, name, stock, reorder_level FROM products WHERE stock <= reorder_level ORDER BY stock').all(),
    });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Error handler
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (/constraint/i.test(err.message)) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
