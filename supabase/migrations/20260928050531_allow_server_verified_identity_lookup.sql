-- Funding claims read only these identity fields after Supabase validates the user's OTP.
-- Keep SECURITY INVOKER; do not grant auth access to browser roles.
grant select (id, email, email_confirmed_at) on auth.users to service_role;
