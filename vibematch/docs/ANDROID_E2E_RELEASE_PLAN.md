# Plano E2E Android/release — VibeMatch

Atualizado em **2026-08-28** após auditoria da branch `continuity`, revisão de ADB/device farm e nova tentativa de boot do AVD Google Play.

## Objetivo e regra de evidência

Esta matriz valida os contratos já implementados entre o Android, o backend cooperativo, Google Identity, Age Assurance, telefone, matchmaking, consentimento, LiveKit e Google Play Billing. Nenhum caso pode transformar um estado visual local em autorização. Toda aprovação precisa ser observada no retorno do backend ou no comportamento comprovável do dispositivo/provedor.

As evidências devem usar apenas aliases `A` e `B`, timestamps, versão/build, resultado HTTP sanitizado e estado público da UI. Não devem conter Google ID token, JWT de sessão, OTP, `verification_id`, URL privada, token LiveKit, purchase token, PII, chave de API, segredo de webhook ou dados de pagamento. A evidência deve registrar também o ambiente backend e o hash do artefato testado.

## Inventário do ambiente atual

| Recurso             | Estado nesta sessão                                                    | Consequência                                                                                      |
| ------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Branch `continuity` | HEAD publicado `7f752cd` (`docs: record critical path permission fix`) | Código e tooling E2E estão publicados; execução funcional ainda depende de device/provider reais. |

| Android SDK 35/build tools | Disponível em `/home/ubuntu/android-sdk` | Builds locais são possíveis. |
| `adb` | Disponível em `/home/ubuntu/android-sdk/platform-tools/adb`, mas não exposto no PATH desta sessão | Usar `ADB_BIN=/home/ubuntu/android-sdk/platform-tools/adb`; nesta sessão não havia dispositivo autorizado. |
| Android Emulator/AVD | Emulator e imagem `google_apis_playstore;x86_64` provisionados; AVD criado | O boot headless falhou após 300 s e o processo encerrou; `/dev/kvm` não está disponível. |

| Harness E2E no repositório | Há `androidTest` para armazenamento seguro; não há harness funcional completo Espresso/UIAutomator/Maestro/Appium/Detox | `tools/android-e2e-preflight.sh`, `tools/android-e2e-session.sh` e `tools/android-e2e-auth-refresh.sh` cobrem preflight/lançamento sanitizado e teste instrumentado de storage; a execução funcional ainda requer dispositivo real/Play internal track ou harness externo autorizado. |

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

## Comandos ADB e intents para execução controlada

Os comandos abaixo devem ser executados somente depois de configurar o SDK e confirmar um dispositivo autorizado. O `adb` é um canal de transporte e diagnóstico; ele não deve ser usado para inserir JWT, refresh token, OTP, purchase token, token LiveKit, identidade, aprovação de idade, telefone, consentimento ou entitlement. Login Google, Billing, Age Assurance e decisões backend continuam sendo ações reais no app/provedor.

```bash
export ANDROID_SDK_ROOT=/home/ubuntu/android-sdk
export ANDROID_HOME=/home/ubuntu/android-sdk
export PATH="$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$PATH"
export ADB_BIN="$ANDROID_SDK_ROOT/platform-tools/adb"

"$ADB_BIN" start-server
"$ADB_BIN" devices -l                 # deve exibir exatamente um serial com estado device
export DEVICE_SERIAL="<serial-do-dispositivo>"
ADB=("$ADB_BIN" -s "$DEVICE_SERIAL")

"${ADB[@]}" install -r android/app/build/outputs/apk/debug/app-debug.apk
"${ADB[@]}" shell pm clear com.vibematch.app       # somente antes de um caso que exija estado limpo
"${ADB[@]}" shell am force-stop com.vibematch.app
"${ADB[@]}" shell monkey -p com.vibematch.app 1
"${ADB[@]}" shell dumpsys package com.vibematch.app | grep -E 'versionName|versionCode'
"${ADB[@]}" logcat -c
"${ADB[@]}" logcat -v threadtime > /tmp/vibematch-logcat-sanitized.txt
```

Para testar os intents que são públicos e não concedem autorização, use apenas os exemplos abaixo. O intent de navegador serve para abrir uma URL HTTPS já emitida pelo backend durante Age Assurance; nunca substitua a URL real por uma decisão local. O intent de configurações serve para permitir a intervenção manual em permissões.

```bash
# Abrir a Activity principal sem criar uma segunda instância.
"${ADB[@]}" shell am start -W -a android.intent.action.MAIN \\
  -c android.intent.category.LAUNCHER -n com.vibematch.app/.MainActivity

# Abrir uma verification_url HTTPS recebida do backend; substituir somente em shell local.
"${ADB[@]}" shell am start -W -a android.intent.action.VIEW \\
  -d 'https://<verification-host>/<path>'

# Abrir configurações do app para concessão manual de câmera/microfone pelo tester.
"${ADB[@]}" shell am start -W -a android.intent.action.APPLICATION_DETAILS_SETTINGS \\
  -d 'package:com.vibematch.app'

# Em um dispositivo exclusivamente de teste, depois da ação explícita do tester,
# verificar o estado; não usar para fabricar aprovação de backend.
"${ADB[@]}" shell dumpsys package com.vibematch.app | grep -E 'CAMERA|RECORD_AUDIO'
"${ADB[@]}" shell input keyevent KEYCODE_APP_SWITCH
"${ADB[@]}" shell am force-stop com.vibematch.app
```

Não existe um intent ADB legítimo que simule Google Credential Manager, consentimento mútuo, compra Play, Block server-side ou emissão JIT LiveKit. Esses casos precisam da UI real, das contas/provedores reais e da resposta do backend. Não usar `pm grant` como substituto da ação de permissão em um caso de release; a permissão pode ser concedida manualmente no dispositivo de teste e o resultado deve ser observado no app.

### Device farm remota com ADB interativo

Para uma sessão interativa, escolher um fornecedor que declare explicitamente suporte a ADB remoto e que forneça um serial/endpoint temporário. O procedimento seguro é: criar o projeto/tenant; habilitar cobrança ou quota; selecionar uma imagem Android com Google Play quando o caso exigir Google Sign-In ou Billing; iniciar a instância; habilitar ADB na interface do fornecedor; obter o comando de conexão temporário; executar `adb connect` ou o comando oficial do fornecedor; confirmar `adb devices -l`; instalar o APK; executar os runners sanitizados; coletar somente logs públicos; e destruir a instância ao final. Nunca colocar API token do fornecedor no repositório, no APK ou em logs.

Para **Genymotion SaaS**, a documentação oficial descreve o fluxo `gmsaas auth token`, `gmsaas config set android-sdk-path`, `gmsaas doctor`, `gmsaas instances list` e `gmsaas instances adbconnect <instance_uuid>`, seguido de `adb devices`. O token deve ser inserido por prompt seguro ou variável temporária, nunca neste arquivo [5].

```bash
python3 -m venv /tmp/gmsaas-venv
. /tmp/gmsaas-venv/bin/activate
pip install gmsaas
gmsaas auth token                 # colar o token somente no prompt local
gmsaas config set android-sdk-path /home/ubuntu/android-sdk
gmsaas doctor
gmsaas instances list
gmsaas instances adbconnect <instance_uuid>
/home/ubuntu/android-sdk/platform-tools/adb devices -l
```

Para **Firebase Test Lab**, o caminho oficial é apropriado para instrumentação automatizada, não para uma sessão ADB interativa persistente: autenticar o `gcloud`, selecionar o projeto, listar modelos/versões e executar o APK junto com o APK de testes usando `gcloud firebase test android run --type instrumentation --app ... --test ... --device ...`. O Test Lab deve ser tratado como uma execução de matriz; ele não substitui o acesso ADB interativo necessário para operar manualmente Google Sign-In, duas contas e RTC [6].

```bash
gcloud auth login
gcloud config set project <PROJECT_ID>
gcloud firebase test android models list
gcloud firebase test android versions list
gcloud firebase test android run \\
  --type instrumentation \\
  --app android/app/build/outputs/apk/debug/app-debug.apk \\
  --test android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk \\
  --device model=<MODEL_ID>,version=<OS_VERSION_ID>,locale=en,orientation=portrait \\
  --use-orchestrator \\
  --client-details matrixLabel=vibematch-e2e
```

Em fornecedores que apresentem um painel “ADB commands” ou um endpoint temporário, não inventar host, porta ou flags: copiar apenas o comando emitido pela própria sessão, executar `adb devices -l`, fixar `DEVICE_SERIAL` e passar `ADB_BIN`/`DEVICE_SERIAL` aos scripts do repositório. O BrowserStack documenta comandos ADB para sessões App Live/App Automate, mas o modo e o endpoint dependem do produto e da sessão contratada [7].

### Emulador local Google Play nesta máquina

A máquina já possui SDK, Emulator, imagem `system-images;android-35;google_apis_playstore;x86_64` e os AVDs `vibematch-api35-play` e `vibematch-api35-play-lite`. O procedimento de configuração é:

```bash
export ANDROID_SDK_ROOT=/home/ubuntu/android-sdk
export ANDROID_HOME=/home/ubuntu/android-sdk
export PATH="$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$PATH"

sdkmanager --licenses
sdkmanager 'platform-tools' 'emulator' 'platforms;android-35' \\
  'build-tools;35.0.0' \\
  'system-images;android-35;google_apis_playstore;x86_64'
avdmanager list avd
avdmanager create avd -n vibematch-api35-play-clean \\
  -k 'system-images;android-35;google_apis_playstore;x86_64' \\
  -d pixel_2 --force
emulator -avd vibematch-api35-play-clean -no-snapshot -wipe-data
```

Após o boot, validar `adb devices -l`, `adb shell getprop ro.build.version.sdk`, `adb shell getprop sys.boot_completed`, `adb shell pm path com.google.android.gms` e `adb shell pm path com.android.vending`. Nesta máquina, `/dev/kvm` está ausente. A última tentativa com o AVD Google Play leve, `-no-accel`, GPU SwiftShader, 1.5 GB de RAM, dois cores e `-wipe-data` alcançou estado ADB `device`, mas não atingiu `sys.boot_completed=1` após 180 segundos. Isso mantém o resultado como **BLOCKED**: ADB aparecer como `device` não prova que Android, Play Services ou Play Store terminaram o boot.

Se uma máquina controlada pelo usuário possuir virtualização habilitada, o desbloqueio recomendado é habilitar Intel VT-x/AMD-V no firmware, expor `/dev/kvm` ao processo e confirmar `ls -l /dev/kvm` antes de iniciar o AVD. Sem KVM, aumentar timeout ou trocar intents não corrige a limitação estrutural; usar um dispositivo físico ou device farm com Google Play é a alternativa correta.

## Próximas entradas necessárias

Para continuar a execução real, é necessário disponibilizar um dispositivo Android físico ou emulador com Google Play conectado ao ambiente de execução, um AAB assinado/publicável, Web client ID e contas Google de teste, ambiente backend HTTPS com Didit/Twilio/LiveKit/Billing configurados, produto Play SUBS em internal testing e canal administrativo sanitizado para confirmar entitlement/RTDN. Credenciais devem ser fornecidas por canal seguro e nunca commitar ou inserir em `BuildConfig`, APK, logs ou este plano.

## Referências

[1]: https://developer.android.com/google/play/billing/test 'Test your Google Play Billing Library integration'
[2]: https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation 'Implement Sign in with Google with Credential Manager'
[3]: https://developer.android.com/studio/publish/app-signing 'Sign your app for Google Play'
[4]: https://developer.android.com/studio/publish/upload-bundle 'Upload your app bundle to Google Play'
[5]: https://www.genymotion.com/blog/tutorial/connect-saas-device-adb/ 'How to connect a virtual device to ADB in Genymotion SaaS'
[6]: https://firebase.google.com/docs/test-lab/android/command-line 'Start testing with the gcloud CLI'
[7]: https://www.browserstack.com/docs/app-live/adb-commands 'Test using adb commands with BrowserStack'
