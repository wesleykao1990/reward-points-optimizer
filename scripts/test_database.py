#!/usr/bin/env python3
"""Apply and test the database migration chain in a confirmed empty database."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path


BASE = Path(__file__).resolve().parents[1]
MIGRATIONS = sorted((BASE / "db").glob("[0-9][0-9][0-9][0-9]_*.sql"))
SEEDS = sorted((BASE / "db" / "seeds").glob("[0-9][0-9][0-9]_*.sql"))
TESTS = sorted((BASE / "db" / "tests").glob("[0-9][0-9][0-9]_*.sql"))


def query(psql: str, database_url: str, sql: str) -> str:
    result = subprocess.run(
        [psql, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", database_url, "-c", sql],
        check=True,
        text=True,
        capture_output=True,
    )
    return result.stdout.strip()


def run_sql(psql: str, database_url: str, path: Path) -> None:
    relative = path.relative_to(BASE)
    print(f"database gate: {relative}", flush=True)
    subprocess.run(
        [psql, "-X", "-v", "ON_ERROR_STOP=1", "-d", database_url, "-f", str(path)],
        check=True,
    )


def bootstrap_supabase_test_roles(psql: str, database_url: str) -> None:
    """Create the NOLOGIN API roles used by Supabase grants and security tests."""
    query(
        psql,
        database_url,
        """
        do $roles$
        begin
          if not exists (select 1 from pg_roles where rolname = 'anon') then
            create role anon nologin;
          end if;
          if not exists (select 1 from pg_roles where rolname = 'authenticated') then
            create role authenticated nologin;
          end if;
          if not exists (select 1 from pg_roles where rolname = 'service_role') then
            create role service_role nologin;
          end if;
        end
        $roles$;
        """,
    )


def main() -> int:
    database_url = os.environ.get("JRO_TEST_DATABASE_URL")
    if not database_url:
        print("JRO_TEST_DATABASE_URL is required", file=sys.stderr)
        return 2
    if os.environ.get("JRO_DB_TEST_CONFIRM") != "isolated":
        print("set JRO_DB_TEST_CONFIRM=isolated to confirm this is a disposable database", file=sys.stderr)
        return 2

    psql = shutil.which("psql")
    if psql is None:
        print("psql is required", file=sys.stderr)
        return 2

    try:
        version_text = query(psql, database_url, "show server_version_num")
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or "").strip()
        print(f"could not connect to the test database: {detail}", file=sys.stderr)
        return exc.returncode or 1
    try:
        version_number = int(version_text)
    except ValueError:
        print(f"could not parse PostgreSQL server_version_num: {version_text!r}", file=sys.stderr)
        return 2
    if version_number < 150000:
        print(f"PostgreSQL 15+ is required; server_version_num={version_number}", file=sys.stderr)
        return 2

    database_name = query(psql, database_url, "select current_database()")
    if database_name in {"postgres", "template0", "template1"}:
        print(f"refusing to modify administrative database {database_name!r}", file=sys.stderr)
        return 2

    existing_schemas = int(
        query(
            psql,
            database_url,
            "select count(*) from pg_namespace "
            "where nspname in ('app_private', 'app_api', 'user_data')",
        )
    )
    if existing_schemas:
        print("refusing to run: application schemas already exist", file=sys.stderr)
        return 2

    print(
        f"database gate: PostgreSQL server_version_num={version_number}, database={database_name}",
        flush=True,
    )
    if not MIGRATIONS or not SEEDS or not TESTS:
        print("database migration, seed, or test files are missing", file=sys.stderr)
        return 2

    try:
        bootstrap_supabase_test_roles(psql, database_url)
        for migration in MIGRATIONS:
            run_sql(psql, database_url, migration)
        for seed in SEEDS:
            run_sql(psql, database_url, seed)
        for test in TESTS:
            run_sql(psql, database_url, test)
    except subprocess.CalledProcessError as exc:
        print(f"database gate failed with exit code {exc.returncode}", file=sys.stderr)
        return exc.returncode or 1

    print(
        f"database gate passed: {len(MIGRATIONS)} migrations, "
        f"{len(SEEDS)} seeds, {len(TESTS)} tests"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
