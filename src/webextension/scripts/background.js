var nub = {
	self: {
		id: chrome.runtime.id,
		version: chrome.runtime.getManifest().version,
		chromemanifestkey: 'trigger' // crossfile-link37388
	},
	browser: {
		name: getBrowser().name.toLowerCase(),
		version: getBrowser().version
	},
	path: {
		// webext relative paths
		webext: '/',
		images: 'images/',
		fonts: 'styles/fonts/',
		pages: 'pages/',
		scripts: 'scripts/',
		styles: 'styles/',
		exe: 'exe/',
		// chrome path versions set after this block
		chrome: {
			// non-webext paths - SPECIAL prefixed with underscore - means it is from chrome://nub.addon.id/content/
			// all the relatives from above will come in here as well, prefixed with chrome://nub.addon.id/content/
			// only: 'only', // will me prefixed with chrome://nub.addon.id/content/
		}
	},
	namsg: { // only used by firefox
		manifest: {
			name: 'trigger', // this is also the exe filename // i use this as child entry for windows registry entry, so make sure this name is compatible with injection into windows registry link39191
			description: 'Platform helper for Trigger',
			path: undefined, // set by `getNativeMessagingInfo` in bootstrap
			type: 'stdio',
			allowed_extensions: [ chrome.runtime.id ]
		}
	},
	stg: {
		// defaults - keys that present in here during `preinit` are fetched on startup
			// 3 types
				// prefs are prefeixed with "pref_"
				// mem are prefeixed with "mem_" - mem stands for extension specific "cookies"/"system memory"
				// filesystem-like stuff is prefixied with "fs_"
		mem_lastversion: '-1', // indicates not installed - the "last installed version"
	}
};
formatNubPaths();

var gExeComm;
var gPortsComm = new Comm.server.webextports();
var gBsComm = new Comm.client.webext();

var callInAPort = Comm.callInX2.bind(null, gPortsComm, null);
var callInExe = Comm.callInX2.bind(null, 'gExeComm', null, null); // cannot use `gExeComm` it must be `"gExeComm"` as string because `gExeComm` var was not yet assigned
var callInBootstrap = Comm.callInX2.bind(null, gBsComm, null, null);
var callInMainworker = Comm.callInX2.bind(null, gBsComm, 'callInMainworker', null);
var callInNative; // set in preinit, if its android, it is eqaul to callInMainworker, else it is equal to callInExe

// start - init
async function preinit() {
	let basketmain = new PromiseBasket;

	/*
	 promises in promiseallarr when get rejected, reject with:
		{
			reason: string;enum[STG_CONNECT, EXE_CONNECT, EXE_MISMATCH]
			text: string - non-localized associated text to show - NOT formated text. this is something i would insert into the template shown
			data: object - only if EXE_MISMATCH - keys: exeversion
		}
	*/
	// fetch storage
	basketmain.add(
		async function() {
			try {
				let stgeds = await storageCall('local', 'get', Object.keys(nub.stg));
				for (let key in stgeds) {
					nub.stg[key] = stgeds[key];
				}
			} catch(err) {
				throw { reason:'STG_CONNECT', text:err.toString() };
			}
		}()
	);

	// get platform info - and startup exe (desktop) or mainworker (android)
	// set callInNative
	basketmain.add(
		async function() {
			// get platform info
			nub.platform = await browser.runtime.getPlatformInfo();

			// set callInNative
			callInNative = nub.platform.os == 'android' ? callInMainworker : callInExe;

			// connect to native
			if (nub.platform.os == 'android') {
				callInBootstrap('startupMainworker', { path:nub.path.chrome.scripts + 'mainworker.js' });
				// worker doesnt start till first call, so just assume it connected

				// no need to verify host version, as its the one from the chromeworker
				return 'platinfo got, callInNative set, worker started';
			} else {
				try {
					await new Promise((resolve, reject) => {
						gExeComm = new Comm.server.webextexe('trigger', ()=>resolve(), err=>reject(err))
					});
				} catch(first_conn_err) {
					// exe failed to connect
					console.error('failed to connect to exe, first_conn_err:', first_conn_err);
					if (first_conn_err) first_conn_err = first_conn_err.toString(); // because at the time of me writing this, Comm::webext.js does not give an error reason fail, i tried but i couldnt get the error reason, it is only logged to console

					if (nub.browser.name == 'firefox') {
						// manifest and exe may not be installed, so try installing
						try {
							await new Promise((resolve, reject) => {
								callInBootstrap('installNativeMessaging', { manifest:nub.namsg.manifest, exe_pkgpath:getNamsgExepkgPath(), os:nub.platform.os }, err => err ? reject(err) : resolve() );
							})
						} catch(install_err) {
							throw { reason:'EXE_INSTALL', text:'Failed to connect for reason "' + first_conn_err.toString() + '" so tried copying manifest and executable but failed due to "' + install_err + '".' };
						}
					}

					// try re-connecting
					try {
						// try reconnecting 10 times over 5000ms
						await doRetries(500, 10, () =>
							new Promise((resolve, reject) => {
								gExeComm = new Comm.server.webextexe('trigger', ()=>resolve(), err=>reject(err));
							})
						);
					} catch(re_conn_err) {
						throw { reason:'EXE_CONNECT', text:re_conn_err };
					}
				}

				// ok connected
				// lets verify the exe is for this version of extension, else send it exe from within for self update/downgrade
				// btw if it gets here, its not android, as if it was android it `return`ed earlier after starting worker

				// verify exe version
				let exeversion = await new Promise( resolve => callInExe('getExeVersion', undefined, val => resolve(val)) );
				let extversion = nub.self.version;
				if (exeversion === extversion) {
					return 'platinfo got, callInNative set, exe started, exe version is correct';
				} else {
					// version mismatch, lets fetch the exe and send it to the current exe so it can self-apply
					let exearrbuf = xhrSync(getNamsgExepkgPath()).response;

					try {
						await new Promise(  (resolve, reject)=>callInExe( 'applyExe', exearrbuf, err=>err?reject(err):resolve() )  );
					} catch(exe_apply_err) {
						console.error('exe_apply_err:', exe_apply_err);
						let howtofixstr = isSemVer(extversion, '>' + exeversion) ? chrome.i18n.getMessage('startupfailed_exemismatch_howtofix1') : chrome.i18n.getMessage('startupfailed_exemismatch_howtofix2');
						throw { reason:'EXE_MISMATCH', text:chrome.i18n.getMessage('startupfailed_exemismatch', [exeversion, extversion, howtofixstr]) };
					}

					return 'platinfo got, callInNative set, exe started, exe self applied';
				}
			}
		}()
	);

	try {
		await basketmain.run();

		init();
	} catch(err) {
		console.error('onPreinitFailed, err:', err);

		// build body, based on err.reason, with localized template and with err.text and errex
		var body, bodyarr;
		switch (err.reason) {
			// case 'STG_CONNECT': // let default handler take care of this
			// 		//
			// 	break;
			// case 'EXE_CONNECT':
			//
			// 		bodyarr = [chrome.i18n.getMessage('startupfailed_execonnect') + ' ' + (err.text || chrome.i18n.getMessage('startupfailed_unknown'))]
			// 		if (errex) bodyarr[0] += ' ' + errex.toString();
			//
			// 	break;
			default:
				var txt = '';
				if (err.text) txt += err.text;
				// if (txt && errex) txt += '\n';
				// if (errex) txt += errex;

				bodyarr = [ txt || chrome.i18n.getMessage('startupfailed_unknown') ];
		}
		var body = chrome.i18n.getMessage('startupfailed_body', bodyarr);

		// show error to user
		callInBootstrap('showSystemAlert', { title:chrome.i18n.getMessage('startupfailed_title'), body:body });
	}
}

function init() {
	// after receiving nub
	console.log('in init, nub:', nub);

	startupBrowserAction();

	var lastversion = nub.stg.mem_lastversion;
	if (lastversion === '-1') {
		// installed / first run
		console.error('FIRST RUN');
		storageCall('local', 'set', { mem_lastversion:nub.self.version })
		.then(a=>console.log('set, nub.stg:', nub.stg));
	} else if (lastversion !== nub.self.version) {
		// downgrade or upgrade
		if (isSemVer(nub.self.version, '>' + lastversion)) {
			// upgrade
			console.error('UPDGRADE');
		} else {
			// downgrade
			console.error('DOWNGRADE');
		}
		storageCall('local', 'set', { mem_lastversion:nub.self.version })
		.then(a=>console.log('set, nub.stg:', nub.stg));
	} // else if (lastversion === nub.self.version) { } // browser startup OR enabled after having disabled

}

function uninit() {
	// from IRC on 093016 - no need to unregister these ports, they are done for me on addon sutdown
	// gPortsComm.unregister();
	// gExeComm.unregister();
}
// end - init

// start - browseraction
function startupBrowserAction() {
	// browser_action/chrome.browserAction is not supported on Android, so tell bootstrap to inject action item to NativeWindow.menu
	if (nub.platform.os == 'android') {
		callInBootstrap('startupAndroid', {
			browseraction: {
				name: chrome.i18n.getMessage('browseraction_title'),
				// iconpath: chrome.runtime.getURL('images/icon.svg')
				checkable: false
			}
		});
	} else {
		chrome.browserAction.setBadgeBackgroundColor({color:'#7DCE8D'});
		chrome.browserAction.onClicked.addListener(onBrowserActionClicked);
	}
}
function onBrowserActionClicked() {
	console.log('opening menu.html now');
	addTab(nub.path.pages + 'app.html');
}
// end - browseraction

async function fetchData(aArg={}) {
	let { hydrant, nub:wantsnub } = aArg;
	// xprefs means xpcom prefs

	let data = {};
	console.log('PromiseBasket:', PromiseBasket);
	let basketmain = new PromiseBasket;

	if (wantsnub) data.nub = nub;

	if (hydrant) {
		data.hydrant = {};
		if ('stg' in hydrant) {
			basketmain.add(
				storageCall('local', 'get', Object.keys(hydrant.stg)),
				stgeds => data.hydrant.stg = stgeds
				// stgeds => { console.log('got stgeds:', stgeds); data.stg = stgeds; }
			);
		}
		// if ('xprefs' in hydrant) { // xpcom_prefs
		// 	basketmain.add(
		// 		new Promise( resolve=>callInBootstrap('getXPrefs', { nametypes:{  'geo.provider.testing':'boolean', 'geo.wifi.uri':'string'  } }, xprefs => resolve(xprefs)) ),
		// 		xprefvals => data.hydrant.xprefs=xprefvals
		// 		// xprefvals => { console.error('got xprefvals in bg:', xprefvals); data.xprefs=xprefvals; }
		// 	)
		// }
	}

	await basketmain.run();
	return data;
}

function setFaking(aNewStatus) {
	// aNewStatus - boolean; - true for on, false for off
	switch (nub.browser.name) {
		case 'firefox':

				if (aNewStatus) {
					let { pref_lat:lat, pref_lng:lng } = nub.stg;
					let geojson = { location:{ lat, lng }, accuracy:4000 };
					let geouri = 'data:,' + encodeURIComponent(JSON.stringify(geojson));
					let xprefvals = { 'geo.wifi.uri':geouri, 'geo.provider.testing':true };
					callInBootstrap('setXPrefs', { namevals:xprefvals } );
				} else {
					let xprefvals = { 'geo.wifi.uri':null, 'geo.provider.testing':null };
					callInBootstrap('setXPrefs', { namevals:xprefvals });
				}

			break;
		default:
			throw new Error(nub.browser.name + ' browser not supported!')
	}

	// set badge
	if (nub.platform.os != 'android') {
		if (aNewStatus) {
			chrome.browserAction.setBadgeText({text:chrome.i18n.getMessage('on')});
			browserActionSetTitle(chrome.i18n.getMessage('browseraction_title_on'));
		} else {
			chrome.browserAction.setBadgeText({text:''});
			browserActionSetTitle(chrome.i18n.getMessage('browseraction_title'));
		}
	} else {
		if (aNewStatus) {
			callInBootstrap('browserActionUpdate', { checked:true, checkable:true, name:chrome.i18n.getMessage('browseraction_title_on') });
		} else {
			callInBootstrap('browserActionUpdate', { checked:false, checkable:false, name:chrome.i18n.getMessage('browseraction_title') });
		}
	}
}

// start - polyfill for android
function browserActionSetTitle(title) {
	if (nub.platform.os != 'android') {
		chrome.browserAction.setTitle({title});
	} else {
		callInBootstrap('update');
	}
}
function browserActionSetBadgeText(text) {

}
function addTab(url) {
	if (chrome.tabs && chrome.tabs.create) {
		chrome.tabs.create({ url:url });
	} else {
		// its android
		callInBootstrap('addTab', { url:url });
	}
}
function reuseElseAddTab(url) {
	// find tab by url, if it exists focus its window and tab and the reuse it. else add tab
}
// end - polyfill for android

// start - addon specific helpers

function getNamsgExepkgPath() {
	let exe_subdir = ['win', 'mac'].includes(nub.platform.os) ? nub.platform.os : 'nix';
	let exe_filename = nub.namsg.manifest.name + (nub.platform.os == 'win' ? '.exe' : '');
	let exe_pkgpath = nub.path.exe + exe_subdir + '/' + exe_filename; // path to the exe inside the xpi
	return exe_pkgpath;
}

// end - addon specific helpers

// start - cmn
// rev3 - not yet comit - https://gist.github.com/Noitidart/bcb964207ac370d3301720f3d5c9eb2b
var _storagecall_pendingset = {};
var _storagecall_callid = 1;
function storageCall(aArea, aAction, aKeys, aOptions) {
	if (typeof(aArea) == 'object') ({ aArea, aAction, aKeys, aOptions } = aArea);
	// because storage can fail, i created this, which goes until it doesnt fail

	// aAction - string;enum[set,get,clear,remove]
	// aKeys -
		// if aAction "clear" then ignore
		// if aAction "remove" then string/string[]
		// if aAction "get" then null/string/string[]
		// if aAction "set" then object
	// aOptions - object
		// maxtries - int;default:0 - set to 0 if you want it to try infinitely
		// timebetween - int;default:50 - milliseconds

	aOptions = aOptions ? aOptions : {};
	const maxtries = aOptions.maxtries || 0;
	const timebetween = aOptions.timebetween || 50;

	const callid = _storagecall_callid++; // the id of this call to `storageCall` // only used for when `aAction` is "set"

	if (aAction == 'set') {
		// see if still trying to set any of these keys
		for (var setkey in aKeys) {
			_storagecall_pendingset[setkey] = callid;
		}
	}
	return new Promise(function(resolve, reject) {
		// start asnc-proc49399
		var trycnt = 0;

		var call = function() {
			switch (aAction) {
				case 'clear':
						chrome.storage[aArea][aAction](check);
					break;
				case 'set':
						// special processing
						// start - block-link3191
						// make sure that each this `callid` is still responsible for setting in `aKeys`
						for (var setkey in aKeys) {
							if (_storagecall_pendingset[setkey] !== callid) {
								delete aKeys[setkey];
							}
						}
						// end - block-link3191
						if (!Object.keys(aKeys).length) resolve(); // no longer responsible, as another call to set - with the keys that this callid was responsible for - has been made, so lets say it succeeded // i `resolve` and not `reject` because, say i was still responsible for one of the keys, when that completes it will `resolve`
						else chrome.storage[aArea][aAction](aKeys, check);
					break;
				default:
					chrome.storage[aArea][aAction](aKeys, check);
			}
		};

		var check = function(arg1) {
			if (chrome.runtime.lastError) {
				if (!maxtries || trycnt++ < maxtries) setTimeout(call, timebetween);
				else reject(chrome.runtime.lastError); // `maxtries` reached
			} else {
				switch (aAction) {
					case 'clear':
					case 'remove':
							// callback `check` triggred with no arguments
							resolve();
					case 'set':
							// callback `check` triggred with no arguments - BUT special processing

							// race condition I THINK - because i think setting storage internals is async - so what if another call came in and did the set while this one was in between `call` and `check`, so meaningi t was processing - and then this finished processing AFTER a new call to `storageCall('', 'set'` happend
							// copy - block-link3191
							// make sure that each this `callid` is still responsible for setting in `aKeys`
							for (var setkey in aKeys) {
								if (_storagecall_pendingset[setkey] !== callid) {
									delete aKeys[setkey];
								}
							}
							// end copy - block-link3191

							// remove keys from `_storagecall_pendingset`
							for (var setkey in aKeys) {
								// assuming _storagecall_pendingset[setkey] === callid
								delete _storagecall_pendingset[setkey];
							}

							// SPECIAL - udpate nub.stg
							if (typeof(nub) == 'object' && nub.stg) {
								for (let setkey in aKeys) {
									if (setkey in nub.stg) nub.stg[setkey] = aKeys[setkey];
								}
							}

							resolve(aKeys);
						break;
					case 'get':
							// callback `check` triggred with 1 argument
							var stgeds = arg1;
							resolve(stgeds);
						break;
				}
				resolve(stgeds);
			}
		};

		call();
		// end asnc-proc49399
	});
}

// rev2 - https://gist.github.com/Noitidart/59ee6c306fa493a4f35fb122bcf13e99
function getBrowser() {
	function getBrowserInner() {
		// http://stackoverflow.com/a/2401861/1828637
	    var ua= navigator.userAgent, tem,
	    M= ua.match(/(opera|chrome|safari|firefox|msie|trident(?=\/))\/?\s*(\d+)/i) || [];
	    if(/trident/i.test(M[1])){
	        tem=  /\brv[ :]+(\d+)/g.exec(ua) || [];
	        return 'IE '+(tem[1] || '');
	    }
	    if(M[1]=== 'Chrome'){
	        tem= ua.match(/\b(OPR|Edge)\/(\d+)/);
	        if(tem!= null) return tem.slice(1).join(' ').replace('OPR', 'Opera');
	    }
	    M= M[2]? [M[1], M[2]]: [navigator.appName, navigator.appVersion, '-?'];
	    if((tem= ua.match(/version\/(\d+)/i))!= null) M.splice(1, 1, tem[1]);
	    return M.join(' ');
	}

	var name_version_str = getBrowserInner();
	var split = name_version_str.split(' ');
	var version = split.pop();
	var name = split.join(' ');
	return {
		name: name,
		version: version
	};
}

class PromiseBasket {
	constructor() {
		this.promises = [];
		this.thens = [];
	}
	add(aAsync, onThen) {
		// onThen is optional
		this.promises.push(aAsync);
		this.thens.push(onThen);
	}
	async run() {
		let results = await Promise.all(this.promises);
		results.forEach((r, i)=>this.thens[i] ? this.thens[i](r) : null);
		return results;
	}
}

function formatNubPaths() {

	// make relative paths, non-relative
	// and push to nub.path.chrome
	for (var relkey in nub.path) {
		if (relkey == 'chrome') continue;
		nub.path.chrome[relkey] = 'webextension/' + nub.path[relkey];
		nub.path[relkey] = chrome.runtime.getURL(nub.path[relkey]);
	}

	// prefix chrome paths
	for (var chromekey in nub.path.chrome) {
		nub.path.chrome[chromekey] = 'chrome://' + nub.self.chromemanifestkey + '/content/' + nub.path.chrome[chromekey];
	}
}

function xhrSync(url, opt={}) {
	const optdefault = {
		responseType: 'text',
		method: 'GET'
	};
	opt = Object.assign(optdefault, opt);

	if (opt.url) url = url;

	let xhreq = new XMLHttpRequest();
	xhreq.open(opt.method, url, false);
	xhreq.responseType = opt.responseType;
	xhreq.send();
}

async function promiseTimeout(milliseconds) {
	await new Promise(resolve => setTimeout(()=>resolve(), milliseconds))
}

async function doRetries(retry_ms, retry_cnt, callback) {
	// callback should return promise
	// total_time = retry_ms * retry_cnt
	for (let i=0; i<retry_cnt; i++) {
		try {
			return await callback();
			break;
		} catch(err) {
			console.warn('retry err:', err, 'attempt, i:', i);
			if (i < retry_cnt) await promiseTimeout(retry_ms);
			else throw err;
		}
	}
}
// end - cmn

preinit();
