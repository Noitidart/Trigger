var nub = {
	self: {
		id: chrome.runtime.id,
		version: chrome.runtime.getManifest().version,
		chromemanifestkey: 'trigger' // crossfile-link37388
		// startup_reason: string; enum[STARTUP, UPGRADE, DOWNGRADE, INSTALL]
		// old_version: set only on UPGRADE/DOWNGRADE
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
		locales: '_locales/',
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
		// defaults - keys that present in here during `preinit` are fetched on startup and maintained whenever `storageCall` with `set` is done
			// 3 types
				// prefs are prefeixed with "pref_"
				// mem are prefeixed with "mem_" - mem stands for extension specific "cookies"/"system memory"
				// filesystem-like stuff is prefixied with "fs_"
		mem_lastversion: '-1', // indicates not installed - the "last installed version"
		mem_oauth: {},
		pref_hotkeys: []
	},
	oauth: { // config
		github: {
			client_id: '588171458d360bdb2497',
			client_secret: '8d877cf13e5647f93ad42c28436e33e29aa8aa9b',
			redirect_uri: 'http://127.0.0.1/trigger_github',
			scope: 'user repo delete_repo',
			dotname: 'login', // `dotid` and `dotname` are dot paths in the `mem_oauth` entry. `dotid` is meant to point to something that uniquely identifies that account across all accounts on that oauth service's web server
			dotid: 'id'
		}
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
	// fetch storage - set nub.self.startup_reason and nub.self.old_version
	basketmain.add(
		async function() {
			// fetch storage and set always update values (keys in nub.stg)
			try {
				let stgeds = await storageCall('local', 'get', Object.keys(nub.stg));
				for (let key in stgeds) {
					nub.stg[key] = stgeds[key];
				}
			} catch(err) {
				throw { reason:'STG_CONNECT', text:err.toString() };
			}

			// set nub.self.startup_reason and old_version
			let lastversion = nub.stg.mem_lastversion;
			if (lastversion === '-1') {
				// installed / first run
				nub.self.startup_reason = 'INSTALL';
				storageCall('local', 'set', { mem_lastversion:nub.self.version })
				.then(a=>console.log('set, nub.stg:', nub.stg));
			} else if (lastversion !== nub.self.version) {
				// downgrade or upgrade
				if (isSemVer(nub.self.version, '>' + lastversion)) {
					// upgrade
					nub.self.startup_reason = 'UPGRADE';
				} else {
					// downgrade
					nub.self.startup_reason = 'DOWNGRADE';
				}
				nub.self.old_version = lastversion;
				storageCall('local', 'set', { mem_lastversion:nub.self.version })
				.then(a=>console.log('set, nub.stg:', nub.stg));
			} else {
				// lastversion === nub.self.version
				// browser startup OR enabled after having disabled
				nub.self.startup_reason = 'STARTUP';
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
							console.error('install_err:', install_err);
							throw { reason:'EXE_INSTALL', text:chrome.i18n.getMessage('startupfailed_execonnectinstall', [first_conn_err, install_err.toString()]) };
						}

						// ok installed, try re-connecting
						try {
							await new Promise((resolve, reject) => {
								gExeComm = new Comm.server.webextexe('trigger', ()=>resolve(), err=>reject(err))
							});
						} catch(re_conn_err) {
							throw { reason:'EXE_CONNECT', text:chrome.i18n.getMessage('startupfailed_execonnect', re_conn_err) };
						}
					} else {
						throw { reason:'EXE_CONNECT', text:chrome.i18n.getMessage('startupfailed_execonnect', first_conn_err) };
					}

				}

				// ok connected
				// lets verify the exe is for this version of extension, else send it exe from within for self update/downgrade
				// btw if it gets here, its not android, as if it was android it `return`ed earlier after starting worker

				// verify exe version
				let exeversion = await new Promise( resolve => callInExe('getExeVersion', undefined, val => resolve(val)) );
				console.log('exeversion:', exeversion);
				let extversion = nub.self.version;
				console.log('extversion:', extversion);
				console.log('equal?');
				if (exeversion === extversion) {
					return 'platinfo got, callInNative set, exe started, exe version is correct';
				} else {
					// version mismatch, lets fetch the exe and send it to the current exe so it can self-apply
					console.log('as not equal, am fetching exearrbuf');
					// let exearrbuf = (await xhrPromise(getNamsgExepkgPath(), { restype:'arraybuffer' })).response;
					let exearrbuf = (await xhrPromise('https://cdn2.iconfinder.com/data/icons/oxygen/48x48/actions/media-record.png', { restype:'arraybuffer' })).xhr.response;
					// let exebinarystr = new TextDecoder('utf-8').decode(new Uint8Array(exearrbuf));
					// let exebinarystr = Uint8ArrayToString(new Uint8Array(exearrbuf));
					let exebinarystr = new TextDecoder('utf-8').decode(exearrbuf);
					try {
						console.log('sending exearrbuf to exe');
						await new Promise(  (resolve, reject)=>callInExe( 'applyExe', exebinarystr, applied=>applied===true?resolve(true):reject(applied) )  );
					} catch(exe_apply_err) {
						console.error('exe_apply_err:', exe_apply_err);
						let howtofixstr = isSemVer(extversion, '>' + exeversion) ? chrome.i18n.getMessage('startupfailed_exemismatch_howtofix1') : chrome.i18n.getMessage('startupfailed_exemismatch_howtofix2');
						// throw { reason:'EXE_MISMATCH', text:chrome.i18n.getMessage('startupfailed_exemismatch', [exeversion, extversion, howtofixstr]) }; // debug: commented out
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

	switch (nub.self.startup_reason) {
		case 'STARTUP':
				// was already installed, just regular startup to enabling or browser starting up
			break;
		case 'INSTALL':
				// first run
			break;
		case 'UPGRADE':
			break;
		case 'DOWNGRADE':
			break;
	}

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
	console.log('opening menu.html now', nub.path.webext);
	// addTab(nub.path.webext);
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

// start - oauth stuff
async function openAuthTab({ serviceid, dontopen }, aReportProgress) {
	// does oauth authorization flow
	// if dontopen is true, then it doesnt open the tab, just gives you the url
	// Comm func

	let config = nub.oauth[serviceid];

	// determine url for service
	let url;
	switch (serviceid) {
		case 'github':
				url = 'https://github.com/login/oauth/authorize?' + queryStringDom({
					client_id: config.client_id,
					redirect_uri: config.redirect_uri,
					scope: config.scope,
					state: 'trigger',
					allow_signup: 'true'
				});
			break;
		default:
			throw 'Unsupported `serviceid` of "' + serviceid + '"'
	}

	if (!dontopen) addTab(url)

	return url;
}

async function oauthAuthorized({ serviceid, href, json }) {
	// href's:
		// github - http://127.0.0.1/trigger_github?code=924c82542a85ca8eb756&state=trigger

	if (json && href) throw new Error('must only provide `href` OR `json`');

	let params = json || queryStringDom(href);
	let config = nub.oauth[serviceid];

	console.log('params:', params);

	switch (serviceid) {
		case 'github': {
			// need to get an access_token

			let at = (await xhrPromise({ // access_token
				url: 'https://github.com/login/oauth/access_token',
				method: 'POST',
				headers: { Accept: 'application/json' },
				fdhdr: true,
				restype: 'json',
				data: {
					client_id: config.client_id,
					client_secret: config.client_secret,
					code: params.code,
					redirect_uri: config.redirect_uri,
					state: params.state
				}
			})).xhr;

			console.log('at.status:', at.status, 'at.response:', at.response);
			// at.status: 200 at.response: Object { access_token: "e2d262becc9f1ff72b7f1be6fb35eda2b55…", token_type: "bearer", scope: "repo,user" }
			if (at.status != 200) throw 'oauthAuthorized Error: Failed to get Github `access_token`, bad status code: ' + at.status;

			// get user name and id
			let ui = (await xhrPromise({ // user_info
				url: 'https://api.github.com/user',
				method: 'GET',
				headers: { Accept: 'application/json', Authorization:'token ' + at.response.access_token },
				fdhdr: true,
				restype: 'json',
				data: {
					client_id: config.client_id,
					client_secret: config.client_secret,
					code: params.code,
					redirect_uri: config.redirect_uri,
					state: params.state
				}
			})).xhr;

			console.log('ui.status:', ui.status, 'ui.response:', ui.response);
			// ui.status: 200 ui.response: Object { access_token: "e2d262becc9f1ff72b7f1be6fb35eda2b55…", token_type: "bearer", scope: "repo,user" }
			// Object { error: "bad_verification_code", error_description: "The code passed is incorrect or exp…", error_uri: "https://developer.github.com/v3/oau…" }
			if (ui.status != 200) throw 'oauthAuthorized Error: Failed to get Github user information, bad status code: ' + ui.status;
			if (ui.status == 200 && ui.response.error) throw 'oauthAuthorized Error: Failed to get Github user information due to error field in response: ' + ui.response.error;

			let mi = {...at.response, id:ui.response.id, login:ui.response.login}; // meminfo_for_serviceid
			console.log('mi:', mi);

			nub.stg.mem_oauth[serviceid] = mi;
			await storageCall('local', 'set', { mem_oauth:nub.stg.mem_oauth });

			break;
		}
	}
}

function oauthWebRequestListener(detail) {
	let { url, tabId:tabid, responseHeaders } = detail;

	if (!url.startsWith('http://127.0.0.1/' + nub.self.chromemanifestkey + '_')) return;

	console.error('oauthWebRequestListener, url:', url, 'detail:', detail);

	let serviceid;
	try {
		serviceid = url.match(/127.0.0.1\/.*?_(.*?)\?/)[1];
	} catch(ignore) {}

	if (serviceid) {
		oauthAuthorized({ serviceid, tabid, href:url});

		tabid = (tabid === -1 || tabid === undefined || tabid === null) ? null : tabid;

		let proc; // processing, endied, approved, error (if error i can provide parameter `msg`)
		switch(serviceid) {
			case 'github':
					proc = 'processing';
				break;
			case 'twitter':
					if (url.includes('denied=')) proc = 'denied';
					else proc = 'processing'
				break;
			default:
				if (url.includes('error=access_denied')) proc = 'denied';
				else proc = 'approved';
		}
		let redirurl = nub.path.pages + 'auth.html?serviceid=' + serviceid + '&proc=' + proc;
		console.log('redirurl:', redirurl);
		if (tabid) setTimeout(()=>chrome.tabs.update(tabid, { url:redirurl }), 0); // needed for `onCommitted` - TODO: support android for controling load in this tab
		return { cancel:true, redirectUrl:redirurl  };
	}
	else console.error('could not determine `serviceid` from url:', url);

}

browser.webRequest.onBeforeRequest.addListener(oauthWebRequestListener, { urls:['http://127.0.0.1/' + nub.self.chromemanifestkey + '_*'] }, ['blocking']); // catches when after user clicks on "Approve" it catches that redirect
// browser.webNavigation.onBeforeNavigate.addListener(oauthWebRequestListener); // this does work, if i copy and paste the url to the bar like for url "http://127.0.0.1/trigger_github?code=d8f5a084e3f6da266050&state=trigger" // user never pastes in a tab, so i dont think its needed
browser.webNavigation.onCommitted.addListener(oauthWebRequestListener); // when offline it works which is interesting. because when online it seems the request goes through in the back // catches when user goes to reauth page but is redirected immediately because they already had approved the app in the past
// end - oauth stuff

// // about page
// var aboutPageTabIds = {}
// function aboutPageListenerNavigate({url, tabId:tabid}) {
// 	if (!url.startsWith(nub.path.webext)) return;
//
// 	if (tabid === -1) return;
//
// 	let redirurl = nub.path.pages + 'app.html';
// 	console.error('doing redir now');
//
// 	aboutPageTabIds[tabid] = setTimeout(()=> {
// 		console.log('doing redir now as push state did not happen');
// 		delete aboutPageTabIds[tabid];
// 		chrome.tabs.update(tabid, { url:redirurl });
// 	}, 400);
//
// }
// function aboutPageListenerHistory({url, tabId:tabid}) {
// 	if (tabid === -1) return;
// 	aboutPageTabIds[tabid] = setTimeout(()=> {
// 		delete aboutPageTabIds[tabid];
// 	}, 400); // allow 400ms for onDOMContentLoaded to fire
// 	// if (tabid in aboutPageTabIds) {
// 	// 	clearTimeout(aboutPageTabIds[tabid]);
// 	// 	delete aboutPageTabIds[tabid];
// 	// }
// }
// function aboutPageListenerLoaded({url, tabId:tabid}) {
// 	if (tabid === -1) return;
// 	if (tabid in aboutPageTabIds) {
// 		// had push state so no need
// 		console.log('DONT redir');
// 		clearTimeout(aboutPageTabIds[tabid]);
// 		delete aboutPageTabIds[tabid];
// 	} else {
// 		// no history push, so do redir
// 		console.log('do redir');
// 		let redirurl = nub.path.pages + 'app.html';
// 		chrome.tabs.update(tabid, { url:redirurl });
// 	}
// }
// // browser.webNavigation.onBeforeNavigate.addListener(aboutPageListenerNavigate);
// browser.webNavigation.onHistoryStateUpdated.addListener(aboutPageListenerHistory);
// browser.webNavigation.onDOMContentLoaded.addListener(aboutPageListenerLoaded);
// end - about page
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

async function getExtLocales() {
	let { xhr:{response} } = await xhrPromise(nub.path.locales);

	let locales = [];
	let match, patt = /^.*? ([a-z\-]+)\//img;
	while (match = patt.exec(response))
		locales.push(match[1]);

	return locales;
}

async function getClosestAvailableLocale() {
	// gets the locale available in my extension, that is closest to the users locale
	// returns null if nothing close

	// lower case things because thats what findClosestLocale needs
	let extlocales = await getExtLocales(); // these are the available locales

	let userlocale_preferred = browser.i18n.getUILanguage(); // same as `browser.i18n.getMessage('@@ui_locale')`
	let userlocale_lesspreferred = await browser.i18n.getAcceptLanguages();

	let available = extlocales.map(el => el.toLowerCase()); // findClosestLocale needs it lower case
	let wanted = [userlocale_preferred, ...userlocale_lesspreferred]; // in order of priority
	wanted = [...new Set(wanted)]; // filter duplicates from wanted
	wanted = wanted.map(el => el.toLowerCase()); // findClosestLocale needs it lower case

	let closest = findClosestLocale(available, wanted);
	if (closest)
		return extlocales.find(el => el.toLowerCase() == closest); // return proper casing
	else
		return null;
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

// rev1 - not yet committed
function xhrPromise(url, opt={}) {

	// three ways to call
		// xhrPromise( {url, ...} )
		// xhrPromise(url, {...})
		// xhrPromise(undefined/null, {...})

	if (typeof(url) == 'object' && url && url.constructor.name == 'Object') opt = url;

	// set default options
	opt = {
		restype: 'text',
		method: 'GET',
		data: undefined,
		headers: {},
		// odd options
		reject: true,
		fdhdr: false, // stands for "Form Data Header" set to true if you want it to add Content-Type application/x-www-form-urlencoded
		// overwrite with what devuser specified
		...opt
	};
	if (opt.url) url = opt.url;

	return new Promise( (resolve, reject) => {
		let xhr = new XMLHttpRequest();

		let evf = f => ['load', 'error', 'abort', 'timeout'].forEach(f);

		let handler = ev => {
			evf(m => xhr.removeEventListener(m, handler, false));
		    switch (ev.type) {
		        case 'load':
		            	resolve({ xhr, reason:ev.type });
		            break;
		        case 'abort':
		        case 'error':
		        case 'timeout':
						console.error('ev:', ev);
						if (opt.reject) reject({ xhr, reason:ev.type });
						else resolve({ xhr, reason:ev.type });
		            break;
		        default:
					if (opt.reject) reject({ xhr, reason:'unknown', type:ev.type });
					else resolve({ xhr, reason:'unknown', type:ev.type });
		    }
		};

		evf(m => xhr.addEventListener(m, handler, false));

		xhr.open(opt.method, url, true);

		xhr.responseType = opt.restype;

		if (opt.fdhdr) opt.headers['Content-Type'] = 'application/x-www-form-urlencoded'
		for (let h in opt.headers) xhr.setRequestHeader(h, opt.headers[h]);

		if (typeof(opt.data) == 'object' && opt.data != null && opt.data.constructor.name == 'Object') opt.data = queryStringDom(opt.data);

		xhr.send(opt.data);
	});
}

function xhrSync(url, opt={}) {
	const optdefault = {
		// restype: 'text', // DOMException [InvalidAccessError: "synchronous XMLHttpRequests do not support timeout and responseType."
		method: 'GET'
	};
	opt = Object.assign(optdefault, opt);

	if (opt.url) url = url;

	let xhreq = new XMLHttpRequest();
	xhreq.open(opt.method, url, false);
	// xhreq.restype = opt.restype;
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
			if (i < retry_cnt-1) await promiseTimeout(retry_ms);
			else throw err;
		}
	}
}
function Uint8ArrayToString(arr) {
  let MAX_ARGC = 65535;
  let len = arr.length;
  let s = "";
  for (let i = 0; i < len; i += MAX_ARGC) {
    if (i + MAX_ARGC > len) {
      s += String.fromCharCode.apply(null, arr.subarray(i));
    } else {
      s += String.fromCharCode.apply(null, arr.subarray(i, i + MAX_ARGC));
    }
  }
  return s;
}

function queryStringDom(objstr, opts={}) {
	// queryString using DOM capabilities, like `new URL`

	// objstr can be obj or str
	// if obj then it does stringify
	// if str then it does parse. if str it should be a url

	if (typeof(objstr) == 'string') {
		// parse
		// is a url?
		let url;
		try {
			url = new URL(objstr);
		} catch(ignore) {}

		// if (url) objstr = objstr.substr(url.search(/[\?\#]/));
		//
		// if (objstr.startsWith('?')) objstr = objstr.substr(1);
		// if (objstr.startsWith('#')) objstr = objstr.substr(1);

		if (!url) throw new Error('Non-url not yet supported');

		let ret = {};

		let strs = [];
		if (url.search) strs.push(url.search);
		if (url.hash) strs.push(url.hash);
		if (!strs.length) throw new Error('no search or hash on this url! ' + objstr);

		strs.forEach(str => {
			// taken from queryString 4.2.3 - https://github.com/sindresorhus/query-string/blob/3ba022410dbcff27404de090b33ce9b67768c139/index.js
			str = str.trim().replace(/^(\?|#|&)/, '');
			str.split('&').forEach(function (param) {
				var parts = param.replace(/\+/g, ' ').split('=');
				// Firefox (pre 40) decodes `%3D` to `=`
				// https://github.com/sindresorhus/query-string/pull/37
				var key = parts.shift();
				var val = parts.length > 0 ? parts.join('=') : undefined;

				key = decodeURIComponent(key);

				// missing `=` should be `null`:
				// http://w3.org/TR/2012/WD-url-20120524/#collect-url-parameters
				val = val === undefined ? null : decodeURIComponent(val);

				if (ret[key] === undefined) {
					ret[key] = val;
				} else if (Array.isArray(ret[key])) {
					ret[key].push(val);
				} else {
					ret[key] = [ret[key], val];
				}
			});
		});

		return ret;
	} else {
		// stringify
		// taken from queryString github release 4.2.3 but modified out the objectAssign for Object.assign and anded encode as strict-uri-encode - https://github.com/sindresorhus/query-string/blob/3ba022410dbcff27404de090b33ce9b67768c139/index.js
		let objectAssign = Object.assign;
		let encode = str => encodeURIComponent(str).replace(/[!'()*]/g, x => `%${x.charCodeAt(0).toString(16).toUpperCase()}`);
		let obj = objstr;
		// strict-uri-encode taken from - github release 2.0.0 - https://github.com/kevva/strict-uri-encode/blob/0b2dfae92f37618e1cb5f15911bb717e45b71385/index.js

		// below
		var defaults = {
			encode: true,
			strict: true
		};

		opts = objectAssign(defaults, opts);

		return obj ? Object.keys(obj).sort().map(function (key) {
			var val = obj[key];

			if (val === undefined) {
				return '';
			}

			if (val === null) {
				return encode(key, opts);
			}

			if (Array.isArray(val)) {
				var result = [];

				val.slice().forEach(function (val2) {
					if (val2 === undefined) {
						return;
					}

					if (val2 === null) {
						result.push(encode(key, opts));
					} else {
						result.push(encode(key, opts) + '=' + encode(val2, opts));
					}
				});

				return result.join('&');
			}

			return encode(key, opts) + '=' + encode(val, opts);
		}).filter(function (x) {
			return x.length > 0;
		}).join('&') : '';
	}
}

// rev3 - https://gist.github.com/Noitidart/110c2f859db62398ae76069f4a6c5642
/**
 * Selects the closest matching locale from a list of locales.
 *
 * @param  aLocales
 *         An array of available locales
 * @param  aMatchLocales
 *         An array of prefered locales, ordered by priority. Most wanted first.
 *         Locales have to be in lowercase.
 * @return the best match for the currently selected locale
 *
 * Stolen from http://mxr.mozilla.org/mozilla-central/source/toolkit/mozapps/extensions/internal/XPIProvider.jsm
 */
function findClosestLocale(aLocales, aMatchLocales) {
  aMatchLocales = aMatchLocales;

  // Holds the best matching localized resource
  let bestmatch = null;
  // The number of locale parts it matched with
  let bestmatchcount = 0;
  // The number of locale parts in the match
  let bestpartcount = 0;

  for (let locale of aMatchLocales) {
    let lparts = locale.split("-");
    for (let localized of aLocales) {
      let found = localized.toLowerCase();
      // Exact match is returned immediately
      if (locale == found)
        return localized;

      let fparts = found.split("-");
      /* If we have found a possible match and this one isn't any longer
         then we dont need to check further. */
      if (bestmatch && fparts.length < bestmatchcount)
        continue;

      // Count the number of parts that match
      let maxmatchcount = Math.min(fparts.length, lparts.length);
      let matchcount = 0;
      while (matchcount < maxmatchcount &&
             fparts[matchcount] == lparts[matchcount])
        matchcount++;

      /* If we matched more than the last best match or matched the same and
         this locale is less specific than the last best match. */
      if (matchcount > bestmatchcount ||
         (matchcount == bestmatchcount && fparts.length < bestpartcount)) {
        bestmatch = localized;
        bestmatchcount = matchcount;
        bestpartcount = fparts.length;
      }
    }
    // If we found a valid match for this locale return it
    if (bestmatch)
      return bestmatch;
  }
  return null;
}
// end - cmn

preinit()
.then(val => console.log('preinit done'))
.catch(err => console.error('preinit err:', err));
