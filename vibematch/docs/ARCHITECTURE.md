# Arquitetura

A fonte técnica de verdade é o **Blueprint V1.2** (documento externo ao repositório
até ser versionado aqui). Este arquivo não redefine arquitetura; apenas indica onde
cada decisão da V1.2 aparece no código.

| Seção V1.2                    | Onde está implementado                                  |
| ----------------------------- | ------------------------------------------------------- |
| §2.2 schema                   | `migrations/002`–`004`                                  |
| §2.3 invariantes de Consent   | `migrations/003` (constraints + triggers)               |
| §2.2 trigger de elegibilidade | `migrations/003` `enforce_session_eligibility`          |
| §2.5 privilégios por papel    | `migrations/006`                                        |
| §4.2 trilha de autenticidade  | `migrations/003` `consent_decisions` + `005` hash chain |
| §12 audit model               | `migrations/005`                                        |
| §1.3 interfaces de fornecedor | `backend/src/shared/providers/index.ts`                 |
| D2 / D3 (config server-side)  | `backend/src/config/env.ts`                             |
| Gates 42/43/44                | `tests/db/privileges/roles.test.ts`                     |

**Não implementado nesta etapa:** §5 API Contract, §6 tokens, §7 modelo de concorrência
(transações de aplicação), §8 LiveKit, §9 cascatas, §10 event bus, §11 billing.
As garantias estruturais de banco existem; as garantias de aplicação não.
