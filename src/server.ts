/// <reference path="../passcards/typings/DefinitelyTyped/express/express.d.ts" />
/// <reference path="../passcards/typings/DefinitelyTyped/q/Q.d.ts" />

import express = require('express');
import Q = require('q');
import urlLib = require('url');

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

interface LookupResponseIcon {
	width: number;
	height: number;
	sourceUrl: string;
	dataUrl: string;
}

interface LookupResponse {
	domain: string;
	icons: LookupResponseIcon[];
	lastModified: number;
	status: string;
	submitted: number;
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
	private metadataCache: collectionutil.OMap<IconStoreEntry>;
	private dataCache: collectionutil.OMap<Uint8Array>;
	private lookupService: siteinfo_service.SiteInfoService;

	constructor() {
		var urlFetcher = new HttpUrlFetcher();

		this.dataCache = {};
		this.metadataCache = {};

		this.lookupService = new siteinfo_service.SiteInfoService(urlFetcher);
		this.lookupService.updated.listen((url) => {
			var domain = this.domainForUrl(url);
			var lookupResult = this.lookupService.lookup(url);

			this.initCacheEntry(domain);
			
			console.log('icons updated for %s, total %d', domain, lookupResult.info.icons.length);
			var entry = this.metadataCache[domain];
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
					this.dataCache[icon.url] = icon.data;
				}
			});

			if (lookupResult.state == site_info.QueryState.Ready) {
				entry.status = LookupStatus.Done;
			}
		});
	}

	query(domain: string) : Q.Promise<IconStoreEntry> {
		if (this.metadataCache.hasOwnProperty(domain)) {
			return Q(this.metadataCache[domain]);
		} else {
			return Q(<IconStoreEntry>{
				icons: [],
				status: LookupStatus.NotFound
			});
		}
	}

	lookup(domain: string) : IconStoreEntry {
		var url = this.urlForDomain(domain);
		this.lookupService.lookup(url);
		
		this.initCacheEntry(domain);
		return this.metadataCache[domain];
	}

	fetchData(srcUrl: string) : Q.Promise<Uint8Array> {
		if (this.dataCache.hasOwnProperty(srcUrl)) {
			return Q(this.dataCache[srcUrl]);
		} else {
			return Q.reject(new NotFoundError());
		}
	}

	private urlForDomain(domain: string) {
		return urlLib.format({
			protocol: 'https',
			host: domain,
			path: '/'
		});
	}

	private domainForUrl(url: string) {
		return urlLib.parse(url).host;
	}

	private initCacheEntry(domain: string) {
		if (this.metadataCache.hasOwnProperty(domain)) {
			return;
		}

		this.metadataCache[domain] = {
			icons: [],
			status: LookupStatus.Processing,
			submitted: new Date(),
			lastModified: new Date()
		};
	}
}

class App {
	private app: express.Express;
	private iconStore: IconStore;

	constructor() {
		this.app = express();
		this.iconStore = new IconStore();

		var corsHandler: express.Handler = (req, res, next) => {
			res.set('Access-Control-Allow-Origin', '*');
			next();
		}
		this.app.use(corsHandler);

		this.app.get('/siteinfo/:domain', (req, res) => {
			var domain = req.params.domain;
			
			this.iconStore.query(domain).then((entry) => {
				var iconList: LookupResponseIcon[] = entry.icons.map((icon) => {
					return {
						width: icon.width,
						height: icon.height,
						sourceUrl: icon.url,
						dataUrl: this.dataUrl(icon.url)
					};
				});

				if (entry.status == LookupStatus.NotFound) {
					console.log('starting lookup for %s', domain);
					entry = this.iconStore.lookup(domain);
				}

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

				var body: LookupResponse = {
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

	start(port: number, ip: string) {
		this.app.listen(port, ip, () => {
			console.log('Server started on %s:%d', ip, port);
		});
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

export function main() {
	var app = new App();
	var ipAddress = process.env.OPENSHIFT_NODEJS_IP;
	var port = process.env.OPENSHIFT_NODEJS_PORT || 8060;
	app.start(port, ipAddress);
}

