-- Seed data. Totals are load-bearing: they must match the hand-written
-- fixture (fixtures/flagship-graph.json) and the approved wireframe:
--   Dana Reyes (#42) <-> Acme Corp : $48,200.00 across 17 transactions
--   Dana Reyes (#42) <-> Globex    :  $9,850.00 across  4 transactions
--   Dana Reyes (#42) <-> Initech   :    $310.00 across  1 transaction

INSERT INTO users (id, name, email) VALUES
  (42, 'Dana Reyes',   'dana.reyes@example.com'),
  (7,  'Sam Okafor',   'sam.okafor@example.com'),
  (13, 'Mia Lindqvist','mia.lindqvist@example.com');

INSERT INTO companies (id, name) VALUES
  (1, 'Acme Corp'),
  (2, 'Globex'),
  (3, 'Initech'),
  (4, 'Umbrella LLC');

INSERT INTO accounts (id, user_id, label) VALUES
  (100, 42, 'Dana - operating'),
  (101, 42, 'Dana - savings'),
  (110, 7,  'Sam - operating'),
  (120, 13, 'Mia - operating');

-- Dana -> Globex: the wireframe's selected edge. IDs, amounts, and dates
-- match the wireframe receipt panel exactly.
INSERT INTO transactions (id, account_id, company_id, amount, created_at) VALUES
  (9107, 100, 2, 4200.00, '2026-06-30'),
  (8841, 100, 2, 2150.00, '2026-05-12'),
  (8512, 101, 2, 1900.00, '2026-03-02'),
  (8320, 100, 2, 1600.00, '2026-01-19');

-- Dana -> Acme Corp: 17 transactions summing 48200.00.
INSERT INTO transactions (id, account_id, company_id, amount, created_at) VALUES
  (9201, 100, 1, 2800.00, '2026-06-28'),
  (9188, 100, 1, 2800.00, '2026-06-14'),
  (9154, 101, 1, 2800.00, '2026-05-30'),
  (9120, 100, 1, 2800.00, '2026-05-15'),
  (9088, 100, 1, 2800.00, '2026-04-30'),
  (9042, 101, 1, 2800.00, '2026-04-15'),
  (9011, 100, 1, 2800.00, '2026-03-31'),
  (8955, 100, 1, 2800.00, '2026-03-15'),
  (8901, 100, 1, 2800.00, '2026-02-28'),
  (8850, 101, 1, 2800.00, '2026-02-14'),
  (8800, 100, 1, 5000.00, '2026-01-31'),
  (8750, 100, 1, 4000.00, '2026-01-15'),
  (8700, 101, 1, 3200.00, '2025-12-31'),
  (8650, 100, 1, 3000.00, '2025-12-15'),
  (8600, 100, 1, 2000.00, '2025-11-30'),
  (8550, 101, 1, 1500.00, '2025-11-15'),
  (8500, 100, 1, 1500.00, '2025-10-31');

-- Dana -> Initech: single small transaction.
INSERT INTO transactions (id, account_id, company_id, amount, created_at) VALUES
  (8888, 100, 3, 310.00, '2026-04-02');

-- Noise: other users' activity, so queries must actually filter.
INSERT INTO transactions (id, account_id, company_id, amount, created_at) VALUES
  (7001, 110, 1,  900.00, '2026-05-01'),
  (7002, 110, 2, 1250.00, '2026-05-03'),
  (7003, 120, 4,  777.00, '2026-06-01'),
  (7004, 120, 1,  432.10, '2026-06-05');
