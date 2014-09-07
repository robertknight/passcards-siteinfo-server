#!/usr/bin/env node

// 7/9/14 - OpenShift is currently using Node.js v0.10.25
// which ships with an old CA cert bundle.
//
// Use the certificates from /etc/ssl/certs instead
//
var custom_ssl_certs = require('./build/src/custom_ssl_certs');
var certList = custom_ssl_certs.readCertDir('/etc/ssl/certs');
custom_ssl_certs.cryptoPatch(certList);

var server = require('./build/src/server');
server.main();
