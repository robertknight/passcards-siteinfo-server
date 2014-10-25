/// <reference path="../passcards/typings/DefinitelyTyped/express/express.d.ts" />
/// <reference path="../passcards/typings/DefinitelyTyped/node/node.d.ts" />
/// <reference path="../passcards/typings/DefinitelyTyped/q/Q.d.ts" />

import express = require('express');
import fs = require('fs');
import http = require('http');
import path = require('path');
import Q = require('q');
import urlLib = require('url');

import client_api = require('../passcards/lib/siteinfo/client_api');
import collectionutil = require('../passcards/lib/base/collectionutil');
import dateutil = require('../passcards/lib/base/dateutil');
import err_util = require('../passcards/lib/base/err_util');
import http_client = require('../passcards/lib/http_client');
import image = require('../passcards/lib/siteinfo/image');
import site_info = require('../passcards/lib/siteinfo/site_info');
import siteinfo_service = require('../passcards/lib/siteinfo/service');
import stringutil = require('../passcards/lib/base/stringutil');

class NotFoundError extends err_util.BaseError {
	constructor() {
		super('Item not found');
	}
}

enum LookupStatus {
	NotFound,
	Processing,
	Done
}

interface Icon {
	width: number;
	height: number;
	url: string;
}

interface IconStoreEntry {
	icons: Icon[];
	status: LookupStatus;
	submitted: Date;
	lastModified: Date;
}

export interface IconStoreOptions {
	/** Specifies whether icons are fetched via HTTPS by
	  * default. Icon links that explicitly specify 'http'
	  * are still fetched without SSL.
	  *
	  * If not specified, secureFetch defaults to true.
	  * Ideally, icons could always be fetched via SSL. However,
	  * there are many popular sites whose homepages have invalid
	  * SSL configurations (eg. SSL certs only valid for the CDN
	  * serving the homepage content).
	  */
	secureFetch?: boolean;
}

export interface AppConfig extends IconStoreOptions {
}

class HttpUrlFetcher {
	fetch(url: string) : Q.Promise<siteinfo_service.UrlResponse> {
		return http_client.get(url, {redirectLimit: 5}).then((reply) => {
			return {
				status: reply.status,
				body: reply.body
			};
		});
	}
}

class IconStore {
	private metadataCache: Map<string,IconStoreEntry>;
	private dataCache: Map<string,Uint8Array>;
	private lookupService: siteinfo_service.SiteInfoService;
	private opts: IconStoreOptions

	constructor(opts?: IconStoreOptions) {
		var urlFetcher = new HttpUrlFetcher();

		this.dataCache = new collectionutil.PMap<string,Uint8Array>();
		this.metadataCache = new collectionutil.PMap<string,IconStoreEntry>();
		this.opts = opts || {
			secureFetch: true
		};

		this.lookupService = new siteinfo_service.SiteInfoService(urlFetcher);
		this.lookupService.updated.listen((url) => {
			var domain = this.domainForUrl(url);
			var lookupResult = this.lookupService.lookup(url);

			this.initCacheEntry(domain);
			
			console.log('icons updated for %s, total %d', domain, lookupResult.info.icons.length);
			var entry = this.metadataCache.get(domain);
			entry.icons = lookupResult.info.icons.map((icon) => {
				return <Icon>{
					width: icon.width,
					height: icon.height,
					url: icon.url
				};
			});
			entry.lastModified = new Date();

			lookupResult.info.icons.forEach((icon) => {
				if (icon.data) {
					this.dataCache.set(icon.url, icon.data);
				}
			});

			if (lookupResult.state == site_info.QueryState.Ready) {
				console.log('icon lookup for %s completed in %d ms', domain, entry.lastModified.getTime() -
				  entry.submitted.getTime());
				entry.status = LookupStatus.Done;
			}
		});
	}

	query(domain: string, timeout?: number) : Q.Promise<IconStoreEntry> {
		if (this.metadataCache.has(domain)) {
			return Q(this.metadataCache.get(domain));
		} else {
			return this.lookup(domain, timeout);
		}
	}

	private lookup(domain: string, timeout?: number) : Q.Promise<IconStoreEntry> {
		console.log('starting lookup for %s (timeout: %d)', domain, timeout);
		var url = this.urlForDomain(domain);
		this.lookupService.lookup(url);

		this.initCacheEntry(domain);
		var cacheEntry = this.metadataCache.get(domain);

		if (cacheEntry.status != LookupStatus.Processing || !timeout) {
			return Q(cacheEntry);
		}

		var entry = Q.defer<IconStoreEntry>();
		var lookupUrl = this.urlForDomain(domain);
		var updateHandler = this.lookupService.updated.listen((url) => {
			if (url == lookupUrl) {
				cacheEntry = this.metadataCache.get(domain);
				if (cacheEntry.status != LookupStatus.Processing) {
					this.lookupService.updated.ignore(updateHandler);
					entry.resolve(cacheEntry);
				}
			}
		});

		setTimeout(() => {
			this.lookupService.updated.ignore(updateHandler);
			entry.resolve(cacheEntry);
		}, timeout);

		return entry.promise;
	}

	fetchData(srcUrl: string) : Q.Promise<Uint8Array> {
		if (this.dataCache.has(srcUrl)) {
			return Q(this.dataCache.get(srcUrl));
		} else {
			return Q.reject(new NotFoundError());
		}
	}

	private urlForDomain(domain: string) {
		return urlLib.format({
			protocol: this.opts.secureFetch ? 'https' : 'http',
			host: domain,
			path: '/'
		});
	}

	private domainForUrl(url: string) {
		return urlLib.parse(url).host;
	}

	private initCacheEntry(domain: string) {
		if (this.metadataCache.get(domain)) {
			return;
		}

		this.metadataCache.set(domain, {
			icons: [],
			status: LookupStatus.Processing,
			submitted: new Date(),
			lastModified: new Date()
		});
	}
}

export class App {
	private app: express.Express;
	private iconStore: IconStore;
	private server: http.Server;

	constructor(opts?: AppConfig) {
		this.app = express();
		this.iconStore = new IconStore(opts);

		var corsHandler: express.Handler = (req, res, next) => {
			res.set('Access-Control-Allow-Origin', '*');
			next();
		}
		this.app.use(corsHandler);

		this.app.get('/siteinfo/:domain', (req, res) => {
			var domain = req.params.domain;
			var timeout = parseInt(req.param('timeout'));
			
			this.iconStore.query(domain, timeout).then((entry) => {
				var iconList: client_api.LookupResponseIcon[] = entry.icons.map((icon) => {
					return {
						width: icon.width,
						height: icon.height,
						sourceUrl: icon.url,
						dataUrl: this.dataUrl(icon.url)
					};
				});

				var statusString: string;
				switch (entry.status) {
					case LookupStatus.NotFound:
						// fallthrough
					case LookupStatus.Processing:
						statusString = 'processing';
						break;
					case LookupStatus.Done:
						statusString = 'done';
						break;
				}

				var body: client_api.LookupResponse = {
					domain: domain,
					icons: iconList,
					lastModified: dateutil.unixTimestampFromDate(entry.lastModified),
					status: statusString,
					submitted: dateutil.unixTimestampFromDate(entry.submitted)
				};
				res.send(body);
				if (entry.status == LookupStatus.Processing) {
					res.status(202);
				} else if (entry.status == LookupStatus.Done) {
					res.status(200);
				}
				res.end();
			}).catch((err) => {
				res.status(500);
				res.send({message: err.message});
				res.end();
			});
		});

		this.app.get('/icondata', (req, res) => {
			var srcUrl = req.param('src');
			if (!srcUrl) {
				res.status(400);
				res.send({message:'No source icon URL specified'});
				res.end();
			}

			this.iconStore.fetchData(srcUrl).then((data) => {
				var parsedSrcUrl = urlLib.parse(srcUrl);
				var imageInfo = image.getInfo(data);
				var mimeType = image.mimeType(imageInfo.type);

				res.set('Content-Disposition', 'filename=' + stringutil.suffix(parsedSrcUrl.path, '/'));
				res.set('Content-Type', mimeType);

				res.status(200);
				res.send(new Buffer(<any>data));
			}).catch((err) => {
				if (err instanceof NotFoundError) {
					res.status(404);
					res.send({message: 'No such icon found'});
				} else {
					res.send(err);
					res.status(500);
				}
			}).finally(() => {
				res.end();
			});
		});
	}

	start(port: number, ip: string) : Q.Promise<void> {
		var ready = Q.defer<void>();
		this.server = this.app.listen(port, ip, () => {
			console.log('Server started on %s:%d', ip, port);
			ready.resolve(null);
		});
		return ready.promise;
	}

	stop() {
		this.server.close();
	}

	private dataUrl(sourceUrl: string) {
		return urlLib.format({
			pathname: '/icondata',
			query: {
				src: sourceUrl
			}
		});
	}
}

function logConfig(config: AppConfig) {
	var configMessages = {
		'Config: Using SSL for connections to external hosts': !!config.secureFetch
	};
	for (var key in configMessages) {
		console.log('%s:', key, (<any>configMessages)[key]);
	}
}

export function main() {
	var config: AppConfig = {}
	if (process.env.OPENSHIFT_DATA_DIR) {
		var configPath = path.join(process.env.OPENSHIFT_DATA_DIR, 'config.json');
		config = JSON.parse(fs.readFileSync(configPath).toString());
		
		console.log('Read configuration from %s', configPath);
		logConfig(config);
	}

	var app = new App(config);
	var ipAddress = process.env.OPENSHIFT_NODEJS_IP;
	var port = process.env.OPENSHIFT_NODEJS_PORT || 8060;
	app.start(port, ipAddress);
}

