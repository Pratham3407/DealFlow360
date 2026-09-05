-- Audit log is append-only (PRD §20, BUSINESS_RULES.md §11).
-- A trigger function raises on UPDATE or DELETE so no code path — or raw SQL —
-- can silently amend approval or quotation history.

create or replace function audit_logs_no_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'audit_logs is append-only: UPDATE/DELETE is not permitted';
end;
$$;

drop trigger if exists audit_logs_append_only on audit_logs;

create trigger audit_logs_append_only
    before update or delete on audit_logs
    for each row
    execute function audit_logs_no_mutation();