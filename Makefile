build:
	./build.sh

a:
	./a.sh

l:
	./l.sh

server_build:
	./build_server.sh

server_run:
	./run_server.sh

build_linux:
	./build_linux.sh

test:
	./run_tests.sh

format:
	gofmt -w -s $$(find . -type f -name '*.go' -not -path "./pkg/proto/*" -not -name "*.gen.go" -not -path "*/mock/*")
	goimports -w $$(find . -type f -name '*.go' -not -path "./pkg/proto/*" -not -name "*.gen.go" -not -path "*/mock/*")

#comment:
#	$GOPATH/bin/commentwrap -fix -docflow_limit=90 /Users/norwnd/crypto-integrations/applications/outgoing-transactions/domain/outgoing_transaction.go
#    $GOPATH/bin/commentwrap -fix -docflow_limit=90 TODO

server_deps_up:
	docker-compose -f server/docker/deps-compose.yml up -d --build

server_deps_down:
	docker-compose -f server/docker/deps-compose.yml down
