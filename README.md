# Procura

Procurement compliance platform by **CODX Systems Tech**.

Officers submit updates via WhatsApp. Every requisition is tracked from creation through delivery to payment. Every action creates an immutable, hash-chained audit trail. Managers receive automatic escalation alerts when SLAs are missed.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Vite + React 19 |
| Backend | Node.js + Express |
| Database | PostgreSQL (row-level security, per-org isolation) |
| Cache / Queues | Redis + Bull |
| Auth | JWT + RBAC (Officer / Manager / Executive / Auditor) |
| Storage | S3-compatible (delivery photos) |
| WhatsApp | Meta Cloud API |

---

## Quick start

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Redis 6+

### Backend

```bash
cd backend
cp .env.example .env        # fill in credentials
npm install
node src/db/migrate.js      # run schema (idempotent)
npm run dev                 # API on :4000

# In a separate terminal — escalation worker
node src/jobs/index.js
```

### Frontend

```bash
# From project root
npm install
npm run dev                 # Vite dev server on :5173 (proxies /api → :4000)
```

---

## Roles

| Role | Can do |
|---|---|
| Officer | Create requisitions, confirm deliveries (WhatsApp or browser) |
| Manager | Approve, order, dispute, process payments, acknowledge escalations |
| Executive | All Manager actions + lift supplier blacklists + audit log access |
| Auditor | Read-only access to all data + audit log verification |

---

## WhatsApp commands

Officers send structured commands to the registered WhatsApp number:

```
REQ-0001 STATUS              — check status
REQ-0001 DELIVERED [notes]   — confirm delivery
REQ-0001 DISPUTE <reason>    — raise a dispute
REQ-0001 PAID ref:PAY-123    — record payment (Manager+)
LIST                         — open requisitions
HELP                         — command reference
```

---

## Escalation engine

- Requisitions in **Ordered** status past the SLA window (default 72h) trigger a tier-1 escalation to the Officer
- If unacknowledged after **2 hours**, auto-escalates: Officer → Manager → Executive
- All escalation events are audit-logged and immutable

---

## Security

- PostgreSQL row-level security: organisations cannot access each other's data
- Audit log rows are immutable at the database trigger level (no UPDATE or DELETE permitted)
- SHA-256 hash chain links every audit entry — tampering breaks the chain (verifiable from the dashboard)
- Payments require a confirmed delivery record — enforced by DB trigger
- JWT authentication on every API endpoint; role checks on every route
