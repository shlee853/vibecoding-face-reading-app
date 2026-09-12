# 배포 가이드 — Oracle Cloud Always Free

관상사주 분석 웹앱을 인터넷에 공개하는 절차입니다. 위에서부터 순서대로 따라 하면 됩니다.

## 이 배포의 값 (2026-09-12 확정)

| 항목 | 값 |
|---|---|
| 클라우드 | Oracle Cloud |
| 서버 IP | `168.107.8.13` |
| 접속 도메인 | `168-107-8-13.sslip.io` (도메인 미보유 → sslip.io 사용) |
| 최종 주소 | `https://168-107-8-13.sslip.io` |
| OS | Ubuntu 24.04.3 LTS |
| 아키텍처 | x86_64 (AMD), 2코어 |
| 메모리 | **956Mi** — 서버에서 빌드 불가, 스왑 필요 |
| 계정 | `ubuntu` |
| Node | v22.22.0 (이미 설치됨 — 추가 설치 불필요) |
| nginx | 미설치 |
| Gemini 아웃바운드 | **정상** (키 없이 호출해 403 응답 = 네트워크 도달 확인) |

### 이 서버에서 미리 확인한 것

- **번들 이식성**: 개발 기계는 arm64(Mac), 서버는 x86_64입니다. 번들에 네이티브
  바이너리(`.node`)가 하나도 없음을 확인했으므로 **그대로 올려도 동작합니다.**
- **메모리 956Mi**: `next build`를 서버에서 돌리면 거의 확실히 OOM입니다.
  이 가이드는 로컬에서 빌드해 산출물만 올리므로 문제없지만, **스왑은 잡아두는 것이 안전합니다**
  (아래 3단계). 스왑이 없으면 부하가 몰릴 때 커널이 앱을 죽일 수 있습니다.

> **sslip.io가 뭔가요**: IP를 그대로 이름으로 되돌려주는 공개 DNS입니다.
> `168-107-8-13.sslip.io` 를 조회하면 `168.107.8.13` 이 나옵니다. 도메인을 사지 않고도
> Let's Encrypt 인증서를 받을 수 있어, **카메라에 필요한 HTTPS**를 확보할 수 있습니다.
> 나중에 실제 도메인을 사면 nginx의 `server_name` 만 바꾸고 certbot을 다시 돌리면 됩니다.

## 왜 Oracle VM인가

이 앱의 분석은 **20~60초**가 걸립니다. Vercel 같은 서버리스 무료 요금제는 함수 실행 시간
상한이 이보다 짧아 정상 분석이 잘려나갑니다. **상시 구동되는 VM**이 이 앱에는 맞습니다.
Oracle Always Free는 기간 제한 없이 VM을 주므로 적합합니다.

## 전체 그림

```
브라우저 ──HTTPS──> nginx (443) ──> Next.js standalone (127.0.0.1:3000) ──> Gemini API
                      │                       │
                   Let's Encrypt          systemd가 죽으면 다시 띄움
```

---

## 0~1. 계정과 VM — ✅ 완료

Oracle 계정, Ubuntu 24.04 인스턴스(`168.107.8.13`), SSH 접속까지 모두 준비되어 있습니다.
**2단계부터 시작하세요.**

<details>
<summary>새 서버에 처음부터 만들 때 (참고용)</summary>

1. **Compute → Instances → Create instance**
2. **Image**: Ubuntu 22.04 또는 24.04
3. **Shape**: `VM.Standard.A1.Flex` (ARM, 4 OCPU / 24GB)가 넉넉합니다.
   `Out of host capacity` 가 뜨면 다른 가용 도메인·리전으로 바꾸거나 시간을 두고 재시도하세요.
   AMD `E2.1.Micro`(1GB)로도 **이 가이드는 그대로 동작합니다** — 빌드를 서버에서 하지 않기 때문입니다.
4. **SSH 키**: `ssh-keygen -t ed25519 -f ~/.ssh/oracle_face_reading` 로 만든 뒤
   `.pub` 내용을 "Paste public keys"에 붙여넣으세요. **개인키는 오라클이 보관하지 않습니다.**

</details>

## 2. 방화벽 열기 — ★ 두 군데를 모두 열어야 합니다

Oracle에서 가장 많이 막히는 지점입니다. **클라우드 방화벽만 열고 끝내면 접속되지 않습니다.**

**(1) 클라우드 쪽** — 콘솔에서 인스턴스의 서브넷 → **Security List** → Ingress Rules 추가:

| Source CIDR | Protocol | Port |
|---|---|---|
| 0.0.0.0/0 | TCP | 80 |
| 0.0.0.0/0 | TCP | 443 |

**(2) VM 안쪽** — Oracle의 Ubuntu 이미지는 iptables 규칙이 기본으로 걸려 있습니다. SSH 접속 후:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 3. 서버 초기 설정

```bash
ssh -i ~/.ssh/oracle_face_reading ubuntu@168.107.8.13
```

**Node는 이미 v22.22.0이 설치되어 있으므로 추가 설치가 필요 없습니다.** nginx만 설치합니다.

```bash
sudo apt update && sudo apt install -y nginx iptables-persistent
```

### 스왑 잡기 — 메모리가 956Mi뿐입니다

스왑이 없으면 부하가 몰릴 때 커널이 앱 프로세스를 죽입니다(OOM kill). 2GB를 잡아둡니다.

```bash
free -h | grep -i swap          # 이미 있으면 이 단계는 건너뛰세요
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h                          # Swap 줄에 2.0Gi가 보이면 성공
```

## 4. API 키 등록

```bash
sudo install -m 600 -o ubuntu -g ubuntu /dev/null /etc/face-reading.env
sudo nano /etc/face-reading.env
```

파일에 이 한 줄만 넣고 저장합니다:

```
GEMINI_API_KEY=여기에_실제_키
```

> 권한을 600으로 두는 이유: 다른 사용자가 읽지 못하게 하기 위함입니다.
> **이 파일은 절대 git에 올리지 마세요.**

## 5. 앱 올리기

**로컬에서** 번들을 만듭니다:

```bash
./scripts/build-deploy.sh
```

`deploy-bundle.tar.gz` 가 생깁니다. 서버로 보냅니다:

```bash
scp -i ~/.ssh/oracle_face_reading deploy-bundle.tar.gz ubuntu@168.107.8.13:~/
scp -i ~/.ssh/oracle_face_reading deploy/face-reading.service deploy/nginx.conf ubuntu@168.107.8.13:~/
```

**서버에서** 펼칩니다:

```bash
mkdir -p ~/face-reading
tar -xzf ~/deploy-bundle.tar.gz -C ~/face-reading
```

systemd에 등록합니다:

```bash
sudo cp ~/face-reading.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now face-reading
sudo systemctl status face-reading --no-pager
```

`active (running)` 이 보이면 성공입니다. 확인:

```bash
curl -s http://127.0.0.1:3000/api/health
```

`{"ok":true,"apiKey":"configured",...}` 가 나와야 합니다.
`"apiKey":"missing"` 이면 4단계의 환경 파일을 다시 보세요.

## 6. nginx + HTTPS

`deploy/nginx.conf` 에 `168-107-8-13.sslip.io` 가 이미 들어 있습니다. 그대로 복사하면 됩니다.

```bash
sudo cp ~/nginx.conf /etc/nginx/sites-available/face-reading
# nginx.conf에 도메인이 이미 채워져 있어 수정할 것이 없습니다
sudo ln -sf /etc/nginx/sites-available/face-reading /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

인증서를 받습니다:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d 168-107-8-13.sslip.io
```

certbot이 HTTPS 블록을 자동으로 추가하고 자동 갱신도 설정합니다.

> ### ★ HTTPS는 선택이 아닙니다
> 브라우저는 **보안 연결에서만 카메라를 허용**합니다. HTTP로 접속하면 카메라 탭이
> "보안 연결이 아니어서 카메라를 쓸 수 없습니다" 로 막힙니다.

## 7. 확인

```bash
curl -s https://168-107-8-13.sslip.io/api/health
```

브라우저에서 `https://168-107-8-13.sslip.io` 접속 후:

- [ ] 사진 업로드 → 분석 결과가 5개 섹션으로 나온다
- [ ] 카메라 촬영 → 좌우 반전된 미리보기, 촬영 후 분석
- [ ] 분석 중 경과 초가 올라간다
- [ ] 새로고침해도 마지막 결과가 남는다

---

## 자동 배포 (GitHub Actions) — 권장

설정을 마치면 **`main`에 푸시하는 것만으로 서버까지 자동 반영**됩니다.
`scp`를 직접 칠 일이 없어집니다.

```
git push  →  타입검사 + 테스트  →  빌드  →  서버 전송  →  재시작  →  버전 확인
                     ↓ 실패하면                              ↓ 헬스체크 실패하면
                   배포 안 함                              이전 버전으로 자동 롤백
```

### 왜 이 방식인가

- **검증을 통과해야만 배포됩니다.** 타입 오류나 테스트 실패가 있으면 서버에 올라가지 않습니다.
- **빌드를 GitHub 러너(linux/x64)에서 합니다.** 서버와 아키텍처가 같아 개발 기계(arm64 Mac)에서
  빌드하는 것보다 안전하고, 956Mi 서버에서 빌드하지 않아도 됩니다.
- **실패하면 되돌립니다.** 새 버전이 헬스체크를 통과하지 못하면 이전 버전으로 자동 복구합니다.
- **배포된 버전을 밖에서 확인합니다.** `/api/health`의 `version`이 커밋 해시와 일치하는지 검사합니다.

### 설정 1 — 배포 전용 SSH 키 만들기 (로컬에서)

평소 접속용 키를 재사용하지 마세요. **배포 전용 키를 따로** 만들어 권한 범위를 좁힙니다.

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/deploy_face_reading -N ""
```

### 설정 2 — 공개키를 서버에 등록 (로컬에서)

```bash
ssh-copy-id -i ~/.ssh/deploy_face_reading.pub -o IdentityFile=~/.ssh/oracle_face_reading ubuntu@168.107.8.13
```

`ssh-copy-id`가 없으면:

```bash
cat ~/.ssh/deploy_face_reading.pub | ssh -i ~/.ssh/oracle_face_reading ubuntu@168.107.8.13 'cat >> ~/.ssh/authorized_keys'
```

### 설정 3 — 재시작 권한 열기 (서버에서)

Actions가 비밀번호 없이 서비스를 재시작해야 합니다. **전체 sudo를 열지 않고 필요한 명령만** 허용합니다.

```bash
sudo tee /etc/sudoers.d/face-reading > /dev/null <<'EOF'
ubuntu ALL=(root) NOPASSWD: /usr/bin/systemctl restart face-reading
ubuntu ALL=(root) NOPASSWD: /usr/bin/systemctl status face-reading
ubuntu ALL=(root) NOPASSWD: /usr/bin/journalctl -u face-reading *
EOF
sudo chmod 440 /etc/sudoers.d/face-reading
sudo visudo -c          # "parsed OK" 가 나와야 합니다
```

### 설정 4 — GitHub에 시크릿 등록 (브라우저에서)

저장소 → **Settings → Secrets and variables → Actions → New repository secret** 에서 4개를 만듭니다.

| 이름 | 값 |
|---|---|
| `DEPLOY_HOST` | `168.107.8.13` |
| `DEPLOY_USER` | `ubuntu` |
| `DEPLOY_DOMAIN` | `168-107-8-13.sslip.io` |
| `DEPLOY_SSH_KEY` | `~/.ssh/deploy_face_reading` **개인키 전문** |

개인키를 클립보드로 복사하려면:

```bash
pbcopy < ~/.ssh/deploy_face_reading
```

> `-----BEGIN OPENSSH PRIVATE KEY-----` 부터 `-----END OPENSSH PRIVATE KEY-----` 까지
> **줄바꿈을 포함해 전부** 붙여넣으세요. 마지막 줄바꿈이 빠지면 인증이 실패합니다.

### 설정 5 — 동작 확인

아무 커밋이나 푸시하거나, 저장소의 **Actions 탭 → 배포 → Run workflow** 를 누릅니다.
"배포된 버전 확인" 단계에서 `✅ <커밋해시> 배포 확인` 이 나오면 완료입니다.

> 시크릿을 설정하기 전에도 워크플로는 돕니다 — 검증만 하고 배포는 건너뛰며,
> 빨간 실패로 표시되지 않습니다.

---

## 수동 배포 (자동 배포를 쓰지 않을 때)

```bash
# 로컬
./scripts/build-deploy.sh
scp -i ~/.ssh/oracle_face_reading deploy-bundle.tar.gz deploy/remote-install.sh ubuntu@168.107.8.13:~/

# 서버 — 검증과 롤백이 포함된 설치 스크립트를 씁니다
chmod +x ~/remote-install.sh && ~/remote-install.sh
```

## 무엇이 배포되어 있는지 확인하기

```bash
curl -s https://168-107-8-13.sslip.io/api/health
```

`version` 필드가 배포된 커밋 해시입니다. 로컬의 `git rev-parse HEAD` 와 비교하면
고친 내용이 반영됐는지 바로 알 수 있습니다.

## 로그 보기

```bash
sudo journalctl -u face-reading -f          # 실시간
sudo journalctl -u face-reading -n 100      # 최근 100줄
sudo journalctl -u face-reading | grep '\[analyze\]'   # 분석 실패 원인만
```

---

## 문제 해결

| 증상 | 원인과 조치 |
|---|---|
| 브라우저에서 접속 자체가 안 됨 | 방화벽 **두 군데**를 모두 열었는지 확인 (2단계). 클라우드 Security List만 열면 안 됩니다 |
| 화면은 뜨는데 버튼이 안 먹음 | 번들에 `.next/static` 이 빠진 것입니다. `scripts/build-deploy.sh` 로 다시 만드세요 (직접 tar로 묶지 마세요) |
| 분석이 504로 끊김 | nginx의 `proxy_read_timeout` 을 확인하세요. 기본 60초는 이 앱에 짧습니다 |
| 카메라 탭이 막힘 | HTTPS로 접속했는지 확인 (6단계) |
| 모든 분석이 "서버가 AI 분석 서비스에 연결하지 못했습니다" | VM에서 외부 HTTPS 아웃바운드가 막힌 것입니다. `curl -I https://generativelanguage.googleapis.com` 으로 확인 |
| `"apiKey":"missing"` | `/etc/face-reading.env` 를 확인하고 `sudo systemctl restart face-reading` |
| **502 Bad Gateway** + 서비스가 `status=203/EXEC` 로 반복 재시작 | **유닛의 node 경로가 틀린 것입니다.** systemd는 로그인 셸의 PATH를 쓰지 않아 node 위치가 apt/nvm에 따라 다릅니다. 아래 한 줄로 고치세요 |
| 요청 제한에 자꾸 걸림 | nginx가 `X-Forwarded-For` 를 넘기는지 확인. 빠지면 모든 방문자가 한 사람으로 취급됩니다 |

### node 경로가 틀렸을 때 (203/EXEC)

```bash
NODE_BIN=$(readlink -f "$(command -v node)")
echo "node 실제 경로: $NODE_BIN"
sudo sed -i "s|^ExecStart=.*|ExecStart=$NODE_BIN server.js|" /etc/systemd/system/face-reading.service
sudo systemctl daemon-reload && sudo systemctl reset-failed face-reading && sudo systemctl restart face-reading
sleep 4 && curl -s http://127.0.0.1:3000/api/health
```

> nvm으로 설치한 node를 쓰면 경로에 버전이 박힙니다(`~/.nvm/versions/node/v22.22.0/bin/node`).
> 나중에 node를 올리면 이 경로가 깨지므로, 운영을 오래 할 계획이면
> `sudo apt install -y nodejs` 로 시스템 경로(`/usr/bin/node`)에 두는 편이 안정적입니다.

## 비용 관리

이 앱은 분석 1회에 Gemini 비전 호출이 **2회** 일어납니다. 공개 주소이므로 제한이 필수입니다.
현재 기본값은 `lib/ratelimit.ts` 의 `DEFAULT_RULES` 에 있습니다:

- 5분에 5회 (연타 방지)
- 하루 30회 (IP당 총량)

트래픽을 보고 조절한 뒤 다시 배포하면 됩니다. Google AI Studio 콘솔에서 실제 사용량도
함께 지켜보세요.
