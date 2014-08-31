Passcards Siteinfo API
======================

## Retrieving site information

````
GET /siteinfo/:domain
````

Response:

If cached details are available for the specified domain,
the lookup returns a 200 response with the cached details:


````
{
	"domain" : "foo.example.com",
	"icons" : {
		"32x32" : "<URL>",
		"64x64" : "<URL>"
	},
	"lastModified" : <UNIX timestamp>,
	"status" : "processing|done"
}
````

