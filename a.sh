set -e

#!/usr/bin/env bash

## mainnet
# pprof is available at:
# http://127.0.0.1:3333/debug/pprof/goroutine?debug=1
(./client/cmd/bisonw/bisonw --webaddr=127.0.0.1:3333 --log=trace --httpprof)

## mainnet with dedicated DB:
#(./client/cmd/bisonw/bisonw --db=/Users/norwnd/d-e-x-c-db/db_mainnet --webaddr=127.0.0.1:3333 --log=trace)
## testnet
#(./client/cmd/bisonw/bisonw --db=/Users/norwnd/d-e-x-c-db/db_mainnet --webaddr=127.0.0.1:3333 --log=trace --testnet)

## mainnet with disaster backups:
#(./client/cmd/bisonw/bisonw --webaddr=127.0.0.1:3333 --log=trace --skynetapikey=I8JMMBPUNMEHGCV056IG1V8OEEIB0CJUTG97S0J3IQNJJ4CSGH0G --skynetapiurl='https://web3portal.com' --testnet)
