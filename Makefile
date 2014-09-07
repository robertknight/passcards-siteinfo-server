include passcards/common.mk

TSC=tsc -m commonjs --noImplicitAny --sourcemap

app_srcs=$(shell find src/ -name '*.ts')
compiled_srcs=$(patsubst %.ts, build/%.js, $(app_srcs))
test_files=$(shell find build/ -name '*_test.js')

all: $(compiled_srcs)

$(compiled_srcs): $(app_srcs)
	$(TSC) --outDir build $(app_srcs)

clean:
	rm -rf build

lint: $(app_srcs)
	@echo $(app_srcs) | $(FOREACH_FILE) tslint -c passcards/tslint.json -f

test: build/src/server.js
	@echo $(test_files) | $(FOREACH_FILE) $(NODE)
