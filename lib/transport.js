'use strict';

const inherits = require('inherits'),
    Promise = require('./promise'),
    canvas = require('./browser/canvas'),
    jsonp = require('./browser/jsonp');

let baseUrl;
if (typeof window === 'undefined') {
    baseUrl = process.env.LOCATION_BASE_URL || "";
} else {
    const apiHost = normalizeApiHost(window.location.host);
    baseUrl = apiHost ? "https://" + apiHost : "";
}

/**
 * Add stream() method to promise (and following promise chain), to access original request stream.
 * @private
 */
function streamify(promise, factory) {
    const _then = promise.then;
    promise.then = function() {
        factory();
        const newPromise = _then.apply(promise, arguments);
        return streamify(newPromise, factory);
    };
    promise.stream = factory;
    return promise;
}

/**
 * Normalize Salesforce API host name
 * @private
 */
function normalizeApiHost(apiHost) {
    const m = /(\w+).(visual.force|salesforce).com$/.exec(apiHost);
    if (m) {
        apiHost = m[1] + ".salesforce.com";
    }
    return apiHost;
}

/**
 * Class for HTTP request transport
 * @class
 * @protected
 */
const Transport = module.exports = function() {};

Transport.prototype.httpRequest = function(params, callback) {
    const deferred = Promise.defer();
    let req;
    const createRequest = function() {
        if (!req) {
            req = fetch(params.url, {
                method: params.method,
                headers: params.headers,
                body: params.body
            })
            .then(response => {
                const contentType = response.headers.get('content-type');
                const result = {
                    headers: response.headers,
                    statusCode: response.status
                };

                if (!response.ok) {
                    throw new Error('Network response was not ok ' + response.statusText);
                }

                return (contentType && contentType.includes('application/json') ? response.json() : response.text())
                    .then(body => {
                        result.body = body;
                        return result;
                    });
            })
            .then(result => {
                deferred.resolve(result);
            })
            .catch(err => {
                deferred.reject(err);
            });
        }
        return req;
    };
    return streamify(deferred.promise, createRequest).thenCall(callback);
};

/** @protected **/
Transport.prototype._getHttpRequestModule = function() {
    return fetch;
};

/**
 * Class for JSONP request transport
 * @class Transport~JsonpTransport
 * @protected
 * @extends Transport
 * @param {String} jsonpParam - Callback parameter name for JSONP invocation.
 */
const JsonpTransport = Transport.JsonpTransport = function(jsonpParam) {
    this._jsonpParam = jsonpParam;
};
inherits(JsonpTransport, Transport);

/** @protected **/
JsonpTransport.prototype._getHttpRequestModule = function() {
    return jsonp.createRequest(this._jsonpParam);
};

JsonpTransport.supported = jsonp.supported;

/**
 * Class for Sfdc Canvas request transport
 * @class Transport~CanvasTransport
 * @protected
 * @extends Transport
 * @param {Object} signedRequest - Parsed signed request object
 */
const CanvasTransport = Transport.CanvasTransport = function(signedRequest) {
    this._signedRequest = signedRequest;
};
inherits(CanvasTransport, Transport);

/** @protected **/
CanvasTransport.prototype._getHttpRequestModule = function() {
    return canvas.createRequest(this._signedRequest);
};

CanvasTransport.supported = canvas.supported;

/**
 * Class for HTTP request transport using AJAX proxy service
 * @class Transport~ProxyTransport
 * @protected
 * @extends Transport
 * @param {String} proxyUrl - AJAX Proxy server URL
 */
const ProxyTransport = Transport.ProxyTransport = function(proxyUrl) {
    this._proxyUrl = proxyUrl;
};
inherits(ProxyTransport, Transport);

/**
 * Make HTTP request via AJAX proxy
 * @method Transport~ProxyTransport#httpRequest
 * @param {Object} params - HTTP request
 * @param {Callback.<Object>} [callback] - Callback Function
 * @returns {Promise.<Object>}
 */
ProxyTransport.prototype.httpRequest = function(params, callback) {
    let url = params.url;
    if (url.indexOf("/") === 0) {
        url = baseUrl + url;
    }
    const proxyParams = {
        method: params.method,
        url: this.proxyUrl + '?' + Date.now() + "." + ("" + Math.random()).substring(2),
        headers: {
            'salesforceproxy-endpoint': url
        }
    };
    if (params.body || params.body === "") {
        proxyParams.body = params.body;
    }
    if (params.headers) {
        for (let name in params.headers) {
            proxyParams.headers[name] = params.headers[name];
        }
    }
    return ProxyTransport.super.prototype.httpRequest.call(this, proxyParams, callback);
};

/**
 * Class for HTTP request transport using a proxy server
 * @class Transport~HttpProxyTransport
 * @protected
 * @extends Transport
 * @param {String} httpProxy - URL of the HTTP proxy server
 */
const HttpProxyTransport = Transport.HttpProxyTransport = function(httpProxy) {
    this._httpProxy = httpProxy;
};
inherits(HttpProxyTransport, Transport);

/**
 * Make HTTP request via proxy server
 * @method Transport~HttpProxyTransport#httpRequest
 * @param {Object} params - HTTP request
 * @param {Callback.<Object>} [callback] - Callback Function
 * @returns {Promise.<Object>}
 */
HttpProxyTransport.prototype.httpRequest = function(params, callback) {
    let url = params.url;
    if (url.indexOf("/") === 0) {
        url = baseUrl + url;
    }
    const proxyParams = {
        method: params.method,
        url: params.url,
        proxy: this.httpProxy,
        headers: {}
    };
    if (params.body || params.body === "") {
        proxyParams.body = params.body;
    }
    if (params.headers) {
        for (let name in params.headers) {
            proxyParams.headers[name] = params.headers[name];
        }
    }
    return HttpProxyTransport.super.prototype.httpRequest.call(this, proxyParams, callback);
};
