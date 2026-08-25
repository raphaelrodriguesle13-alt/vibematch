# Manus Handoff

## HEAD analisado

`a8237f093df4073329add16ec79d5eb4fe7fb807` — `continuity` sincronizada com `origin/continuity` antes do lote.
HEAD final do lote: `46f376af61256ecfad91bdbccc7f6834337221e7`.
Após o lote, o branch foi reconciliado com os commits remotos de Auth/phone verification em
`f177047`, sem sobrescrever o trabalho Android.

## Commits produzidos

| Commit                                     | Descrição                                                           |
| ------------------------------------------ | ------------------------------------------------------------------- |
| `be1d2572885af7d61cd1c53ac46a8c5924995a6c` | `fix: isolate Android dev auth and add CI gates`                    |
| `393d5c1`                                  | `docs: add Android batch handoff`                                   |
| `f177047`                                  | merge de Auth/phone verification remoto, preservando o lote Android |
| `bb04da0`                                  | `feat: connect Android Google sign-in session`                      |
| `46f376a`                                  | `fix: return Android chat to auth on session expiry`                |

Os commits foram criados sem reescrever histórico e o branch foi reconciliado sem force-push.
O handoff atualizado será publicado no branch `continuity` após este commit documental.

## Testes executados

| Comando          | Resultado                                       |
| ---------------- | ----------------------------------------------- |
| `./gradlew test` | Aprovado; suíte Android incluindo AuthViewModel |

| `./gradlew :app:assembleDebug` | Aprovado; APK debug gerado sem UI JWT manual |

| `./gradlew :app:lintDebug` | Aprovado; 0 erros; apenas avisos de depreciação do AndroidX Crypto |
| `./gradlew :app:assembleRelease -PAPI_BASE_URL=https://api.vibematch.example -PGOOGLE_SERVER_CLIENT_ID=web-client-id.apps.googleusercontent.com` | Aprovado |

| `./gradlew :app:assembleRelease -PAPI_BASE_URL=http://inseguro.local` | Falhou intencionalmente com `Release API_BASE_URL must use HTTPS` |
| `npm run typecheck` | Aprovado |
| `npm run lint` | Aprovado |
| `npm run format:check` | Aprovado |
| `npm run test:unit` | Aprovado após o merge; 5 suítes e 28 testes |

| Scanner local de padrões de segredo | Aprovado; nenhum segredo real encontrado |

## Mudanças realizadas

O campo provisório de JWT foi removido da Activity. O cliente usa Credential Manager para obter o Google ID token, troca-o em `/auth/google` por uma sessão curta do backend e guarda somente o JWT de sessão em `EncryptedSharedPreferences`.

O tráfego HTTP claro foi movido para `android/app/src/debug/AndroidManifest.xml`. O manifest de release força `android:usesCleartextTraffic="false"`, e o Gradle rejeita uma `API_BASE_URL` que não comece com `https://` em builds release.

O workflow `.github/workflows/ci.yml` ganhou um job Android independente que instala Java 17, configura o Android SDK, executa `./gradlew test` e executa `./gradlew :app:assembleDebug`. O CI backend e as fronteiras de Auth, banco, JWT e Fastify não foram reescritos.

A documentação Android e o contrato ChatGPT foram sincronizados com a separação debug/release e com os comandos de validação.

## Pendências para ChatGPT

- Confirmar em CI a execução do novo job Android no primeiro push.
- Coordenar nonce server-side no `/auth/google` se o backend quiser exigir proteção adicional contra replay.
- Adicionar rate limiting por usuário ao endpoint `/api/chat` antes de habilitá-lo em produção.
- Definir o contrato de renovação/revogação de sessão antes do vencimento do JWT curto.

## Riscos encontrados

O login Google Android está implementado, mas a validação ponta a ponta ainda requer um Web client ID OAuth real, configuração equivalente no audience do backend e uma conta Google em emulador/dispositivo. Nenhuma credencial foi colocada no repositório.

O lint Android termina sem erros, mas reporta avisos de depreciação das APIs `EncryptedSharedPreferences`/`MasterKey`. O APK anexado é debug e não é um artefato de release assinado.

O job Android do CI usa `android-actions/setup-android@v3` e instala `platforms;android-35` e `build-tools;35.0.0`; a execução efetiva do runner GitHub ainda precisa ser observada no primeiro push. O branch recebeu commits remotos adicionais de phone verification durante o lote; os gates backend foram repetidos e permaneceram verdes.

## Próximo trabalho recomendado para Manus

Conectar o onboarding de telefone à Activity, executar a troca OAuth em emulador com client ID configurado, definir nonce server-side e revisar a migração futura das APIs `EncryptedSharedPreferences`/`MasterKey` antes da release final.
