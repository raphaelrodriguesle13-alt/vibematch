# VibeMatch — Handoff Manus ↔ ChatGPT

Atualizado em **2026-08-26** após a publicação na branch exclusiva `continuity`.

## Resumo da entrega

A etapa atual conclui o onboarding e a edição de perfil no Android com Jetpack Compose, consumindo o backend Fastify real. Após uma sessão Google válida, o app carrega os interesses disponíveis, consulta o perfil existente e abre o onboarding quando o backend responde `404 PROFILE_NOT_FOUND`. O botão de continuidade só libera a navegação após um `PUT /api/profile` bem-sucedido. Depois do perfil, usuários com `phone_verified=false` passam pela confirmação telefônica antes de acessar o chat.

A branch também foi reconciliada com os commits cooperativos mais recentes do ChatGPT, que adicionaram Age Assurance, MatchIntent, Consent, Video e a migration 008. O Android agora consulta o status real de Age Assurance e permanece em estado fail-closed para qualquer resultado diferente de `APPROVED`; o cliente não aprova idade, consentimento, matchmaking, vídeo ou entitlement localmente.

> **Fonte de verdade:** identidade, sessão, idade, bloqueio, suspensão, consentimento, elegibilidade e autorização de recursos restritos continuam sendo decisões do backend e do banco.

## Estado do Git

| Item                          | Valor                                                                 |
| ----------------------------- | --------------------------------------------------------------------- |
| Repositório                   | `raphaelrodriguesle13-alt/vibematch`                                  |
| Branch utilizada              | `continuity`                                                          |
| HEAD inicial desta retomada   | `d9487c9`                                                             |
| HEAD da implementação Android | `84039c7`                                                             |
| Estado final                  | `continuity` sincronizada com `origin/continuity`, working tree limpo |
| Push                          | Realizado sem force-push e sem tocar na `main`                        |

Durante a execução, a branch remota recebeu commits backend em paralelo. O trabalho Android foi preservado por rebases lineares sucessivos sobre o HEAD remoto, sem reset destrutivo ou sobrescrita de Auth, JWT, migrations, Fastify ou controles de segurança.

## Commits produzidos nesta retomada

| Commit    | Descrição                                         |
| --------- | ------------------------------------------------- |
| `ae69a14` | `feat: add Android profile onboarding`            |
| `23466e3` | `style: format cooperative backend additions`     |
| `88d6d30` | `fix: gate Android chat on age assurance`         |
| `adbcacf` | `test: include video unit suite`                  |
| `13e1273` | `style: normalize DB helper type formatting`      |
| `84039c7` | `feat: add Android phone verification onboarding` |

Os commits de estilo alteram apenas a formatação necessária para o gate estrito de Prettier nos arquivos cooperativos remotos; não alteram a lógica de Consent, Video, Profile ou banco.

## Implementação Android

O módulo `android/.../profile/` contém os modelos `UserProfile`, `ProfileInterest`, `ProfileDraft`, o contrato `ProfileGateway`, o cliente `ProfileApiClient` e o `ProfileViewModel`. O cliente envia sempre o Bearer token da sessão segura e implementa os contratos abaixo.

| Endpoint                        | Uso no Android                             | Comportamento relevante                                                                        |
| ------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `GET /api/interests`            | Carrega os chips de interesses             | A resposta vem do backend; a seleção visual é limitada a 10 itens                              |
| `GET /api/profile`              | Carrega o perfil atual                     | `404 PROFILE_NOT_FOUND` abre onboarding; `401` encerra a sessão                                |
| `PUT /api/profile`              | Cria ou atualiza o perfil                  | Envia `display_name`, `avatar_url`, `language`, `region` e `interest_ids` com nomes snake_case |
| `GET /api/age-assurance/status` | Consulta a elegibilidade etária do usuário | Somente `APPROVED` permite sair do perfil e abrir o chat                                       |

A `MainActivity` agora possui tela de onboarding e tela de perfil reutilizando o mesmo formulário. Os campos são nome de exibição, idioma, região, avatar HTTPS opcional e interesses. Há estados explícitos para carregamento, salvamento, erro, sessão expirada, idade necessária, idade pendente, idade rejeitada e indisponibilidade do serviço. O estado desconhecido nunca é tratado como aprovação.

O roteamento autenticado permanece protegido: sem perfil, o usuário fica no onboarding; com perfil mas Age Assurance não aprovado, fica no cartão fail-closed; com perfil e idade aprovada, mas sem telefone confirmado, fica na tela de verificação; somente depois de `phone_verified=true` o chat é exibido. O backend continua sendo a autoridade final e pode rejeitar qualquer operação mesmo que o estado local esteja desatualizado.

O cliente telefônico usa `POST /auth/phone/start` e `POST /auth/phone/confirm`. O primeiro envia `phone_e164` e recebe `verification_id` e `expires_at`; o segundo envia `verification_id` e `code`. O Android mantém esses valores somente no estado da tela, apresenta mensagens públicas para erros do provedor e encerra a sessão em HTTP 401. Após a confirmação positiva do backend, o `AuthViewModel` atualiza a dica local `phone_verified` para permitir a navegação; o JWT existente não é reemitido nem tratado como renovado.

## Testes e builds

| Comando                                                        | Resultado                                                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                            | Aprovado                                                                                     |
| `npm run lint`                                                 | Aprovado                                                                                     |
| `npm run format:check`                                         | Aprovado                                                                                     |
| `npm run test:unit`                                            | Aprovado: 11 suítes e 54 testes, incluindo Auth, Chat, Profile, MatchIntent, Consent e Video |
| `./gradlew test :app:assembleDebug :app:lintDebug --no-daemon` | Aprovado: `BUILD SUCCESSFUL`, incluindo o fluxo de telefone                                  |
| Scanner local de padrões de segredo no Android                 | Aprovado; nenhuma chave real encontrada                                                      |
| `git diff --check` e working tree                              | Aprovados; branch limpa e sincronizada                                                       |

O APK debug atualizado foi gerado em `android/app/build/outputs/apk/debug/app-debug.apk`. O build de release não foi repetido nesta última rodada porque a entrega solicitada é debug; a política já existente de HTTPS obrigatório para release e de `GOOGLE_SERVER_CLIENT_ID` configurado permanece preservada.

A tentativa de `npm run test:db` não executou nenhuma suíte porque este sandbox não possui `DATABASE_URL_OWNER` nem as demais URLs de banco configuradas. A falha é ambiental (`Missing required env var: DATABASE_URL_OWNER`), não uma falha de teste de domínio. A execução de migrations Up/Down/Up e os testes PostgreSQL devem ser repetidos no ambiente CI/local com PostgreSQL e credenciais de teste.

## Pendências externas e incompatibilidades conhecidas

A validação ponta a ponta do telefone ainda depende de um provedor SMS configurado e de um dispositivo/emulador que receba o código. A validação ponta a ponta do Google OAuth ainda depende de um Web client ID real, audience equivalente no backend e uma conta Google em emulador ou dispositivo. A coordenação de nonce server-side continua pendente; não foi implementado nonce apenas no cliente para evitar proteção ilusória.

O backend já expõe Age Assurance, MatchIntent, Consent e Video, mas a UX Android de MatchIntent, consentimento mútuo e sessão de vídeo ainda não foi implementada. Nenhum token RTC, decisão de consentimento ou autorização de vídeo é criado pelo Android.

A sessão curta ainda precisa de um contrato de renovação/revogação antes da release. Rate limiting por usuário no chat, persistência de conversas, observabilidade, moderação operacional e evidência de execução em CI continuam pendentes. `EncryptedSharedPreferences` e `MasterKey` emitem avisos de depreciação que devem ser revisados antes da release final.

## Próximo passo recomendado

Validar o fluxo telefônico em dispositivo com um provedor SMS real, executar OAuth Google em dispositivo e repetir as migrations/testes de banco no ambiente CI. Depois, desenhar a UX Android de MatchIntent e Consent sobre os contratos já presentes, mantendo revalidação server-side e JIT para qualquer recurso de vídeo.

## Invariantes preservados

Nenhuma chave OpenAI ou segredo foi incluído no Android ou no repositório. O `OPENAI_API_KEY` continua exclusivamente no backend. O branch utilizado foi somente `continuity`; não houve merge ou push na `main`, nem force-push. As decisões críticas permanecem fail-closed e dependentes do backend.
