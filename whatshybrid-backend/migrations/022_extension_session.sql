-- 022_extension_session.sql
-- LIC-02 — uma sessão ativa por conta na extensão. Guarda o identificador da
-- sessão atual da extensão; o login da extensão em outro computador troca o
-- valor e os tokens da sessão anterior passam a ser recusados (SESSION_REPLACED).
-- O painel do site (tokens sem sessão de extensão) não é afetado.
ALTER TABLE users ADD COLUMN extension_session_id TEXT;
