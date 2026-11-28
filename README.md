# Emulator Console

A local console for AWS Emulator: inspect its resources and, through an optional Gateway, record the calls your code makes. "Emulator Console" is a working name. This project is not affiliated with AWS.

The Console is one Node process (TypeScript; React and Vite for the UI) that serves the UI and its API. It listens on loopback only, refuses requests with a foreign `Host` or `Origin`, and never sends the Emulator's credentials to the browser.

## Run it

With Docker (Docker 28 or later; starts the Emulator and the Console):

```sh
docker compose up --build
```

- Console: http://127.0.0.1:9298
- Emulator: https://127.0.0.1:9297
- Gateway port 9300 is reserved; nothing listens on it yet.

The Console mounts `.aws/emulator` read-only to read `<port>/ca.pem` and `<port>/emulator_credentials`. It does not mount the Docker socket. Change ports with `PORT` (the Emulator's port, which the Console's process reads as `EMULATOR_PORT`), `CONSOLE_PORT` and `GATEWAY_PORT`. Both containers run as `HOST_UID:HOST_GID` (default 1000:1000), because the Emulator publishes its files readable only by its own user. If your user is not 1000, run `HOST_UID=$(id -u) HOST_GID=$(id -g) docker compose up --build`.

Without Docker, against an Emulator already running on this machine (Node 22 or later):

```sh
npm install
npm run build
npm start
```

`npm start` reads the Emulator's files from `~/.aws/emulator` by default, while compose writes them to `./.aws/emulator` in this folder. To use the compose Emulator, run `EMULATOR_HOME=$PWD/.aws/emulator npm start`. `EMULATOR_PORT` and `CONSOLE_PORT` override the other defaults.

For UI work, run `npm run dev` (API) and `npm run dev:web` (Vite, on 127.0.0.1) together.

`npm install` prints a harmless `allow-scripts` warning about the install scripts of esbuild (and fsevents on macOS). The Console does not need them.

## Service Model index

`data/model-index/` is generated from the two reference clones and committed (about 4.4 MB: `index.json` plus one brotli file per service holding its operations and Smithy shape graph, without documentation text). The Console reads it from there; `MODEL_INDEX_DIR` overrides the folder. It describes Emulator 1.0.509, which `index.json` records.

To regenerate it, point the script at the clones (it only reads them, and refuses an output folder inside either):

```sh
API_MODELS_DIR=/path/to/api-models-aws AWS_EMULATOR_DIR=/path/to/aws-emulator npm run model-index
```

Both default to `./api-models-aws` and `./aws-emulator`. The Emulator release is read from the tag at the clone's checked-out commit (or pass `--emulator-version`). Routes: `GET /api/services` (all services with counts and labels), `GET /api/service?sdkId=DynamoDB` (one service's operations; `slug=dynamodb` also works) and `GET /api/service/shapes?sdkId=DynamoDB[&operation=PutItem]` (its Smithy shape graph, or the shapes one operation reaches). They carry an ETag. In code, use `modelIndex(config.modelIndexDir)` from `src/server/model-index`.

## Test it

```sh
npm run lint
npm run typecheck   # UI, server, and the tests
npm test            # unit tests; needs openssl on PATH
npm run e2e         # builds and starts the console-e2e stack, runs e2e/, tears it down
```

The shared e2e stack uses compose project `console-e2e`: Emulator on 19297, Console on 19298, Gateway port 19300 reserved. `npm run e2e:up` and `npm run e2e:down` start and stop it by hand.

The script takes and releases the lock itself, so do not create the lock directory by hand. `up` waits up to 30 minutes for the lock (and names its owner if it gives up); `down`, or the end of `npm run e2e`, releases it. `down` does nothing for a stack another checkout started. Humans can leave `E2E_LOCK_DIR` unset (it defaults to `$TMPDIR/console-e2e.lock`).

**Agents:** run `E2E_LOCK_DIR=<scratchpad>/e2e.lock npm run e2e`. The script takes the lock; don't mkdir it yourself.

CI runs lint, typecheck, unit tests, the build and the e2e test on every pull request.
