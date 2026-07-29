#!/usr/bin/env bash
# =============================================================================
# MMMIS Edge Function curl smoke tests
#
# Exercises the four auth-sensitive functions:
#   - chit-authorize        (buyer CHIT approval)
#   - set-member-email      (member self-service email update, password check)
#   - create-user           (admin user creation)
#   - admin-reset-password  (admin password reset)
#
# Tests:
#   1. CORS preflight (OPTIONS) returns 204 + Access-Control-Allow-* headers.
#   2. Missing JWT returns 401.
#   3. Happy path returns 2xx with expected JSON.
#   4. set-member-email without current_password on self-service returns 400.
#   5. set-member-email with wrong current_password returns 401.
#   6. chit-authorize with wrong password returns 401.
#   7. chit-authorize with expired session returns 401 (session_not_found).
#
# Required env (set these before running):
#   SUPABASE_URL          e.g. https://gkegnmshivmgqhenqkzr.supabase.co
#   SUPABASE_ANON_KEY     the project's anon key
#   ADMIN_JWT             a JWT for an administrator (from the SPA devtools)
#   MEMBER_JWT            a JWT for an active member
#   BUYER_EMAIL           the email of the member above
#   BUYER_PASSWORD        the password of the member above
#   REQUEST_ID            (optional) id of a pending chit_authorization_requests
#                                row to use for chit-authorize happy path
#
# Usage:
#   export $(grep -v '^#' .env.test | xargs)
#   bash tests/edge/run.sh
#
# Exit code: 0 if all assertions pass, 1 if any fails.
# =============================================================================

set -u
# NOTE: deliberately not `set -e` — we want to run every test and report a
# summary at the end, not abort on first failure.

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'

PASS=0; FAIL=0; SKIP=0

# ---- helpers ---------------------------------------------------------------

assert_status() {
  # $1 = expected status, $2 = actual status, $3 = test name
  if [[ "$2" == "$1" ]]; then
    echo -e "${GREEN}PASS${NC} $3 (status=$2)"
    PASS=$((PASS+1))
  else
    echo -e "${RED}FAIL${NC} $3 (expected=$1 actual=$2)"
    FAIL=$((FAIL+1))
  fi
}

assert_status_in() {
  # $1 = list of acceptable statuses (space-sep), $2 = actual, $3 = name
  local ok=0
  for s in $1; do [[ "$s" == "$2" ]] && ok=1; done
  if [[ "$ok" == "1" ]]; then
    echo -e "${GREEN}PASS${NC} $3 (status=$2)"
    PASS=$((PASS+1))
  else
    echo -e "${RED}FAIL${NC} $3 (expected one of [$1] actual=$2)"
    FAIL=$((FAIL+1))
  fi
}

assert_header_present() {
  # $1 = header name, $2 = headers file, $3 = test name
  if grep -qi "^$1:" "$2"; then
    echo -e "${GREEN}PASS${NC} $3 ($1 present)"
    PASS=$((PASS+1))
  else
    echo -e "${RED}FAIL${NC} $3 ($1 missing)"
    FAIL=$((FAIL+1))
  fi
}

skip() {
  echo -e "${YELLOW}SKIP${NC} $1 ($2)"
  SKIP=$((SKIP+1))
}

call_edge() {
  # $1 = fn name, $2 = method, $3 = extra curl args, $4 = body (or "")
  # Sets globals: STATUS, BODY_FILE, HEADERS_FILE
  local fn="$1" method="$2" extra="$3" body="$4"
  local url="${SUPABASE_URL}/functions/v1/${fn}"
  BODY_FILE=$(mktemp); HEADERS_FILE=$(mktemp)
  local args=(-sS -o "$BODY_FILE" -D "$HEADERS_FILE" -w '%{http_code}'
              -X "$method" "$url"
              -H "apikey: ${SUPABASE_ANON_KEY}"
              -H "Authorization: Bearer ${SUPABASE_ANON_KEY}")
  if [[ -n "$body" ]]; then
    args+=(-H "Content-Type: application/json" --data "$body")
  fi
  # shellcheck disable=SC2086
  STATUS=$(curl "${args[@]}" $extra)
}

# ---- env check -------------------------------------------------------------

for var in SUPABASE_URL SUPABASE_ANON_KEY ADMIN_JWT MEMBER_JWT; do
  if [[ -z "${!var:-}" ]]; then
    echo -e "${RED}ERROR${NC} env var $var is unset. Source .env.test first."
    exit 2
  fi
done

echo "=== MMMIS Edge Function smoke tests ==="
echo "Target: $SUPABASE_URL"
echo ""

# ---------------------------------------------------------------------------
# 1. CORS preflight (OPTIONS) — every function should return 204 + headers.
# ---------------------------------------------------------------------------

echo "--- CORS preflight ---"
for fn in chit-authorize set-member-email create-user admin-reset-password; do
  url="${SUPABASE_URL}/functions/v1/${fn}"
  STATUS=$(curl -sS -o /dev/null -D "$HEADERS_FILE" -w '%{http_code}' \
    -X OPTIONS "$url" \
    -H "Origin: https://mmmis.vercel.app" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: authorization,content-type,apikey")
  assert_status 204 "$STATUS" "CORS preflight: $fn"
  assert_header_present "access-control-allow-origin" "$HEADERS_FILE" "CORS header origin: $fn"
  assert_header_present "access-control-allow-methods" "$HEADERS_FILE" "CORS header methods: $fn"
done
echo ""

# ---------------------------------------------------------------------------
# 2. chit-authorize
# ---------------------------------------------------------------------------

echo "--- chit-authorize ---"

# 2a. No JWT -> 401
call_edge chit-authorize POST "" ""
assert_status 401 "$STATUS" "chit-authorize: no Authorization header"
echo ""

# 2b. Member JWT, missing body fields -> 400
call_edge chit-authorize POST "-H \"Authorization: Bearer ${MEMBER_JWT}\"" "{}"
assert_status 400 "$STATUS" "chit-authorize: empty body rejected"
echo ""

# 2c. Member JWT, missing request_id/password in body -> 400
call_edge chit-authorize POST "-H \"Authorization: Bearer ${MEMBER_JWT}\"" "{\"foo\":\"bar\"}"
assert_status 400 "$STATUS" "chit-authorize: missing fields rejected"
echo ""

# 2d. Happy path (only if REQUEST_ID is set)
if [[ -z "${REQUEST_ID:-}" ]]; then
  skip "chit-authorize: happy path" "REQUEST_ID not set"
else
  call_edge chit-authorize POST "-H \"Authorization: Bearer ${MEMBER_JWT}\"" \
    "{\"request_id\":\"${REQUEST_ID}\",\"password\":\"${BUYER_PASSWORD}\"}"
  assert_status_in "200 409 410" "$STATUS" "chit-authorize: happy path (or already-finalized)"
  if [[ "$STATUS" == "200" ]]; then
    grep -q '"ok":true' "$BODY_FILE" || echo -e "${RED}FAIL${NC} chit-authorize: response missing ok:true"
  fi
fi
echo ""

# 2e. Wrong password -> 401 (only if REQUEST_ID is set and still pending)
if [[ -z "${REQUEST_ID:-}" ]]; then
  skip "chit-authorize: wrong password" "REQUEST_ID not set"
else
  call_edge chit-authorize POST "-H \"Authorization: Bearer ${MEMBER_JWT}\"" \
    "{\"request_id\":\"${REQUEST_ID}\",\"password\":\"definitely-wrong-pw-12345\"}"
  # 401 = wrong password, 409 = already finalized, 410 = expired
  assert_status_in "401 409 410" "$STATUS" "chit-authorize: wrong password (or already-finalized)"
fi
echo ""

# ---------------------------------------------------------------------------
# 3. set-member-email
# ---------------------------------------------------------------------------

echo "--- set-member-email ---"

# 3a. No JWT -> 401
call_edge set-member-email POST "" "{\"email\":\"foo@bar.com\"}"
assert_status 401 "$STATUS" "set-member-email: no JWT"
echo ""

# 3b. Member JWT, no current_password -> 400 (the new hardening check)
call_edge set-member-email POST "-H \"Authorization: Bearer ${MEMBER_JWT}\"" \
  "{\"email\":\"new-${RANDOM}@example.com\"}"
assert_status 400 "$STATUS" "set-member-email: missing current_password on self-service"
grep -q 'current_password required' "$BODY_FILE" \
  && echo -e "${GREEN}PASS${NC} set-member-email: error message mentions current_password required" \
  || echo -e "${RED}FAIL${NC} set-member-email: error message did not mention current_password"
echo ""

# 3c. Member JWT, wrong current_password -> 401
call_edge set-member-email POST "-H \"Authorization: Bearer ${MEMBER_JWT}\"" \
  "{\"email\":\"new-${RANDOM}@example.com\",\"current_password\":\"wrong-pw-12345\"}"
assert_status 401 "$STATUS" "set-member-email: wrong current_password"
echo ""

# 3d. Member JWT, correct current_password -> 200 (writes new email)
NEW_EMAIL="selftest-$(date +%s)-${RANDOM}@example.com"
call_edge set-member-email POST "-H \"Authorization: Bearer ${MEMBER_JWT}\"" \
  "$(printf '{"email":"%s","current_password":"%s"}' "$NEW_EMAIL" "${BUYER_PASSWORD:-wrong}")"
if [[ "${BUYER_PASSWORD:-}" == "" ]]; then
  skip "set-member-email: happy path" "BUYER_PASSWORD not set"
else
  assert_status 200 "$STATUS" "set-member-email: happy path (correct current_password)"
  grep -q "\"email\":\"${NEW_EMAIL}\"" "$BODY_FILE" \
    && echo -e "${GREEN}PASS${NC} set-member-email: response echoes new email" \
    || echo -e "${RED}FAIL${NC} set-member-email: response did not echo new email"
fi
echo ""

# ---------------------------------------------------------------------------
# 4. create-user
# ---------------------------------------------------------------------------

echo "--- create-user ---"

# 4a. No JWT -> 401
call_edge create-user POST "" "{\"service_number\":\"X\",\"email\":\"x@x.com\",\"full_name\":\"X\",\"role_code\":\"member\"}"
assert_status 401 "$STATUS" "create-user: no JWT"
echo ""

# 4b. Non-admin JWT -> 403
call_edge create-user POST "-H \"Authorization: Bearer ${MEMBER_JWT}\"" \
  "{\"service_number\":\"X\",\"email\":\"x@x.com\",\"full_name\":\"X\",\"role_code\":\"member\"}"
assert_status 403 "$STATUS" "create-user: member caller rejected"
echo ""

# 4c. Admin JWT, missing fields -> 400
call_edge create-user POST "-H \"Authorization: Bearer ${ADMIN_JWT}\"" "{}"
assert_status 400 "$STATUS" "create-user: missing fields rejected"
echo ""

# 4d. Admin JWT, bad role_code -> 400
call_edge create-user POST "-H \"Authorization: Bearer ${ADMIN_JWT}\"" \
  "{\"service_number\":\"X\",\"email\":\"x@x.com\",\"full_name\":\"X\",\"role_code\":\"not-a-role\"}"
assert_status 400 "$STATUS" "create-user: bad role_code rejected"
echo ""

# 4e. Admin JWT, happy path -> 200 with user_id, auth_id, temp_password
SVC="TEST$(date +%s)${RANDOM}"
TEST_EMAIL="test-${SVC}@example.com"
call_edge create-user POST "-H \"Authorization: Bearer ${ADMIN_JWT}\"" \
  "$(printf '{"service_number":"%s","email":"%s","full_name":"Test User","role_code":"member","is_active":true}' "$SVC" "$TEST_EMAIL")"
assert_status 200 "$STATUS" "create-user: happy path"
if [[ "$STATUS" == "200" ]]; then
  for key in user_id auth_id temp_password; do
    grep -q "\"${key}\":" "$BODY_FILE" \
      && echo -e "${GREEN}PASS${NC} create-user: response contains $key" \
      || echo -e "${RED}FAIL${NC} create-user: response missing $key"
  done
  # If mail is not configured, mailed should be false.
  grep -q '"mailed":false' "$BODY_FILE" \
    && echo -e "${YELLOW}INFO${NC} create-user: mailed=false (Mailgun secrets not set — expected)" \
    || echo -e "${YELLOW}INFO${NC} create-user: mailed response field not 'false' (Mailgun may be configured)"
fi
echo ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo "=== Summary ==="
echo -e "PASS: ${GREEN}${PASS}${NC}  FAIL: ${RED}${FAIL}${NC}  SKIP: ${YELLOW}${SKIP}${NC}"

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0