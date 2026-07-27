#!/usr/bin/env bash
# ===========================================================================
#  서버 강제 검증 스크립트
#
#  화면을 거치지 않고 API 를 직접 때린다. 이게 핵심이다 —
#  브라우저에서 막히는 건 아무 의미가 없고, curl 로도 막혀야 진짜 강제다.
#
#  사용법:
#      ./scripts/verify.sh                       # http://localhost:3000
#      ./scripts/verify.sh https://your.app      # 배포된 주소
# ===========================================================================
set -uo pipefail

BASE="${1:-http://localhost:3000}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0

# ---------------------------------------------------------------------------
# 헬퍼
# ---------------------------------------------------------------------------

# 업로드해서 HTTP 상태코드와 사유 코드를 얻는다.
#   $1 = 서버로 보낼 파일명, $2 = 로컬 파일 경로
upload() {
  curl -s -w '\n%{http_code}' -X POST "$BASE/api/upload" \
    -F "file=@$2;filename=$1" 2>/dev/null
}

# $1 설명  $2 기대 상태코드  $3 기대 code(빈 문자열이면 검사 안 함)  $4 파일명  $5 로컬파일
check_upload() {
  local desc="$1" want_status="$2" want_code="$3" fname="$4" path="$5"
  local out status body code

  out="$(upload "$fname" "$path")"
  status="$(tail -n1 <<<"$out")"
  body="$(sed '$d' <<<"$out")"
  code="$(sed -n 's/.*"code":"\([A-Z_]*\)".*/\1/p' <<<"$body")"

  if [[ "$status" == "$want_status" ]] && { [[ -z "$want_code" ]] || [[ "$code" == "$want_code" ]]; }; then
    printf '  \033[32m✓\033[0m %-46s %s %s\n' "$desc" "$status" "$code"
    PASS=$((PASS + 1))
  else
    printf '  \033[31m✗\033[0m %-46s got %s %s (want %s %s)\n' \
      "$desc" "$status" "${code:-–}" "$want_status" "$want_code"
    FAIL=$((FAIL + 1))
  fi
}

# $1 설명  $2 기대 상태코드  $3 method  $4 path  $5 body(선택)
check_api() {
  local desc="$1" want="$2" method="$3" path="$4" body="${5:-}"
  local status

  if [[ -n "$body" ]]; then
    status="$(curl -s -o /dev/null -w '%{http_code}' -X "$method" "$BASE$path" \
      -H 'Content-Type: application/json' -d "$body")"
  else
    status="$(curl -s -o /dev/null -w '%{http_code}' -X "$method" "$BASE$path")"
  fi

  if [[ "$status" == "$want" ]]; then
    printf '  \033[32m✓\033[0m %-46s %s\n' "$desc" "$status"
    PASS=$((PASS + 1))
  else
    printf '  \033[31m✗\033[0m %-46s got %s (want %s)\n' "$desc" "$status" "$want"
    FAIL=$((FAIL + 1))
  fi
}

# ---------------------------------------------------------------------------
# 테스트 픽스처
# ---------------------------------------------------------------------------
printf 'hello, 평범한 텍스트 파일입니다\n' > "$TMP/plain.txt"
printf '%%PDF-1.7\n1 0 obj\n' > "$TMP/real.pdf"
# Windows PE 헤더(MZ)로 시작하는 "가짜 실행 파일"
printf 'MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00' > "$TMP/fake.exe"
printf '#!/bin/bash\necho hi\n' > "$TMP/script.sh"

echo
echo "대상: $BASE"

# ---------------------------------------------------------------------------
echo
echo "[1] 초기 상태 — 명세상 고정 확장자 기본값은 unCheck"
# 아무것도 차단돼 있지 않으므로 exe 도 통과해야 한다. 이게 명세 그대로의 동작이다.
check_upload "차단 전이므로 .exe 통과" 201 "" "installer.exe" "$TMP/plain.txt"

# ---------------------------------------------------------------------------
echo
echo "[2] 고정 확장자 exe 를 차단으로 전환"
EXE_ID="$(curl -s "$BASE/api/extensions" \
  | tr ',' '\n' | grep -B4 '"extension":"exe"' | sed -n 's/.*"id":"\([0-9]*\)".*/\1/p' | head -1)"
if [[ -z "$EXE_ID" ]]; then
  EXE_ID="$(curl -s "$BASE/api/extensions" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const j=JSON.parse(s);
      console.log(j.extensions.find(e=>e.extension==="exe").id);
    });')"
fi
check_api "PATCH exe → isBlocked=true" 200 PATCH "/api/extensions/$EXE_ID" '{"isBlocked":true}'

# ---------------------------------------------------------------------------
echo
echo "[3] 확장자 우회 시도 — 전부 차단되어야 한다"
check_upload "기본형          installer.exe"      400 BLOCKED_EXTENSION "installer.exe"       "$TMP/plain.txt"
check_upload "대문자          installer.EXE"      400 BLOCKED_EXTENSION "installer.EXE"       "$TMP/plain.txt"
check_upload "혼합            installer.ExE"      400 BLOCKED_EXTENSION "installer.ExE"       "$TMP/plain.txt"
check_upload "후행 점         installer.exe."     400 BLOCKED_EXTENSION "installer.exe."      "$TMP/plain.txt"
check_upload "후행 공백       'installer.exe '"   400 BLOCKED_EXTENSION "installer.exe "      "$TMP/plain.txt"
check_upload "이중 확장자     resume.exe.pdf"     400 BLOCKED_EXTENSION "resume.exe.pdf"      "$TMP/plain.txt"
check_upload "이중 확장자     resume.pdf.exe"     400 BLOCKED_EXTENSION "resume.pdf.exe"      "$TMP/plain.txt"
check_upload "연속 점         installer..exe"     400 BLOCKED_EXTENSION "installer..exe"      "$TMP/plain.txt"
check_upload "전각 문자       installer.ｅｘｅ"     400 BLOCKED_EXTENSION "installer.ｅｘｅ"      "$TMP/plain.txt"

# ---------------------------------------------------------------------------
echo
echo "[4] 파일명 자체가 비정상 — 확장자 정책 이전 단계에서 차단"
check_upload "경로 순회       ../../etc/passwd"   400 ILLEGAL_PATH_SEPARATOR "../../etc/passwd" "$TMP/plain.txt"
check_upload "윈도우 경로     C:\\evil.exe"       400 ILLEGAL_PATH_SEPARATOR "C:\\evil.exe"     "$TMP/plain.txt"
# RTLO(U+202E): 화면에는 photo_exe.png 로 보이지만 실제로는 .exe
check_upload "RTLO 위장       photo_<U+202E>gnp.exe" 400 ILLEGAL_BIDI_CHAR "$(printf 'photo_\xe2\x80\xaegnp.exe')" "$TMP/plain.txt"

# ---------------------------------------------------------------------------
echo
echo "[5] 내용 기반 차단 — 확장자만으로는 절대 못 잡는 영역"
# 확장자는 png. 정책에 png 는 없다. 그런데 내용은 Windows 실행 파일이다.
check_upload "이름만 바꾼 exe → photo.png"   400 EXECUTABLE_SIGNATURE "photo.png"  "$TMP/fake.exe"
check_upload "shebang 스크립트 → memo.txt"   400 EXECUTABLE_SIGNATURE "memo.txt"   "$TMP/script.sh"
check_upload "확장자 없는 실행 파일"          400 EXECUTABLE_SIGNATURE "installer" "$TMP/fake.exe"

# ---------------------------------------------------------------------------
echo
echo "[6] 정상 파일은 통과"
check_upload "일반 텍스트     memo.txt"       201 "" "memo.txt"   "$TMP/plain.txt"
check_upload "정상 PDF        report.pdf"     201 "" "report.pdf" "$TMP/real.pdf"

# ---------------------------------------------------------------------------
echo
echo "[7] 커스텀 확장자 — 입력 검증과 중복 방지"
check_api "sh 추가"                    201 POST "/api/extensions" '{"extension":"sh"}'
check_api "SH 재추가 → 중복"           409 POST "/api/extensions" '{"extension":"SH"}'
check_api ".sh 재추가 → 중복"          409 POST "/api/extensions" '{"extension":".sh"}'
check_api "' sh ' 재추가 → 중복"       409 POST "/api/extensions" '{"extension":"  sh  "}'
check_api "exe(고정) 추가 → 중복"      409 POST "/api/extensions" '{"extension":"exe"}'
check_api "20자 → 허용"                201 POST "/api/extensions" '{"extension":"aaaaaaaaaaaaaaaaaaaa"}'
check_api "21자 → 거부"                400 POST "/api/extensions" '{"extension":"aaaaaaaaaaaaaaaaaaaaa"}'
check_api "빈 문자열 → 거부"           400 POST "/api/extensions" '{"extension":""}'
check_api "경로 문자 → 거부"           400 POST "/api/extensions" '{"extension":"../etc"}'
check_api "한글 → 거부"                400 POST "/api/extensions" '{"extension":"실행"}'
check_api "숫자 타입 → 거부"           400 POST "/api/extensions" '{"extension":123}'
check_api "tar.gz(중간 점) → 거부"     400 POST "/api/extensions" '{"extension":"tar.gz"}'

# ---------------------------------------------------------------------------
echo
echo "[8] 커스텀 정책이 업로드에 즉시 반영된다"
check_upload "script.sh 차단"          400 BLOCKED_EXTENSION "script.sh" "$TMP/plain.txt"
check_upload "script.SH 도 차단"       400 BLOCKED_EXTENSION "script.SH" "$TMP/plain.txt"

# ---------------------------------------------------------------------------
echo
echo "[9] 고정 확장자는 DELETE 로 삭제되지 않는다"
check_api "DELETE 고정 exe → 404"      404 DELETE "/api/extensions/$EXE_ID"

# ---------------------------------------------------------------------------
echo
echo "[10] 정책 해제 후 다시 허용되는지"
check_api "PATCH exe → isBlocked=false" 200 PATCH "/api/extensions/$EXE_ID" '{"isBlocked":false}'
sleep 6   # 정책 캐시 TTL(5초)보다 길게 대기 — 무효화가 실패해도 TTL 로 회복되는지 함께 확인
check_upload "해제 후 installer.exe 통과" 201 "" "installer.exe" "$TMP/plain.txt"

# ---------------------------------------------------------------------------
echo
printf '결과: \033[32m%d passed\033[0m' "$PASS"
if [[ $FAIL -gt 0 ]]; then
  printf ', \033[31m%d failed\033[0m\n' "$FAIL"
  exit 1
fi
printf '\n'
