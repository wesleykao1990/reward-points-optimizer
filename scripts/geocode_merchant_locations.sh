#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/geocode_merchant_locations.sh [--batch-size N] [--retry-attempted]

Runs the private, audited GSI merchant-address geocoder through PostgreSQL.
Requires JRO_DATABASE_URL and psql. The connection string is never printed.

Options:
  --batch-size N       Rows per transaction, 1-25 (default: 25)
  --retry-attempted    Retry one bounded batch of previously attempted rows
  -h, --help           Show this help
EOF
}

batch_size=25
retry_attempted=false

while (($# > 0)); do
  case "$1" in
    --batch-size)
      shift
      if (($# == 0)); then
        echo "--batch-size requires a value" >&2
        exit 2
      fi
      batch_size="$1"
      ;;
    --retry-attempted)
      retry_attempted=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [[ ! "$batch_size" =~ ^[0-9]+$ ]] || ((batch_size < 1 || batch_size > 25)); then
  echo "batch size must be an integer from 1 to 25" >&2
  exit 2
fi

: "${JRO_DATABASE_URL:?JRO_DATABASE_URL is required}"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required" >&2
  exit 2
fi

run_batch() {
  psql "$JRO_DATABASE_URL" \
    -X \
    -A \
    -t \
    -F '|' \
    -v ON_ERROR_STOP=1 \
    -c "
      with result as (
        select app_private.geocode_merchant_locations_gsi(
          ${batch_size},
          ${retry_attempted}
        ) as value
      )
      select
        value ->> 'attempted',
        value ->> 'updated',
        value ->> 'no_match',
        value ->> 'http_errors',
        value ->> 'parse_errors',
        value ->> 'remaining_without_coordinates'
      from result;
    "
}

print_unresolved() {
  psql "$JRO_DATABASE_URL" \
    -X \
    -v ON_ERROR_STOP=1 \
    -c "
      select
        location_key,
        display_name,
        address,
        metadata ->> 'coordinate_status' as coordinate_status
      from app_private.merchant_locations
      where latitude is null or longitude is null
      order by location_key
      limit 25;
    "
}

while true; do
  result="$(run_batch)"
  IFS='|' read -r attempted updated no_match http_errors parse_errors remaining <<<"$result"

  echo "merchant geocoding: attempted=${attempted} updated=${updated} no_match=${no_match} http_errors=${http_errors} parse_errors=${parse_errors} remaining=${remaining}"

  if [[ "$http_errors" != "0" || "$parse_errors" != "0" ]]; then
    echo "merchant geocoding stopped because provider or parsing errors were recorded" >&2
    exit 1
  fi

  if [[ "$retry_attempted" == "true" ]]; then
    break
  fi

  if [[ "$remaining" == "0" ]]; then
    echo "merchant geocoding complete"
    exit 0
  fi

  if [[ "$attempted" == "0" ]]; then
    echo "merchant geocoding cannot progress automatically; unresolved rows follow" >&2
    print_unresolved >&2
    exit 1
  fi
done

if [[ "$remaining" != "0" ]]; then
  echo "retry batch finished with ${remaining} locations still unresolved" >&2
  print_unresolved >&2
  exit 1
fi

echo "merchant geocoding complete"
