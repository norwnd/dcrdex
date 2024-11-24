set -e

#!/usr/bin/env bash

#(cd server/cmd/dcrdex/ && CGO_ENABLED=0 GO111MODULE=on go build -tags lgpl -race)
(cd server/cmd/dcrdex/ && CGO_ENABLED=0 GO111MODULE=on go build -tags lgpl)
