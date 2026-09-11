# 배포 가이드 — Oracle Cloud Always Free

관상사주 분석 웹앱을 인터넷에 공개하는 절차입니다. 위에서부터 순서대로 따라 하면 됩니다.

## 이 배포의 값 (2026-09-12 확정)

| 항목 | 값 |
|---|---|
| 클라우드 | Oracle Cloud |
| 서버 IP | `168.107.8.13` |
| 접속 도메인 | `168-107-8-13.sslip.io` (도메인 미보유 → sslip.io 사용) |
| 최종 주소 | `https://168-107-8-13.sslip.io` |

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

## 0. 준비물

- Oracle Cloud 계정 (가입에 신용카드 확인이 필요하지만 Always Free는 청구되지 않습니다)
- Gemini API 키
- 로컬에 이 저장소

---

## 1. VM 만들기 (Oracle 콘솔)

1. **Compute → Instances → Create instance**
2. **Image**: Ubuntu 22.04 (또는 24.04)
3. **Shape**: `VM.Standard.A1.Flex` (ARM) — **4 OCPU / 24GB** 로 잡으세요. Always Free 범위입니다.
4. **SSH 키**: 공개키를 붙여넣거나 새로 생성해 개인키를 내려받으세요
5. 생성 후 **Public IP** 를 적어둡니다

> ### ⚠️ ARM 재고가 없다고 나오면
> `Out of host capacity` 는 매우 흔합니다. 선택지:
> - 다른 **가용 도메인(AD)** 이나 **리전**으로 바꿔 재시도
> - 시간을 두고 반복 시도 (재고가 수시로 돌아옵니다)
> - 대안으로 **AMD `VM.Standard.E2.1.Micro`** (1GB RAM) 사용 — 이 경우에도
>   **이 가이드는 그대로 동작합니다.** 빌드를 서버에서 하지 않고 로컬에서 만든 번들을
>   올리는 방식이라 1GB로도 충분합니다.

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
ssh ubuntu@168.107.8.13
```

```bash
sudo apt update && sudo apt install -y nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # v20.x 가 나와야 합니다
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
scp deploy-bundle.tar.gz ubuntu@168.107.8.13:~/
scp deploy/face-reading.service deploy/nginx.conf ubuntu@168.107.8.13:~/
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

## 갱신하기

코드를 고친 뒤:

```bash
# 로컬
./scripts/build-deploy.sh
scp deploy-bundle.tar.gz ubuntu@168.107.8.13:~/

# 서버
rm -rf ~/face-reading && mkdir -p ~/face-reading
tar -xzf ~/deploy-bundle.tar.gz -C ~/face-reading
sudo systemctl restart face-reading
```

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
| 요청 제한에 자꾸 걸림 | nginx가 `X-Forwarded-For` 를 넘기는지 확인. 빠지면 모든 방문자가 한 사람으로 취급됩니다 |

## 비용 관리

이 앱은 분석 1회에 Gemini 비전 호출이 **2회** 일어납니다. 공개 주소이므로 제한이 필수입니다.
현재 기본값은 `lib/ratelimit.ts` 의 `DEFAULT_RULES` 에 있습니다:

- 5분에 5회 (연타 방지)
- 하루 30회 (IP당 총량)

트래픽을 보고 조절한 뒤 다시 배포하면 됩니다. Google AI Studio 콘솔에서 실제 사용량도
함께 지켜보세요.
