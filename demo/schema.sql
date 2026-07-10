-- OpenQuery demo schema: the four-table world of the flagship question,
-- "Show me the relationship between user 42 and companies Acme, Globex,
--  Initech based on their transactions."
--
--   users 1──* accounts 1──* transactions *──1 companies
--
CREATE TABLE users (
  id         bigint PRIMARY KEY,
  name       text NOT NULL,
  email      text NOT NULL UNIQUE
);

CREATE TABLE companies (
  id         bigint PRIMARY KEY,
  name       text NOT NULL UNIQUE
);

CREATE TABLE accounts (
  id         bigint PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id),
  label      text NOT NULL
);

CREATE TABLE transactions (
  id         bigint PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES accounts(id),
  company_id bigint NOT NULL REFERENCES companies(id),
  amount     numeric(12,2) NOT NULL,
  created_at date NOT NULL
);

CREATE INDEX idx_tx_account ON transactions(account_id);
CREATE INDEX idx_tx_company ON transactions(company_id);
