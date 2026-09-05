--
-- PostgreSQL database cluster dump
--

\restrict r0zggIcQkMa5PqwkDZqU0egdP8HaWQZcqWiM6nOc4SXZb4SAqyFf1vMyoLrG1Zy

SET default_transaction_read_only = off;

SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;

--
-- Roles
--

CREATE ROLE anon;
ALTER ROLE anon WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB NOLOGIN NOREPLICATION NOBYPASSRLS;
CREATE ROLE authenticated;
ALTER ROLE authenticated WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB NOLOGIN NOREPLICATION NOBYPASSRLS;
CREATE ROLE authenticator;
ALTER ROLE authenticator WITH NOSUPERUSER NOINHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION NOBYPASSRLS;
CREATE ROLE dashboard_user;
ALTER ROLE dashboard_user WITH NOSUPERUSER INHERIT CREATEROLE CREATEDB NOLOGIN REPLICATION NOBYPASSRLS;
CREATE ROLE pgbouncer;
ALTER ROLE pgbouncer WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION NOBYPASSRLS;
CREATE ROLE postgres;
ALTER ROLE postgres WITH NOSUPERUSER INHERIT CREATEROLE CREATEDB LOGIN REPLICATION BYPASSRLS;
CREATE ROLE service_role;
ALTER ROLE service_role WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB NOLOGIN NOREPLICATION BYPASSRLS;
CREATE ROLE supabase_admin;
ALTER ROLE supabase_admin WITH SUPERUSER INHERIT CREATEROLE CREATEDB LOGIN REPLICATION BYPASSRLS;
CREATE ROLE supabase_auth_admin;
ALTER ROLE supabase_auth_admin WITH NOSUPERUSER NOINHERIT CREATEROLE NOCREATEDB LOGIN NOREPLICATION NOBYPASSRLS;
CREATE ROLE supabase_etl_admin;
ALTER ROLE supabase_etl_admin WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB LOGIN REPLICATION BYPASSRLS;
CREATE ROLE supabase_functions_admin;
ALTER ROLE supabase_functions_admin WITH NOSUPERUSER NOINHERIT CREATEROLE NOCREATEDB LOGIN NOREPLICATION NOBYPASSRLS;
CREATE ROLE supabase_privileged_role;
ALTER ROLE supabase_privileged_role WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB NOLOGIN NOREPLICATION NOBYPASSRLS;
CREATE ROLE supabase_read_only_user;
ALTER ROLE supabase_read_only_user WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION BYPASSRLS;
CREATE ROLE supabase_realtime_admin;
ALTER ROLE supabase_realtime_admin WITH NOSUPERUSER NOINHERIT NOCREATEROLE NOCREATEDB NOLOGIN NOREPLICATION NOBYPASSRLS;
CREATE ROLE supabase_replication_admin;
ALTER ROLE supabase_replication_admin WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB LOGIN REPLICATION NOBYPASSRLS;
CREATE ROLE supabase_storage_admin;
ALTER ROLE supabase_storage_admin WITH NOSUPERUSER NOINHERIT CREATEROLE NOCREATEDB LOGIN NOREPLICATION NOBYPASSRLS;

--
-- User Configurations
--

--
-- User Config "anon"
--

ALTER ROLE anon SET statement_timeout TO '3s';

--
-- User Config "authenticated"
--

ALTER ROLE authenticated SET statement_timeout TO '8s';

--
-- User Config "authenticator"
--

ALTER ROLE authenticator SET session_preload_libraries TO 'supautils', 'safeupdate';
ALTER ROLE authenticator SET statement_timeout TO '8s';
ALTER ROLE authenticator SET lock_timeout TO '8s';

--
-- User Config "postgres"
--

ALTER ROLE postgres SET search_path TO E'\\$user', 'public', 'extensions';

--
-- User Config "supabase_admin"
--

ALTER ROLE supabase_admin SET search_path TO E'\\$user', 'public', 'auth', 'extensions';
ALTER ROLE supabase_admin SET log_statement TO 'none';

--
-- User Config "supabase_auth_admin"
--

ALTER ROLE supabase_auth_admin SET search_path TO 'auth';
ALTER ROLE supabase_auth_admin SET idle_in_transaction_session_timeout TO '60000';
ALTER ROLE supabase_auth_admin SET log_statement TO 'none';

--
-- User Config "supabase_functions_admin"
--

ALTER ROLE supabase_functions_admin SET search_path TO 'supabase_functions';

--
-- User Config "supabase_read_only_user"
--

ALTER ROLE supabase_read_only_user SET default_transaction_read_only TO 'on';

--
-- User Config "supabase_realtime_admin"
--

ALTER ROLE supabase_realtime_admin SET search_path TO 'public', 'extensions', 'realtime';

--
-- User Config "supabase_storage_admin"
--

ALTER ROLE supabase_storage_admin SET search_path TO 'storage';
ALTER ROLE supabase_storage_admin SET log_statement TO 'none';


--
-- Role memberships
--

GRANT anon TO authenticator WITH INHERIT FALSE GRANTED BY supabase_admin;
GRANT anon TO postgres WITH ADMIN OPTION, INHERIT TRUE GRANTED BY supabase_admin;
GRANT anon TO supabase_realtime_admin WITH INHERIT FALSE GRANTED BY supabase_admin;
GRANT authenticated TO authenticator WITH INHERIT FALSE GRANTED BY supabase_admin;
GRANT authenticated TO postgres WITH ADMIN OPTION, INHERIT TRUE GRANTED BY supabase_admin;
GRANT authenticated TO supabase_realtime_admin WITH INHERIT FALSE GRANTED BY supabase_admin;
GRANT authenticator TO postgres WITH ADMIN OPTION, INHERIT TRUE GRANTED BY supabase_admin;
GRANT authenticator TO supabase_storage_admin WITH INHERIT FALSE GRANTED BY supabase_admin;
GRANT pg_create_subscription TO postgres WITH ADMIN OPTION, INHERIT TRUE GRANTED BY supabase_admin;
GRANT pg_monitor TO postgres WITH ADMIN OPTION, INHERIT TRUE GRANTED BY supabase_admin;
GRANT pg_monitor TO supabase_etl_admin WITH INHERIT TRUE GRANTED BY supabase_admin;
GRANT pg_monitor TO supabase_read_only_user WITH INHERIT TRUE GRANTED BY supabase_admin;
GRANT pg_read_all_data TO postgres WITH ADMIN OPTION, INHERIT TRUE GRANTED BY supabase_admin;
GRANT pg_read_all_data TO supabase_etl_admin WITH INHERIT TRUE GRANTED BY supabase_admin;
GRANT pg_read_all_data TO supabase_read_only_user WITH INHERIT TRUE GRANTED BY supabase_admin;
GRANT pg_signal_backend TO postgres WITH ADMIN OPTION, INHERIT TRUE GRANTED BY supabase_admin;
GRANT service_role TO authenticator WITH INHERIT FALSE GRANTED BY supabase_admin;
GRANT service_role TO postgres WITH ADMIN OPTION, INHERIT TRUE GRANTED BY supabase_admin;
GRANT service_role TO supabase_realtime_admin WITH INHERIT FALSE GRANTED BY supabase_admin;
GRANT supabase_functions_admin TO postgres WITH INHERIT TRUE GRANTED BY supabase_admin;
GRANT supabase_privileged_role TO postgres WITH INHERIT TRUE GRANTED BY supabase_admin;
GRANT supabase_privileged_role TO supabase_etl_admin WITH INHERIT TRUE GRANTED BY supabase_admin;


--
-- Role privileges on configuration parameters
--

GRANT SET ON PARAMETER log_min_messages TO supabase_realtime_admin;




\unrestrict r0zggIcQkMa5PqwkDZqU0egdP8HaWQZcqWiM6nOc4SXZb4SAqyFf1vMyoLrG1Zy

--
-- PostgreSQL database cluster dump complete
--

