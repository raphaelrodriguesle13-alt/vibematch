# Manus Handoff

## HEAD analisado

`a8237f093df4073329add16ec79d5eb4fe7fb807` — `continuity` sincronizada com `origin/continuity` antes do lote.
Após o lote, o branch foi reconciliado com os commits remotos de Auth/phone verification em
`f177047`, sem sobrescrever o trabalho Android.

## Commits produzidos

| Commit                                     | Descrição                                                           |
| ------------------------------------------ | ------------------------------------------------------------------- |
| `be1d2572885af7d61cd1c53ac46a8c5924995a6c` | `fix: isolate Android dev auth and add CI gates`                    |
| `393d5c1`                                  | `docs: add Android batch handoff`                                   |
| `f177047`                                  | merge de Auth/phone verification remoto, preservando o lote Android |

Os commits foram criados sem reescrever histórico e o branch foi reconciliado sem force-push.
O handoff atualizado será publicado no branch `continuity`.

## Testes executados

| Comando                                                                       | Resultado                                                         |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `./gradlew test`                                                              | Aprovado; build Gradle concluído com sucesso                      |
| `./gradlew :app:assembleDebug`                                                | Aprovado; APK debug gerado                                        |
| `./gradlew :app:lintDebug`                                                    | Aprovado; 0 erros e 8 avisos não bloqueantes                      |
| `./gradlew :app:assembleRelease -PAPI_BASE_URL=https://api.vibematch.example` | Aprovado                                                          |
| `./gradlew :app:assembleRelease -PAPI_BASE_URL=http://inseguro.local`         | Falhou intencionalmente com `Release API_BASE_URL must use HTTPS` |
| `npm run typecheck`                                                           | Aprovado                                                          |
| `npm run lint`                                                                | Aprovado                                                          |
| `npm run format:check`                                                        | Aprovado                                                          |
| `npm run test:unit`                                                           | Aprovado após o merge; 5 suítes e 28 testes                       |

| Scanner local de padrões de segredo | Aprovado; nenhum segredo real encontrado |

## Mudanças realizadas

O campo provisório de JWT foi isolado no build debug por `BuildConfig.DEV_TOKEN_INPUT_ENABLED`. O release não compila essa interface, não permite a mesma rota de desenvolvimento e mostra apenas o estado de autenticação pendente para o futuro login Google.

O tráfego HTTP claro foi movido para `android/app/src/debug/AndroidManifest.xml`. O manifest de release força `android:usesCleartextTraffic="false"`, e o Gradle rejeita uma `API_BASE_URL` que não comece com `https://` em builds release.

O workflow `.github/workflows/ci.yml` ganhou um job Android independente que instala Java 17, configura o Android SDK, executa `./gradlew test` e executa `./gradlew :app:assembleDebug`. O CI backend e as fronteiras de Auth, banco, JWT e Fastify não foram reescritos.

A documentação Android e o contrato ChatGPT foram sincronizados com a separação debug/release e com os comandos de validação.

## Pendências para ChatGPT

- Conectar o login Google/OIDC existente à Activity Android.
- Definir o contrato oficial de armazenamento seguro e renovação/revogação da sessão no cliente.
- Revisar os release gates de Auth/Profile antes de remover o modo provisório debug.
- Adicionar rate limiting por usuário ao endpoint `/api/chat` antes de habilitá-lo em produção.

## Riscos encontrados

O Android ainda não possui login Google integrado; por isso, o chat debug continua dependente de um JWT de sessão informado manualmente. Esse fluxo é explicitamente desabilitado em release, mas não representa autenticação de produto.

O lint Android reporta 8 avisos não bloqueantes relacionados ao empacotamento de bibliotecas nativas e à configuração mínima do protótipo. O APK foi produzido como debug e não é um artefato de release assinado.

O job Android do CI usa `android-actions/setup-android@v3` e instala `platforms;android-35` e `build-tools;35.0.0`; a execução efetiva do runner GitHub ainda precisa ser observada no primeiro push. O branch recebeu commits remotos adicionais de phone verification durante o lote; os gates backend foram repetidos e permaneceram verdes.

## Próximo trabalho recomendado para Manus

Após a conclusão do fluxo oficial de Auth pelo ChatGPT, substituir `DevSessionStore` por um repositório de sessão seguro e conectar a tela de login Google. Em seguida, adicionar logout, tratamento de sessão expirada e testes de navegação antes de persistir conversas ou ampliar a UI social.
