# Plano E2E Android/release — VibeMatch

Atualizado em **2026-08-27** após auditoria da branch `continuity` e provisionamento local de tooling Android.

## Objetivo e regra de evidência

Esta matriz valida os contratos já implementados entre o Android, o backend cooperativo, Google Identity, Age Assurance, telefone, matchmaking, consentimento, LiveKit e Google Play Billing. Nenhum caso pode transformar um estado visual local em autorização. Toda aprovação precisa ser observada no retorno do backend ou no comportamento comprovável do dispositivo/provedor.

As evidências devem usar apenas aliases `A` e `B`, timestamps, versão/build, resultado HTTP sanitizado e estado público da UI. Não devem conter Google ID token, JWT de sessão, OTP, `verification_id`, URL privada, token LiveKit, purchase token, PII, chave de API, segredo de webhook ou dados de pagamento. A evidência deve registrar também o ambiente backend e o hash do artefato testado.

## Inventário do ambiente atual

| Recurso             | Estado nesta sessão                                                                   | Consequência                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Branch `continuity` | Base cooperativa `855deab90e669a6c65cf0ba489243c37464da4bd`; HEAD publicado `e01866c` | Código e tooling E2E estão publicados; execução funcional ainda depende de device/provider reais. |

| Android SDK 35/build tools | Disponível em `/home/ubuntu/android-sdk` | Builds locais são possíveis. |
| `adb` | Disponível em `/home/ubuntu/android-sdk/platform-tools/adb`, mas não exposto no PATH | O preflight consegue usar o caminho absoluto; não havia dispositivo autorizado. |
| Android Emulator/AVD | Emulator e imagem `google_apis_playstore;x86_64` provisionados; AVD criado | O boot headless falhou após 300 s e o processo encerrou; `/dev/kvm` não está disponível. |

| Harness E2E no repositório | Não foram encontrados Espresso, UIAutomator, Maestro, Appium, Detox ou `androidTest` | `tools/android-e2e-preflight.sh` e `tools/android-e2e-session.sh` cobrem preflight/lançamento sanitizado; a execução funcional ainda requer dispositivo real/Play internal track ou harness externo autorizado. |

| Google Web client ID real | Não disponível nesta sessão | Login Google e vínculo de certificado/package não podem ser provados. |
| Contas Google de teste A/B | Não disponíveis | MatchIntent, Consent, RTC de duas partes e Billing por conta não podem ser provados. |
| Didit/Age Assurance real | Sem API key/workflow/webhook real | Hosted Age Assurance só pode ser classificado como contrato/teste local até receber ambiente real. |
| Twilio/telefone real | Sem provedor e números de teste | SMS/OTP real não pode ser provado. |
| LiveKit real | Sem URL/credenciais server-side e dois dispositivos | Mídia, reconexão e revogação RTC não podem ser provadas. |
| Play Console/Play Billing | Sem produto, licença, track, conta tester e Play Billing Lab | Compra, restore, renovação e revogação no sandbox não podem ser executados. |
| Assinatura AAB | Sem upload key/keystore | O AAB local permanece unsigned; upload ao Play é bloqueado. |

O Android SDK sozinho não substitui um dispositivo com Google Play e conta tester. O AVD Google Play foi tentado em modo headless, mas não chegou a `sys.boot_completed=1` sem KVM; portanto não é evidência de device E2E. A documentação oficial recomenda license testers e Play Billing Lab para testar compras sem cobrança e cenários de pagamento [1].
Para o App Bundle, a publicação exige assinatura/upload key e configuração de Play App Signing [3] [4]. A navegação do Chat usa menu acessível para manter Perfil, Premium e Solicitações utilizáveis em telas estreitas, sem alterar os contratos server-side.

## Casos E2E

| ID        | Caso                            | Pré-requisitos                                                           | Passos principais                                                                  | Resultado esperado                                                                                    | Estado atual                                  |
| --------- | ------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| REL-001   | Instalação do release candidate | AAB assinado, track internal, dispositivo Android com Play               | Instalar pela track; abrir; conferir versão e backend configurado                  | App abre sem cleartext; BuildConfig aponta somente API HTTPS e LiveKit WSS                            | **BLOCKED — assinatura/Play/device**          |
| AUTH-001  | Google login conta A            | Web client ID real, SHA-1/SHA-256 registrado, conta A                    | Abrir login Google; selecionar A; concluir Credential Manager                      | Backend valida ID token; Android recebe apenas sessão server-side; sem token Google persistido        | **BLOCKED — credenciais/device**              |
| AUTH-002  | Logout e troca para conta B     | Contas A/B no mesmo ou em dois dispositivos                              | Logout; limpar estado Credential Manager; login B                                  | Sessão A é revogada/limpa pelo contrato de refresh; nenhuma tela ou callback A altera sessão B        | **BLOCKED — credenciais/device/backend real** |
| AGE-001   | Início hosted                   | Age provider real configurado                                            | Com perfil autenticado, tocar iniciar; abrir URL HTTPS                             | Backend retorna `PENDING`; navegador abre somente URL HTTPS; nenhum `APPROVED` local                  | **BLOCKED — provider/device**                 |
| AGE-002   | Retorno e aprovação             | Sessão hosted real e webhook/reconciler ativo                            | Concluir verificação no provider; voltar ao app; observar ActivityResult/ON_RESUME | Android chama refresh; somente retorno backend `APPROVED` muda gate para READY                        | **BLOCKED — provider/device**                 |
| AGE-003   | Rejeição/indisponibilidade      | Provider capaz de produzir decisão/rejeição e erro                       | Repetir com decisão rejeitada e indisponibilidade                                  | `REJECTED`/`UNKNOWN`/erro permanecem bloqueados; sem retry que aprove localmente                      | **BLOCKED — provider/device**                 |
| TEL-001   | Telefone conta A                | Número E.164 de teste e SMS provider                                     | Iniciar telefone; receber OTP; confirmar                                           | Somente `{ok:true, phone_verified:true}` do backend libera; OTP não aparece em logs                   | **BLOCKED — SMS/device**                      |
| MATCH-001 | MatchIntent A→B                 | A/B com perfil, age approved e telefone verified                         | Criar/entregar intenção; B abrir solicitações; aceitar                             | Backend controla sender/receiver/status; aceitar não abre vídeo automaticamente                       | **BLOCKED — contas/backend real**             |
| CONS-001  | Consentimento mútuo             | MatchIntent aceita por A/B                                               | Criar consent; A e B decidem; observar ambos                                       | `ACCEPTED_BOTH` só quando o backend confirmar ambas decisões; `request_id` novo por ação              | **BLOCKED — contas/device**                   |
| RTC-001   | Video Session e JIT             | Consent `ACCEPTED_BOTH`, LiveKit server configurado                      | Criar sessão; pedir JIT; tocar entrar; permitir câmera/mic                         | Sem token ou mídia antes da ação/permissões; room/identity/grants continuam server-side               | **BLOCKED — LiveKit/device**                  |
| RTC-002   | Duas partes e lifecycle         | Dois dispositivos/contas A/B                                             | Conectar ambos; alternar câmera/mic; background/return; encerrar                   | Mídia explícita; renderer cleanup; `ON_STOP` desconecta; retorno exige nova autorização               | **BLOCKED — dois devices/LiveKit**            |
| MOD-001   | Block durante RTC               | RTC A↔B ativo e moderação backend                                        | A abre Block; confirmar; observar ambos                                            | Backend confirma; A encerra RTC imediatamente; sessão/relations revogadas server-side                 | **BLOCKED — dois devices/backend real**       |
| MOD-002   | Revogação externa durante RTC   | Admin/reconciler ou evento backend autorizado                            | Revogar sessão/token enquanto A/B estão conectados                                 | Room termina; Android não reconecta com token antigo; UI pede nova autorização                        | **BLOCKED — backend/LiveKit/device**          |
| BILL-001  | Compra aprovada                 | AAB assinado na Play, produto SUBS, license tester                       | A abrir Premium; comprar com instrumento aprovado                                  | Android envia somente purchase token por HTTPS; UI só libera após `data.entitled=true`; ack depois    | **BLOCKED — Play/device/backend real**        |
| BILL-002  | Restore sem compra local        | Conta com entitlement server-side e Play sem compra local no dispositivo | Abrir Premium; tocar restore                                                       | Android consulta GET entitlement; nunca concede por ausência de compra local nem por callback isolado | **BLOCKED — Play/device/backend real**        |
| BILL-003  | Pendente/cancelada              | License tester e instrumentos lentos                                     | Fazer compra pendente; reiniciar; aguardar aprovação/cancelamento                  | Pendente não libera; aprovação exige validação server-side; cancelamento/revogação remove acesso      | **BLOCKED — Play/device/backend real**        |
| BILL-004  | Revogação/renovação             | Play Billing Lab/Console e RTDN backend                                  | Acelerar renovação, grace/account hold ou revogar; abrir/refresh Premium           | Entitlement refletido pelo backend; Android fail-closed sem depender apenas de cache local            | **BLOCKED — Play/backend real**               |

Para Google Sign-In, o Android deve enviar o ID token ao servidor para validação; a documentação oficial recomenda nonce forte quando utilizado e limpeza do estado de credencial no logout [2]. O backend continua responsável por validar autenticidade, audience, nonce quando aplicável, sessão e identidade.

O caso `AUTH-002` usa o contrato confirmado `POST /auth/logout/refresh` com `{ "refresh_token": "..." }`, sem `Authorization`, resposta indistinguível `200 {"ok":true}` e `503 REVOCATION_UNAVAILABLE` em falha de infraestrutura. A validação continua `BLOCKED` somente por faltar device/contas/ambiente real nesta sessão; o cliente não deve registrar o token nem promover testes locais a E2E.

## Procedimento de execução quando os pré-requisitos existirem

Primeiro gerar um AAB assinado com upload key fora do repositório, conferir o SHA do artefato e publicar em internal testing. O package name precisa coincidir com o app Play configurado e cada conta deve estar autorizada como license tester [1]. Instalar em dois dispositivos com Play atualizado, registrar apenas aliases A/B e executar os casos na ordem `AUTH → AGE → TEL → MATCH → CONSENT → RTC → MOD`.

Depois executar Billing em uma instalação Play do mesmo package/version code, usando o produto SUBS real e license tester. Anotar apenas o estado público e timestamps; conferir no backend, por canal administrativo seguro, se a compra foi vinculada, acknowledged e refletida em entitlement. Revogação, renovação, grace period e account hold devem ser observados no backend e no Android, sem registrar tokens.

Cada caso deve ter um resultado `PASS`, `FAIL`, `BLOCKED` ou `NOT APPLICABLE`, com motivo objetivo. `BLOCKED` não é evidência de falha do cliente; significa que o pré-requisito real não foi disponibilizado. Nenhum resultado deve ser promovido a `PASS` com base apenas em build, teste unitário ou mock.

## Próximas entradas necessárias

Para continuar a execução real, é necessário disponibilizar um dispositivo Android físico ou emulador com Google Play conectado ao ambiente de execução, um AAB assinado/publicável, Web client ID e contas Google de teste, ambiente backend HTTPS com Didit/Twilio/LiveKit/Billing configurados, produto Play SUBS em internal testing e canal administrativo sanitizado para confirmar entitlement/RTDN. Credenciais devem ser fornecidas por canal seguro e nunca commitar ou inserir em `BuildConfig`, APK, logs ou este plano.

## Referências

[1]: https://developer.android.com/google/play/billing/test 'Test your Google Play Billing Library integration'
[2]: https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation 'Implement Sign in with Google with Credential Manager'
[3]: https://developer.android.com/studio/publish/app-signing 'Sign your app for Google Play'
[4]: https://developer.android.com/studio/publish/upload-bundle 'Upload your app bundle to Google Play'
