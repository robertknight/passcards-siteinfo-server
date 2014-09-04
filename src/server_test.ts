/// <reference path="../passcards/typings/DefinitelyTyped/q/Q.d.ts" />
/// <reference path="../passcards/typings/DefinitelyTyped/underscore/underscore.d.ts" />

import Q = require('q');
import underscore = require('underscore');
import urlLib = require('url');

import asyncutil = require('../passcards/lib/base/asyncutil');
import http_client = require('../passcards/lib/http_client');
import node_vfs = require('../passcards/lib/vfs/node');
import http_vfs = require('../passcards/lib/vfs/http');
import server = require('./server');
import testLib = require('../passcards/lib/test');

var nextPort = 7561;

function testPort() {
	var port = nextPort;
	++nextPort;
	return port;
}

function startFileServer(path: string, port: number) : Q.Promise<http_vfs.Server> {
	var fs = new node_vfs.FileVFS(path);
	var server = new http_vfs.Server(fs);
	return server.listen(port).then(() => {
		return server;
	});
}

testLib.addAsyncTest('fetch site info', (assert) => {
	var app = new server.App();
	var appPort = testPort();
	var baseUrl = 'http://localhost:' + appPort;
	var response: server.LookupResponse;

	var fileServer: http_vfs.Server;
	var fileServerPort = testPort();
	var testDomain = 'localhost:' + fileServerPort;

	return startFileServer('passcards/lib/test-data/site-icons/wikipedia/standard-icons', fileServerPort).then((server) => {
		fileServer = server;
		return app.start(appPort, undefined)
	}).then(() => {
		return http_client.get(baseUrl + '/siteinfo/' + testDomain);
	}).then((reply) => {
		response = JSON.parse(reply.body);
		assert.equal(response.domain, testDomain);
		assert.deepEqual(response.icons, []);
		assert.equal(response.status, 'processing');
		return asyncutil.until(() => {
			return http_client.get(baseUrl + '/siteinfo/' + testDomain).then((reply) => {
				response = JSON.parse(reply.body);
				return response.status == 'done';
			});
		});
	}).then(() => {
		var smallIconUrl = 'https://' + testDomain + '/favicon.ico';
		var largeIconUrl = 'https://' + testDomain + '/apple-touch-icon.png';

		var iconDataUrl = (url: string) => {
			return urlLib.format({
				pathname: '/icondata',
				query: {
					src: url
				}
			});
		};

		var expectedIcons = [{
			width: 48,
			height: 48,
			sourceUrl: smallIconUrl,
			dataUrl: iconDataUrl(smallIconUrl)
		},{
			width: 144,
			height: 144,
			sourceUrl: largeIconUrl,
			dataUrl: iconDataUrl(largeIconUrl)
		}]; 
		var icons = underscore.sortBy(response.icons, (icon) => {
			return icon.width;
		});
		assert.deepEqual(icons, expectedIcons);

		fileServer.close();
		app.stop();
	});
});

testLib.start();
