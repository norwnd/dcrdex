set -e

#!/usr/bin/env bash

pushd client/webserver/site
npm clean-install
npm run build
popd

(cd client/cmd/bisonw/ && CGO_ENABLED=1 GO111MODULE=on go build -tags lgpl && codesign -s - -f ./bisonw)
#
# to specify OS and Architecture
#(cd client/cmd/bisonw/ && CGO_ENABLED=1 GO111MODULE=on GOOS=darwin GOARCH=arm64 go build -tags lgpl && codesign -s - -f ./bisonw)
#
# -race build
#(cd client/cmd/bisonw/ && CGO_ENABLED=1 GO111MODULE=on go build -race -tags lgpl && codesign -s - -f ./bisonw)
