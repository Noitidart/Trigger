// Imports
const {classes: Cc, interfaces: Ci, manager: Cm, results: Cr, utils: Cu, Constructor: CC} = Components;
Cu.import('resource://gre/modules/osfile.jsm');
Cu.import('resource://gre/modules/Services.jsm');
Cu.import('resource://gre/modules/Timer.jsm'); // needed for babel-polyfill async/await stuff
// #includetop 'babel-polyfill'

const SELFID = '@trigger';
const CHROMEMANIFESTKEY = 'trigger'; // crossfile-link37388
const WEBEXT_OS = OS.Constants.Sys.Name.toLowerCase().startsWith('win') ? 'win' : (OS.Constants.Sys.Name.toLowerCase() == 'darwin' ? 'mac' : (OS.Constants.Sys.Name.toLowerCase())); // it can give more then "openbsd"/"linux" though // https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/runtime/PlatformOs

// Globals
var gAndroidMenus = [];

var gBgComm;
var gWkComm;
var callInBackground;
var callInExe;
var callInMainworker;

function install() {}
function uninstall(aData, aReason) {
    if (WEBEXT_OS != 'android' && aReason == ADDON_UNINSTALL) {
		uninstallNativeMessaging() // if it wasnt installed, then this will do nothing
		.then(valarr => console.log('uninstallNativeMessaging done:', valarr))
		.catch(err => console.error('uninstallNativeMessaging error:', err));
	}
}

function startup(aData, aReason) {
	// Services.scriptloader.loadSubScript('chrome://' + CHROMEMANIFESTKEY + '/content/webextension/scripts/3rd/polyfill.min.js'); // not needed because of `#includetop 'babel-polyfill'`
	Services.scriptloader.loadSubScript('chrome://' + CHROMEMANIFESTKEY + '/content/webextension/scripts/3rd/comm/webext.js');

	gBgComm = new Comm.server.webext(aData.webExtension); // starts up the webext
	callInBackground = Comm.callInX2.bind(null, gBgComm, null, null);
	callInExe = Comm.callInX2.bind(null, gBgComm, 'gExeComm', null);
}

function shutdown(aData, aReason) {
	if (aReason == APP_SHUTDOWN) return;

	shutdownAndroid(); // if its not android it wont do anything
}

// start - mainworker stuff
function startupMainworker(aArg) {
	var { path, initdata } = aArg;

	gWkComm = new Comm.server.worker(path, initdata ? ()=>initdata : undefined, undefined, onMainworkerBeforeShutdown);
	callInMainworker = Comm.callInX2.bind(null, gWkComm, null, null);

	// its lazy started, meaning it wont actually start till first call
}
async function onMainworkerBeforeShutdown() {
	let basketmain = new PromiseBasket;

	basketmain.add(
		new Promise( resolve => callInMainworker('onBeforeTerminate', undefined, aArg => resolve()) )
	);

	await basketmain.run();
}
// end - mainworker stuff

// start - android stuff
var gBrowserAction; // object; keys[title, iconpath]
var gStartedupAndroid = false;
function startupAndroid(aArg) {
	if (WEBEXT_OS != 'android') return;

	gStartedupAndroid = true;
	if (aArg.browseraction) gBrowserAction = Object.assign(aArg.browseraction, {callback:onBrowserActionClicked});
	windowListenerAndroid.register();
}

function shutdownAndroid() {

	if (WEBEXT_OS != 'android') return;
	if (!gStartedupAndroid) return;

	// Remove inserted menu entry
	for (var androidmenu of gAndroidMenus) {
		var { domwin, menuid } = androidmenu;
		domwin.NativeWindow.menu.remove(menuid);
	}
}

function addTab(aArg, aReportProgress, aComm) {
	var { url } = aArg;
	var win = Services.wm.getMostRecentWindow('navigator:browser');
	win.BrowserApp.addTab(url);
}

function onBrowserActionClicked() {
	callInBackground('onBrowserActionClicked');
}

function browserActionUpdate(aArg) {
	let updateobj = aArg;
	// updateobj - object:
		// name - string
		// checked - boolean - if `checkable` is not set to `true` though, this will have no affect
		// enabled - boolean
		// visible - boolean
		// checkable - boolean

	if (WEBEXT_OS == 'android') {
		Object.assign(gBrowserAction, updateobj);

		var l = gAndroidMenus.length;
		for (var i=0; i<l; i++) {
			var androidmenu = gAndroidMenus[i];
			let { domwin, menuid } = androidmenu;
			try { // wrap in try-catch because domwin might not exist if it was closed
				domwin.NativeWindow.menu.update(menuid, updateobj);
			} catch(ignore) {}
		}
	}
}

var windowListenerAndroid = {
	//DO NOT EDIT HERE
	onOpenWindow: function(aXULWindow) {
		// Wait for the window to finish loading
		var aDOMWindow = aXULWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindow);
		aDOMWindow.addEventListener('load', function () {
			aDOMWindow.removeEventListener('load', arguments.callee, false);
			windowListenerAndroid.loadIntoWindow(aDOMWindow);
		}, false);
	},
	onCloseWindow: function(aXULWindow) {
		if (windowListenerAndroid.windowClosed) {
			var window = aXULWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindow);
			windowListenerAndroid.windowClosed(window);
		}
	},
	onWindowTitleChange: function(aXULWindow, aNewTitle) {},
	register: function() {

		// Load into any existing windows
		var windows = Services.wm.getEnumerator(null);
		while (windows.hasMoreElements()) {
			var window = windows.getNext();
			if (window.document.readyState == 'complete') { //on startup `window.document.readyState` is `uninitialized`
				windowListenerAndroid.loadIntoWindow(window);
			} else {
				window.addEventListener('load', function () {
					window.removeEventListener('load', arguments.callee, false);
					windowListenerAndroid.loadIntoWindow(window);
				}, false);
			}
		}

		// Listen to new windows
		Services.wm.addListener(windowListenerAndroid);
	},
	unregister: function() {
		// Unload from any existing windows
		var windows = Services.wm.getEnumerator(null);
		while (windows.hasMoreElements()) {
			var window = windows.getNext();
			windowListenerAndroid.unloadFromWindow(window);
		}

		// Stop listening so future added windows dont get this attached
		Services.wm.removeListener(windowListenerAndroid);
	},
	//END - DO NOT EDIT HERE
	loadIntoWindow: function (aDOMWindow) {
		if (!aDOMWindow) { return }

            // desktop_android:insert_gui
			if (WEBEXT_OS == 'android') {
                // // android:insert_gui
				if (aDOMWindow.NativeWindow && aDOMWindow.NativeWindow.menu) {
					var menuid = aDOMWindow.NativeWindow.menu.add(gBrowserAction);
					gAndroidMenus.push({
						domwin: aDOMWindow,
						menuid
					});
				}
			}
	},
	unloadFromWindow: function (aDOMWindow) {
		if (!aDOMWindow) { return }

	},
	windowClosed: function(aDOMWindow) {
		// Remove from gAndroidMenus the entry for this aDOMWindow
		if (WEBEXT_OS == 'android') {
			var l = gAndroidMenus.length;
			for (var i=0; i<l; i++) {
				var androidmenu = gAndroidMenus[i];
				if (androidmenu.domwin == aDOMWindow) {
					gAndroidMenus.splice(i, 1);
					break;
				}
			}
		}
	}
};
// end - android stuff

// start - native messaging stuff
function getNativeMessagingSystemPaths(aArg) {
	let { manifest_name, manifest, os } = aArg;

	// either `manifest_name` OR `manifest` with `name` key filled must be provided
	// when `uninstallNativeMessaging` it passes `manifest_name`
	// when `installNativeMessaging` it passes `manifest`

	manifest_name = manifest_name || manifest.name;
	if (!manifest_name) throw new Error('must provide manifest name for getNativeMessagingSystemPaths!');

	let exe_filename = manifest_name + (os == 'win' ? '.exe' : '');
	let exe_fromdirpath = OS.Constants.Path.userApplicationDataDir;
	let exe_filepath = OS.Path.join(exe_fromdirpath, 'extension-exes', exe_filename); // path on filesystem

	let manifest_filename = manifest_name + '.json';
	let manifest_filepath;
	let manifest_fromdirpath;
	switch (os) {
		case 'win':
				manifest_fromdirpath = OS.Constants.Path.userApplicationDataDir;
				manifest_filepath = OS.Path.join(manifest_fromdirpath, 'extension-exes', manifest_filename);
			break;
		case 'mac':
				manifest_fromdirpath = OS.Path.join(OS.Constants.Path.homeDir, 'Library', 'Application Support');
				manifest_filepath = OS.Path.join(manifest_fromdirpath, 'Mozilla', 'NativeMessagingHosts', manifest_filename);
			break;
		default:
			// linux
			// openbsd
			manifest_fromdirpath = OS.Constants.Path.homeDir;
			manifest_filepath = OS.Path.join(manifest_fromdirpath, '.mozilla', 'native-messaging-hosts', manifest_filename);
	}

	let manifest_winregpath = (os != 'win' ? undefined : 'SOFTWARE\\Mozilla\\NativeMessagingHosts'); // windows registry path

	return {
		exe_fromdirpath,
		exe_filepath,

		manifest_filepath,
		manifest_fromdirpath,

		manifest_winregpath
	};
}

async function installNativeMessaging(aArg) {
	let { exe_pkgpath, manifest, os } = aArg;

	let sys = getNativeMessagingSystemPaths(aArg);
	manifest.path = sys.exe_filepath;

	Services.prefs.setCharPref('extensions.' + SELFID + '.namsg', manifest.name);

	// copy the exes
	let exe_uint8 = new Uint8Array(xhrSync(exe_pkgpath, { responseType:'arraybuffer' }).response);

	// copy the manifest
	// this is not a uint8 so it does not get neutered on write failure
	// await OS.File.makeDir(OS.Path.dirname(sys.manifest_filepath), { from:sys.manifest_fromdirpath });
	// await OS.File.writeAtomic(sys.exe_filepath, JSON.stringify(manifest), { noOverwrite:false, encoding:'utf-8' });
	await writeThenDirMT(sys.manifest_filepath, JSON.stringify(manifest), sys.manifest_fromdirpath, { noOverwrite:false, encoding:'utf-8' });

	// tested on 11/17/16 - writeThenDirMT DOES indeed neuter even on failure to write
	await OS.File.makeDir(OS.Path.dirname(sys.exe_filepath), { from:sys.exe_fromdirpath });
	await OS.File.writeAtomic(sys.exe_filepath, exe_uint8, { noOverwrite:false });
	if (os != 'win') await OS.File.setPermissions(sys.exe_filepath, { unixMode:0o4777 });

	// update registry
	if (os == 'win') {
		let wrk = Cc['@mozilla.org/windows-registry-key;1'].createInstance(Ci.nsIWindowsRegKey);
		try {
			wrk.create(wrk.ROOT_KEY_CURRENT_USER, sys.manifest_winregpath + '\\' + manifest.name, wrk.ACCESS_WRITE); // link39191
			wrk.writeStringValue('', sys.manifest_filepath);
		} finally {
			wrk.close();
		}
	}

}

async function uninstallNativeMessaging() {
	// if installed then pref is set
	let manifest_name;
	try {
		manifest_name = Services.prefs.getCharPref('extensions.' + SELFID + '.namsg');
	} catch(ex) {
		throw new Error('native messaging was never installed');
	}

	let os = WEBEXT_OS;
	let sys = getNativeMessagingSystemPaths({os, manifest_name})

	// delete manifest
	await OS.File.remove(sys.manifest_filepath, { ignorePermissions:true, ignoreAbsent:true }) // ignoreAbsent for the hell of it

	// delete exe
	// exe might fail to delete, if clicked "uninstall" from addon manager while addon was running, so connection to exe hasnt yet terminated, so trying to delete during this time gives access denied
	// try deleting 20 times, over 4000ms
	doRetries(200, 20, ()=>OS.File.remove(sys.exe_filepath, { ignorePermissions:true, ignoreAbsent:true })) // ignoreAbsent because maybe another profile already deleted it

	// if Windows then update registry
	if (os == 'win') {
		let wrk = Cc['@mozilla.org/windows-registry-key;1'].createInstance(Ci.nsIWindowsRegKey);
		try {
			wrk.open(wrk.ROOT_KEY_CURRENT_USER, sys.manifest_winregpath, wrk.ACCESS_WRITE);
			wrk.removeChild(manifest_name); // link39191
		} finally {
			wrk.close();
		}
		// NOTE: i am ignoring errors that happen during uninstall from registry
	}

	// succesfully uninstalled, so remove from pref
	Services.prefs.clearUserPref('extensions.' + SELFID + '.namsg');

	// if `exe_path` parent dir is empty, remove it, because parent dir is my own created one of "extensions-exes"
	try {
		await OS.File.removeEmptyDir(OS.Path.dirname(sys.exe_filepath));
	} catch(ex) {
		console.warn('ok so the dir is not empty')
	}
}

// start - addon functions
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
function showSystemAlert(aArg) {
	var { title, body } = aArg;

	Services.prompt.alert(Services.wm.getMostRecentWindow('navigator:browser'), title, body);
}

function setApplyBackgroundUpdates(aNewApplyBackgroundUpdates) {
	// 0 - off, 1 - respect global setting, 2 - on
	AddonManager.getAddonByID(SELFID, addon =>
		addon.applyBackgroundUpdates = aNewApplyBackgroundUpdates
	);
}

async function getAddonInfo(aAddonId=SELFID) {
	return await new Promise(resolve =>
		AddonManager.getAddonByID(aAddonId, addon =>
			resolve({
				applyBackgroundUpdates: parseInt(addon.applyBackgroundUpdates) === 1 ? (AddonManager.autoUpdateDefault ? 2 : 0) : parseInt(addon.applyBackgroundUpdates),
				updateDate: addon.updateDate.getTime()
			})
		)
	);
}

function getXPrefs(aArgs) {
	let { nametypes } = aArgs;
	let rez = {};

	// namevals should be object { [pref_string]:[pref_type]}
		// pref_type is string - string, bool, int
	// Services.prefs.PREF_STRING 32
	// Services.prefs.PREF_BOOL 128
	// Services.prefs.PREF_INT 64
	// Services.prefs.PREF_INVALID 0

	console.log('bootstrap getting namevals:', namevals);

	var getXTypeFromType = aPrefType => {
		switch (aPrefType.toLowerCase()) {
			case 'string':
				return 'Char';
			case 'number':
				return 'Int';
			case 'boolean':
				return 'Bool';
			default:
				throw new Error('invalid value for pref_type: "' + aPrefType + '"');
		}
	};

	for (let name in nametypes) {
		let type = namevals[name];
		try {
			rez[name] = Services.prefs['get' + getXTypeFromType(type) + 'Pref'](name);
		} catch(ex) {
			// pref doesnt exist
			// console.error('ex during getXXXPref, ex:', ex);
			rez[name] = null;
		}
	}

	return rez;
}

function setXPrefs(aArgs) {
	let { namevals } = aArgs;
	// namevals should be object { [pref_string]:pref_value }
		// pref_value of null means reset it

	var getXTypeFromValue = aPrefValue => {
		switch (typeof(aPrefValue)) {
			case 'string':
				return 'Char';
			case 'number':
				return 'Int';
			case 'boolean':
				return 'Bool';
			default:
				throw new Error('invalid type for aPrefValue, you probably want a string type!');
		}
	};

	for (let name in namevals) {
		let val = namevals[name];
		if (val === null) {
			Services.prefs['clearUserPref'](name);
		} else {
			Services.prefs['set' + getXTypeFromValue(val) + 'Pref'](name, val);
		}
	}
}

// start - common helper functions
function getNativeHandlePtrStr(aDOMWindow) {
	var aDOMBaseWindow = aDOMWindow.QueryInterface(Ci.nsIInterfaceRequestor)
								   .getInterface(Ci.nsIWebNavigation)
								   .QueryInterface(Ci.nsIDocShellTreeItem)
								   .treeOwner
								   .QueryInterface(Ci.nsIInterfaceRequestor)
								   .getInterface(Ci.nsIBaseWindow);
	return aDOMBaseWindow.nativeHandle;
}

// TODO: not yet comitted - rev3 - https://gist.github.com/Noitidart/5257376b54935556173e8d13c2821f4e
async function writeThenDirMT(path, contents, from, opt={}) {
	// path - platform path of file to write
	// from - platform path of dir to make from
	// contents -
	// opt - see `optd`

	// tries to writeAtomic
	// if it fails due to dirs not existing, it creates the dir
	// then writes again
	// if fail again for whatever reason it rejects with `osfileerr`
	// on success resolves with `undefined`

	let optd = {
		encoding: 'utf-8',
		noOverwrite: false
		// tmpPath: path + '.tmp'
	};

	opt = Object.assign(optd, opt);

	let writeTarget = () => OS.File.writeAtomic(path, contents, opt);

	try {
		await writeTarget();
	} catch(osfileerr) {
		if (osfileerr.becauseNoSuchFile) { // this happens when directories dont exist to it
			// TODO: verify this again: // im pretty sure i tested, if contents was a Uint8Array it will not be netuered. it is only neutered on success.
			await OS.File.makeDir(OS.Path.dirname(path), {from}); // can throw
			await writeTarget(); // can throw
		} else {
			throw osfileerr;
		}
	}
}

function xhrSync(url, opt={}) {
	const optdefault = {
		responseType: 'text',
		method: 'GET'
	};
	opt = Object.assign(optdefault, opt);

	if (opt.url) url = url;

	let xhreq = Cc['@mozilla.org/xmlextras/xmlhttprequest;1'].createInstance(Ci.nsIXMLHttpRequest);
	xhreq.open(opt.method, url, false);
	xhreq.responseType = opt.responseType;
	xhreq.send();

	return xhreq;
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
