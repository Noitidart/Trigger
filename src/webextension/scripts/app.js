let gBgComm = new Comm.client.webextports('tab');
let callInBackground = Comm.callInX2.bind(null, gBgComm, null, null);
let callInExe = Comm.callInX2.bind(null, gBgComm, 'callInExe', null);
let callInBootstrap = Comm.callInX2.bind(null, gBgComm, 'callInBootstrap', null);
let callInMainworker = Comm.callInX2.bind(null, gBgComm, 'callInMainworker', null);

let nub;
let store;

let gSupressUpdateHydrantOnce;

async function init() {
	console.error('calling fetchData with hydrant skeleton:', hydrant);
	document.title = browser.i18n.getMessage('addon_name');

	strftime = strftime.localize({
        days: browser.i18n.getMessage('days').split(' '),
        shortDays: browser.i18n.getMessage('shortDays').split(' '),
        months: browser.i18n.getMessage('months').split(' '),
        shortMonths: browser.i18n.getMessage('shortMonths').split(' '),
        AM: browser.i18n.getMessage('AM'),
        PM: browser.i18n.getMessage('PM'),
        am: browser.i18n.getMessage('am'),
        pm: browser.i18n.getMessage('pm')
    });

	// gLocale = await new Promise(resolve => callInBackground('getClosestAvailableLocale', undefined, val=>resolve(val))) || 'en-US';
	gLocale = await new Promise(resolve => callInBackground('getSelectedLocale', undefined, val=>resolve(val))) || 'en-US';
	gLocale = 'en-US'; // for now, as i havent wrote up locales support

	let data = await new Promise( resolve => callInBackground('fetchData', { hydrant, nub:1 }, val => resolve(val)) );

	nub = data.nub;

	// window.addEventListener('unload', uninit, false);

	// setup and start redux
	if (app) {
		if (hydrant) objectAssignDeep(hydrant, data.hydrant); // dont update hydrant if its undefined, otherwise it will screw up all default values for redux
		store = Redux.createStore(app);
		// if (hydrant) store.subscribe(shouldUpdateHydrant); // manually handle setting hydrant
	}

	window.history.replaceState({key:'trigger'}, browser.i18n.getMessage('addon_name'), '/');
	// window.history.replaceState({trigger:'origin'}, browser.i18n.getMessage('addon_name'), '/edit/11111111');
	// console.error('currentLocation on init:', uneval(ReactRouter.browserHistory.getCurrentLocation()));

	// render react
	ReactDOM.render(
		React.createElement(Root),
		document.body
	);

	if (typeof(focusAppPage) != 'undefined') {
		window.addEventListener('focus', focusAppPage, false);
	}
}
window.addEventListener('DOMContentLoaded', init, false);

// app page stuff
function focusAppPage() {
	// console.log('focused!!!!!!');
}

// GLOBALS
let hydrant = {
	stg: {
		// set defaults here, as if it never has been set with `storageCall('storaget', 'set')` then `fetchData` will get back an empty object
		pref_hotkeys: [],
		mem_oauth: {} // github, github_inactive
	}
};

let gLocale; // the locale in my ext, that is closest to the users locale

const GROUPS = [ // command groups
	{ id:0, text:browser.i18n.getMessage('group_nocategory') }, // must keep this as first element
	{ id:1, text:browser.i18n.getMessage('group_tabs') },
	{ id:2, text:browser.i18n.getMessage('group_websites') },
	{ id:3, text:browser.i18n.getMessage('group_unique') },
	{ id:4, text:browser.i18n.getMessage('group_keys') }
].sort((a,b) => a.id === 0 ? -1 : a.text.localeCompare(b.text)); // keep "Uncategorized" at top, and rest alpha

// GERNAL ACTIONS AND CREATORS - no specific reducer because each reducer will respect these actions
const SET_MAIN_KEYS = 'SET_MAIN_KEYS';
function setMainKeys(obj_of_mainkeys) {
	return {
		type: SET_MAIN_KEYS,
		obj_of_mainkeys
	}
}

// PAGES_STATE ACTIONS AND CREATORS AND REDUCER
// clearPageStates
const CLEAR_PAGE_STATES_IF_CHANGED = 'CLEAR_PAGE_STATES_IF_CHANGED';
function clearPageStates(pathnames, namevalues) {
	// pathnames can be a single pathname, so a string, else an array of strings
	// namevalues is a new object to replace the state with
	if (typeof(pathnames) == 'string')
		pathnames = [pathnames];

	return {
		type: CLEAR_PAGE_STATES_IF_CHANGED,
		pathnames,
		namevalues
	};
}

// loadPage - clears any saved state for the new path to load
function loadPage(pathname, namevalues) {
	// TODO: MAYBE: namevalues - what to set the pagestate to before loading, it replaces the old state with this one

	store.dispatch(clearPageStates(pathname, namevalues));

	// i dont think i need async, as the store.dispatch should complete everything synchronously
	// setTimeout(()=>ReactRouter.browserHistory.push(pathname), 0); // setTimeout so that it happens after the redux state is update is comitted, as that should happen synchronously from here // link393485
	ReactRouter.browserHistory.push(pathname);

}

// loadOldPage - load a previously loaded page, without clearing pages_state
function loadOldPage(pathname) {
	// TODO: with my current pages_state logic, if an old page occurs twice in the history, it will have the same data, i should fix that in the future
		// i also in this, erase the data of the first time it occurs in reverse, so the first instance in forwards, will have no data in pages_state

	ReactRouter.browserHistory.push(pathname);
}

// modPageState - modify a piece(s) of state within the page
const MODIFY_PAGE_STATE_IF_CHANGED = 'MODIFY_PAGE_STATE_IF_CHANGED';
function modPageState(pathname, namevalues, value) {
	// namevalues is object of names and values OR just string of name
	// link383991 NOTE: to remove something set value to undefined
	if (typeof(namevalues) == 'string')
		namevalues = { [namevalues]: value }

	if (!Object.keys(namevalues).length) throw 'ERROR(modPageState): namevalues must have at least one key';

	console.log('in modPageState');

	return {
		type: MODIFY_PAGE_STATE_IF_CHANGED,
		pathname,
		namevalues
	}
}

// reducer
function pages_state(state={}, action) {
	// NOTE: KEEP each pages object shallow
	switch (action.type) {
		case SET_MAIN_KEYS: {
			const reducer = 'pages_state';
			let { [reducer]:reduced } = action.obj_of_mainkeys;
			return reduced || state;
		}
		case CLEAR_PAGE_STATES_IF_CHANGED: {
			let { pathnames, namevalues } = action;

			let newstate_isnew = false;
			let newstate = {...state};
			for (let pathname of pathnames) {
				let pagestate = state[pathname];
				let newpagestate = namevalues;
				if (React.addons.shallowCompare({props:pagestate}, newpagestate)) {
					newstate_isnew = true;
					if (newpagestate) newstate[pathname] = newpagestate;
					else delete newstate[pathname];
				}
				// else - this pathname never had any pagestate saved, so no change, meaning newstate_isNOTnew because of this
			}

			return newstate_isnew ? newstate : state;
		}
		case MODIFY_PAGE_STATE_IF_CHANGED: {
			let { pathname, namevalues } = action;
			let pagestate = state[pathname];

			let orignamevalues = JSON.parse(JSON.stringify(namevalues)); // debug

			let newstate;
			if (!pagestate) {
				if (Object.entries(namevalues).find(([,value]) => value !== undefined))
					newstate = { ...state, [pathname]:namevalues };
				else console.warn('all values in namevalues are undefined and there is no pagestate so nothing changed really');
			} else {
				// this is why when you want to remove something from pagestate you must set to undefined link383991
				for (let [name, newvalue] of Object.entries(namevalues))
					if (pagestate[name] === newvalue)
						delete namevalues[name];

				if (Object.keys(namevalues).length)
					newstate = { ...state, [pathname]:{...pagestate, ...namevalues} }; // and also this why link383991
			}

			if (!newstate) console.warn('WARN modPageState: Nothing changed in page state of ' + pathname + '. Passed namevalues:', orignamevalues, 'Current pagestate:', pagestate);
			else console.log('OK modPageState: Something changed in page state of ' + pathname + '. new pagestate:', newstate[pathname], 'old pagestate:', pagestate);

			return newstate || state;
		}
		default:
			return state;
	}
}

// HOTKEYS ACTIONS AND CREATORS AND REDUCER
const ADD_HOTKEY = 'ADD_HOTKEY';
function addHotkey(hotkey) {
	return {
		type: ADD_HOTKEY,
		hotkey
	}
}

const REMOVE_HOTKEY = 'REMOVE_HOTKEY';
function removeHotkey(filename) {
	return {
		type: REMOVE_HOTKEY,
		filename
	}
}

const EDIT_REPLACE_HOTKEY = 'EDIT_REPLACE_HOTKEY';
function editHotkey(hotkey, oldfilename) {
	// this really is a fully replacement of the hotkey
	// pass in oldfilename only if the filename changed so i can find the old entry
	return {
		type: EDIT_REPLACE_HOTKEY,
		hotkey,
		oldfilename
	}
}

function hotkeys(state=hydrant.stg.pref_hotkeys, action) {
	switch (action.type) {
		case SET_MAIN_KEYS: {
			const reducer = 'hotkeys';
			let { [reducer]:reduced } = action.obj_of_mainkeys;
			return reduced || state;
		}
		case ADD_HOTKEY: {
			let { hotkey } = action;

			let newstate = [...state, hotkey];

			callInBackground('storageCall', {aArea:'local',aAction:'set',aKeys:{
				pref_hotkeys: newstate
			}});

			return newstate;
		}
		case REMOVE_HOTKEY: {
			let { filename } = action;

			let newstate = state.filter(a_hotkey => a_hotkey.command.filename != filename);

			callInBackground('storageCall', {aArea:'local',aAction:'set',aKeys:{
				pref_hotkeys: newstate
			}});

			return newstate;
		}
		case EDIT_REPLACE_HOTKEY: {
			let { hotkey, oldfilename } = action;
			let { filename } = hotkey.command;

			let findfilename = oldfilename || filename;
			let newstate = state.map(a_hotkey => a_hotkey.command.filename != findfilename ? a_hotkey : hotkey);

			callInBackground('storageCall', {aArea:'local',aAction:'set',aKeys:{
				pref_hotkeys: newstate
			}});

			return newstate;
		}
		default:
			return state;
	}
}

// OAUTH ACTIONS AND CREATORS AND REDUCER
const FORGET_AUTH = 'FORGET_AUTH';
function forgetAuth(serviceid) {
	return {
		type: FORGET_AUTH,
		serviceid
	}
}
function oauth(state=hydrant.stg.mem_oauth, action) {
	switch (action.type) {
		case SET_MAIN_KEYS:
			const reducer = 'oauth';
			let { [reducer]:reduced } = action.obj_of_mainkeys;
			return reduced || state;
		case FORGET_AUTH:
			let { serviceid } = action;

			let newstate = { ...state };
			delete newstate[serviceid];

			callInBackground('storageCall', { aArea:'local',aAction:'set',aKeys:{
				mem_oauth: newstate
			} });

			return newstate;
		default:
			return state;
	}
}

let app = Redux.combineReducers({
	hotkeys,
	oauth,
	pages_state
});

/* HotkeyStruct -
{
	enabled: false,
	combo: [], // remote_htk does not have
	// code is in filename_code.js
	command: CommandStruct
}
*/
/* CommandStruct - RemoteCommandStruct is same as this, except it has some '_' prefixed keys
{
	filename: '', // generated based on filename's available on server // just a random hash // if not yet verified with server (meaning not yet shared) this is prefexed with `_`
	file_sha, // not there if edited & unshared edits
	base_file_sha, // only there if edited & unshared edits
	share_unix, // moving to share_unix instead of file_sha because file_sha does not help me with anything. my original hope was that file_sha would help me get the version number, but fetching versions from github gives me commit_sha. i would have to do another xhr on each commit_sha to get the file_sha.
	base_share_unix,
	changes_since_base: {'group':1, 'locale':{a:[],r:[],u:[]}, 'code':1} // only there if has base_file_sha and edited & unshared edits // if no base_file_sha then this is all new stuff
	content: {
		group:
		locales: {
			'en-US': {
				name, description
			}
		},
		code: {
			exec // in future, maybe `init, uninit`
		}
	}
}
*/

// REACT COMPONENTS - PRESENTATIONAL
const Root = () => React.createElement(ReactRedux.Provider, { store },
	React.createElement(ReactRouter.Router, { history:ReactRouter.browserHistory },
		React.createElement(ReactRouter.Route, { path:'/', component:App },
			React.createElement(ReactRouter.IndexRoute, { component:PageMyHotkeys }),
			React.createElement(ReactRouter.Route, { path:'edit/(:filename)', component:PageCommandForm }),
			React.createElement(ReactRouter.Route, { path:'versions/(:filename)', component:PageVersions }),
			React.createElement(ReactRouter.Route, { path:'add', component:PageAddCommand }),
			React.createElement(ReactRouter.Route, { path:'add/browse', component:PageCommunity }),
			React.createElement(ReactRouter.Route, { path:'add/create', component:PageCommandForm }),
			React.createElement(ReactRouter.Route, { path:'*', component:PageInvalid })
		)
	)
);

const App = React.createClass({
	displayName: 'App',
	render() {
		let { location:{pathname, params}, children } = this.props; // router props
		console.log('app props:', this.props);

		return React.createElement('div', { id:'app', className:'app container' },
			React.createElement(Header, { pathname, params }),
			children
		);
	}
});
// start - Header
const Header = React.createClass({
	displayName: 'Header',
	render() {
		let { pathname, params } = this.props;

		let pathcrumbs = {
			'/': ['myhotkeys'],
			'/add': ['myhotkeys', 'addcommand'],
			'/add/browse': ['myhotkeys', 'addcommand', 'community'],
			'/add/create': ['myhotkeys', 'addcommand', 'createcommand'],
			// '/edit': ['myhotkeys', 'editcommand'],
			// '/versions': ['myhotkeys', 'versionscommand']
		};
		// special cases
		let special = /(edit|versions)\/(_?[a-z0-9]{8})/.exec(pathname)
		if (special) {
			let [, subcrumb, filename] = special;
			let hotkey = store.getState().hotkeys.find(a_hotkey => a_hotkey.command.filename == filename);
			let { name } = hotkey.command.content.locales[gLocale]; // TODO: multilocale
			pathcrumbs[pathname] = ['myhotkeys', browser.i18n.getMessage(`crumb_${subcrumb}command`, name)]
		}

		let crumbs = pathcrumbs[pathname] || ['invalid'];

		// localize it and wrap it <small>
		crumbs.forEach( (crumb, i, arr) =>
			arr[i] = React.createElement( 'small', { style:{whiteSpace:'no-wrap'} }, (browser.i18n.getMessage('crumb_' + crumb) || crumb) )
		);

		if (crumbs.length > 1)
			pushAlternatingRepeating(crumbs, React.createElement('small', { style:{whiteSpace:'normal'} }, ' > ') );

		return React.createElement('div', { className:'row' },
			React.createElement('div', { className:'col-lg-12' },
				React.createElement('h1', { className:'page-header' },
					'Trigger',
					' ',
					...crumbs
				)
			)
		);
	}
});
// end - Header
// start - PageMyHotkeys and related components
const PageMyHotkeys = ReactRedux.connect(
	function(state, ownProps) {
		return {
			hotkeys: state.hotkeys
		}
	}
)(React.createClass({
	displayName: 'PageMyHotkeys',
	render() {
		let { hotkeys } = this.props;

		return React.createElement('span', undefined,
			// controls
			React.createElement('div', { className:'row text-center' },
				React.createElement('div', { className:'col-lg-12' },
					browser.i18n.getMessage('myhotkeys_page_description'),
					React.createElement('br'),
					React.createElement('br'),
					React.createElement(OauthManager)
				)
			),
			React.createElement('hr'),
			// content
			React.createElement('div', { className:'row text-center' },
				...hotkeys.map(hotkey => React.createElement(Hotkey, { hotkey, key:hotkey.command.filename })),
				React.createElement(HotkeyAdd)
			),
			React.createElement('hr')
		);
	}
}));

// hotkey elements
const Hotkey = React.createClass({
	displayName: 'Hotkey',
	trash(e) {
		// trash hotkey and command
		if (!stopClickAndCheck0(e)) return;
		let { hotkey:{command:{filename}} } = this.props;
		store.dispatch(removeHotkey(filename));
	},
	edit(e) {
		// edit command
		if (!stopClickAndCheck0(e)) return;
		let { hotkey } = this.props;
		let { hotkey:{command:{filename}} } = this.props;
		// loadPage('/edit/' + filename, { testing:genFilename() });
		loadPage('/edit/' + filename);
	},
	share: async function(e) {
		// share command
		if (!stopClickAndCheck0(e)) return;

		let { hotkey } = this.props;
		let { command } = hotkey;
		let { filename } = command;

		// let oc = nub.oauth.github; // oauth_config
		let mos = store.getState().oauth.github; //mem_oauth_serviceid
		if (!mos) {
			if (confirm(browser.i18n.getMessage('github_auth_needed')))
				callInBackground('openAuthTab', { serviceid:'github' });
			return;
		}

		let hotkey_withnewcommand = JSON.parse(JSON.stringify(hotkey));
		let newcommand = hotkey_withnewcommand.command;

		try {
			// step 1 - delete repo
			// `https://api.github.com/repos/${mos.dotname}/testapi`
			// gives 204 when done. or 404 if it wasnt there meaning nothing to delete
			await xhrPromise(`https://api.github.com/repos/${mos.login}/Trigger-Community`, { method:'DELETE', headers:{ Accept:'application/vnd.github.v3+json', Authorization:'token ' + mos.access_token } });

			// step 2 - fork it - 202 after forked - even if already forked it gives 202
			// https://api.github.com/repos/Noitidart/testapi/forks
			let xpfork = await xhrPromise('https://api.github.com/repos/Noitidart/Trigger-Community/forks', { method:'POST', headers:{ Accept:'application/vnd.github.v3+json', Authorization:'token ' + mos.access_token } });
			console.log('xpfork:', xpfork);
			if (xpfork.xhr.status !== 202)
				throw 'Failed to do step "Pull Request Step 2 - Fork Repo"';

			// step 2.1 - need to wait till fork completes - i do 1min - docs say it can take up to 5, if more then that they say contact support
			// http://stackoverflow.com/a/33667417/1828637
			// (new Date()).toISOString().replace(/\.\d+Z/,'Z')
			// https://api.github.com/repos/noitdev/testapi/commits?since=2016-11-20T06:14:02Z
			// if get 409 then not yet done. wait till get 200
			await doRetries(1000, 60, async function() {
				let data = queryStringDom({ since: (new Date()).toISOString().replace(/\.\d+Z/,'Z') });
				let xpwait = await xhrPromise(`https://api.github.com/repos/${mos.login}/Trigger-Community/commits?${data}`, { headers:{ Accept:'application/vnd.github.v3+json' } });
				console.log('xpwait:', xpwait);
				if (xpwait.xhr.status !== 200) throw 'Failed to do step "Pull Request Step 2.1 - Wait Fork Finish"';
			});

			// step 3 - create/update file
			let prtitle;

			for (let goto=0; goto<1; goto++) {
				if (filename.startsWith('_')) {
				// if (pref_hotkey.file_sha) 'No changes made! actually it can be new one created' THAT's why i prefix with `_` instead of `if (!pref_hotkey.base_file_sha && !pref_hotkey.file_sha)` // NOTE:
					// never shared yet
					prtitle = prtitle || 'Add new command';

					// step 3a.1
					// check if filename exists - so getting avaialble filename as newfilename
					// `https://api.github.com/repos/noitdev/testapi/contents/${newfilename}-code.json`
					let newfilename = filename.substr(1);
					while (true) {
						let xpexists = await xhrPromise(`https://api.github.com/repos/${mos.login}/Trigger-Community/contents/${newfilename}.json`, { headers:{ Accept:'application/vnd.github.v3+json' } });
						console.log('xpexists:', xpexists);
						if (xpexists.xhr.status === 404) break; // newfilename is not taken
						newfilename = genFilename();
						await promiseTimeout(200);
					}
					newcommand.filename = newfilename;

					// step 3a.2 - create file
					// create commit_message
					let commit_message = {
						type: 'new',
						filename: newfilename,
						unix: await getUnixTime(),
						code:1,
						group:1,
						locale: {
							a: Object.keys(command.content.locales)
							// a: Object.keys(pref_hotkey.command.content.locale).filter( locale => (command.content.locales[locale].name || command.content.locales[locale].description) ) // remove if both name AND desc are blank // TODO: when i implement locales, this removal should be redundant, as if both are blank, i should not insert it into the `command.content.locale` object
						}
					};
					console.log('commit_message:', commit_message);

					let xpcreate = await xhrPromise({
						url: `https://api.github.com/repos/${mos.login}/Trigger-Community/contents/${newfilename}.json`,
						method: 'PUT',
						restype: 'json',
						data: JSON.stringify({
							message: btoa(JSON.stringify(commit_message)),
							content: btoa(JSON.stringify(command.content))
						}),
						headers: {
							Accept: 'application/vnd.github.v3+json',
							Authorization: 'token ' + mos.access_token
						}
					});
					console.log('xpcreate:', xpcreate);
					if (xpcreate.xhr.status !== 201) {
						throw 'Failed to do step "Pull Request Step 3a.2 - Create File"';
					} else {
						let file_sha = xpcreate.xhr.response.content.sha;
						// delete newcommand.base_file_sha; // doesnt have base_commit_sha as this is "never shared yet"
						// delete newcommand.base_share_unix; // doesnt have base_commit_sha as this is "never shared yet"
						// delete newcommand.changes_since_base; // doesnt have base_commit_sha as this is "never shared yet"
						newcommand.file_sha = file_sha;
						newcommand.share_unix = commit_message.unix;
					}
				} else {
					// update file

					// if (!command.changes_since_base) throw 'You made no changes since last update, nothing to share!'

					// step 3b.1 get sha of file - actually get contents so i can calculate changes
					let xpsha = await xhrPromise(`https://api.github.com/repos/${mos.login}/Trigger-Community/contents/${filename}.json`, { restype:'json', headers:{ Accept:'application/vnd.github.v3+json' } });
					console.log('xpsha:', xpsha);
					if (xpsha.xhr.status === 404) {
						// gives 404 if user created THEN shared THEN before i accept pull request user edited and shared another update
						// not an issue if already initiall accepted pr, it will just come in as another update
						// so repeat step 3 but as "brand new local going to"
						prtitle = 'Add new command again - initial PR was not yet accepted';
						filename = '_' + filename;
						goto--; // goto = -1;
						continue;
					}
					if (xpsha.xhr.status !== 200) throw 'Failed to do step "Pull Request Step 3b.1 - Get "${filename}" File SHA and Compare Master Contents"';
					let { sha:master_file_sha, content:master_content} = xpsha.xhr.response;
					// let base_file_sha = command.base_file_sha;
					let use_file_sha = master_file_sha; // TODO: can do experiement, see how it affects it. im thinking maybe the PR gets inserted between? i dont know, but i think it makes more sense to update master as i only want a single version (and local versions) out there online.
					master_content = JSON.parse(atob(master_content));
					console.log('master_content:', master_content);

					let changes_since_master = calcCommandChanges(command.content, master_content);
					if (!changes_since_master)
						throw 'No changes between your command and the most recent command in the community'

					prtitle = 'Update command ' + Object.keys(changes_since_master).sort().join(', ');

					// step 3b.2 - update file
					let commit_message = {
						type: 'update',
						filename,
						unix: await getUnixTime(),
						...changes_since_master
					};
					console.log('commit_message:', commit_message);

					let xpupdate = await xhrPromise({
						url: `https://api.github.com/repos/${mos.login}/Trigger-Community/contents/${filename}.json`,
						method: 'PUT',
						restype: 'json',
						data: JSON.stringify({
							message: btoa(JSON.stringify(commit_message)),
							content: btoa(JSON.stringify(command.content)),
							sha: use_file_sha
						}),
						headers: {
							Accept: 'application/vnd.github.v3+json',
							Authorization: 'token ' + mos.access_token
						}
					});
					console.log('xpupdate:', xpupdate);
					if (xpupdate.xhr.status !== 200) {
						throw 'Failed to do step "Pull Request Step 3b.2 - Update File"';
					} else {
						let file_sha = xpupdate.xhr.response.content.sha;
						delete newcommand.base_file_sha;
						delete newcommand.base_share_unix;
						// delete newcommand.changes_since_base;
						newcommand.file_sha = file_sha;
						newcommand.share_unix = commit_message.unix;
					}
				}
			}

			// step 4 - create pull request
			// https://api.github.com/repos/Noitidart/testapi/pulls
			let xppr = await xhrPromise({
				url: 'https://api.github.com/repos/Noitidart/Trigger-Community/pulls',
				method: 'POST',
				restype: 'json',
				data: JSON.stringify({
					title: prtitle,
					body: 'see title',
					head: `${mos.login}:master`,
					base: 'master'
				}),
				headers: {
					Accept: 'application/vnd.github.v3+json',
					Authorization: 'token ' + mos.access_token
				}
			});
			console.log('xppr:', xppr);
			if (xppr.xhr.status !== 201)
				throw 'Failed to do step "Pull Request Step 4 - Create Request"';

			let { html_url:prurl } = xppr.xhr.response;

			// `https://api.github.com/repos/${mos.dotname}/testapi`
			// gives 204 when done - if it errors here i dont care
			try {
				await xhrPromise(`https://api.github.com/repos/${mos.login}/Trigger-Community`, { method:'DELETE', headers:{ Accept:'application/vnd.github.v3+json', Authorization:'token ' + mos.access_token } });
			} catch(ignore) {}

			/////// ok pull request creation complete - update store and storage
			// the reducer will update storage
			store.dispatch(editHotkey(hotkey_withnewcommand, command.filename));

			if (confirm(browser.i18n.getMessage('github_shared_success')))
				callInBackground('addTab', prurl);
		} catch(ex) {
			console['error'](browser.i18n.getMessage('github_shared_fail', [ex]));
			alert(browser.i18n.getMessage('github_shared_fail', [ex]))
		}
	},
	render() {
		let { hotkey } = this.props;

		let { enabled, combo, command } = hotkey;
		let { share_unix, filename, content:{group, locales:{[gLocale]:{name, description}}, code:{exec:code}} } = command; // TODO: multilocale
		// share_unix, filename, group, name, description, code

		let combotxt;
		let hashotkey = true;
		if (!combo || !combo.length) {
			combotxt = browser.i18n.getMessage('NO_HOTKEY');
			hashotkey = false;
		}

		let islocal = filename.startsWith('_'); // is something that was never submited to github yet
		// cant use `locale.file_sha` and `code.file_sha` to determine `islocal`, as it might be edited and not yet shared
		// it also CAN be shared but not yet PR merged

		let isshared = (!islocal && share_unix); // if has share_unix, it doesnt have base_share_unix. base_share_unix would indicate that a remotecommand was locally edited

		let isupdated = islocal ? true : true; // TODO: if its not local, i need to check if its updated, maybe add a button for "check for updates"?

		let isenabled = enabled;

		return React.createElement('div', { className:'col-md-3 col-sm-6 hero-feature' },
			React.createElement('div', { className:'thumbnail' },
				// React.createElement('img', { src:'http://placehold.it/800x500', alt:'' }),
				React.createElement('div', { className:'caption' },
					React.createElement('h3', undefined,
						combotxt
					),
					React.createElement('p', undefined,
						name
					),
					React.createElement('p', undefined,
						React.createElement('a', { href:'#', className:'btn btn-' + (!hashotkey ? 'warning' : 'default'), 'data-tooltip':browser.i18n.getMessage(hashotkey ? 'tooltip_changehotkey' : 'tooltip_sethotkey') },
							React.createElement('span', { className:'glyphicon glyphicon-refresh' })
						),
						' ',
						React.createElement('a', { href:'#', className:'btn btn-default', 'data-tooltip':browser.i18n.getMessage('tooltip_editcommand'), onClick:this.edit },
							React.createElement('span', { className:'glyphicon glyphicon-pencil' })
						),
						hashotkey && ' ',
						hashotkey && React.createElement('a', { href:'#', className:'btn btn-' + (isenabled ? 'default' : 'danger'), 'data-tooltip':browser.i18n.getMessage(isenabled ? 'tooltip_disablehotkey' : 'tooltip_enablehotkey') },
							React.createElement('span', { className:'glyphicon glyphicon-off' })
						),
						' ',
						React.createElement('a', { href:'#', className:'btn btn-default', 'data-tooltip':browser.i18n.getMessage('tooltip_removehotkeycommand'), onClick:this.trash },
							React.createElement('span', { className:'glyphicon glyphicon-trash' })
						),
						!isshared && ' ',
						!isshared && React.createElement('a', { href:'#', className:'btn btn-default', 'data-tooltip':browser.i18n.getMessage('tooltip_sharecommand'), onClick:this.share },
							React.createElement('span', { className:'glyphicon glyphicon-globe' })
						),
						!isupdated && ' ',
						!isupdated && React.createElement('a', { href:'#', className:'btn btn-info', 'data-tooltip':browser.i18n.getMessage('tooltip_updatecommand')},
							React.createElement('span', { className:'glyphicon glyphicon-download' })
						)
					)
				)
			)
		);
	}
});

let HotkeyAdd = React.createClass({
	displayName: 'HotkeyAdd',
	loadAdd: e => stopClickAndCheck0(e) ? loadPage('/add') : null,
	render() {
		return React.createElement('div', { className:'col-md-3 col-sm-6 hero-feature hotkey-add' },
			React.createElement('div', { className:'thumbnail' },
				// React.createElement('img', { src:'http://placehold.it/800x500', alt:'' }),
				React.createElement('div', { className:'caption' },
					React.createElement('p'),
					React.createElement('p', undefined,
						React.createElement('a', { href:'#', className:'btn btn-default', onClick:this.loadAdd },
							React.createElement('span', { className:'glyphicon glyphicon-plus' })
						)
					)
				)
			)
		);
	}
});

// oauth manager
const OauthManager = ReactRedux.connect(
	function(state, ownProps) {
		return {
			oauth: state.oauth
		}
	},
	function(dispatch, ownProps) {
		return {
			doForget: serviceid => dispatch(forgetAuth(serviceid)),
			doAuth: serviceid => callInBackground('openAuthTab', { serviceid })
		}
	}
)(React.createClass({
	displayName: 'OauthManager',
	render() {
		let { oauth } = this.props; // mapped state
		let { doForget, doAuth } = this.props; // mapped dispatchers
		// rels.push('Manage your collection of hotkeys here. You can browse the community shared commands by click "Add" and then "Community". You can create your own custom commands and share it with the community.');
		// rels.push(React.createElement('br'));
		// rels.push(React.createElement('br'));

		return React.createElement('div', { className:'oauth-manager' },
			browser.i18n.getMessage('oauth_manager_description'),
			Object.entries(nub.oauth).map( ([serviceid, config]) => React.createElement(OauthManagerRow, { serviceid, config, auth:oauth[serviceid], doForget, doAuth }) )
		);
	}
}));

const OauthManagerRow = ({serviceid, config, auth, doForget, doAuth}) => {
	// auth - authorization details for serviceid, user may not have authorized so it will be missing

	let onClick = e => {
		if (!stopClickAndCheck0(e)) return;

		if (auth) doForget(serviceid);
		else doAuth(serviceid);

		e.target.blur();
	};

	return React.createElement('div', { className:'oauth-manager-row' },
		React.createElement('img', { src:`../images/${serviceid}.png` }),
		React.createElement('span', { style:{margin:'0 5px', fontStyle:(auth || 'italic')} },
			(!auth ? '(no account)' : deepAccessUsingString(auth, config.dotname))
		),
		React.createElement('span', { className:'oauth-manager-row-spacer' }),
		React.createElement('a', { href:'#', className:'btn btn-default btn-sm', onClick },
			React.createElement('span', { className:'glyphicon glyphicon-' + (auth ? 'minus-sign' : 'plus-sign') }),
			' ' + browser.i18n.getMessage(auth ? 'forget_account' : 'authorize_account')
		)
	);
}
// end - PageMyHotkeys
// start - PageCommandForm
const PageCommandForm = ReactRedux.connect(
	function(state, ownProps) {
		let { location:{pathname}, params:{filename} } = ownProps; // router
		let { hotkeys } = state; // state
		return {
			// NOTE: never feed in fully pagestate, like line below, just select the stuff from pagestate that this component needs
			// pagestate: state.pages_state[ownProps.location.pathname],
			...(pathname.startsWith('/edit/') ? {hotkey:hotkeys.find(({command:{filename:a_filename}})=>a_filename == filename)} : {}) // hotkey
		}
	}
	// function(dispatch, ownProps) {
	// 	return {
	// 		// back: e => stopClickAndCheck0(e) ? dispatch(prevPage()) : undefined,
	// 		// savehtk: e => stopClickAndCheck0(e) ? dispatch(prevPage()) : undefined
	// 	}
	// }
)(React.createClass({
	displayName: 'PageCommandForm',
	goBack(e) {
		if (!stopClickAndCheck0(e)) return;

		let { location:{pathname} } = this.props;

		let backpath = '/';
		if (pathname == '/add/create') backpath = '/add';
		// else backpath = '/'; // pathname == '/edit'

		loadOldPage(backpath);
	},
	validateForm: async function() {
		console.log('in validateForm');

		let { hotkey } = this.props; // mapped state
		// hotkey is undefined, unless `iseditpage` is true
		let { location:{pathname} } = this.props; // router

		let iseditpage = !!hotkey;

		let isvalid = true; // new

		// test to set isvalid false if soemthing blank
		let domvalues = getFormValues(['name', 'description', 'code']);
		for (let [domid, domvalue] of Object.entries(domvalues)) {
			if (!domvalue.length) {
				isvalid = false;
				break;
			}
		}

		// test to set isvalid false if something unchanged
		if (isvalid && iseditpage) {
			// beautify the code
			code = await new Promise(resolve => callInBootstrap('beautifyText', { js:code }, val=>resolve(val)));

			// if edit, make sure at least one value is changed
			Object.assign(domvalues, getFormValues(['group']));

			let { group, locales:{[gLocale]:{name,description}}, code:{exec:code} } = hotkey.command.content; // TODO: multilocale point
			let hotkeyvalues = { group, name, description, code };

			if(!React.addons.shallowCompare({props:hotkeyvalues}, domvalues))
				isvalid = false;
		}

		console.log('dispatching modPageState with isvalid:', isvalid);

		store.dispatch(modPageState(pathname, { isvalid })); // modPageState does the difference check, if nothing in namevalues is changed it doesnt update

	},
	beautifyCode(e) {
		if (!stopClickAndCheck0(e)) return;
		let domel = document.getElementById('code');
		let js = domel.value;
		callInBootstrap('beautifyText', { js }, beautified => domel.value = beautified);
	},
	revertCode(e) {
		let { hotkey } = this.props; // mapped state
		let iseditpage = !!hotkey;
		if (!stopClickAndCheck0(e) || !iseditpage) return;

		document.getElementById('code').value = hotkey.command.content.code.exec;
	},
	render() {
		let { hotkey, isvalid } = this.props; // mapped state
		// hotkey is undefined, unless `iseditpage` is true
		let { location:{pathname} } = this.props; // router
		// pathname - needed for SaveCommandBtn so it can get `isvalid` from right `pages_state`
		let iseditpage = !!hotkey;

		// default values for form fields
		let name, description, code, group=0; // default group "Uncategorized"
		if (iseditpage) // take from `hotkey`
			({ group, locales:{[gLocale]:{name,description}}, code:{exec:code} } = hotkey.command.content);

		return React.createElement('span', undefined,
			// controls
			React.createElement('div', { className:'row text-center' },
				React.createElement('div', { className:'col-lg-12' },
					React.createElement('a', { href:'#', className:'btn btn-default pull-left', onClick:this.goBack},
						React.createElement('span', { className:'glyphicon glyphicon-triangle-left' }),
						' ' + browser.i18n.getMessage('back')
					),
					React.createElement(SaveCommandBtn, { pathname, iseditpage, hotkey })
				)
			),
			React.createElement('hr'),
			// content
			React.createElement('div', { className:'row text-center' },
				React.createElement('form', undefined,
					React.createElement('div', { className:'input-group' },
						React.createElement('span', { className:'input-group-addon' },
							browser.i18n.getMessage('group')
						),
						React.createElement('input', { className:'form-control', type:'text', style:{display:'none'} }),
						React.createElement('select', { className:'form-control', id:'group', defaultValue:group, onChange:this.validateForm },
							GROUPS.map( ({id:value, text}) => React.createElement('option', { value }, text) )
						)
					),

					React.createElement('br'),
					React.createElement('div', { className:'input-group' },
						React.createElement('span', { className:'input-group-addon' },
							browser.i18n.getMessage('name')
						),
						React.createElement('input', { className:'form-control', type:'text', id:'name', defaultValue:name, onChange:this.validateForm }),
						React.createElement(LocalePicker, { onChange:this.validateForm })
					),

					React.createElement('br'),
					React.createElement('div', { className:'input-group' },
						React.createElement('span', { className:'input-group-addon' },
							browser.i18n.getMessage('description')
						),
						React.createElement('input', { className:'form-control', type:'text', id:'description', defaultValue:description, onChange:this.validateForm }),
						React.createElement(LocalePicker, { onChange:this.validateForm })
					),

					React.createElement('br'),
					React.createElement('div', { className:'input-group' },
						React.createElement('span', { className:'input-group-addon', style:{verticalAlign:'top', paddingTop:'9px'} },
							browser.i18n.getMessage('code'),
							React.createElement('br'),
							React.createElement('br'),
							React.createElement('div', { className:'btn-group' },
								React.createElement('a', { href:'#', className:'btn btn-default btn-sm', 'data-tooltip':browser.i18n.getMessage('tooltip_beautify'), onClick:this.beautifyCode, tabIndex:'-1' },
									React.createElement('span', { className:'glyphicon glyphicon-console' })
								),
								iseditpage && React.createElement('a', { href:'#', className:'btn btn-default btn-sm', 'data-tooltip':browser.i18n.getMessage('tooltip_revert'), onClick:this.revertCode, tabIndex:'-1' },
									React.createElement('span', { className:'glyphicon glyphicon-repeat' })
								)
							)
						),
						React.createElement('input', { className:'form-control', type:'text', style:{display:'none'} }),
						React.createElement('div', { className:'form-group' },
							React.createElement('textarea', { className:'form-control', id:'code', defaultValue:code, style:{resize:'vertical',minHeight:'100px'}, onChange:this.validateForm })
						)
					)
				)
			),
			React.createElement('hr')
		);
	}
}));

const SaveCommandBtn = ReactRedux.connect(
	// ownProps
		// hotkey - used to get command, combo, and enabled values when doing editHotkey. will obviously be undefined if is not `iseditpage`
		// pathname - used to get `pagestate` for `isvalid`
		// iseditpage - even though `pathname` is provided, i already calc this value in parent component so just send it
	function(state, ownProps) {
		let { pathname } = ownProps;
		let pagestate = state.pages_state[pathname] || {};

		return {
			isvalid: pagestate.isvalid
		}
	}
)(React.createClass({
	displayName: 'SaveCommandBtn',
	onClick: async function(e) {
		if (!stopClickAndCheck0(e)) return;

		let { isvalid } = this.props; // mapped state
		if (!isvalid) return;

		let { iseditpage, hotkey } = this.props;

		let { command } = hotkey || {};
		let filename = iseditpage ? command.filename : '_' + genFilename(); // TODO: ideally i should make sure no other local hotkey shares this filename

		let domvalues = getFormValues(['name', 'description', 'code', 'group']);
		let newcommand = {
			// changes_since_base // added below if it is edit of isgitfile (!islocal)
			// base_file_sha // added below if it is edit of isgitfile (!islocal)
			// file_sha
			// base_share_unix
			// file_unix
			filename,
			content: {
				group: domvalues.group,
				locales: {
					'en-US': {
						name: domvalues.name,
						description: domvalues.description
					}
				},
				code: {
					exec: await new Promise(resolve => callInBootstrap('beautifyText', { js:domvalues.code }, val=>resolve(val)))
				}
			}
		};

		let isreallyedited = false;
		if (iseditpage) {
			// lets make sure something really changed
			// and collect that into changes_since_base if necessary
			if (JSON.stringify(newcommand.content) != JSON.stringify(command.content)) {
				isreallyedited = true;

				// is there a gitfile? if so then set the git properies of `base_file_sha` and `changes_since_base`
				let islocal = filename.startsWith('_'); // newhotkey.name is same as filename as this is not something copied even if isreallyedited
				if (!islocal) {
					// ok isgitfile
					let { content:newcontent } = newcommand;
					let { content } = command;

					// set `base_file_sha` ajnd `base_share_unix`
					let { file_sha, base_file_sha, share_unix, base_share_unix } = command;
					if (!file_sha && !base_file_sha) throw 'how is this isgitfile (not islocal) and doesnt have a file_sha or base_file_sha??';
					if (!share_unix && !base_share_unix) throw 'how is this isgitfile (not islocal) and doesnt have a share_unix or base_share_unix??';
					newcommand.base_file_sha = file_sha || base_file_sha; // need the || as this may be FIRST changes, or SECOND+ changes
					newcommand.base_share_unix = share_unix || base_share_unix; // need the || as this may be FIRST changes, or SECOND+ changes
					// delete newcommand.file_sha; // i never copied this from `pref_hotkey.command` so no need to delete. i dont copy it because the pref_hotkey.file_sha is now defunkt for sure. it instead goes to newhotkey.command.base_file_sha
					// delete newcommand.share_unix; // i never copied this from `pref_hotkey.command` so no need to delete. i dont copy it because the pref_hotkey.file_unix is now defunkt for sure. it instead goes to newhotkey.command.base_share_unix

					// newcommand.changes_since_base = calcCommandChanges(newcontent, content); // no longer using
				}
			}
		}

		if (!iseditpage) {
			// so iscreate
			// add disabled and unset hotkey with this command
			store.dispatch(addHotkey({
				combo: null,
				enabled: false,
				command: newcommand
			}));

			loadPage('/'); // go back to my hotkeys page
		} else if (isreallyedited) { // in this else it is obviously `iseditpage == true`
			let { combo, enabled } = hotkey;
			store.dispatch(editHotkey({
				combo,
				enabled,
				command: newcommand
			}));

			loadPage('/'); // go back to my hotkeys page
		}
	},
	render() {
		let { iseditpage } = this.props;
		let { isvalid } = this.props; // mapped state

		return React.createElement('a', { href:'#', className:'btn btn-success pull-right', disabled:!isvalid, onClick:this.onClick, tabIndex:(isvalid ? undefined : '-1') },
			React.createElement('span', { className:'glyphicon glyphicon-ok' }),
			' ' + browser.i18n.getMessage(iseditpage ? 'btn_savecommand' : 'btn_addcommand')
		);
	}
}));

function calcCommandChanges(newcontent, content) {
	// returns null if no chnges
	let changes = {};
	for (let change_type of ['group', 'locales', 'code']) { // change_type is same as change_field - so i just use chagne_type. `type` is really what is seen in `changes` and `field` is the keys in `content` of gitfile
		if (JSON.stringify(newcontent[change_type]) != JSON.stringify(content[change_type])) {
			changes[change_type] = 1;

			if (change_type == 'locales') {
				// figure out which locales changed
				let newlocales = newcontent.locales;
				let oldlocales = content.locales;

				// which locales added
				let a = [];
				for (let nl in newlocales) {
					// nl - newlocale
					if (!(nl in oldlocales))
						if (newlocales[nl].name || newlocales[nl].description) // make sure at least one is provided
							a.push(nl);
				}

				// which locales removed
				let r = [];
				for (let ol in oldlocales) {
					if (!(ol in newlocales))
						r.push(ol);
				}

				// which locales updated
				let u = [];
				for (let ol in oldlocales) {
					if (ol in newlocales) // make sure it is in newlocales (so not removed)
						if (newlocales[ol].name != oldlocales[ol].name || newlocales[ol].description != oldlocales[ol].description) // NOTE: if one is updated to blank, then it is counted as update // TODO: ensure that form NEVER accepts if one or the other is blank this will resolve this issue
							u.push(ol);
				}

				changes.locales = {
					...(a.length ? {a} : {}),
					...(r.length ? {r} : {}),
					...(u.length ? {u} : {})
				};
			}
		}
	}

	return Object.keys(changes) ? changes : null;
}
const LocalePicker = ({ locale=gLocale, onChange }) =>
	React.createElement('div', { className:'input-group-btn' },
		React.createElement('select', { className:'btn btn-default', defaultValue:locale, tabIndex:'-1', onChange },
			React.createElement('option', { value:'en-US' },
				'English'
			)
		)
	);
// end - PageCommandForm
// start - PageVersions
const PageVersions = React.createClass({
	displayName: 'PageVersions',
	render() {
		return React.createElement('div', undefined,
			'PageVersions'
		);
	}
});
// end - PageVersions
// start - PageAddCommand
const PageAddCommand = React.createClass({
	displayName: 'PageAddCommand',
	goBack: e => stopClickAndCheck0(e) ? loadOldPage('/') : null,
	loadCreate: e => stopClickAndCheck0(e) ? loadPage('/add/create') : null,
	loadBrowse: e => stopClickAndCheck0(e) ? loadPage('/add/browse') : null,
	render() {
		return React.createElement('span', undefined,
			// controls
			React.createElement('div', { className:'row text-center' },
				React.createElement('div', { className:'col-lg-12' },
					React.createElement('a', { href:'#', className:'btn btn-default pull-left', onClick:this.goBack},
						React.createElement('span', { className:'glyphicon glyphicon-triangle-left' }),
						' ' + browser.i18n.getMessage('back')
					)
				)
			),
			React.createElement('hr'),
			// content
			React.createElement('div', { className:'row text-center' },
				React.createElement('a', { href:'#', className:'btn btn-default btn-lg', onClick:this.loadBrowse },
					React.createElement('span', { className:'glyphicon glyphicon-globe' }),
					' ' + browser.i18n.getMessage('browse_community')
				),
				' ',
				React.createElement('a', { href:'#', className:'btn btn-default btn-lg', onClick:this.loadCreate },
					React.createElement('span', { className:'glyphicon glyphicon-console' }),
					' ' + browser.i18n.getMessage('create_new_command')
				)
			),
			React.createElement('hr')
		);
	}
});
// end - PageAddCommand
// start - PageCommunity
const PageCommunity = ReactRedux.connect(
	function(state, ownProps) {
		let { location:{pathname} } = ownProps; // router
		let pagestate = state.pages_state[pathname] || {};

		return {
			remotecommands: pagestate.remotecommands,
			filterterm: pagestate.filterterm,
			filtercat: pagestate.filtercat,
			sort: pagestate.sort
		}
	}
)(React.createClass({
	displayName: 'PageCommunity',
	goBack: e => stopClickAndCheck0(e) ? loadOldPage('/add') : null,
	loadRemoteCommands: async function() {
		let { location:{pathname} } = this.props; // router
		let { sort } = this.props; // mapped state

		// start spinner if it hasnt already
		store.dispatch(modPageState(pathname, { remotecommands:undefined, remotecommands_error:undefined })); // when clicking "Try Again" this will cause spinner to show, and error to hide // if this is first run, on first render, then it `modPageState` will see that there is no change as `remotecommands_error` is not there it is already `undefined`

		let remotecommands = [];
		try {
			// get file tree
			let tree;
			try {
				let xp = await xhrPromise('https://api.github.com/repos/Noitidart/Trigger-Community/git/trees/master', { restype:'json' });
				let { status, response } = xp.xhr;
				if (status !== 200) throw xp;
				({ tree } = response);
			} catch(xperr) {
				let { errtext='Unhandled server response when fetching command tree.', reason:xhrreason, xhr:{response, status}} = xperr;
				throw {	errtext, xhrreason, response, status };
			}

			// get install counts
			let installs;
			try {
				let xp = await xhrPromise('https://trigger-community.sundayschoolonline.org/installs.php?act=getcount', { restype:'json' });
				let { status, response } = xp.xhr;
				if (status !== 200) throw xp;
				installs = response;
			} catch(xperr) {
				let { errtext='Unhandled server response when fetching install counts.', reason:xhrreason, xhr:{response, status}} = xperr;
				throw {	errtext, xhrreason, response, status };
			}

			// get commits - used for history and statistics
			let commits;
			try {
				let xp = await xhrPromise('http://api.github.com/repos/Noitidart/Trigger-Community/commits?per_page=1000000', { restype:'json' });
				let { status, response } = xp.xhr;
				if (status !== 200) throw xp;
				commits = response;
			} catch(xperr) {
				let { errtext='Unhandled server response when fetching command details.', reason:xhrreason, xhr:{response, status}} = xperr;
				throw {	errtext, xhrreason, response, status };
			}
			// clean out commits
			let prnum;
			let versions = commits.reduce((acc, el) => {
				let { sha:commit_sha, committer:{login:author}, commit:{committer:{date},message:commit_message}} = el;
				date = new Date(date);

				let version = {
					commit_sha, // needed to later get the content
					author, // name of author
					date,
					commit_message
				};

				if (prnum) {
					version.discussurl = 'https://github.com/Noitidart/Trigger-Community/pull/' + prnum;
					prnum = null;
				}

				// to get the contents of the file at thsi point see - http://stackoverflow.com/a/16707165/1828637
				// so i will not do this until the user clicks "Version"


				let str = 'Merge pull request #';
				let strix = commit_message.indexOf(str);
				if (strix > -1) {
					// is pr merge for the commit that come after
					let spaceix = commit_message.indexOf(' ', str.length);
					prnum = commit_message.substr(str.length, spaceix - str.length);
					return acc;
				}
				if (author == 'web-flow') return acc; // this is a PR merge, `el.commit.author.name` will be "Noitidart" discard // `el.commit.comitter.name` will be "Github"

				// cant do the ='s test as it is 0, 1, or 2 ='s per http://stackoverflow.com/a/8571544/1828637
				// if (!version.commit_message.endsWith('=')) return acc; // is not a btoa string
				try {
					commit_message = JSON.parse(atob(commit_message));
					version.commit_message = commit_message;
				} catch(ex) {
					console.error('ERROR: Trying to `JSON.parse` the `atob` of it caused error. commit.message:', commit.message);
					return acc; // this is not a proper message, so it is not one of my files, discard it
				}

				let filename = commit_message.filename;
				if (!acc[filename]) acc[filename] = [];
				acc[filename].push(version);

				return acc;
			}, {});

			// get contents of latest/master version each file in tree
			let basket = new PromiseBasket; // for fetching content of each file

			for (let {path, url, sha:file_sha} of tree) {
				if (!path.endsWith('.json')) continue;
				let filename = path.substr(0, path.indexOf('.json'));
				if (filename.length != 8) continue; // i made the change to 8 char filename when started commit message of btoa

				basket.add(
					(async function() {

						let content;
						try {
							let xp = await xhrPromise(url, { restype:'json', headers:{Accept:'application/vnd.github.v3+json'} });
							let { status, response } = xp.xhr;
							if (status !== 200) throw xp;
							content = JSON.parse(atob(response.content));
						} catch(xperr) {
							let { errtext='Unhandled server response when fetching command content for file:' + filename, reason:xhrreason, xhr:{response, status}} = xperr;
							throw {	errtext, xhrreason, response, status };
						}

						let remotecommand = {
							_installs: installs[filename] || 0,
							_versions: versions[filename],
							filename,
							file_sha,
							share_unix: versions[filename][0].unix,
							content
						};

						remotecommands.push(remotecommand);
					})()
				);
			}

			await basket.run();
			console.log('ok basket done, remotecommands:', remotecommands);

		} catch(remotecommands_error) {
			let { response } = remotecommands_error;

			if (response && typeof(response) == 'object')
				remotecommands_error.beautified_response = await new Promise(resolve => callInBootstrap('beautifyText', { js:JSON.stringify(response) }, val=>resolve(val)));

			delete remotecommands_error.response; // delete if it had one

			store.dispatch(modPageState(pathname, { remotecommands_error }));
			return;
		}

		this.sortRemoteCommands(remotecommands, sort);

		store.dispatch(modPageState(pathname, { remotecommands }));
	},
	sortRemoteCommands(remotecommands, sort='alpha') {
		let sortalgo = {
			alpha: (a, b) => compareIntThenLex(a.content.locales[gLocale].name, b.content.locales[gLocale].name), // asc
			installs: (a, b) => b._installs - a._installs, // desc
			updated: (a, b) => b._versions[0].date - a._versions[0].date // desc
		};
		console.log('pre sort:', remotecommands.map(el=>el.content.locales[gLocale].name));
		setTimeout(()=>console.log('post sort:', remotecommands.map(el=>el.content.locales[gLocale].name)));
		return remotecommands.sort(sortalgo[sort]);
	},
	changeSort() {
		let { remotecommands:oldremotecommands, sort:oldsort='alpha' } = this.props; // mapped state
		let { dispatch } = this.props; // redux
		let { location:{pathname} } = this.props; // router

		let { sort } = getFormValues(['sort']);

		if (sort != oldsort) { // i do the test rather then letting modPageState test, because default in pagestate is undefined, but here i use "alpha", so  for me `"alpha" === undefined`
			let remotecommands = this.sortRemoteCommands([...oldremotecommands], sort);
			dispatch(modPageState(pathname, {sort, remotecommands}));
		}
	},
	changeFilterTerm(e) {
		let filterterm = e.target.value.toLowerCase();
		if (!filterterm.length) filterterm = undefined; // i dont have to do this, as a blank string should do the trick, but eh

		let { dispatch } = this.props; // redux
		let { location:{pathname} } = this.props; // router

		dispatch(modPageState(pathname, {filterterm})); // will do nothing if filtercat === oldfiltercat
	},
	keydnFilterTerm(e) {
		if (e.keyCode === 27) {
			e.stopPropagation();
			e.preventDefault();
			if (!e.repeat)
				this.clickClearFilterTerm();
		}
	},
	clickClearFilterTerm(e) {
		if (e && !stopClickAndCheck0(e)) return;

		document.getElementById('search').value = '';

		let { dispatch } = this.props; // redux
		let { location:{pathname} } = this.props; // router

		dispatch(modPageState(pathname, {filterterm:undefined}));
	},
	setFilterCategory(filtercat, e) {
		if (!stopClickAndCheck0(e)) return;

		let { dispatch } = this.props; // redux
		let { location:{pathname} } = this.props; // router

		dispatch(modPageState(pathname, {filtercat})); // will do nothing if filtercat === oldfiltercat
	},
	termFilterer(remotecommand, filterterm) {
		if (filterterm === undefined) return true;
		let { locales, code:{exec:code} } = remotecommand.content;
		// if (code.toLowerCase().includes(filterterm)) return true;
		for (let [locale, {name, description}] of Object.entries(remotecommand.content.locales)) {
			if (name.toLowerCase().includes(filterterm)) return true;
			if (description.toLowerCase().includes(filterterm)) return true;
		}
		return false;
	},
	catFilterer(remotecommand, filtercat) {
		return filtercat === undefined || remotecommand.content.group === filtercat;
	},
	render() {
		let { remotecommands_error, remotecommands, filterterm, filtercat, sort='alpha' } = this.props; // mapped state

		if (!remotecommands && !remotecommands_error) // first render i think - i hope
			setTimeout(this.loadRemoteCommands)

		let istermfiltered = remotecommands && filterterm;
		let iscatfiltered = remotecommands && filtercat;

		let termfiltered = !istermfiltered ? remotecommands : remotecommands.filter(remotecommand => this.termFilterer(remotecommand, filterterm));

		// filter by both `filterterm` and `filtercat`
		let bothfiltered = remotecommands && remotecommands.filter(remotecommand => this.termFilterer(remotecommand, filterterm) && this.catFilterer(remotecommand, filtercat));


		return React.createElement('span', undefined,
			// controls
			React.createElement('div', { className:'row text-center' },
				React.createElement('div', { className:'col-lg-12' },
					React.createElement('a', { href:'#', className:'btn btn-default pull-left', onClick:this.goBack},
						React.createElement('span', { className:'glyphicon glyphicon-triangle-left' }),
						' ' + browser.i18n.getMessage('back')
					),
					React.createElement('div', { className:'input-group pull-right' },
						React.createElement('select', { className:'form-control', id:'sort', style:{borderRadius:'4px'}, disabled:!remotecommands, defaultValue:sort, onChange:this.changeSort },
							React.createElement('option', { value:'alpha' }, browser.i18n.getMessage('sort_alpha') ),
							React.createElement('option', { value:'installs' }, browser.i18n.getMessage('sort_installs') ),
							React.createElement('option', { value:'updated' }, browser.i18n.getMessage('sort_updated') )
						)
					),
					React.createElement('div', { className:'input-group', style:{width:'250px',margin:'0 auto'} },
						React.createElement('input', { className:'form-control', placeholder:browser.i18n.getMessage('placeholder_communitysearch'), id:'search', type:'text', onChange:this.changeFilterTerm, disabled:!remotecommands, onKeyDown:this.keydnFilterTerm }),
						istermfiltered && React.createElement('div', { className:'input-group-btn' },
							React.createElement('a', { href:'#', className:'btn btn-default btn-danger', onClick:this.clickClearFilterTerm },
								React.createElement('i', { className:'glyphicon glyphicon-remove' })
							)
						)
					)
				)
			),
			React.createElement('hr'),
			// content
			React.createElement('div', { className:'row' + (!remotecommands ? ' text-center' : '') },
				remotecommands_error && React.createElement('button', { className:'btn btn-lg btn-default no-btn', style:{marginLeft:'-80px'} },
					React.createElement('span', { className:'glyphicon glyphicon-refresh', onClick:this.loadRemoteCommands }),
					' ' + browser.i18n.getMessage('try_again')
				),
				remotecommands_error && React.createElement(RemoteCommandsLoadError, { remotecommands_error }),
				!remotecommands && React.createElement('button', { className:'btn btn-lg btn-default no-btn', style:{marginLeft:'-80px'} },
					React.createElement('span', { className:'glyphicon glyphicon-globe spinning' }),
					' ' + browser.i18n.getMessage('loading_community')
				),
				remotecommands &&
				React.createElement('div', { className:'row'},
					// categories filter
					React.createElement('div', { className:'col-md-3' },
						React.createElement('div', { className:'list-group' },
							React.createElement('h4', undefined, browser.i18n.getMessage('categories')),
							[{id:undefined, text:browser.i18n.getMessage('all')}, ...GROUPS].map(({id, text}) =>
								React.createElement('a', { className:'list-group-item', href:'#', style:(id !== filtercat ? undefined : {backgroundColor:'#f0f0f0'}), onClick:this.setFilterCategory.bind(null, id)}, // if active, give it style `#f0f0f0` (which is the hover background-color) rather then `active`. active is too dark.
									React.createElement('span', { className:'badge' }, termfiltered.reduce((sum, remotecommand)=>(id === remotecommand.content.group || id === undefined) ? sum+1 : sum, 0)),
									' ' + text
								)
							)
						)
					),
					// command results
					React.createElement('div', { className:'col-md-9' },
						!!bothfiltered.length && pushAlternatingRepeating(bothfiltered.map(remotecommand => React.createElement(RemoteCommand, { remotecommand, key:remotecommand.filename })), React.createElement('hr')),
						!bothfiltered.length && React.createElement('h2', {style:{textAlign:'center'}}, browser.i18n.getMessage('noresults'))
					)
				)
			),
			React.createElement('hr')
		);
	}
}));

const RemoteCommandsLoadError = ({errtext, xhrreason, status, beautified_response}) =>
React.createElement('span', undefined,
	'Failed to load community from Github. ' + errtext,
	React.createElement('br'),
	React.createElement('br'),
	status && React.createElement('dl', undefined,
		React.createElement('dt', undefined,
			React.createElement('dd', undefined,
				'Status Code: ' + status
			),
			React.createElement('dd', undefined,
				'XHR Reason: ' + xhrreason
			),
			React.createElement('dd', undefined,
				'Response:',
				React.createElement('pre', undefined, beautified_response)
			)
		)
	)
);

const RemoteCommand = ReactRedux.connect(
	function(state, ownProps) {
		return {};
	}
)(React.createClass({
	displayName: 'RemoteCommand',
	render() {
		let { remotecommand } = this.props;
		let { _installs:installs, _versions:versions, filename, content:{locales:{[gLocale]:{name, description}}} } = remotecommand;
		let version = versions.length;
		let { date } = versions[0];

		// figure out if it is installed, and if it is lower version, or higher version, or custom based on lower version, or custom based on this version
		let has_pref_hotkey = false; // pref_hotkeys.find(a_pref_hotkey => a_pref_hotkey.filename == filename);
		let isinstalled;
		if (has_pref_hotkey) {
			isinstalled = {};
		}

		return React.createElement('div', { className:'row' },
			React.createElement('div', { className:'col-sm-4' },
				React.createElement('img', { className:'img-responsive', src:'http://placehold.it/1280X720' }),
			),
			React.createElement('div', { className:'col-sm-8' },
				React.createElement('h3', undefined,
					name, ' ',
					React.createElement('small', undefined,
						browser.i18n.getMessage('addon_version_long', version)
					)
				),
				React.createElement('p', { className:'text-muted pull-right' },
					React.createElement('span', { title:browser.i18n.getMessage('unique_installs'), style:{margin:'0 7px'} },
						React.createElement('span', { className:'glyphicon glyphicon-cloud-download' }),
						' ' + installs
					),
					' ',
					React.createElement('span', { title:browser.i18n.getMessage('last_updated'), style:{margin:'0 7px'} },
						React.createElement('span', { className:'glyphicon glyphicon-calendar' }),
						' ' + strftime(browser.i18n.getMessage('strftime_format_date1'), date)
					)
				),
				React.createElement('p', undefined,
					React.createElement(InstallBtn, { remotecommand }),
					' ',
					React.createElement('a', { href:'#', className:'btn btn-default' },
						React.createElement('span', { className:'glyphicon glyphicon-dashboard' }),
						' ', browser.i18n.getMessage('versions')
					)
				),
				React.createElement('p', undefined,
					description
				),
				React.createElement('p', { className:'text-muted' },
					'Missing Languages: none'
				)
			)
		);
	}
}));
const InstallBtn = ReactRedux.connect(
	function(state, ownProps) {
		return {
			hotkeys: state.hotkeys
		}
	}
)(React.createClass({
	displayName: 'InstallBtn',
	onClick(e) {
		if (!stopClickAndCheck0(e)) return;


	},
	getInstalledType() {
		// returns
			// 0 - not installed
			// 1 - installed and installed version is master version, disabled
			// 2 - installed and installed version is less then master, safe upgrade
			// 3 - installed and edited, warn upgrade - tell user if their edits are enhancements not seen in the latest master version, then we would appreciate it if they shared it, if their edits are not as good then they will probably want to upgrade
			// 4 - installed master version and edited, danger downgrade - tell user to share if its better, or if they dont like their edits they can downgrade

		let { remotecommand:{filename, _versions:versions} } = this.props;
		let { hotkeys } = this.props; // mapped state

		// the hotkey the command is installed in
		let hotkey = hotkeys.find(a_hotkey => a_hotkey.command.filename == filename);

		if (!hotkey) return 0; // not installed

		let command = hotkey.command; // the installed command
		let isedited = 'base_share_unix' in command;
		let version = versions.length - versions.findIndex(a_version => a_version.commit_message.unix === (command.share_unix || command.base_share_unix));

		let masterversion = versions.length;

		if (version === masterversion) {
			if (isedited) {
				return 4;
			} else {
				return 1;
			}
		} else if (version < masterversion) {
			if (isedited) {
				return 3;
			} else {
				return 2;
			}
		}
	},
	render() {

		// props for the button
		let installtype_styles = {
			0: { color:'success', label:browser.i18n.getMessage('install') },
			1: { disabled:true, color:'success', label: browser.i18n.getMessage('installed') },
			2: { color:'success', label: browser.i18n.getMessage('upgrade') },
			3: { color:'warning', label: browser.i18n.getMessage('discard_upgrade') },
			4: { color:'danger', label: browser.i18n.getMessage('discard_downgrade') }
		}
		let { label, disabled, color } = installtype_styles[this.getInstalledType()];

		return React.createElement('a', { href:'#', className:'btn btn-default btn-' + color, disabled },
			React.createElement('span', { className:'glyphicon glyphicon-arrow-down' }),
			' ' + label
		);
	}
}));
// end - PageCommunity
const PageInvalid = React.createClass({
	displayName: 'PageInvalid',
	render() {
		let { params } = this.props;
		console.log('params:', params);

		return React.createElement('div', undefined,
			'PageInvalid'
		);
	}
});

function genFilename() {
	// salt generator from http://mxr.mozilla.org/mozilla-aurora/source/toolkit/profile/content/createProfileWizard.js?raw=1*/

	var mozKSaltTable = [
		'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n',
		'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
		'1', '2', '3', '4', '5', '6', '7', '8', '9', '0'
	];

	var kSaltString = '';
	for (var i = 0; i < 8; ++i) {
		kSaltString += mozKSaltTable[Math.floor(Math.random() * mozKSaltTable.length)];
	}
	return kSaltString;
	// return kSaltString + '.' + aName;
}

// start - cmn
function pushAlternatingRepeating(aTargetArr, aEntry) {
	// pushes into an array aEntry, every alternating
		// so if aEntry 0
			// [1, 2] becomes [1, 0, 2]
			// [1] statys [1]
			// [1, 2, 3] becomes [1, 0, 2, 0, 3]
	let l = aTargetArr.length;
	for (let i=l-1; i>0; i--) {
		aTargetArr.splice(i, 0, aEntry);
	}

	return aTargetArr;
}
function stopClickAndCheck0(e) {
	if (!e) return true;

	e.stopPropagation();
	e.preventDefault();

	return e.button === 0 ? true : false;
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
		timeout: 0, // integer, milliseconds, 0 means never timeout, value is in milliseconds
		onprogress: undefined, // set to callback you want called
		onuploadprogress: undefined, // set to callback you want called
		// odd options
		reject: true,
		fdhdr: false, // stands for "Form Data Header" set to true if you want it to add Content-Type application/x-www-form-urlencoded
		// overwrite with what devuser specified
		...opt
	};
	if (opt.url) url = opt.url;

	return new Promise( (resolve, reject) => {
		let xhr = new XMLHttpRequest();

		if (opt.timeout) xhr.timeout = opt.timout;

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

		if (opt.onprogress) xhr.addEventListener('progress', opt.onprogress, false);
		if (opt.onuploadprogress) xhr.upload.addEventListener('progress', opt.onuploadprogress, false);

		xhr.open(opt.method, url, true);

		xhr.responseType = opt.restype;

		if (opt.fdhdr) opt.headers['Content-Type'] = 'application/x-www-form-urlencoded'
		for (let h in opt.headers) xhr.setRequestHeader(h, opt.headers[h]);

		if (typeof(opt.data) == 'object' && opt.data != null && opt.data.constructor.name == 'Object') opt.data = queryStringDom(opt.data);

		xhr.send(opt.data);
	});
}

function objectAssignDeep(target, source) {
  // rev3 - https://gist.github.com/Noitidart/dffcd2ace6135350cd0ca80f615e06dc
  var args       = Array.prototype.slice.call(arguments);
  var startIndex = 1;
  var output     = Object(target || {});

  // Cycle the source object arguments.
	for (var a = startIndex, alen = args.length ; a < alen ; a++) {
		var from = args[a];
		var keys = Object.keys(Object(from));

    // Cycle the properties.
		for (var k = 0; k < keys.length; k++) {
      var key = keys[k];

      // Merge arrays.
      if (Array.isArray(output[key]) || Array.isArray(from[key])) {
        var o = (Array.isArray(output[key]) ? output[key].slice() : []);
        var f = (Array.isArray(from[key])   ? from[key].slice()   : []);
        output[key] = o.concat(f);
      }

      // Copy functions references.
      else if (typeof(output[key]) == 'function' || typeof(from[key]) == 'function') {
        output[key] = from[key];
      }

      // Extend objects.
      else if ((output[key] && typeof(output[key]) == 'object') || (from[key] && typeof(from[key]) == 'object')) {
        output[key] = objectAssignDeep(output[key], from[key]);
      }

      // Copy all other types.
      else {
        output[key] = from[key];
      }

		}

	}

	return output;

};

function deepAccessUsingString(obj, key){
	// https://medium.com/@chekofif/using-es6-s-proxy-for-safe-object-property-access-f42fa4380b2c#.xotsyhx8t
  return key.split('.').reduce((nestedObject, key) => {
    if(nestedObject && key in nestedObject) {
      return nestedObject[key];
    }
    return undefined;
  }, obj);
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

async function getUnixTime(opt={}) {
	// retry_cnt is used for times to retry each each server
	opt = {
		timeout: 10000,
		compensate: true, // subtracts half of the xhr request time from the time extracted from page
		...opt
	};

	let servers = [
		{
			name: 'trigger-community',
			xhropt: {
				url: 'https://trigger-community.sundayschoolonline.org/unixtime.php',
				restype: 'json'
			},
			xhrthen: ({response, status}) => {
				if (status !== 200) throw `Unhandled Status (${status})`;
				let unix_ms = response.unixtime * 1000;
				return unix_ms;
			}
		},
		{
			name: 'CurrentTimestamp.com',
			xhropt: {
				url: 'http://currenttimestamp.com/'
			},
			xhrthen: ({response, status}) => {
				if (status !== 200) throw `Unhandled Status (${status})`;

				let extract = /current_time = (\d+);/.exec(response);
				if (!extract) throw 'Extraction Failed';

				let unix_ms = extract[1] * 1000;
				return unix_ms;
			}
		},
		{
			name: 'convert-unix-time.com',
			xhropt: {
				url: 'http://convert-unix-time.com/'
			},
			xhrthen: ({response, status}) => {
				if (status !== 200) throw `Unhandled Status (${status})`;

				let extract = /currentTimeLink.*?(\d{10,})/.exec(response);
				if (!extract) throw 'Extraction Failed';

				let unix_ms = extract[1] * 1000;
				return unix_ms;
			}
		}
	];

	let errors = [];
	for (let { xhropt, name, xhrthen } of servers) {
		try {
			let start = Date.now();
			let xpserver = await xhrPromise({ ...xhropt, timeout:opt.timeout });
			let duration = Date.now() - start;
			let halfduration = Math.round(duration / 2);

			let unix_ms = xhrthen(xpserver.xhr);

			if (opt.compensate) unix_ms -= halfduration;

			return unix_ms;
		} catch(ex) {
			if (typeof(ex) == 'string') ex = ex
			else if (ex && typeof(ex) == 'object' && ex.xhr && ex.reason) ex = 'XHR ' + ex.reason
			else ex = ex.toString();

			errors.push(`Server "${name}" Error: ` + ex);

			continue;
		}
	}

	throw errors;
}
function getFormValues(domids) {
	// let domids = ['name', 'description', 'code'];
	let processors = {group:parseInt} // custom for Trigger
	let domvalues = {};
	for (let domid of domids) {
		let domvalue = document.getElementById(domid).value.trim();
		let processor = processors[domid];
		if (processor) domvalue = processor(domvalue);
		domvalues[domid] = domvalue;
	}
	return domvalues;
}

function compareIntThenLex(a, b) {
    // sort ascending by integer, and then lexically
	// ['1', '10', '2'] ->
	// ['1', '2', '10']

    let inta = parseInt(a);
    let intb = parseInt(b);
    let isaint = !isNaN(inta);
    let isbint = !isNaN(intb);
    if (isaint && isbint) {
        return inta - intb; // sort asc
    } else if (isaint && !isbint) {
        return -1; // sort a to lower index then b
    } else if (!isaint && isbint) {
        return 1; // sort b to lower index then a
    } else {
        // neither are int's
        return a.localeCompare(b)
    }
}
// end - cmn
