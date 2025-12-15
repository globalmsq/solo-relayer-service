# MSQ Relayer Service

**Blockchain Transaction Relayer System** - B2B Infrastructure

OpenZeppelin Defender 서비스 종료(2026년 7월)에 대비한 self-hosted 블록체인 트랜잭션 릴레이 시스템입니다.

## Quick Start

```bash
# 로컬 개발 환경 (Hardhat Node)
docker compose -f docker/docker-compose.yaml up -d

# Polygon Amoy 테스트넷
docker compose -f docker/docker-compose-amoy.yaml up -d

# Health Check
curl http://localhost:3000/api/v1/health
```

## Documentation

상세 문서는 [docs/](./docs/) 디렉토리를 참조하세요:

| 문서 | 역할 | 질문 유형 |
|------|------|----------|
| [product.md](./docs/product.md) | **WHAT/WHY** | "무엇을 만드나요?", "왜 필요한가요?" |
| [structure.md](./docs/structure.md) | **WHERE** | "어디에 있나요?", "어떻게 구성되나요?" |
| [tech.md](./docs/tech.md) | **HOW** | "어떻게 구현하나요?", "API 스펙은?" |

## Project Structure

```
msq-relayer-service/
├── docker/                     # Docker 파일 통합 디렉토리
├── packages/
│   ├── api-gateway/            # NestJS API Gateway
│   ├── contracts/              # Smart Contracts (Hardhat)
│   └── examples/               # 사용 예제
├── docs/                       # 문서
└── README.md
```

## Status

**Phase 1 구현 단계** (Direct + Gasless + Multi-Relayer Pool)

---

**Version**: 12.0
**Last Updated**: 2025-12-15
