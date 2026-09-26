#!/bin/sh
# Local validator with Meteora DBC / DAMM v2 / Metaplex programs + DAMM v2 fee configs + program authority PDAs cloned from devnet.
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
OUT="${E2E_OUT_DIR:-/workspace/equicurve-e2e}"; mkdir -p "$OUT"
exec solana-test-validator --reset --quiet --ledger "$OUT/ledger" --url https://api.devnet.solana.com \
 --clone-upgradeable-program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN \
 --clone-upgradeable-program cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG \
 --clone-upgradeable-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s \
 --clone 7F6dnUcRuyM2TwR8myT1dYypFXpPSxqwKNSFNkxyNESd --clone 2nHK1kju6XjphBLbNxpM5XRGFj7p9U8vvNzyZiha1z6k \
 --clone Hv8Lmzmnju6m7kcokVKvwqz7QPmdX9XfKjJsXz8RXcjp --clone 2c4cYd4reUYVRAB9kUUkrq55VPyy2FNQ3FDL4o12JXmq \
 --clone AkmQWebAwFvWk55wBoCr5D62C6VVDTzi84NJuD9H7cFD --clone DbCRBj8McvPYHJG1ukj8RE15h2dCNUdTAESG49XpQ44u \
 --clone A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck \
 --clone FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM --clone HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC \
 --rpc-port 8899 --faucet-port 9900
