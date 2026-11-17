// Database setup using Node's built-in SQLite (no native dependencies).
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT,
      unit_price REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0,
      reorder_level INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, email TEXT, phone TEXT, address TEXT
    );
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, email TEXT, phone TEXT, address TEXT
    );
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, email TEXT, department TEXT, position TEXT,
      salary REAL NOT NULL DEFAULT 0, hire_date TEXT
    );
    CREATE TABLE IF NOT EXISTS sales_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      order_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      total REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sales_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      order_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      total REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS purchase_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL
    );
  `);
  return db;
}

function seed(db) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  if (count > 0) return;
  const p = db.prepare('INSERT INTO products (sku,name,category,unit_price,cost,stock,reorder_level) VALUES (?,?,?,?,?,?,?)');
  p.run('P-1001', 'Office Chair', 'Furniture', 120, 70, 25, 5);
  p.run('P-1002', 'Standing Desk', 'Furniture', 450, 280, 8, 3);
  p.run('P-2001', 'Laptop 14"', 'Electronics', 1100, 850, 12, 4);
  p.run('P-2002', 'Wireless Mouse', 'Electronics', 25, 9, 3, 10);
  p.run('P-3001', 'A4 Paper (500 sheets)', 'Supplies', 6, 3, 200, 50);
  const c = db.prepare('INSERT INTO customers (name,email,phone,address) VALUES (?,?,?,?)');
  c.run('Acme Trading', 'orders@acme.example', '010-1111-2222', 'Seoul');
  c.run('Blue Sky Co.', 'buy@bluesky.example', '010-3333-4444', 'Busan');
  const s = db.prepare('INSERT INTO suppliers (name,email,phone,address) VALUES (?,?,?,?)');
  s.run('Global Furniture Ltd.', 'sales@globalfurn.example', '02-555-0100', 'Incheon');
  s.run('TechParts Inc.', 'hello@techparts.example', '02-555-0200', 'Daejeon');
  const e = db.prepare('INSERT INTO employees (name,email,department,position,salary,hire_date) VALUES (?,?,?,?,?,?)');
  e.run('Kim Minji', 'minji@company.example', 'Sales', 'Manager', 52000, '2022-03-01');
  e.run('Lee Junho', 'junho@company.example', 'Warehouse', 'Staff', 38000, '2023-07-15');
}

module.exports = { openDatabase, seed };
