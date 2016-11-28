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
				return 'debug remove this'; // debug
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

function triggerCommand(aArg) {
	let filename = aArg;
	console.log('exe triggering filename:', filename);
}

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
// end - addon specific helpers

preinit()
.then(val => console.log('preinit done'))
.catch(err => console.error('preinit err:', err));
