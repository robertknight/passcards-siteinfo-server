include passcards/common.mk

TSC=tsc -m commonjs --noImplicitAny --sourcemap

app_srcs=$(shell find src/ -name '*.ts')
test_files=$(shell find build/ -name '*_test.js')

all: build/src/server.js

build/src/server.js: $(app_srcs)
	$(TSC) --outDir build $(app_srcs)

clean:
	rm -rf build

lint:
	tslint -c passcards/tslint.json -f src/server.ts

test: build/src/server.js
	@echo $(test_files) | $(FOREACH_FILE) $(NODE)
