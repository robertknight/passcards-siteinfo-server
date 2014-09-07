/// <reference path="../passcards/typings/DefinitelyTyped/node/node.d.ts" />
	
// Override the default set of certificates used by crypto.createCredentials()
// (and all consumers, including the 'tls' and 'https' modules) with
// a custom set of certificates.
//
// Based on the crypto-cacerts package from https://github.com/monceaux/crypto-cacerts

import crypto = require('crypto');
import fs = require('fs');
import path = require('path');

/** Read a PEM certificate bundle and return an array of the contents
  * of individual certificates.
  */
export function parsePEMFile(filename: string) : string[] {
	var certBundle = fs.readFileSync(filename, {encoding: 'utf8'});
	return certBundle.match(/-+BEGIN CERTIFICATE[^]*?END CERTIFICATE-+/g);
}

/** Read all of the certificate bundles in a given directory
  * and return an array of all certs found in those bundles.
  *
  * Skips any subdirectories or files which the current user
  * does not have permission to access.
  */
export function readCertDir(dirPath: string) : string[] {
	var certs: string[] = [];
	fs.readdirSync(dirPath).map((file) => {
		try {
			var certPath = path.join(dirPath,file);
			var fileInfo = fs.statSync(certPath);
			if (fileInfo.isFile()) {
				certs = certs.concat(parsePEMFile(certPath));
			}
		} catch (err) {
			// on OpenShift, the system cert dir contains
			// several cert bundles which are only readable by root
			if (!err.code || err.code != 'EACCESS') {
				throw err;
			}
		}
	});
	return certs;
}

/** Monkey-patch the crypto.createCredentials() API
  * to append a set of custom certificates to the options map.
  */
export function cryptoPatch(certs: string[]) {
	var createCredentialsOriginal: any = crypto.createCredentials;

	// FIXME: The 'context' argument is not documented but is present in
	// the code from the crypto-cacerts package which this code is based
	// on. See https://github.com/monceaux/crypto-cacerts
	(<any>crypto).createCredentials = (options: crypto.CredentialDetails, context: any) => {
		options.ca = (options.ca || []).concat(certs);
		return createCredentialsOriginal(options, context);
	};
}

