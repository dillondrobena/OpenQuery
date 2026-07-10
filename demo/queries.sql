-- Hand-written SELECTs for the flagship question (the Assignment).
-- These are the queries an agent following SKILL.md would arrive at.
-- Values are bound via $1/$2 parameters — never interpolated into SQL text.

-- Q1: aggregate view — one row per company = one edge in the graph.
-- params: [42, ["Acme Corp","Globex","Initech"]]
--   (arrays bind as a single param with = ANY($2))
SELECT c.id   AS company_id,
       c.name AS company,
       count(*)      AS txn_count,
       sum(t.amount) AS total_amount
FROM transactions t
JOIN accounts  a ON a.id = t.account_id
JOIN companies c ON c.id = t.company_id
WHERE a.user_id = $1
  AND c.name = ANY($2)
GROUP BY c.id, c.name
ORDER BY total_amount DESC;

-- Q2: per-edge receipt detail — the rows behind one edge.
-- params: [42, 'Globex']
SELECT t.id, t.amount, t.created_at
FROM transactions t
JOIN accounts  a ON a.id = t.account_id
JOIN companies c ON c.id = t.company_id
WHERE a.user_id = $1
  AND c.name = $2
ORDER BY t.created_at DESC;

-- Q3: node identity lookup.
-- params: [42]
SELECT id, name FROM users WHERE id = $1;
