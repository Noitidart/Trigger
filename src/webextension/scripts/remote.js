// need to var, so things can access it on window
const gBgComm = new Comm.client.content(finishShake);
const callInBackground = Comm.callInX2.bind(null, gBgComm, null, null);
const callInExe = Comm.callInX2.bind(null, gBgComm, 'callInExe', null);
const callInAPort = Comm.callInX2.bind(null, gBgComm, 'callInAPort'); // first argument must be portid
const callInBootstrap = Comm.callInX2.bind(null, gBgComm, 'callInBootstrap', null);
const callInMainworker = Comm.callInX2.bind(null, gBgComm, 'callInMainworker', null);
// await in* - always returns something - meaning callback is always set
const inBackground = (method, arg) => new Promise(resolve => callInBackground(method, arg, val=>resolve(val)));
const inExe = (method, arg) => new Promise(resolve => callInExe(method, arg, val=>resolve(val)));
const inAPort = (portid, method, arg) => new Promise(resolve => callInAPort(portid, method, arg, val=>resolve(val)));
const inBootstrap = (method, arg) => new Promise(resolve => callInBootstrap(method, arg, val=>resolve(val)));
const inMainworker = (method, arg) => new Promise(resolve => callInMainworker(method, arg, val=>resolve(val)));
// callIn - allows to pass first argument as tabid
window.callInBackground = callInBackground;
window.callInExe = callInExe;
window.callInAPort = callInAPort;
window.callInBootstrap = callInBootstrap;
window.callInMainworker = callInMainworker;
const callIn = (...args) => new Promise(resolve => window['callIn' + args.shift()](...args, val=>resolve(val))); // must pass undefined for aArg if one not provided, due to my use of spread here. had to do this in case first arg is aMessageManagerOrTabId
//
const nub = {};

async function finishShake() {
    console.log('version.html handshake done');

    let data = await inBackground('getSomeNub');
    for (let entry in data) nub[entry] = data[entry];
}

async function showNotificationTemplate(name, subtitle, message) {
    // `name` - hotkey.command.content.locales[gExtLocale].name
    browser.notifications.create({
        type: 'basic',
        iconUrl: await browser.extension.getURL('images/icon48.png'),
        title: await browser.i18n.getMessage('commandcode_notiftitle', [name, subtitle]),
        message
    });
}
async function polyfillTab(tabid, polyfills=['comm', 'babel']) {
    // "babel" not yet supported
    let frames = await browser.webNavigation.getAllFrames({tabId:tabid});
    let frameids = frames.map(a_frame => a_frame.frameId); // all - privileged tabs are splicd out in the below loop
    let frameids_disallowed = [];
    if (polyfills.includes('comm')) {
        for (let frameid of frameids) {
            let hascomm;
            try {
                ([ hascomm ] = await browser.tabs.executeScript(tabid, {
                    frameId: frameid,
                    code: `typeof(gBgComm) != 'undefined'`
                }));
            } catch(ex) {
                // if (/No window matching {"all_frames":true,"matchesHost":["<all_urls>"]}/.test(ex.message)) {
                if (/No window matching.*?"matchesHost":.*?<all_urls>/i.test(ex.message)) {
                    frameids_disallowed.push(frameid);
                    continue;
                } else {
                    console.error('ex:', ex);
                    throw ex.toString(); // to string because i use this polyfillTab func in command code, and throwing object causes "Unhandled promise rejection Error: Type error for parameter options (Error processing message: Expected string instead of {}) for notifications.create." error in browser console
                }
            }

            if (!hascomm) {
                await browser.tabs.executeScript(tabid, {
                    frameId: frameid,
                    file: '/scripts/3rd/comm/webext.js'
                });
                await browser.tabs.executeScript(tabid, {
                    frameId: frameid,
                    code: `(function() {
                        gBgComm = new Comm.client.webextports('contentscript');
                        callInBackground = Comm.callInX2.bind(null, gBgComm, null, null);
                        callInExe = Comm.callInX2.bind(null, gBgComm, 'callInExe', null);
                        callInAPort = Comm.callInX2.bind(null, gBgComm, 'callInAPort'); // first argument must be portid
                        callInBootstrap = Comm.callInX2.bind(null, gBgComm, 'callInBootstrap', null);
                        callInMainworker = Comm.callInX2.bind(null, gBgComm, 'callInMainworker', null);
                        callIn = (...args) => new Promise(resolve => window['callIn' + args.shift()](...args, val=>resolve(val))); // must pass undefined for aArg if one not provided, due to my use of spread here. had to do this in case first arg is aMessageManagerOrTabId
                        // callInBackground('getTabExtProperties', undefined, function(aArg) {
                        //     __FRAMEID = aArg.frameid;
                        //     __TABID = aArg.tabid;
                        // });
                    })()`
                });
            }
        }

        frameids = frameids.filter(a_frameid => !frameids_disallowed.includes(a_frameid));
        console.log('viable frameids:', frameids);

        if (!frameids.length) throw browser.i18n.getMessage('webext_disallowedtab');
    }

    return true;
}

async function doit({name, exec}) {
    let showNotification = showNotificationTemplate.bind(null, name);
    try {
        eval(exec);
    } catch(ex) {
        // callInBackground('doBrowser', {dotpath:'i18n.getMessage', args:['error']}, function(aResult) {});
        // console.error('Trigger - Error:', ex);
        let message = ex.message;
        console['error']('Trigger :: ' + name + ' - ' + (await browser.i18n.getMessage('error')) + ':', message);
        showNotification(await browser.i18n.getMessage('error'), message);
    }
}

async function doBrowser(dotpath, ...args) {
    return await inBackground('doBrowser', { dotpath, args });
}

const browser = new Proxy({}, {
    get: function(target, name, receiver) {
        // console.log('name:', name);
        if (!(name in target)) {
            target[name] = new Proxy({}, {
                get: function(subtarget, subname, subreceiver) {
                    // console.log('subname:', subname, 'subreceiver:', subreceiver);
                    var dotpath = name + '.' + subname;
                    if (!(subname in subtarget)) {
                        subtarget[dotpath] = doBrowser.bind(null, dotpath);
                    }
                    return subtarget[dotpath];
                }
            });

        }
        return target[name]
    }
});
