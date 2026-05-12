-- 003_stripe.sql
-- Suporte a Stripe (clientes internacionais)

ALTER TABLE workspaces ADD COLUMN stripe_customer_id TEXT;
-- @SEPARATOR
ALTER TABLE workspaces ADD COLUMN stripe_subscription_id TEXT;
-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_workspaces_stripe_sub ON workspaces(stripe_subscription_id);
-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_workspaces_stripe_cust ON workspaces(stripe_customer_id);
