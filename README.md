# ERP System (draft)

A first draft of a web-based ERP (Enterprise Resource Planning) system.

## Modules

| Area | What it does |
|------|--------------|
| Dashboard | Revenue, purchases, inventory value, open orders, low-stock alerts |
| Sales | Customers and sales orders (draft → confirmed → shipped, or cancelled) |
| Purchasing | Suppliers and purchase orders (draft → ordered → received, or cancelled) |
| Inventory | Products with price, cost, stock and reorder level |
| HR | Employee records |

Stock updates automatically:
- **Confirming a sales order** takes stock out. It is refused if there isn't enough stock.
- **Receiving a purchase order** puts stock in.
- **Cancelling** a confirmed sales order puts its stock back.

## Tech stack

- **Backend:** Node.js (22.13+) + Express
- **Database:** SQLite, using Node's built-in `node:sqlite`, so no database server is needed. Data is stored in `data/erp.db`.
- **Frontend:** plain HTML/CSS/JavaScript served by the same server, with no build step.

## Run it

```bash
npm install
npm start
```

Open http://localhost:3000. Sample data is created on the first run.

Settings: `PORT` (default `3000`) and `DB_FILE` (default `data/erp.db`).

## Tests

```bash
npm test
```

## Project layout

```
src/server.js   entry point
src/app.js      REST API (/api/...)
src/db.js       schema + sample data
public/         web UI
test/           API tests
```

## Possible next steps

- Login and user roles
- Invoices and payments (accounting)
- Stock movement history
- Search, filters, pagination
- Reports and CSV export
- Multi-company support
