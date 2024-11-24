set -e

#!/usr/bin/env bash

# mainnet
(./client/cmd/bisonw/bisonw --webaddr=127.0.0.1:3333 --log=trace)
# mainnet with dedicated DB:
#(./client/cmd/bisonw/bisonw --db=/Users/norwnd/d-e-x-c-db/db_mainnet --webaddr=127.0.0.1:3333 --log=trace)
# testnet
#(./client/cmd/bisonw/bisonw --db=/Users/norwnd/d-e-x-c-db/db_mainnet --webaddr=127.0.0.1:3333 --log=trace --testnet)

# with disaster backups:
#(./client/cmd/bisonw/bisonw --webaddr=127.0.0.1:3333 --log=trace --skynetapikey=I8JMMBPUNMEHGCV056IG1V8OEEIB0CJUTG97S0J3IQNJJ4CSGH0G --skynetapiurl='https://web3portal.com' --testnet)
