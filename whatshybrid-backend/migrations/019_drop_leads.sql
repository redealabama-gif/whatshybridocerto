-- 019_drop_leads.sql
-- Unificação dos leads do modal de cupom numa tabela só.
--
-- Houve duas implementações em paralelo: `coupon_leads` (migration 018, ligada
-- ao POST /api/v1/coupons/lead e à aba "Cupom" do admin) e `leads` (uma
-- implementação redundante). Ficamos com `coupon_leads` como canônica e
-- removemos a `leads`, que não é mais escrita nem lida por nada.
--
-- Idempotente: DROP IF EXISTS — em bancos que nunca criaram `leads` é no-op.

DROP TABLE IF EXISTS leads;
