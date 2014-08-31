TSC=tsc -m commonjs --noImplicitAny --sourcemap

app_srcs=$(shell find src/ -name '*.ts')

all: build/src/server.js

build/src/server.js: $(app_srcs)
	$(TSC) --outDir build $(app_srcs)

clean:
	rm -rf build
