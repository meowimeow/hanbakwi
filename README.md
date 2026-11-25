# 한바퀴 (가칭)

국립한국교통대 주변(대소원면 일대)의 실제 도로에서 GPS로 달리며 겨루는 러닝 웹앱.

**체험: https://meowimeow.github.io/hanbakwi/** (순위는 이 기기의 기록만 표시, 실시간 AI 그림 제외)

- 준비: Node.js 20 이상, `npm install`
- 실행: `npm start` 후 http://localhost:3000
- 테스트: `npm test` (약 3분)
- AI 그림: 터미널에서 환경 변수 `ANTHROPIC_API_KEY`를 설정하고 실행. 없으면 준비된 도안만 사용. 하루 100회 제한(`AI_DAILY_LIMIT`)
- 휴대폰 GPS는 HTTPS 주소에서만 동작

| 파일 | 역할 |
|---|---|
| public/router.js | 그림을 도로 경로로 변환 |
| public/roads.json | 도로망 (tools/build-roads.py로 생성) |
| public/presets.js | Claude가 그린 도안 |
| public/core.js | GPS 필터, 점수, 순위 (앱과 서버 공용) |
| ai.js | Claude API로 그림 받기 |
| server.js | 경로 검증, 점수 재계산, 순위 저장 |

도로, 건물, 하천 데이터: © OpenStreetMap contributors, ODbL 1.0.

한계: 공식 면 경계가 아닌 대략적인 구역(달천 동쪽 제외). OSM에 없는 건물, 공사, 통제, 사유지는 반영되지 않음. 화면이 꺼지면 GPS가 멈춤. 로그인 없음.
