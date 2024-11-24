set -e

#!/usr/bin/env bash

pushd client/webserver/site
npm clean-install
npm run build
popd

#(cd client/cmd/bisonw/ && CGO_ENABLED=1 GO111MODULE=on GOOS=linux GOARCH=amd64 go build -tags lgpl)
(cd client/cmd/bisonw/ && CGO_ENABLED=1 GO111MODULE=on go build -tags lgpl)
#
# Note, this is -race build, to be used for testing only!
#(cd client/cmd/bisonw/ && CGO_ENABLED=1 GO111MODULE=on go build -race -tags lgpl)
# TODO, previously was CGO_ENABLED=0 ?

# Run Bison binary with:
# - (./client/cmd/bisonw/bisonw --db=/home/t/dcrdex-old-decrediton/db --webaddr=127.0.0.1:5758 --log=trace)
# - (./client/cmd/bisonw/bisonw --db=/home/t/dcrdex-anon/db --webaddr=127.0.0.1:5758 --log=trace)
