/// <reference path="passcards/typings/DefinitelyTyped/express/express.d.ts" />
/// <reference path="passcards/typings/DefinitelyTyped/q/Q.d.ts" />

import express = require('express');
import Q = require('q');
import urlLib = require('url');

import collectionutil = require('passcards/lib/base/collectionutil');
import site_info = require('passcards/lib/siteinfo/site_info');
import siteinfo_service = require('passcards/lib/siteinfo/service');

interface LookupResponse {
	domain: string;
	icons: {
		[dimension: string] : string;
	};
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
}

class IconStore {
	private cache: collectionutil.OMap<IconStoreEntry>;
	private lookupService: siteinfo_service.SiteInfoService;

	constructor() {
		this.cache = {};

		this.lookupService = new siteinfo_service.SiteInfoService(urlFetcher);
		this.lookupService.updated.listen((url) => {
			var domain = this.domainForUrl(url);
			var lookupResult = this.lookupService.lookup(url);
			
			console.log('icons updated for %s, total %d', domain, lookupResult.info.icons.length);

			if (!this.cache.hasOwnProperty(domain)) {
				this.cache[domain] = {
					icons: [],
					status: LookupStatus.Processing
				};
			}

			var entry = this.cache[domain];
			entry.icons = lookupResult.info.icons.map((icon) => {
				return <Icon>{
					width: icon.width,
					height: icon.height,
					url: icon.url
				};
			});

			if (lookupResult.state == site_info.QueryState.Ready) {
				entry.status = LookupStatus.Done;
			}
		});
	}

	query(domain: string) : Q.Promise<IconStoreEntry> {
		if (this.cache.hasOwnProperty(domain)) {
			return Q(this.cache[domain]);
		} else {
			return Q(<IconStoreEntry>{
				icons: [],
				status: LookupStatus.NotFound
			});
		}
	}

	lookup(domain: string) {
		this.lookupService.update(this.urlForDomain(domain));
	}

	private urlForDomain(domain: string) {
		return urlLib.format({
			scheme: 'https',
			host: domain
		});
	}

	private domainForUrl(url: string) {
		return urlLib.parse(url).host;
	}
}

class App {
	private app: express.Express;
	private iconStore: IconStore;

	constructor() {
		this.app = express();
		this.iconStore = new IconStore();

		this.app.use((req, res, next) => {
			res.set('Access-Control-Allow-Origin', '*');
			next();
		});

		this.app.get('/siteinfo/:domain', (req, res) => {
			var domain = req.params.domain;
			
			this.iconStore.query(domain).then((entry) => {
				var iconList: collectionutil.OMap<string> = {};
				entry.icons.forEach((icon) => {
					var key = icon.width + 'x' + icon.height;
					iconList[key] = icon.url;
				});

				if (entry.status == LookupStatus.NotFound) {
					console.log('starting lookup for %s', domain);
					this.iconStore.lookup(domain);
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
					lastModified: 0,
					status: statusString,
					submitted: 0
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
	}

	start(port: number, ip: string) {
		this.app.listen(port, ip, () => {
			console.log('Server started on %s:%d', ip, port);
		});
	}
}

export function main() {
	var app = new App();
	var ipAddress = process.env.OPENSHIFT_NODEJS_IP;
	var port = process.env.OPENSHIFT_NODEJS_PORT || 8060;
	app.start(port, ipAddress);
}

