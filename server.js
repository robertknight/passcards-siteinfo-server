#!/usr/bin/env node

// 7/9/14 - OpenShift is currently using Node.js v0.10.25
// which ships with an old CA cert bundle.
//
// Use the certificates from /etc/ssl/certs instead
//
var crypto_cacerts = require('crypto-cacerts');
crypto_cacerts.cryptoPatch('/etc/ssl/certs');

var server = require('./build/src/server');
server.main();
