let gBgComm = new Comm.client.webextports('tab');
var callInBackground = Comm.callInX2.bind(null, gBgComm, null, null);
var callInExe = Comm.callInX2.bind(null, gBgComm, 'callInExe', null);
var callInBootstrap = Comm.callInX2.bind(null, gBgComm, 'callInBootstrap', null);
var callInMainworker = Comm.callInX2.bind(null, gBgComm, 'callInMainworker', null);
let callIn = (...args) => new Promise(resolve => window['callIn' + args.shift()](...args, val=>resolve(val))); // must pass undefined for aArg if one not provided, due to my use of spread here. had to do this in case first arg is aMessageManagerOrTabId

let nub;
let store;
const shallowCompare = React.addons.shallowCompare;

let gSupressUpdateHydrantOnce;

async function init() {
	console.error('calling fetchData with hydrant skeleton:', hydrant);
	document.title = browser.i18n.getMessage('addon_name');

	gExtLocale = await callIn('Background', 'getSelectedLocale', 'myhotkeys_page_description');
	gUserLocales = (await callIn('Background', 'getUserPreferredLocales', undefined)).map(el => el.replace(/_/g, '-'));

    let data = await callIn('Background', 'fetchData', { hydrant_instructions, nub:1 });

	nub = data.nub;

	// window.addEventListener('unload', uninit, false);

	// setup and start redux
	if (app) {
		if (hydrant) objectAssignDeep(hydrant, data.hydrant); // dont update hydrant if its undefined, otherwise it will screw up all default values for redux
		store = Redux.createStore(app);
		// if (hydrant) store.subscribe(shouldUpdateHydrant); // manually handle setting hydrant
	}

  // set pathname for react-router
  let initial_pathname = '/';
  let qparam = {};
  try {
    qparam = queryStringDom(window.location.href);
  } catch(ignore) {}
  if (qparam.page) {
    initial_pathname += qparam.page;
    delete qparam.page;
  }
  if (Object.keys(qparam).length) initial_pathname += '?' + queryStringDom(qparam);
  window.history.replaceState({key:'trigger'}, browser.i18n.getMessage('addon_name'), initial_pathname);

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
// start - for UNREF_KEYS
function reduceToNonRefsCallback(acc, [kname, kval]) {
    let type = typeof(kval);
    acc.keys.push(kname);
    if (type == 'string' || type == 'number' || kval === undefined || kval === null) {
        acc.vals.push(kval);
    } else {
        acc.vals.push(0); // unreffed
    }
    return acc;
}
function sortByFirstElOfArr(a, b) {
    return a[0].localeCompare(b[0]);
}
function reduceToNonRefs(obj) {
    // the object is sorted by keys
    if (!obj || typeof(obj) != 'object') return [[], []];
    let arrofobj = Object.entries(obj);
    arrofobj.sort(sortByFirstElOfArr);
    let {keys, vals} = arrofobj.reduce( reduceToNonRefsCallback, {keys:[],vals:[]} );
    return [keys, vals];
}
const UND = 'UND';
const SHCMP = 'SHCMP'
const UNREF_KEYS = 'UNREF_KEYS'; // non-ref keys, so all but arrays/objects
// end - for UNREF_KEYS
function doesAnyTestPass(cur, next, instructs) {
    // let instructs = { // key is the dotpath
    //     'combo': [UND],
    //     'comobo.keyname': [SHCMP],
    //     'comobo.mods': [SHCMP],
    //     'command': [UNREF_KEYS],
    // };

    for (let [dotpath, tests] of Object.entries(instructs)) {
        let caccess = dotpath == '.' ? cur : deepAccessUsingString(cur, dotpath);
        let naccess = dotpath == '.' ? next : deepAccessUsingString(next, dotpath);

        // console.log('dotpath:', dotpath, 'tests:', tests.toString(), 'caccess:', caccess, 'naccess:', naccess);

        if (tests.includes(UND)) {
            if (caccess && !naccess) return true;
            if (!caccess && naccess) return true;
        }

        if (tests.includes(SHCMP)) {
            if (shallowCompare({props:caccess}, naccess)) return true;
        }

        if (tests.includes(UNREF_KEYS)) {
            let [ckeys, cvals] = reduceToNonRefs(caccess);
            let [nkeys, nvals] = reduceToNonRefs(naccess);
            if (ckeys.length !== nkeys.length) return true;
            if (shallowCompare({props:ckeys}, nkeys)) return true; // if one has X key and the other doesnt
            // console.log('testing vals', 'cvals:', cvals, 'nvals:', nvals);
            if (shallowCompare({props:cvals}, nvals)) return true;
        }

        let customs = tests.filter(test => typeof(test) == 'function');
        for (let custom of customs) {
            if (custom(caccess, naccess)) return true;
        }
    }
}
async function focusAppPage() {
	// console.log('focused!!!!!!');
    let data = await callIn('Background', 'fetchData', { hydrant_instructions });
    // console.log('data:', data);

    let newhydrant = data.hydrant;

	// objectAssignDeep(hydrant, data.hydrant); // dont update hydrant if its undefined, otherwise it will screw up all default values for redux
    let newmainkeys = {};

    let state = store.getState();

    let checks = [
        {
            name: 'serials',
            dotpath: {
                data: 'hydrant.stg.pref_serials',
                store: 'serials'
            },
            isDiff: (cserials, nserials) => {
                if (nserials === undefined) return false;
                return doesAnyTestPass(cserials, nserials, {'.':[SHCMP]});
            }
        },
        {
            name: 'oauth',
            dotpath: {
                data: 'hydrant.stg.mem_oauth',
                store: 'oauth'
            },
            isDiff: (coauth, noauth) => {
                if (noauth === undefined) return false;
                return doesAnyTestPass(coauth, noauth, {'github':[SHCMP]});
            }
        },
        {
            name: 'hotkeys',
            dotpath: {
                data: 'hydrant.stg.pref_hotkeys',
                store: 'hotkeys'
            },
            isDiff(chotkeys, nhotkeys) {
                if (nhotkeys === undefined) return false;
                // chotkeys is array of objects
                if (chotkeys.length != nhotkeys.length) return true;

                let instructs = { // key is the dotpath
                    'enabled': [SHCMP],
                    'combo': [UND],
                    'comobo.keyname': [SHCMP],
                    'comobo.mods': [SHCMP],
                    'command': [UNREF_KEYS],
                    'command.content.code': [SHCMP],
                    'command.content.group': [SHCMP],
                    'command.content.locales': [UNREF_KEYS, (clocales, nlocales) => {
                        // this test happens after UNREF_KEYS, so it means the smae exact keys -- i now want to test if the values are different
                        let locales = Object.keys(clocales);
                        for (let locale of locales)
                            if (doesAnyTestPass(clocales[locale], nlocales[locale], {'.':[SHCMP]}))
                                return true
                    }],
                };

                let l = chotkeys.length;
                for (let i=0; i<l; i++) {
                    let chotkey = chotkeys[i];
                    let nhotkey = nhotkeys[i];
                    if (doesAnyTestPass(chotkey, nhotkey, instructs)) return true;
                };
            }
        }
    ];

    for (let check of checks) {
        let { name, dotpath, isDiff } = check;
        let cur = deepAccessUsingString(state, dotpath.store);
        let next = deepAccessUsingString(data, dotpath.data);
        // console.log('dotpath.data:', dotpath.data, 'next:', next, 'data:', data);

        if (isDiff(cur, next)) {
            console.log(`${name} is changed! was:`, cur, 'now:', next);
            newmainkeys[dotpath.store] = next;
        }
    }

    if (Object.keys(newmainkeys).length) store.dispatch(setMainKeys(newmainkeys));
    else console.log('nothing changed');
}

// GLOBALS
let hydrant_instructions = {stg:{pref_hotkeys:1,pref_serials:1,mem_oauth:1}};
let hydrant = {
	stg: {
		// set defaults here, as if it never has been set with `storageCall('storaget', 'set')` then `fetchData` will get back an empty object
		pref_hotkeys: [],
        pref_serials: {},
		mem_oauth: {} // github, github_inactive
	}
};

let gExtLocale; // the locale in my _locales dir that the browser is showing my strings in
let gUserLocales; // user prefered locales - array

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
function loadPage(relativeurl, namevalues) {
	// TODO: MAYBE: namevalues - what to set the pagestate to before loading, it replaces the old state with this one

    let pathname = relativeurl.search(/[?#]/) > -1 ? relativeurl.substr(0, relativeurl.search(/[?#]/)) : relativeurl;
	store.dispatch(clearPageStates(pathname, namevalues));

	// i dont think i need async, as the store.dispatch should complete everything synchronously
	// setTimeout(()=>ReactRouter.browserHistory.push(relativeurl), 0); // setTimeout so that it happens after the redux state is update is comitted, as that should happen synchronously from here // link393485
	ReactRouter.browserHistory.push(relativeurl);

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
let MODAL_NEXT_ID = 0;
function createModal(pathname, modal) {
	// obj = link42112
	/*
	createModal(ReactRouter.browserHistory.getCurrentLocation().pathname, { title:'title', msg:'hiiii', ok:{label:'ok'}, cancel:{label:'cancel'} })
	modal {
		id: auto gen number,
		////// provide EITHER content_component OR the rest
		content_component: 'Buy', // will render window[modal.content_component] so will need to declare it with `var` most likely as `const` does not declare it on `window` link8847777
		////// provide EITHER content_component OR the rest
		title: string
		msg: string
		ok: object;optional;default=undefined {
			label:string;optional;defualt=undefined - if not provided then button not rendered and onClick has no affect,
			onClick: function;optional;default=undefined
		}
		cancel: same as `ok`
	}
	*/
	gModalEnter = true;
	modal.id = MODAL_NEXT_ID++;
	store.dispatch(modPageState(pathname, { modal }));
}

let NAG_NEXT_ID = 0;
const NAG_DURATION_MS = 5 * 1000;
function createNag(pathname, nag) {
	/*
	nag {
		id: auto gen number,
		title: string
		msg: string;optional;default:`undefined`
		type: string;optinal;enum[default, primary, success, info, warn, danger];default:"default"
		ok_label: string
		cancel_label: string
		onOk: function;optional;default:`undefined`
	}
	*/
	gNagsEnter = true;
	nag.id = NAG_NEXT_ID++;
	nag.birth_time = Date.now();
	// nag.death_time = Date.now() + NAG_DURATION_MS; // i use this to determine if should use `fadeap` or `fade` getTrans link1929119
	let pagestate = store.getState().pages_state[pathname] || {};
	let oldnags = pagestate.nags || [];
	let nags = [...oldnags, nag];
	store.dispatch(modPageState(pathname, { nags }));
}
function removeNag(pathname, id) {
	let pagestate = store.getState().pages_state[pathname] || {};
	let oldnags = pagestate.nags || [];

	let ix = oldnags.findIndex(nag => nag.id === id);
	if (ix > -1) {
		if (ReactRouter.browserHistory.getCurrentLocation().pathname == pathname) {
			// set for gNagsLeave to true
			gNagsLeave = true;
			// set back oldnags but as a new array so it sets the gNagsLeave // link229439
			store.dispatch(modPageState(pathname, { nags:[...oldnags] }));
		}

		// remove it
		let nags = oldnags.filter(a_nag => a_nag.id !== id);
		store.dispatch(modPageState(pathname, { nags }));
	}
	else { console.warn('nag with id was already removed, id:', id) }
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
				if (shallowCompare({props:pagestate}, newpagestate)) {
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

// SERIALS ACTIONS AND CREATORS AND REDUCER
const ADD_SERIAL = 'ADD_SERIAL';
function addSerial(serial, buyqty) {
	return {
		type: ADD_SERIAL,
		serial,
        buyqty
	}
}

function serials(state=hydrant.stg.pref_serials, action) {
	switch (action.type) {
		case SET_MAIN_KEYS: {
			const reducer = 'serials';
			let { [reducer]:reduced } = action.obj_of_mainkeys;
			return reduced || state;
		}
        case ADD_SERIAL: {
            let { serial, buyqty } = action;

			let newstate = { ...state, [serial]:buyqty };

			callInBackground('storageCall', {aArea:'local',aAction:'set',aKeys:{
				pref_serials: newstate
			}});

			return newstate;
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
    serials,
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

// START REACT
// react globals
const ReactCSSTransitionGroup = React.addons.CSSTransitionGroup;
var gTrans = [ // needs to be var, so its accessible to dom-react.js
	createTrans('fadequick', 150, 150, true),
	createTrans('fade', 300, 300, true),
	createTrans('modalfade', 300, 300, true)
];
initTransTimingStylesheet(); // must go after setting up gTrans

// REACT COMPONENTS - PRESENTATIONAL
const Root = () => {
    console.error('root nub.self.fatal:', nub.self.fatal);
    if (nub.self.fatal) {
        return React.createElement(ReactRedux.Provider, { store },
            React.createElement(ReactRouter.Router, { history:ReactRouter.browserHistory },
                React.createElement(ReactRouter.Route, { path:'/', component:App },
                    React.createElement(ReactRouter.IndexRoute, { component:PageFatal }),
                    React.createElement(ReactRouter.Route, { path:'*', component:PageFatal })
                )
            )
        );
    } else if (nub.self.fatal === undefined) {
        return React.createElement(ReactRedux.Provider, { store },
            React.createElement(ReactRouter.Router, { history:ReactRouter.browserHistory },
                React.createElement(ReactRouter.Route, { path:'/', component:App },
                    React.createElement(ReactRouter.IndexRoute, { component:PageStartingup }),
                    React.createElement(ReactRouter.Route, { path:'*', component:PageStartingup })
                )
            )
        );
    } else {
        return React.createElement(ReactRedux.Provider, { store },
            React.createElement(ReactRouter.Router, { history:ReactRouter.browserHistory },
                React.createElement(ReactRouter.Route, { path:'/', component:App },
                    React.createElement(ReactRouter.IndexRoute, { component:PageMyHotkeys }),
                    React.createElement(ReactRouter.Route, { path:'edit/(:filename)', component:PageCommandForm }),
                    React.createElement(ReactRouter.Route, { path:'versions/(:filename)', component:PageVersions }),
                    React.createElement(ReactRouter.Route, { path:'add', component:PageAddCommand }),
                    React.createElement(ReactRouter.Route, { path:'add/browse', component:PageCommunity }),
                    React.createElement(ReactRouter.Route, { path:'add/create', component:PageCommandForm }),
                    React.createElement(ReactRouter.Route, { path:'auth', component:PageAuth }),
                    React.createElement(ReactRouter.Route, { path:'purchase', component:PagePurchase }),
                    React.createElement(ReactRouter.Route, { path:'*', component:PageInvalid })
                )
            )
        );
    }
}

const App = React.createClass({
	displayName: 'App',
	render() {
		let { location:{pathname, params, query}, children } = this.props; // router props
		console.log('app props:', this.props);

		return React.createElement('div', { id:'app', className:'app container' },
			React.createElement(ModalWrap, { pathname }),
			React.createElement(Nags, { pathname }),
			React.createElement(Header, { pathname, params, query }),
			children
		);
	}
});
// start - Nag
let gNagsEnter = false;
let gNagsLeave = false;
const Nags = ReactRedux.connect(
	function(state, ownProps) {
		let { pathname } = ownProps; // router
		let pagestate = state.pages_state[pathname] || {};
		return {
			nags: pagestate.nags || []
		}
	}
)(React.createClass({
	displayName: 'Nags',
	render() {
		let { pathname } = this.props;
		let { nags } = this.props;

		if (gNagsEnter) setTimeout(()=>gNagsEnter=false, 0);
		if (gNagsLeave) setTimeout(()=> {
			gNagsLeave = false;
			store.dispatch(modPageState(pathname, { nags:[...nags] })); // same tactic as link229439
		}, 0);

		return React.createElement(ReactCSSTransitionGroup, getTrans('fade', { transitionEnter:gNagsEnter, transitionLeave:gNagsLeave, component:'div', className:'nags-backdrop' }), // link1929119
		// return React.createElement('div', { className:'nags-backdrop' },
			nags.map(a_nag => React.createElement(Nag, {nag:a_nag, pathname, key:a_nag.id}))
		);
	}
}));

const Nag = ({pathname, nag}) => {
	let { id, type='default', title, msg, glyphicon, cancel_label, ok_label, onOk } = nag;
	let onOkWrap = function(e) {
		if (!stopClickAndCheck0(e)) return;
		if (onOk) onOk();
		removeNag(pathname, id);
	};
	let onCancel = function(e) {
		if (!stopClickAndCheck0(e)) return;
		removeNag(pathname, id);
	};

	if (!nag.death_time) {
		nag.death_time = Date.now() + NAG_DURATION_MS; // link1929119
		setTimeout(onCancel, NAG_DURATION_MS);
	}

	return React.createElement('div', { className:'col-md-12' },
		React.createElement('div', { className:'nag nag-' + type },
			glyphicon && React.createElement('span', { className:'nag-icon' },
				React.createElement('i', { className:'glyphicon glyphicon-' + glyphicon }),
			),
			React.createElement('span', { className:'nag-content' },
				React.createElement('b', undefined, title),
				msg && (' ' + msg),
				React.createElement('button', { className:'btn btn-default', type:'button', onClick:onCancel }, cancel_label),
				' ',
				React.createElement('button', { className:'btn btn-primary', type:'button', onClick:onOkWrap }, ok_label),
			)
		)
	);
};
// end - Nags
// start - Modal and ModalBackdrop and ModalContent***
let gModalEnter = false;
let gModalLeave = false;
const ModalWrap = ReactRedux.connect(
	function(state, ownProps) {
		let { pathname } = ownProps; // router
		let pagestate = state.pages_state[pathname] || {};
		return {
			modal: pagestate.modal
		}
	}
)(React.createClass({
	displayName: 'ModalWrap',
	render() {
		let { modal, pathname } = this.props;

		if (gModalEnter) setTimeout(()=>gModalEnter=false, 0);
		if (gModalLeave) setTimeout(()=>gModalLeave=false, 0); // tactic link229439 is not needed because i only have a single modal visible, unlike nags which has multiple nag elements: `store.dispatch(modPageState(pathname, { modal: {...modal} }));`

		return React.createElement('span', { className:'my-modal-wrap' },
			React.createElement(ReactCSSTransitionGroup, getTrans('modalfade', { transitionEnter:gModalEnter, transitionLeave:gModalLeave }),
				modal && React.createElement(Modal, { modal, pathname })
			),
			React.createElement(ReactCSSTransitionGroup, getTrans('fadequick', { transitionEnter:gModalEnter, transitionLeave:gModalLeave }),
				modal && React.createElement(ModalBackdrop)
			)
		);
	}
}));
const Modal = React.createClass({
	displayName: 'Modal',
	doOk(e) {
		if (!stopClickAndCheck0(e)) return;
		let onClick = deepAccessUsingString(this.props, 'ok.onClick');
		if (onClick) onClick();
		this.closeModal();
	},
	doCancel(e) {
		if (!stopClickAndCheck0(e)) return;
		let onClick = deepAccessUsingString(this.props, 'cancel.onClick');
		if (onClick) onClick();
		this.closeModal();
	},
	closeModal() {
		let { modal, pathname } = this.props; // router
		gModalLeave = true;
		store.dispatch(modPageState(pathname, { modal: {...modal} })); // same tactic as link229439

		store.dispatch(modPageState(pathname, 'modal', undefined));
	},
	scrollbar_width: null,
	measureScrollbar() {
		if (this.scrollbar_width === null) {
			let scrolldiv = document.createElement('div');
		    scrolldiv.className = 'modal-scrollbar-measure';
		    document.body.append(scrolldiv);
		    this.scrollbar_width = scrolldiv.offsetWidth - scrolldiv.clientWidth;
		    document.body.removeChild(scrolldiv);
		}
		return this.scrollbar_width;
	},
    componentDidMount() {
        let dialog = document.querySelector('.modal-dialog');
        let modal = document.querySelector('.modal');
        if (dialog.offsetHeight > window.innerHeight) {
            document.body.style.overflow = 'hidden';
            modal.style.overflowY = 'scroll';
        }
    },
    componentWillUnmount() {
        let dialog = document.querySelector('.modal-dialog');
        let modal = document.querySelector('.modal');
        document.body.style.overflow = '';
        modal.style.overflowY = '';
    },
	render() {
		let { modal } = this.props;

		let { content_component, title, msg, close=true, ok={label:browser.i18n.getMessage('okay')}, cancel={label:browser.i18n.getMessage('cancel')} } = modal; // mapped state
        // ok and cancel are objects with label, onClick keys
		let ok_label = ok && ok.label;
		let cancel_label = cancel && cancel.label;
		// console.log(title, body, ok, cancel, 'props:', this.props, 'props:', this.props);

		return React.createElement('div', { className:'modal', style:{paddingRight:this.measureScrollbar()+'px'} },
			React.createElement('div', { className:'modal-dialog' },
				content_component && React.createElement(window[content_component], { closeModal:this.closeModal, modal }),
				!content_component && React.createElement('div', { className:'modal-content' },
					React.createElement('div', { className:'modal-header' },
						close && React.createElement('button', { className:'close', type:'button', 'data-dismiss':'modal', onClick:this.doCancel },
							React.createElement('span', { 'aria-hidden':'true'}, '×'),
							React.createElement('span', { className:'sr-only'}, browser.i18n.getMessage('close')),
						),
						React.createElement('h4', { className:'modal-title' }, title),
					),
					React.createElement('div', { className:'modal-body' },
						React.createElement('p', undefined, msg)
					),
					(cancel_label || ok_label) && React.createElement('div', { className:'modal-footer' },
						cancel_label && React.createElement('button', { className:'btn btn-default', 'data-dismiss':'modal', onClick:this.doCancel }, cancel_label),
						ok_label && React.createElement('button', { className:'btn btn-primary', onClick:this.doOk }, ok_label)
					)
				)
			)
		);
	}
});
const ModalBackdrop = React.createClass({
	displayName: 'ModalBackdrop',
	render() {
		return React.createElement('div', { className:'modal-backdrop' });
	}
});

var ModalContentComponentEnterCode = React.createClass({ // need var due to link8847777
	displayName: 'ModalContentComponentEnterCode',
	onCancel(e) {
		if (!stopClickAndCheck0(e)) return;
		let { closeModal } = this.props;
		closeModal();
	},
    modModalData(newdata) {
        // newdata - object
        let { modal:oldmodal } = this.props;
        let modal = {
            ...oldmodal,
            data: {
                ...oldmodal.data,
                ...newdata
            }
        };
        store.dispatch(modPageState(ReactRouter.browserHistory.getCurrentLocation().pathname, { modal }));
    },
    async gotoEnabled(buyqty) {
        let { closeModal, modal:{data:{ toggleEnable }} } = this.props;

        toggleEnable(); // enable the hotkey

        closeModal();
        await promiseTimeout(300); // wait for close anim

        let serials = store.getState().serials;
        let max_enable_count = nub.data.min_enable_count + Object.entries(serials).reduce((acc, [,a_buyqty]) => acc + a_buyqty, 0);

        createModal(ReactRouter.browserHistory.getCurrentLocation().pathname, {
            title: 'Hotkey Enabled',
            msg: `Thank you! The hotkey was enabled. The code was accepted and added ${buyqty} extra enabled hotkeys. You can now enable up to ${max_enable_count} hotkeys.`,
            ok: null,
            cancel: { label:browser.i18n.getMessage('close') }
        });
    },
	onOk(e) {
		if (!stopClickAndCheck0(e)) return;
		// let { closeModal } = this.props;
		// closeModal();
        this.modModalData({ form_validity:'IS_VALIDATING_SERIAL' });

        let serial = document.getElementById('entered_code').value; // no need to trim, exe does the trimming
        setTimeout(() => {
            callInExe('validateSerial', serial, newvalidity => {
                let { isvalid, buyqty, reason } = newvalidity;
                if (isvalid) {
                    // alert('enable the hotkey and let him know how many more hotkeys he just added, and his new total');
                    store.dispatch(addSerial(serial, buyqty));
                    this.gotoEnabled(buyqty);
                } else {
                    this.modModalData({ form_validity:reason });
                    document.getElementById('entered_code').focus();
                }
            });
        }, 1000); // so i can show the loader animation
	},
    componentDidMount() {
        document.getElementById('entered_code').focus();
    },
    hideInvalidOnChange() {
        this.modModalData({ form_validity:undefined });
    },
	render() {
        let { modal } = this.props;

        let { form_validity } = modal.data;
        // form_validity - IS_VALIDATING_SERIAL, else: it is reason for IS_INVALID_SERIAL

        let is_validating_serial = form_validity == 'IS_VALIDATING_SERIAL';

        let is_invalid_serial = form_validity && form_validity != 'IS_VALIDATING_SERIAL'
        let invalid_reason = is_invalid_serial && form_validity;

		return React.createElement('div', { className:'modal-content' },
			React.createElement('div', { className:'modal-header' },
				React.createElement('button', { className:'close', type:'button', 'data-dismiss':'modal', onClick:this.onCancel },
					React.createElement('span', { 'aria-hidden':'true'}, '×'),
					React.createElement('span', { className:'sr-only'}, browser.i18n.getMessage('close')),
				),
				React.createElement('h4', { className:'modal-title' }, browser.i18n.getMessage('title_entercode')),
			),
			React.createElement('div', { className:'modal-body entercode' },
				React.createElement('p', undefined, browser.i18n.getMessage('sentence1_entercode')),
                React.createElement('div', { className:'has-feedback' + (is_invalid_serial ? ' has-error' : '') },
                    React.createElement('input', { className:'form-control', type:'text', id:'entered_code', disabled:is_validating_serial, onChange:(is_invalid_serial && this.hideInvalidOnChange) }),
                    is_invalid_serial && React.createElement('i', { className:'form-control-feedback bv-no-label glyphicon glyphicon-remove' }),
                    is_validating_serial && React.createElement('small', { className:'help-block is-validating-serial' },
                        React.createElement('div', { className:'uil-ripple-css ripple-sm' }, React.createElement('div'), React.createElement('div')),
                        'Validating code and enabling extra hotkeys...'
                    ),
                    is_invalid_serial && React.createElement('small', { className:'help-block' }, `The code is invalid. Reason: ${invalid_reason}`)
                )
			),
			React.createElement('div', { className:'modal-footer' },
				React.createElement('button', { className:'btn btn-default', 'data-dismiss':'modal', onClick:this.onCancel }, browser.i18n.getMessage('dismiss_entercode')),
				React.createElement('button', { className:'btn btn-primary', onClick:this.onOk, disabled:is_validating_serial }, browser.i18n.getMessage('confirm_entercode'))
			)
		);
	}
});
var ModalContentComponentInformTab = ReactRedux.connect(
    function(state, ownProps) {
        return {
            serials: state.serials // needed for max_enable_count
        }
    }
)(React.createClass({
	displayName: 'ModalContentComponentInformTab',
    render() {
        let { modal, closeModal, serials } = this.props;

        let max_enable_count = nub.data.min_enable_count + Object.entries(serials).reduce((acc, [,a_buyqty]) => acc + a_buyqty, 0);
        if (!this.init_max_enable_count)
            this.init_max_enable_count = max_enable_count;

		return React.createElement('div', { className:'modal-content' },
			React.createElement('div', { className:'modal-header' },
				React.createElement('button', { className:'close', type:'button', 'data-dismiss':'modal', onClick:closeModal },
					React.createElement('span', { 'aria-hidden':'true'}, '×'),
					React.createElement('span', { className:'sr-only'}, browser.i18n.getMessage('close')),
				),
				React.createElement('h4', { className:'modal-title' }, 'Transaction Tab Opened'),
			),
			React.createElement('div', { className:'modal-body' },
				(this.init_max_enable_count === max_enable_count) && React.createElement('p', undefined, 'Paypal was launched in a new tab. Please complete the the purchase there. The purhcase will get automatically detected and hotkeys added.'),
				(this.init_max_enable_count !== max_enable_count) && React.createElement('p', undefined,
                    'Thank you for your purchase! You now can now enable a total of ',
                    React.createElement('b', undefined, max_enable_count + ' hotkeys')
                )
            ),
			React.createElement('div', { className:'modal-footer' },
				React.createElement('button', { className:'btn btn-default', onClick:closeModal }, 'Close')
			)
		);
    }
}));

var ModalContentComponentBuy = ReactRedux.connect( // need var due to link8847777
    function(state, ownProps) {
        return {
            serials: state.serials // needed for max_enable_count
        }
    }
)(React.createClass({
	displayName: 'ModalContentComponentBuy',
	onCancel(e) {
		if (!stopClickAndCheck0(e)) return;

		let { closeModal } = this.props;
		closeModal();
	},
	async onOk(e) {
		if (!stopClickAndCheck0(e)) return;

		let { closeModal, modal } = this.props;
		closeModal();
        await promiseTimeout(300); // wait for close anim
        this.gotoInitPayapl();
    },
    async gotoInitPayapl() {
        let { closeModal, modal } = this.props;

        createModal(ReactRouter.browserHistory.getCurrentLocation().pathname, {
            title: browser.i18n.getMessage('title_startrans'),
            close: false,
            msg: browser.i18n.getMessage('message_startrans'),
            ok: null,
            cancel: null
        });

        await promiseTimeout(300); // wait create anim

        let paypal_avail_locales = ['da_DK', 'he_IL', 'id_ID', 'ja_JP', 'no_NO', 'pt_BR', 'ru_RU', 'sv_SE', 'th_TH', 'zh_CN', 'zh_HK', 'zh_TW', 'AU', 'AT', 'BE', 'BR', 'CA', 'CH', 'CN', 'DE', 'ES', 'GB', 'FR', 'IT', 'NL', 'PL', 'PT', 'RU', 'US']; // as of 121216 taken from here - https://developer.paypal.com/docs/api/payment-experience/#definition-presentation
        // let wanted_locales = [...new Set([gUserLocales, gExtLocale].map(el => el.toLowerCase()))]; // lowered and deduped
        let wanted_locales = [...new Set([gExtLocale].map(el => el.toLowerCase()))]; // lowered and deduped
        let pplocale = findClosestLocale(paypal_avail_locales, wanted_locales) || 'US'; // 'US' is an improper locale code by paypal, it is just a country code which is real weird
        console.log('wanted_locales:', wanted_locales, 'pplocale:', pplocale);

        let { data:{buyqty} } = modal;

        try {
            let qparams = {locale:pplocale, qty:buyqty, mh:await callIn('Exe', 'getMh', undefined)};
            let qstr = queryStringDom(qparams);
            console.log('qstr:', qstr);
            let xpppinit = await xhrPromise('https://trigger-community.sundayschoolonline.org/paypal.php?' + qstr, { method:'GET', restype:'json' }); // xp_paypal_init

            let { xhr:{response, status} } = xpppinit;

            if (status !== 200) {
                throw xpppinit;
            } else {
                // this.gotoPaypalFrame(response.approval_url);

                // no need to close and wait, as `gotoEnter` will handle that
                // closeModal();
                // await promiseTimeout(300);
                let url = response.approval_url;
                callInBackground('addTab', {url, index_offset:1});
                // this.gotoEnter();
                this.gotoInformTab();
            }
        } catch(xperr) {
            console.log('xperr:', xperr);
            let { xhr:{response, status}, reason } = xperr;

            closeModal();
            await promiseTimeout(300); // wait close

            createModal(ReactRouter.browserHistory.getCurrentLocation().pathname, {
                title: browser.i18n.getMessage('title_failtrans'),
                msg: React.createElement('p', undefined,
                    browser.i18n.getMessage('message_failtrans'),
                    React.createElement('br'),
                    React.createElement('br'),
                    React.createElement('b', undefined, browser.i18n.getMessage('load_reason:') + ' '),
                    reason,
                    React.createElement('br'),
                    React.createElement('b', undefined, browser.i18n.getMessage('status:') + ' '),
                    status,
                    React.createElement('br'),
                    React.createElement('b', undefined, browser.i18n.getMessage('response:') + ' '),
                    JSON.stringify(response)
                ),
                ok: { label:browser.i18n.getMessage('try_again'), onClick:this.onOk }
            });
        }
    },
    // gotoPaypalFrame(url) {
    //     createModal(ReactRouter.browserHistory.getCurrentLocation().pathname, {
    //         title: 'Paypal',
    //         msg: React.createElement('p', undefined,
    //             'Please complete the Paypal process in the frame below.',
    //             React.createElement('br'),
    //             React.createElement('br'),
    //             React.createElement('iframe', { src:url, width:'500px', height:'600px' })
    //         ),
    //         close: false,
    //         ok: null,
    //         cancel: null
    //     });
    // },
    async gotoInformTab() {
        let { closeModal } = this.props;
        closeModal();
        await promiseTimeout(300);
        createModal(ReactRouter.browserHistory.getCurrentLocation().pathname, { content_component:'ModalContentComponentInformTab', data:{} })
    },
    async gotoEnter(e) {
        if (!stopClickAndCheck0(e)) return;
        let { closeModal, modal:{data:{ toggleEnable }} } = this.props;
        closeModal();
        await promiseTimeout(300);
        createModal(ReactRouter.browserHistory.getCurrentLocation().pathname, { content_component:'ModalContentComponentEnterCode', data:{toggleEnable} })
    },
    setBuyQty(aBuyQty) {
        // aBuyQty must be number

        let { modal:oldmodal } = this.props;
        let modal = {
            ...oldmodal,
            data: {
                ...oldmodal.data,
                buyqty: aBuyQty
            }
        };
        store.dispatch(modPageState(ReactRouter.browserHistory.getCurrentLocation().pathname, { modal }));
    },
	render() {
        let { modal, serials } = this.props;
        let { data:{buyqty} } = modal;

        let max_enable_count = nub.data.min_enable_count + Object.entries(serials).reduce((acc, [,a_buyqty]) => acc + a_buyqty, 0);

		return React.createElement('div', { className:'modal-content' },
			React.createElement('div', { className:'modal-header' },
				React.createElement('button', { className:'close', type:'button', 'data-dismiss':'modal', onClick:this.onCancel },
					React.createElement('span', { 'aria-hidden':'true'}, '×'),
					React.createElement('span', { className:'sr-only'}, browser.i18n.getMessage('close')),
				),
				React.createElement('h4', { className:'modal-title' }, browser.i18n.getMessage('title_maxhotkeysenabled')),
			),
			React.createElement('div', { className:'modal-body' },
				React.createElement('p', undefined,
                ...messageDownReactMarkup(browser.i18n.getMessage('sentence1_maxhotkeysenabled', max_enable_count))
            ),
			React.createElement('p', undefined, browser.i18n.getMessage('sentence2_maxhotkeysenabled').replace('%DOLLA%', '$')),
                React.createElement(InputNumber, { component:InputNumberBuyForm, buyqty, cursor:'ns-resize', min:1, max:12, dispatcher:this.setBuyQty, defaultValue:buyqty })
			),
			React.createElement('div', { className:'modal-footer' },
				React.createElement('button', { className:'btn btn-link pull-left', onClick:this.gotoEnter }, browser.i18n.getMessage('havecode_maxhotkeysenabled')),
				React.createElement('button', { className:'btn btn-default', 'data-dismiss':'modal', onClick:this.onCancel }, browser.i18n.getMessage('dismiss_maxhotkeysenabled')),
				React.createElement('button', { className:'btn btn-primary', onClick:this.onOk }, browser.i18n.getMessage('confirm_maxhotkeysenabled' + (buyqty > 1 ? '_plural' : ''), buyqty))
			)
		);
	}
}));
const InputNumberBuyForm = React.createClass({
    displayName: 'InputNumberBuyForm',
    showTimedCrementOverlay() {
        // needed because once hit ismaxish or isminish the buttons get disabled, which dont trigger the onMouseUp events on it, or even on the body as that is under it. needed something over it.
        let overlay = this.overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed; height:100vh; width:100vw; top:0; left:0; z-index:2000;';
        document.documentElement.appendChild(overlay);
        overlay.addEventListener('mouseup', this.removeTimedCrementOverlay, false);
    },
    removeTimedCrementOverlay() {
        let { timedCrementStop } = this.props;
        timedCrementStop();
        this.overlay.parentNode.removeChild(this.overlay);
        delete this.overlay;
    },
    onMinus(e) {
        if (!allowDownAndCheck0(e)) return;
        let { timedCrement } = this.props;
        this.showTimedCrementOverlay();
        timedCrement(-0);
    },
    onPlus(e) {
        if (!allowDownAndCheck0(e)) return;
        let { timedCrement } = this.props;
        this.showTimedCrementOverlay();
        timedCrement(0);
    },
    render() {
        let { children, domprops_mouseable, domprops_text, isinvalid, ismaxish, isminish } = this.props; // InputNumber specific props
        let { buyqty } = this.props; // props that skip InputNumber and are meant to be sent straght to here

        return React.createElement('div', { id:'buy_field', className:'form-group' + (isinvalid ? ' has-error' : '') },
            children, // required by InputNumber crossfile-link92828222
            React.createElement('label', { htmlFor:'buy_qty', className:'pull-left', ...domprops_mouseable }, browser.i18n.getMessage('quantity_maxhotkeysenabled')),
            React.createElement('b', { className:'pull-right', ...domprops_mouseable }, browser.i18n.getMessage('totalprice_maxhotkeysenabled', buyqty).replace('%DOLLA%', '$')),
            React.createElement('div', { className:'input-group' },
                React.createElement('input', { className:'form-control', type:'text', ...domprops_text }),
                isinvalid && React.createElement('i', { className:'form-control-feedback bv-no-label glyphicon glyphicon-remove' }),
                React.createElement('div', { className:'input-group-btn' },
                    React.createElement('button', { className:'btn btn-default', type:'button', onMouseDown:this.onMinus, disabled:isminish },
                        React.createElement('span', { className:'glyphicon glyphicon-minus'})
                    ),
                    React.createElement('button', { className:'btn btn-default', type:'button', onMouseDown:this.onPlus, disabled:ismaxish },
                        React.createElement('span', { className:'glyphicon glyphicon-plus' })
                    )
                )
            ),
            isinvalid && React.createElement('small', { className:'help-block' }, 'Must be a number between 1 and 12')
        );
    }
});
// end - Modal and ModalBackdrop
// start - Header
const Header = React.createClass({
	displayName: 'Header',
	render() {
		let { pathname, params, query } = this.props;

        let crumbs;
        if (nub.self.fatal) {
            crumbs = ['fatal'];
        } else if (nub.self.fatal === undefined) {
            crumbs = ['startingup'];
        } else {

    		let pathcrumbs = {
    			'/': ['myhotkeys'],
    			'/add': ['myhotkeys', 'addcommand'],
    			'/add/browse': ['myhotkeys', 'addcommand', 'community'],
    			'/add/create': ['myhotkeys', 'addcommand', 'createcommand'],
                '/purchase': ['myhotkeys', 'purchase']
    			// '/auth': ['auth'], // special case
    			// '/edit': ['myhotkeys', 'editcommand'], // special case
    			// '/versions': ['myhotkeys', 'versionscommand'] // special case
    		};
    		// special cases - /edit, /versions
    		let special = /(edit|versions)\/(_?[a-z0-9]{8})/.exec(pathname)
    		if (special) {
    			let [, subcrumb, filename] = special;
    			let hotkey = store.getState().hotkeys.find(a_hotkey => a_hotkey.command.filename == filename);
    			let { name } = hotkey.command.content.locales[gExtLocale]; // TODO: multilocale
    			pathcrumbs[pathname] = ['myhotkeys', browser.i18n.getMessage(`crumb_${subcrumb}command`, name)]
    		}

            // special case - /auth
            if (pathname == '/auth') {
                let { serviceid } = query;
                pathcrumbs[pathname] = [ browser.i18n.getMessage('crumb_auth', browser.i18n.getMessage('servicename_' + serviceid)) ];
            }

    		crumbs = pathcrumbs[pathname] || ['invalid'];
        }

		// localize it and wrap it <small>
		crumbs.forEach( (crumb, i, arr) =>
			arr[i] = React.createElement( 'small', { style:{whiteSpace:'no-wrap'} }, (browser.i18n.getMessage('crumb_' + crumb) || crumb) ) // if change from `small` then update link72188
		);

		if (crumbs.length > 1)
			pushAlternatingRepeating(crumbs, React.createElement('small', { style:{whiteSpace:'normal'} }, ' > ') );

		return React.createElement('div', { className:'row' },
			React.createElement('div', { className:'col-lg-12' },
				React.createElement('h1', { className:'page-header' },
                    browser.i18n.getMessage('addon_name') + ' ',
                    ...crumbs // if a crumb isnt the last element update querySelector in link72188
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
			hotkeys: state.hotkeys,
            mos: state.oauth.github
		}
	}
)(React.createClass({
	displayName: 'PageMyHotkeys',
	render() {
		let { hotkeys, mos } = this.props; // mapped state

		return React.createElement('span', undefined,
			// controls
			React.createElement('div', { className:'row text-center' },
				React.createElement('div', { className:'col-lg-12' },
					browser.i18n.getMessage('myhotkeys_page_description'),
					mos && React.createElement('br'),
					mos && React.createElement('br'),
					mos && React.createElement(OauthManager)
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
const Hotkey = ReactRedux.connect(
	function(state, ownProps) {
		let { pages_state:{'/':pagestate={}} } = state;

		return {
			recording: pagestate.recording, // { filename-of command to find hotkey, current-current recording }
			hotkeys: state.hotkeys, // used to determine if already three thigns enabled
            serials: state.serials // for determining max_enable_count
		}
	}
)(React.createClass({
	displayName: 'Hotkey',
	trash(e) {
		// trash hotkey and command
		if (!stopClickAndCheck0(e)) return;
		this.cancelRecordingIfSelf();
		let { dispatch } = this.props; // redux
		let { hotkey:{enabled, command:{filename}} } = this.props;
		dispatch(removeHotkey(filename));
		if (enabled) callInExe('removeHotkey', { filename });
	},
	edit(e) {
		// edit command
		if (!stopClickAndCheck0(e)) return;
		this.cancelRecordingIfSelf();
		let { hotkey } = this.props;
		let { hotkey:{command:{filename}} } = this.props;
		// loadPage('/edit/' + filename, { testing:genFilename() }); // sets pagestate shows how i can do this in a redux way rather then a router way (relying on props.params)
		loadPage('/edit/' + filename);
	},
    shareModal(e) {
        if (!stopClickAndCheck0(e)) return;

        let { hotkey } = this.props;

        createModal(
            ReactRouter.browserHistory.getCurrentLocation().pathname,
            {
                content_component: 'ModalContentShareCommand',
                data: {
                    progress: undefined,
                    hotkey
                }
                // title: 'Share Command?',
                // ok: {
                // 	label: 'Yes, Share Now',
                // 	onClick: this.share
                // },
                // cancel: { label: 'No, Don\'t Share' },
                // message:
            }
        );

    },
	cancelRecordingIfSelf() {
		// returns 1 if stopped, returns 0 if nothing recording, returns -1 if something else is recording
		let { dispatch } = this.props; // redux
		let { recording } = this.props; // mapped state
		let { hotkey } = this.props;

		let { filename } = hotkey.command;

		if (recording) {
			if (recording.filename == filename) {
				dispatch(modPageState('/', 'recording', undefined));
				callInExe('stopRecordingKeys');
				return 1;
			} else {
				return -1;
			}
		} else {
			return 0;
		}
	},
	setHotkey(e) {
		if (!stopClickAndCheck0(e)) return;

		let { dispatch } = this.props; // redux
		let { hotkey } = this.props;
		let { filename } = hotkey.command;

		if (this.cancelRecordingIfSelf() !== 0)  throw 'either just canceled recording, OR something else is recording';

		dispatch(modPageState('/', 'recording', {filename, current:{mods:[]} }));

		callInExe('startRecordingKeys', undefined, ({__PROGRESS, recording:current, cancel}) => {
			if (__PROGRESS) {
				console.log('current:', current);
				// replace current thats all
				dispatch(modPageState('/', 'recording', {filename, current }));
			} else {
				console.log('ok done, cancel:', cancel, 'current:', current);
				if (!cancel) {
					console.log('no cancel, set it');
					// in case user made changes while recording was going on
					let updatedhotkey = store.getState().hotkeys.find(a_hotkey => a_hotkey.command.filename == filename);
					let newhotkey = { ...updatedhotkey, combo:current };
					dispatch(editHotkey(newhotkey));
					// check if hotkey is enabled, if it is, then callInExe('addHotkey'), it will overwrite
					if (updatedhotkey.enabled) {
						callInExe('addHotkey', { // will overwrite the old one
							combo: newhotkey.combo,
							filename
						});
					}
				}
				dispatch(modPageState('/', 'recording', undefined));
			}
		});
	},
	toggleEnable(e) {
		if (!stopClickAndCheck0(e)) return;

		let { dispatch } = this.props; // redux
		let { hotkey } = this.props;
		let { hotkeys, serials } = this.props; // mapped state

		let { combo, enabled } = hotkey;

        let max_enable_count = nub.data.min_enable_count + Object.entries(serials).reduce((acc, [,a_buyqty]) => acc + a_buyqty, 0);

		let hashotkey = !!combo;
		let isenabled = hotkey.enabled;
		let allowenable = hashotkey && (isenabled || hotkeys.filter(a_hotkey => a_hotkey.enabled).length < max_enable_count);

		if (!allowenable) {
			createModal(
				ReactRouter.browserHistory.getCurrentLocation().pathname,
				{
					content_component: 'ModalContentComponentBuy',
                    data: {
                        buyqty: 1,
                        toggleEnable: this.toggleEnable
                    }
					// title: browser.i18n.getMessage('title_maxhotkeysenabled'),
					// template: 'Buy',
					// body: 'Buy',
					// ok: {
					// 	label: browser.i18n.getMessage('confirm_maxhotkeysenabled'),
					// 	// onClick: function
					// },
					// cancel: {
					// 	label: browser.i18n.getMessage('dismiss_maxhotkeysenabled'),
					// 	// onClick:
					// }
				}
			);
			return;
		}

		let newenabled = !hotkey.enabled; // true for enabled, false for disabled

		if (newenabled) {
			callInExe('addHotkey', { combo:hotkey.combo, filename: hotkey.command.filename }, ({didenable,reason,max_enable_count:max_enable_count_exe}) => {
                if (!didenable) {
                    alert(`Failed to enable hotkey.\nReason: ${reason}\nMax Enabled Count: ` + max_enable_count_exe);
                    let newhotkey = { ...hotkey };
            		dispatch(editHotkey(newhotkey));
                }
            });
		} else {
			callInExe('removeHotkey', {
				filename: hotkey.command.filename
			});
		}

		let newhotkey = { ...hotkey, enabled:newenabled };
		dispatch(editHotkey(newhotkey));
	},
	render() {
		let { hotkey } = this.props;
		let { recording, hotkeys, serials } = this.props; // mapped state

		let { enabled, combo, command } = hotkey;
		let { share_unix, filename, content:{group, locales:{[gExtLocale]:{name, description}}, code:{exec:code}} } = command; // TODO: multilocale
		// share_unix, filename, group, name, description, code

        let max_enable_count = nub.data.min_enable_count + Object.entries(serials).reduce((acc, [,a_buyqty]) => acc + a_buyqty, 0);

		let hashotkey = !!combo;

		let islocal = filename.startsWith('_'); // is something that was never submited to github yet
		// cant use `locale.file_sha` and `code.file_sha` to determine `islocal`, as it might be edited and not yet shared
		// it also CAN be shared but not yet PR merged

		let isshared = (!islocal && share_unix); // if has share_unix, it doesnt have base_share_unix. base_share_unix would indicate that a remotecommand was locally edited

		let isupdated = islocal ? true : true; // TODO: if its not local, i need to check if its updated, maybe add a button for "check for updates"?

		let isenabled, allowenable, tooltip_enable, color_enable;
		if (hashotkey) {
			isenabled = enabled;
			allowenable = isenabled || hotkeys.filter(a_hotkey => a_hotkey.enabled).length < max_enable_count;
			tooltip_enable = browser.i18n.getMessage('tooltip_disablehotkey');
			color_enable = 'danger';
			if (!isenabled) { // its disabled
				color_enable = 'success';
				tooltip_enable = browser.i18n.getMessage('tooltip_enablehotkey');
				if (!allowenable) color_enable = 'default';
				// if (allowenable) tooltip_enable = browser.i18n.getMessage('tooltip_enablehotkey');
				// else tooltip_enable = browser.i18n.getMessage('tooltip_maxhotkeysenabled', max_enable_count);
			}
		}

		let isrecording_self = recording && recording.filename == filename;
		let isrecording_other = recording && recording.filename != filename;
		let comboprops = { combo };
		if (isrecording_self) comboprops.combo = recording.current;


		return React.createElement('div', { className:'col-md-3 col-sm-6 hero-feature' },
			React.createElement('div', { className:'thumbnail' },
				// React.createElement('img', { src:'http://placehold.it/800x500', alt:'' }),
				React.createElement('div', { className:'caption' },
					React.createElement(HotkeyComboTxt, comboprops),
					React.createElement('p', undefined,
						name
					),
					React.createElement('p', undefined,
						React.createElement('a', { href:'#', className:'btn btn-' + (isrecording_self ? 'danger' : (!isrecording_other && !hashotkey ? 'primary' : 'default')), 'data-tooltip':(isrecording_self ? browser.i18n.getMessage('tooltip_cancelchangehotkey') : (isrecording_other ? undefined : browser.i18n.getMessage(hashotkey ? 'tooltip_changehotkey' : 'tooltip_sethotkey'))), onClick:this.setHotkey, disabled:isrecording_other },
							React.createElement('span', { className:'glyphicon glyphicon-refresh' })
						),
						' ',
						React.createElement('a', { href:'#', className:'btn btn-default', 'data-tooltip':browser.i18n.getMessage('tooltip_editcommand'), onClick:this.edit },
							React.createElement('span', { className:'glyphicon glyphicon-pencil' })
						),
						hashotkey && ' ',
						hashotkey && React.createElement('a', { href:'#', className:'btn btn-' + color_enable, 'data-tooltip':tooltip_enable, onClick:this.toggleEnable, /*disabled:!allowenable*/ },
							React.createElement('span', { className:'glyphicon glyphicon-off' })
						),
						' ',
						React.createElement('a', { href:'#', className:'btn btn-default', 'data-tooltip':browser.i18n.getMessage('tooltip_removehotkeycommand'), onClick:this.trash },
							React.createElement('span', { className:'glyphicon glyphicon-trash' })
						),
						!isshared && ' ',
						!isshared && React.createElement('a', { href:'#', className:'btn btn-default', 'data-tooltip':browser.i18n.getMessage('tooltip_sharecommand'), onClick:this.shareModal },
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
}));

function throwUnhandledResponse(xperr, extrafields) {
    let { reason, xhr:{response, status, responseURL:url} } = xperr;
    throw { ...extrafields, reason:'UNHANDLED_SERVER_RESPONSE', xhr:{response, reason, status, url} };
}
var ModalContentShareCommand = ReactRedux.connect(
    function(state, ownProps) {
        return {
            mos: state.oauth.github //mem_oauth_serviceid
        }
    }
)(React.createClass({ // need var due to link8847777
	displayName: 'ModalContentShareCommand',
    share: async function() {
		// share command

        let { modal, closeModal } = this.props;
		let { dispatch } = this.props; // redux
        let { mos } = this.props; // mapped state

		let { hotkey } = modal.data;
		let { command } = hotkey;
		let { filename } = command;

		// let oc = nub.oauth.github; // oauth_config

		let hotkey_withnewcommand = JSON.parse(JSON.stringify(hotkey));
		let newcommand = hotkey_withnewcommand.command;

		try {
			// step 1 - delete repo
            this.modModalData({ progress:'SHARING_DELETING_FORK_ST' });
			// `https://api.github.com/repos/${mos.dotname}/testapi`
			// gives 204 when done. or 404 if it wasnt there meaning nothing to delete
			await xhrPromise(`https://api.github.com/repos/${mos.login}/Trigger-Community`, { method:'DELETE', headers:{ Accept:'application/vnd.github.v3+json', Authorization:'token ' + mos.access_token } });

			// step 2 - fork it - 202 after forked - even if already forked it gives 202
            this.modModalData({ progress:'SHARING_FORKING' });
			// https://api.github.com/repos/Noitidart/testapi/forks
			let xpfork = await xhrPromise('https://api.github.com/repos/Noitidart/Trigger-Community/forks', { method:'POST', headers:{ Accept:'application/vnd.github.v3+json', Authorization:'token ' + mos.access_token } });
			console.log('xpfork:', xpfork);
			if (xpfork.xhr.status !== 202) throwUnhandledResponse(xpfork); // throw 'Failed to do step "Pull Request Step 2 - Fork Repo"';

			// step 2.1 - need to wait till fork completes - i do 1min - docs say it can take up to 5, if more then that they say contact support
			// http://stackoverflow.com/a/33667417/1828637
			// (new Date()).toISOString().replace(/\.\d+Z/,'Z')
			// https://api.github.com/repos/noitdev/testapi/commits?since=2016-11-20T06:14:02Z
			// if get 409 then not yet done. wait till get 200
			await doRetries(1000, 60, async function(aCnt) {
                this.modModalData({ progress:'SHARING_CHECKING_FORK_DONE', progress_data:(aCnt+1) });
				let data = queryStringDom({ since: (new Date()).toISOString().replace(/\.\d+Z/,'Z') });
				let xpwait = await xhrPromise(`https://api.github.com/repos/${mos.login}/Trigger-Community/commits?${data}`, { headers:{ Accept:'application/vnd.github.v3+json' } });
				console.log('xpwait:', xpwait);

                if (xpwait.xhr.status === 409) {
                    this.modModalData({ progress:'SHARING_WAITING_FORK_DONE', progress_data:(aCnt+2) });
                    throw 'retry';
                }
                else if (xpwait.xhr.status !== 200) throwUnhandledResponse(xpwait, { STOP_RETRIES:1 }); // throw 'Failed to do step "Pull Request Step 2.1 - Wait Fork Finish"';
                // else its 200 so success, return undefined
			}.bind(this));

			// step 3 - create/update file
			let prtitle;

			for (let go2=0; go2<1; go2++) {
				if (filename.startsWith('_')) {
				// if (pref_hotkey.file_sha) 'No changes made! actually it can be new one created' THAT's why i prefix with `_` instead of `if (!pref_hotkey.base_file_sha && !pref_hotkey.file_sha)` // NOTE:
					// never shared yet
					prtitle = prtitle || 'Add new command';

					// step 3a.1
					// check if filename exists - so getting avaialble filename as newfilename
					// `https://api.github.com/repos/noitdev/testapi/contents/${newfilename}-code.json`
					let newfilename = filename.substr(1);
					while (true) {
                        this.modModalData({ progress:'SHARING_NEW_GENERATING_FILENAME' });
						let xpexists = await xhrPromise(`https://api.github.com/repos/${mos.login}/Trigger-Community/contents/${newfilename}.json`, { headers:{ Accept:'application/vnd.github.v3+json' } });
						console.log('xpexists:', xpexists);
						if (xpexists.xhr.status === 404) break; // newfilename is not taken
						else if (xpexists.xhr.status !== 200) throwUnhandledResponse(xpexists);
                        // else its 200, meaning filename taken

						newfilename = genFilename();
						// await promiseTimeout(200);
					}
					newcommand.filename = newfilename;

					// step 3a.2 - create file
                    this.modModalData({ progress:'SHARING_NEW_UPLOADING_FILE' });
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
					if (xpcreate.xhr.status === 201) {
                        let file_sha = xpcreate.xhr.response.content.sha;
						// delete newcommand.base_file_sha; // doesnt have base_commit_sha as this is "never shared yet"
						// delete newcommand.base_share_unix; // doesnt have base_commit_sha as this is "never shared yet"
						// delete newcommand.changes_since_base; // doesnt have base_commit_sha as this is "never shared yet"
						newcommand.file_sha = file_sha;
						newcommand.share_unix = commit_message.unix;
                    }
                    else throwUnhandledResponse(xpcreate); // throw 'Failed to do step "Pull Request Step 3a.2 - Create File"';
				} else {
					// update file

					// if (!command.changes_since_base) throw 'You made no changes since last update, nothing to share!'

					// step 3b.1 get sha of file - actually get contents so i can calculate changes
                    this.modModalData({ progress:'SHARING_UPDATE_FETCHING_SHA'});
					let xpsha = await xhrPromise(`https://api.github.com/repos/Noitidart/Trigger-Community/contents/${filename}.json`, { restype:'json', headers:{ Accept:'application/vnd.github.v3+json' } });
					console.log('xpsha:', xpsha);
					if (xpsha.xhr.status === 404) {
						// gives 404 if user created THEN shared THEN before i accept pull request user edited and shared another update
						// not an issue if already initiall accepted pr, it will just come in as another update
						// so repeat step 3 but as "brand new local going to"
						prtitle = 'Add new command again - initial PR was not yet accepted';
						filename = '_' + filename;
						go2--; // go2 = -1;
						continue;
					}
					if (xpsha.xhr.status !== 200) throwUnhandledResponse(xpsha); // throw 'Failed to do step "Pull Request Step 3b.1 - Get "${filename}" File SHA and Compare Master Contents"';
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
                    this.modModalData({ progress:'SHARING_UPDATE_UPLOADING_FILE'});
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
                    if (xpupdate.xhr.status === 200) {
                        let file_sha = xpupdate.xhr.response.content.sha;
						delete newcommand.base_file_sha;
						delete newcommand.base_share_unix;
						// delete newcommand.changes_since_base;
						newcommand.file_sha = file_sha;
						newcommand.share_unix = commit_message.unix;
                    }
                    else throwUnhandledResponse(xpupdate); // throw 'Failed to do step "Pull Request Step 3b.2 - Update File"';
				}
			}

			// step 4 - create pull request
            this.modModalData({ progress:'SHARING_CREATING_DISCUSS_TOPIC'});
			// https://api.github.com/repos/Noitidart/testapi/pulls
			let xppr = await xhrPromise({
				url: 'https://api.github.com/repos/Noitidart/Trigger-Community/pulls',
				method: 'POST',
				restype: 'json',
				data: JSON.stringify({
					title: prtitle,
					body: ReactDOM.findDOMNode(this).querySelector('textarea').value.trim(),
					head: `${mos.login}:master`,
					base: 'master'
				}),
				headers: {
					Accept: 'application/vnd.github.v3+json',
					Authorization: 'token ' + mos.access_token
				}
			});
			console.log('xppr:', xppr);
			if (xppr.xhr.status !== 201) throwUnhandledResponse(xppr); // throw 'Failed to do step "Pull Request Step 4 - Create Request"';

			let { html_url:prurl } = xppr.xhr.response;

            // step 5 - delete fork
            this.modModalData({ progress:'SHARING_DELETING_FORK_END'});
			// `https://api.github.com/repos/${mos.dotname}/testapi`
			// gives 204 when done - if it errors here i dont care
			await xhrPromise(`https://api.github.com/repos/${mos.login}/Trigger-Community`, { method:'DELETE', headers:{ Accept:'application/vnd.github.v3+json', Authorization:'token ' + mos.access_token } });

			/////// ok pull request creation complete - update store and storage
			// the reducer will update storage
			dispatch(editHotkey(hotkey_withnewcommand, command.filename));

            if (newcommand.filename != command.filename) {
                if (hotkey.enabled) {
                    // because filename changed, i need to update exe
                    callInExe('removeHotkey', { // will overwrite the old one
                        combo: hotkey.combo,
                        filename: command.filename
                    });
                    callInExe('addHotkey', {
                        combo: hotkey.combo,
                        filename: newcommand.filename
                    });
                }
            }

            this.modModalData({ progress:'SHARED', progress_data:prurl });
		} catch(ex) {
			console['error'](browser.i18n.getMessage('github_shared_fail', [ex.toString()]));
			// alert(browser.i18n.getMessage('github_shared_fail', [ex]));
            let progress_failed = store.getState().pages_state[ReactRouter.browserHistory.getCurrentLocation().pathname].modal.data.progress; // the progress it was working before failure. so the progress step it failed on.
            console.log('progress_failed:', progress_failed);
            this.modModalData({ progress:'SHARE_ERROR', progress_data: {
                ex: ex,
                progress_failed
            }});
		}
	},
	onCancel(e) {
		if (!stopClickAndCheck0(e)) return;

		let { closeModal } = this.props;
		closeModal();
	},
	onOk(e) {
		if (!stopClickAndCheck0(e)) return;

		// let { closeModal, modal:{data:{onConfirm}} } = this.props;
		// closeModal();
        // onConfirm(undefined, true);

        let txtarea = ReactDOM.findDOMNode(this).querySelector('textarea');
        let value = txtarea.value.trim();
        if (value.length < 3) {
            this.modModalData({ progress:'AWAITING_INPUT_ERROR_CHARS' });
            setTimeout(()=>txtarea.focus(), 0);
        } else {
            this.share();
        }
	},
    modModalData(newdata) {
        // newdata - object
        let { modal:oldmodal } = this.props;
        let modal = {
            ...oldmodal,
            data: {
                ...oldmodal.data,
                ...newdata
            }
        };
        store.dispatch(modPageState(ReactRouter.browserHistory.getCurrentLocation().pathname, { modal }));
    },
    refTxtarea(domel) {
        if (domel) setTimeout(()=>domel.focus(), 0);
    },
    txtareaChange(e) {
        this.modModalData({ progress:undefined });
    },
    onAuthNow() {
        callInBackground('openAuthTab', { serviceid:'github' });
    },
	render() {
		let { modal, mos } = this.props;
		let { data } = modal;

        // progress - undefined/string;enum[] - text to show on upload progress of share. is undefined when have not yet clicked "Yes, Share Now"
        // enum progress:
        const AWAITING_INPUT = 'AWAITING_INPUT';
        const AWAITING_INPUT_ERROR_CHARS = 'AWAITING_INPUT_ERROR_CHARS';
        const SHARING_DELETING_FORK_ST = 'SHARING_DELETING_FORK_ST';
        const SHARE_ERROR = 'SHARE_ERROR';
        const SHARED = 'SHARED';

        let { progress=AWAITING_INPUT, hotkey } = data;

        let sharelabel;
        switch (progress) {
            case AWAITING_INPUT:
            case AWAITING_INPUT_ERROR_CHARS:
                    sharelabel = 'Share';
                break;
            case SHARE_ERROR:
                    sharelabel = 'Try Sharing Again';
                break;
            case progress.startsWith('SHARING_') && progress:
                    sharelabel = 'Sharing...';
                break;
        }

        let share_disable;
        switch (progress) {
            case progress.startsWith('SHARING_') && progress:
                    share_disable = true;
                break;
        }

        let share_showicon;
        switch (progress) {
            case progress.startsWith('SHARING_') && progress:
                    share_showicon = true;
                break;
        }

        let shouldshowclose;
        switch (progress) {
            case AWAITING_INPUT:
            case AWAITING_INPUT_ERROR_CHARS:
            case SHARE_ERROR:
                    shouldshowclose = true;
                break;
            case progress.startsWith('SHARING_') && progress:
                    shouldshowclose = false;
                break;
        }

        let helpblock;
        switch (progress) {
            case AWAITING_INPUT_ERROR_CHARS:
                    helpblock = 'Message must be at least three chracters';
                break;
        }

        let txtarea_disabled;
        switch (progress) {
            case progress.startsWith('SHARING_') && progress:
                    txtarea_disabled = true;
                break;
        }

        let txtareaChange;
        switch (progress) {
            case AWAITING_INPUT_ERROR_CHARS:
                    txtareaChange = this.txtareaChange;
                break;
        }

        let form_class;
        switch (progress) {
            case AWAITING_INPUT_ERROR_CHARS:
                    form_class = 'has-feedback has-error';
                break;
        }

        let statusmsg;
        switch (progress) {
            case progress.startsWith('SHARING_') && progress:
                    statusmsg = progress;
                break;
            case 'SHARE_ERROR':
                    let { progress_failed, ex } = data.progress_data;
                    statusmsg = [ 'Failed sharing at step ' + progress_failed + '.' ];
                    if (typeof(ex) == 'string') {
                        statusmsg.push(' ' + ex);
                    } else if (ex && typeof(ex) == 'object' && ex.reason == 'UNHANDLED_SERVER_RESPONSE') {
                        // browser.i18n.getMessage('github_shared_fail', [ex.toString()])
                        let { url, reason:xhrreason, status, response } = ex.xhr;
                        statusmsg.push(
                            React.createElement('dl', undefined,
                                React.createElement('dt', undefined,
                        			React.createElement('dd', undefined,
                        				browser.i18n.getMessage('url:') + ' ' + url
                        			),
                        			React.createElement('dd', undefined,
                        				browser.i18n.getMessage('status:') + ' ' + status
                        			),
                        			React.createElement('dd', undefined,
                        				browser.i18n.getMessage('load_reason:') + ' ' + xhrreason
                        			),
                        			React.createElement('dd', undefined,
                        				browser.i18n.getMessage('response:') + ' ',
                        				React.createElement('pre', undefined, response)
                        			)
                        		)
                        	)
                        );
                    } else {
                        statusmsg.push(' ' + ex.toString());
                    }
                break;
        }

        let statuspercent;
        switch (progress) {
            case progress.startsWith('SHARING_') && progress:
                    let steppercents = {
                        SHARING_DELETING_FORK_ST: 1,
                        SHARING_FORKING: 2,
                        SHARING_CHECKING_FORK_DONE: 3,
                        SHARING_WAITING_FORK_DONE: 3,

                        SHARING_NEW_GENERATING_FILENAME: 4,
                        SHARING_NEW_UPLOADING_FILE: 5,
                        SHARING_UPDATE_FETCHING_SHA: 4,
                        SHARING_UPDATE_UPLOADING_FILE: 5,

                        SHARING_CREATING_DISCUSS_TOPIC: 6,
                        SHARING_DELETING_FORK_END: 7
                    };
                    statuspercent = Math.round(steppercents[progress] / 7 * 100);
                break;
        }

        let sharebtncolor = progress == 'SHARE_ERROR' ? 'danger' : 'primary';

        if (mos) {
            if (progress == SHARED) {
                return React.createElement('div', { className:'modal-content' },
                    React.createElement('div', { className:'modal-header' },
                        React.createElement('button', { className:'close', type:'button', 'data-dismiss':'modal', onClick:this.onCancel },
                            React.createElement('span', { 'aria-hidden':'true'}, '×'),
                            React.createElement('span', { className:'sr-only'}, browser.i18n.getMessage('close')),
                        ),
                        React.createElement('h4', { className:'modal-title' }, 'Share Command'),
                    ),
                    React.createElement('div', { className:'modal-body' },
                        React.createElement('p', undefined,
                            messageDownReactMarkup(`Succesfully shared <B>${hotkey.command.content.locales[gExtLocale].name}</B>. It is now pending review and approval. `),
                            React.createElement('a', {href:data.progress_data, target:'_blank'}, 'Click here to open approval topic in new tab.')
                        )
                    ),
                    React.createElement('div', { className:'modal-footer' },
                        React.createElement('button', { className:'btn btn-default status-nobtn', 'data-dismiss':'modal', onClick:this.onCancel }, browser.i18n.getMessage('close'))
                    )
                );
            } else {
                return React.createElement('div', { className:'modal-content' },
                    React.createElement('div', { className:'modal-header' },
                        shouldshowclose && React.createElement('button', { className:'close', type:'button', 'data-dismiss':'modal', onClick:this.onCancel },
                            React.createElement('span', { 'aria-hidden':'true'}, '×'),
                            React.createElement('span', { className:'sr-only'}, browser.i18n.getMessage('close')),
                        ),
                        React.createElement('h4', { className:'modal-title' }, 'Share Command'),
                    ),
                    React.createElement('div', { className:'modal-body' },
                        statusmsg && React.createElement('div', { className:'alert alert-' + (progress == SHARE_ERROR ? 'danger' : 'info'), style:{marginBottom:'10px'} },
                            progress == SHARE_ERROR && React.createElement('b', undefined, browser.i18n.getMessage('error_upper') + ' '),
                            ...statusmsg
                        ),
                        React.createElement('form', { className:form_class },
                            React.createElement('div', { class:'form-group', style:{marginBottom:'10px', opacity:(txtarea_disabled ? 0.5 : undefined)} },
                                React.createElement('b', { style:{marginRight:'10px'} }, 'Command'),
                                hotkey.command.content.locales[gExtLocale].name
                            ),
                            React.createElement('div', { className:'form-group', style:{marginBottom:0} },
                                React.createElement('label', { style:(txtarea_disabled ? {opacity:0.5} : undefined) }, 'Type a message explaining your changes'),
                                React.createElement('textarea', { className:'form-control', disabled:txtarea_disabled, style:{resize:'none'}, rows:3, ref:this.refTxtarea, onChange:txtareaChange }),
                                helpblock && React.createElement('span', { className:'help-block', style:{marginBottom:0} }, helpblock)
                            )
                        )
                    ),
                    React.createElement('div', { className:'modal-footer' },
                        statuspercent !== undefined && React.createElement('button', { className:'btn btn-link pull-left status-nobtn' },
                            React.createElement('div', { className:'progress', style:{width:'200px', marginBottom:'0'} },
                                React.createElement('div', { className:'progress-bar progress-bar-striped active', style:{width:statuspercent + '%'} },
                                    React.createElement('span', { className:'sr-only' }, statuspercent + '% Complete')
                                ),
                            ),
                        ),
                        shouldshowclose && React.createElement('button', { className:'btn btn-default status-nobtn', 'data-dismiss':'modal', onClick:this.onCancel }, browser.i18n.getMessage('cancel')),
                        React.createElement('button', { className:'btn btn-' + sharebtncolor, onClick:this.onOk, disabled:share_disable },
                            share_showicon && React.createElement('span', { className:'glyphicon glyphicon-refresh spinning' }),
                            (share_showicon ? ' ' : '') + sharelabel
                        )
                    )
                );
            }
        } else {
            return React.createElement('div', { className:'modal-content' },
                React.createElement('div', { className:'modal-header' },
                    React.createElement('button', { className:'close', type:'button', 'data-dismiss':'modal', onClick:this.onCancel },
                        React.createElement('span', { 'aria-hidden':'true'}, '×'),
                        React.createElement('span', { className:'sr-only'}, browser.i18n.getMessage('close')),
                    ),
                    React.createElement('h4', { className:'modal-title' }, 'Allow Github Sharing?'),
                ),
                React.createElement('div', { className:'modal-body' },
                    React.createElement('p', undefined, `Github powers the community due to it's excellent version control. In order to share your commands, you must grant permission to your Github account.`)
                ),
                React.createElement('div', { className:'modal-footer' },
                    React.createElement('button', { className:'btn btn-default', 'data-dismiss':'modal', onClick:this.onCancel }, browser.i18n.getMessage('cancel')),
                    React.createElement('button', { className:'btn btn-primary', onClick:this.onAuthNow }, 'Yes, Allow My Account')
                )
            );
        }
	}
}));

const HotkeyComboTxt = ({ combo }) => {
	let text = [];
	if (!combo) {
		text.push(browser.i18n.getMessage('NO_HOTKEY'));
	} else {
		for (let modname of combo.mods) {
			console.log('modname:', modname);
			if (modname == 'SUPER' && ['win', 'mac'].includes(nub.platform.os)) {
				modname += '_' + nub.platform.os;
			}
			text.push(browser.i18n.getMessage('modname_' + modname.toLowerCase()));
		}
		text.push(combo.keyname);

		if (text.length === 1 && text[0] === undefined) {
			// obviously is in recording mode, and no keys currently down
			text[0] = browser.i18n.getMessage('hotkey_changing');
		}
	}
	return React.createElement('h3', undefined,
		text.join(browser.i18n.getMessage('combo_joiner'))
	);
}

const HotkeyAdd = React.createClass({
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
			...messageDownReactMarkup(browser.i18n.getMessage('oauth_manager_description')),
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

		let { dispatch } = this.props; // redux
		let { hotkey } = this.props; // mapped state
		// hotkey is undefined, unless `iseditpage` is true
		let { location:{pathname} } = this.props; // router

        let iseditpage = pathname.toLowerCase().startsWith('/edit');

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

			// if edit, make sure at least one value is changed
			Object.assign(domvalues, getFormValues(['group']));
            domvalues.code = await new Promise(resolve => callInBootstrap('beautifyText', { js:domvalues.code }, val=>resolve(val)));

			let { group, locales:{[gExtLocale]:{name,description}}, code:{exec:code} } = hotkey.command.content; // TODO: multilocale point
            // beautify the code
			code = await new Promise(resolve => callInBootstrap('beautifyText', { js:code }, val=>resolve(val)));
			let hotkeyvalues = { group, name, description, code };

			if(!shallowCompare({props:hotkeyvalues}, domvalues))
				isvalid = false;
		}

		console.log('dispatching modPageState with isvalid:', isvalid);

		dispatch(modPageState(pathname, { isvalid })); // modPageState does the difference check, if nothing in namevalues is changed it doesnt update

	},
	beautifyCode(e) {
		if (!stopClickAndCheck0(e)) return;
		let domel = document.getElementById('code');
		let js = domel.value;
		callInBootstrap('beautifyText', { js }, beautified => domel.value = beautified);
	},
	revertCode(e) {
		let { hotkey } = this.props; // mapped state
        let { location:{pathname} } = this.props; // router

        let iseditpage = pathname.toLowerCase().startsWith('/edit');
		if (!stopClickAndCheck0(e) || !iseditpage) return;

		document.getElementById('code').value = hotkey.command.content.code.exec;
	},
    componentDidUpdate() {
        if (this.should_revalidate) {
            this.should_revalidate = false;
            this.validateForm();
        }
    },
    componentWillUpdate(nextProps) {
        let { hotkey } = nextProps; // mapped state
        let { location:{pathname} } = this.props; // router

        let iseditpage = pathname.toLowerCase().startsWith('/edit');
        if (iseditpage && hotkey) { // `&& hotkey` because its not there if it was removed
            console.log('yes has hotkey in nextProps so doing update of fields if changed, hotkey:', hotkey);
            let { group, locales:{[gExtLocale]:{ name,description }}, code:{ exec:code } } = hotkey.command.content;
            let nextvalues = { group, name, description, code };
            let domvalues = getFormValues(['name', 'description', 'code', 'group']);
            let didupdatefield = false;
            for (let [domid, domval] of Object.entries(domvalues)) {
                let nextval = nextvalues[domid];
                if (domval !== nextval) {
                    console.log(domid, 'changed!', 'was:', domval, 'now:', nextval);
                    document.getElementById(domid).value = nextval;
                    didupdatefield = true;
                    if (domid == 'name') {
                        // update header
                        let last_crumb = document.querySelector('.page-header small:last-of-type'); // link72188
                        let oldval = this.props.hotkey.command.content.locales[gExtLocale].name;
                        last_crumb.textContent = last_crumb.textContent.replace(oldval, nextval);
                    }
                }
            }
            if (didupdatefield) this.should_revalidate = true;
        }
    },
	render() {
		let { hotkey, isvalid } = this.props; // mapped state
		// hotkey is undefined, unless `iseditpage` is true
		let { location:{pathname} } = this.props; // router
		// pathname - needed for SaveCommandBtn so it can get `isvalid` from right `pages_state`
        let iseditpage = pathname.toLowerCase().startsWith('/edit');

        if (iseditpage && !hotkey) {
            // the hotkey was deleted from another tab
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
                    React.createElement('button', { className:'btn btn-lg btn-default no-btn' },
                        React.createElement('span', { className:'glyphicon glyphicon-trash' }),
                        ' ' + 'You trashed this hotkey in another tab' // link87777112
                    )
                )
            );
        }
		// default values for form fields
		let name, description, code, group=0; // default group "Uncategorized"
		if (iseditpage) // take from `hotkey`
			({ group, locales:{[gExtLocale]:{name,description}}, code:{exec:code} } = hotkey.command.content);

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
					// exec: await new Promise(resolve => callInBootstrap('beautifyText', { js:domvalues.code }, val=>resolve(val)))
					exec: domvalues.code
				}
			}
		};

		let isreallyedited = false;
		if (iseditpage) {
			// lets make sure something really changed
			// and collect that into changes_since_base if necessary
            let beautified_newcode = await callIn('Bootstrap', 'beautifyText', { js:newcommand.content.code.exec });
            let beautified_oldcode = await callIn('Bootstrap', 'beautifyText', { js:command.content.code.exec });

			if (beautified_newcode != beautified_oldcode || JSON.stringify(newcommand.content) != JSON.stringify(command.content)) {
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
		let { iseditpage, hotkey } = this.props;
		let { isvalid } = this.props; // mapped state

        if (iseditpage && !hotkey) isvalid = false; // link87777112 - i might not need this line as it might be redundtant
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
const LocalePicker = ({ locale=gExtLocale, onChange }) =>
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
			remotecommands_error: pagestate.remotecommands_error,
			filterterm: pagestate.filterterm,
			filtercat: pagestate.filtercat,
			sort: pagestate.sort
		}
	}
)(React.createClass({
	displayName: 'PageCommunity',
	goBack: e => stopClickAndCheck0(e) ? loadOldPage('/add') : null,
	loadRemoteCommands: async function() {
        console.log('in loadRemoteCommands');
		let { location:{pathname} } = this.props; // router
		let { sort } = this.props; // mapped state

		// start spinner if it hasnt already
		store.dispatch(modPageState(pathname, { remotecommands:undefined, remotecommands_error:undefined })); // when clicking "Try Again" this will cause spinner to show, and error to hide // if this is first run, on first render, then it `modPageState` will see that there is no change as `remotecommands_error` is not there it is already `undefined`
        console.log('dispatched spinner');
		let remotecommands = [];
		try {
			// get install counts
			let installs;
			try {
				let xp = await xhrPromise('https://trigger-community.sundayschoolonline.org/installs.php?act=getcount', { restype:'json' });
				let { status, response } = xp.xhr;
				if (status !== 200) throw xp;
				installs = response;
			} catch(xperr) {
				let { errtext='Unhandled server response when fetching install counts.', reason:xhrreason, xhr:{response, status, responseURL:url}} = xperr;
				throw {	errtext, xhrreason, response, status, url };
			}

			// get commits - used for history and statistics
			let commits;
			try {
				let xp = await xhrPromise('http://api.github.com/repos/Noitidart/Trigger-Community/commits?per_page=1000000', { restype:'json' });
				let { status, response } = xp.xhr;
				if (status !== 200) throw xp;
				commits = response;
			} catch(xperr) {
				let { errtext='Unhandled server response when fetching command details.', reason:xhrreason, xhr:{response, status, responseURL:url}} = xperr;
				throw {	errtext, xhrreason, response, status, url };
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

			for (let filename in versions) {
				basket.add(
					(async function() {

						let content;
						let file_sha;
						try {
							let xp = await xhrPromise(`https://api.github.com/repos/Noitidart/Trigger-Community/contents/${filename}.json`, { restype:'json', headers:{ Accept:'application/vnd.github.v3+json' } });
							let { status, response } = xp.xhr;
							if (status !== 200) throw xp;
							({ sha:file_sha, content} = xp.xhr.response);
							content = JSON.parse(atob(content));
						} catch(xperr) {
							let { errtext='Unhandled server response when fetching command content for file:' + filename, reason:xhrreason, xhr:{response, status, responseURL:url}} = xperr;
							throw {	errtext, xhrreason, response, status, url };
						}

						let remotecommand = {
							_installs: installs[filename] || 0,
							_versions: versions[filename],
							filename,
							file_sha,
							share_unix: versions[filename][0].commit_message.unix,
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
			alpha: (a, b) => compareIntThenLex(a.content.locales[gExtLocale].name, b.content.locales[gExtLocale].name), // asc
			installs: (a, b) => b._installs - a._installs, // desc
			updated: (a, b) => b._versions[0].date - a._versions[0].date // desc
		};
		console.log('pre sort:', remotecommands.map(el=>el.content.locales[gExtLocale].name));
		setTimeout(()=>console.log('post sort:', remotecommands.map(el=>el.content.locales[gExtLocale].name)));
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

        console.error('remotecommands_error:', remotecommands_error)
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
						React.createElement('input', { className:'form-control', placeholder:browser.i18n.getMessage('placeholder_communitysearch'), id:'search', type:'text', onChange:this.changeFilterTerm, disabled:!remotecommands, defaultValue:filterterm, onKeyDown:this.keydnFilterTerm }),
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
				remotecommands_error && React.createElement('button', { className:'btn btn-lg btn-default', onClick:this.loadRemoteCommands },
					React.createElement('span', { className:'glyphicon glyphicon-refresh' }),
					' ' + browser.i18n.getMessage('try_again')
				),
				remotecommands_error && React.createElement(RemoteCommandsLoadError, remotecommands_error),
				!remotecommands_error && !remotecommands && React.createElement('button', { className:'btn btn-lg btn-default no-btn', style:{marginLeft:'-80px'} },
					React.createElement('span', { className:'glyphicon glyphicon-globe spinning' }),
					' ' + browser.i18n.getMessage('loading_community')
				),
				remotecommands &&
				React.createElement('div', { className:'container'},
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

const RemoteCommandsLoadError = ({url, errtext, xhrreason, status, beautified_response}) =>
React.createElement('div', undefined,
    React.createElement('br'),
	'Failed to load community from Github. ' + errtext,
	React.createElement('br'),
	React.createElement('br'),
	status && React.createElement('dl', undefined,
		React.createElement('dt', undefined,
			React.createElement('dd', undefined,
				'URL: ' + url
			),
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
    showVersions(e) {
        if (!stopClickAndCheck0(e)) return;
        alert('Versions view not yet implemented.');
    },
	render() {
		let { remotecommand } = this.props;
		let { _installs:installs, _versions:versions, filename, content:{locales:{[gExtLocale]:{name, description}}} } = remotecommand;
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
				React.createElement('img', { className:'img-responsive', src:'http://placehold.it/1280X720?text=Contributor+Stats' }),
			),
			React.createElement('div', { className:'col-sm-8' },
				React.createElement('h3', undefined,
					name, ' ',
					React.createElement('small', undefined,
						browser.i18n.getMessage('addon_version_long', version)
					)
				),
				React.createElement('p', { className:'text-muted pull-right' },
					React.createElement('span', { title:browser.i18n.getMessage('installs'), style:{margin:'0 7px'} },
						React.createElement('span', { className:'glyphicon glyphicon-cloud-download' }),
						' ' + installs
					),
					' ',
					React.createElement('span', { title:browser.i18n.getMessage('last_updated'), style:{margin:'0 7px'} },
						React.createElement('span', { className:'glyphicon glyphicon-calendar' }),
						' ' + (new Intl.DateTimeFormat(gUserLocales, { month:'long', day:'numeric', year:'numeric' }).format(date))
					)
				),
				React.createElement('p', undefined,
					React.createElement(InstallBtn, { remotecommand }),
					' ',
					React.createElement('a', { href:'#', className:'btn btn-default', onClick:this.showVersions },
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
	onClick(e, isConfirm) {
		if (!stopClickAndCheck0(e)) return;

		let installtype = this.getInstallType();

		let { remotecommand } = this.props;
		let { filename } = remotecommand;

		let hotkey;
		if ([3, 4].includes(installtype)) {
			let { hotkeys } = this.props;
			hotkey = hotkeys.find(a_hotkey => a_hotkey.command.filename == filename);
		}

    let message_key = 'installed';
    let glyphicon = 'plus';
		switch (installtype) {
			case 0:
					xhrPromise('https://trigger-community.sundayschoolonline.org/installs.php?act=increment&filename=' + filename);
				break;
			case 1:
					return;
			case 3:
          if (!isConfirm) {
  					createModal(
  						ReactRouter.browserHistory.getCurrentLocation().pathname,
  						{
  							content_component: 'ModalContentDiscardConfirm',
  							data: {
  								grade: 'upgrade',
  								compare_base: 'user', // remote or user
  								user_command_code: hotkey.command.content.code.exec,
  								remote_command_code: remotecommand.content.code.exec,
                  onConfirm: this.onClick
  							}
  						}
  					);

            return;
          }

          message_key = 'upgraded';
          glyphicon = 'arrow-up';

				break;
			case 4:
          if (!isConfirm) {
  					createModal(
  						ReactRouter.browserHistory.getCurrentLocation().pathname,
  						{
  							content_component: 'ModalContentDiscardConfirm',
  							data: {
  								grade: 'downgrade',
  								compare_base: 'user', // remote or user
  								user_command_code: hotkey.command.content.code.exec,
  								remote_command_code: remotecommand.content.code.exec,
                  onConfirm: this.onClick
  							}
  						}
  					);

            return;
          }

          message_key = 'downgraded';
          glyphicon = 'arrow-down';

				break;
		}

		let command = {};
		for (let [key, value] of Object.entries(remotecommand))
			if (key[0] != '_') command[key] = value;
		command = JSON.parse(JSON.stringify(command));

    if ([3, 4].includes(installtype)) {
      let { combo, enabled } = hotkey;
			store.dispatch(editHotkey({
				combo,
				enabled,
				command
			}));
    } else {
  		store.dispatch(addHotkey({
  			combo: null,
  			enabled: false,
  			command
  		}));
    }
		let { name } = remotecommand.content.locales[gExtLocale];

		createNag(ReactRouter.browserHistory.getCurrentLocation().pathname, {title:browser.i18n.getMessage('title_installed'),ok_label:browser.i18n.getMessage('confirm_installed'),cancel_label:browser.i18n.getMessage('dismiss_installed'), msg:browser.i18n.getMessage('message_' + message_key, name), glyphicon, type:'primary', onOk:this.nagOnOk})

		// setTimeout(()=>alert(browser.i18n.getMessage('message_installed')), 0);
	},
	nagOnOk() {
		loadOldPage('/');
	},
	getInstallType() {
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

		if (version === masterversion) return isedited ? 4 : 1;
		else return isedited ? 3 : 2; // is obviously `version < masterversion`
	},
	render() {

		// props for the button
		let installtype_styles = {
			0: { icon:'plus', color:'success', label:browser.i18n.getMessage('install') },
			1: { disabled:true, icon:'plus', color:'success', label: browser.i18n.getMessage('installed') },
			2: { color:'primary', icon:'arrow-up', label: browser.i18n.getMessage('upgrade') },
			3: { color:'warning', icon:'arrow-up', label: browser.i18n.getMessage('discard_upgrade') },
			4: { color:'danger', icon:'arrow-down', label: browser.i18n.getMessage('discard_downgrade') }
		}
		let { label, disabled, color, icon } = installtype_styles[this.getInstallType()];

		return React.createElement('a', { href:'#', className:'btn btn-default btn-' + color, disabled, onClick:this.onClick },
			React.createElement('span', { className:'glyphicon glyphicon-' + icon }),
			' ' + label
		);
	}
}));

var ModalContentDiscardConfirm = React.createClass({ // need var due to link8847777
	displayName: 'ModalContentDiscardConfirm',
	onCancel(e) {
		if (!stopClickAndCheck0(e)) return;

		let { closeModal } = this.props;
		closeModal();
	},
	onOk(e) {
		if (!stopClickAndCheck0(e)) return;

		let { closeModal, modal:{data:{onConfirm}} } = this.props;
		closeModal();
    onConfirm(undefined, true);
	},
	switchDiff(e) {
		if (!stopClickAndCheck0(e)) return;

		let { modal:oldmodal } = this.props;
		let modal = { ...oldmodal };
		let compare_base = oldmodal.data.compare_base == 'remote' ? 'user' : 'remote';
		modal.data = { ...oldmodal.data, compare_base };

		store.dispatch(modPageState(ReactRouter.browserHistory.getCurrentLocation().pathname, { modal }));

	},
	render() {
		let { modal } = this.props;
		let { data } = modal;

		let { grade, compare_base } = data;
		let compare_to = compare_base == 'remote' ? 'user' : 'remote';
		let diff_html = {__html: diffString(data[compare_base + '_command_code'], data[compare_to + '_command_code']) };
		let diff_switch_label = browser.i18n.getMessage('diff_switch_base_' + compare_base);

		return React.createElement('div', { className:'modal-content' },
			React.createElement('div', { className:'modal-header' },
				React.createElement('button', { className:'close', type:'button', 'data-dismiss':'modal', onClick:this.onCancel },
					React.createElement('span', { 'aria-hidden':'true'}, '×'),
					React.createElement('span', { className:'sr-only'}, browser.i18n.getMessage('close')),
				),
				React.createElement('h4', { className:'modal-title' }, browser.i18n.getMessage(`modal_title_${grade}_discard`)),
			),
			React.createElement('div', { className:'modal-body' },
				React.createElement('p', undefined, browser.i18n.getMessage('modal_msg_grade_firstline')),
				React.createElement('br'),
				React.createElement('p', undefined, browser.i18n.getMessage(`modal_msg_${grade}_midline`)),
				React.createElement('br'),
				React.createElement('p', undefined, browser.i18n.getMessage('modal_msg_grade_lastline')),
				React.createElement('br'),
				React.createElement('button', { className:'diff-switch-btn btn btn-default btn-xs pull-right', onClick:this.switchDiff },
					React.createElement('span', { className:'glyphicon glyphicon-sort' }),
					' ' + diff_switch_label
				),
				React.createElement('div', { className:'diff', dangerouslySetInnerHTML:diff_html })
			),
			React.createElement('div', { className:'modal-footer' },
				React.createElement('button', { className:'btn btn-default', 'data-dismiss':'modal', onClick:this.onCancel }, browser.i18n.getMessage(`modal_dismiss_grade_discard`)),
				React.createElement('button', { className:'btn btn-primary', onClick:this.onOk }, browser.i18n.getMessage(`modal_confirm_${grade}_discard`))
			)
		);
	}
});
// end - PageCommunity

// start - PagePurchase
const PagePurchase = ReactRedux.connect(
	function(state, ownProps) {
        let { location:{ pathname } } = ownProps; // router
		let pagestate = state.pages_state[pathname] || {};

		return {
            // NOTE: never feed in fully pagestate, like line below, just select the stuff from pagestate that this component needs
			// pagestate: state.pages_state[pathname],
			validity: pagestate.validity
		}
	}
)(React.createClass({
	displayName: 'PagePurchase',
    goBack: e => stopClickAndCheck0(e) && loadOldPage('/'),
    async doEmail(e) {
        if (!stopClickAndCheck0(e)) return;

        let { location:{query:{ serial }}, pathname } = this.props; // router

        let text = document.getElementById('email_text');
        let btn = document.getElementById('email_btn');

        let to = text.value.trim();
        let patt_email = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
        if (!patt_email.test(to)) return alert('Invalid email');

        btn.setAttribute('disabled', 'disabled');
        text.setAttribute('disabled', 'disabled');

        let s = 'Trigger - Purchase Code';
        let msg = 'Thank you for your purchase. You can use this code to enable extra hotkeys. Your code is: ' + serial;
        let qstr = queryStringDom({to, msg, s});
        let xpemail = await xhrPromise('https://trigger-community.sundayschoolonline.org/email.php?' + qstr, { method:'GET', restype:'json' }); // xp_paypal_init

        let { xhr:{response, status}, reason } = xpemail;

        if (status === 200 && !response.error) {
            alert('Email successfully sent')
            text.value = '';
        } else {
            alert(`Email failed to send.\n\nLoad Reason: ${reason}\nStatus: ${status}\nResponse: ${JSON.stringify(response)}`);
        }

        btn.removeAttribute('disabled');
        text.removeAttribute('disabled');
    },
    validateIfNeeded() {
        let { location:{ pathname, query } } = this.props; // router
        let { serial } = query;
        let { validity } = this.props; // mapped state
        let serials = store.getState().serials; // cheat mapped state - because i dont want my component to refresh when serials updated

        if (validity) {
            return;
        }

        console.error('triggering validateSerial');
        setTimeout(() => {
            callInExe('validateSerial', serial, newvalidity => {
                let { isvalid, buyqty } = newvalidity;
                if (isvalid) {
                    console.log('updating serials - PagePurchase component should not refresh');
                    store.dispatch(addSerial(serial, buyqty));
                }
                store.dispatch(modPageState(pathname, { validity:newvalidity }));
            });
        }, 1000); // so i can show the loader animation
    },
    render() {
    	let { location:{ pathname, query } } = this.props; // router
    	// console.log('query:', query);

        let { serial, error } = query;
        let { validity } = this.props; // mapped state

        let serials = store.getState().serials; // cheat mapped state - because i dont want my component to refresh when serials updated
        let max_enable_count = nub.data.min_enable_count + Object.entries(serials).reduce((acc, [,a_buyqty]) => acc + a_buyqty, 0);
        console.error('validity:', validity);

        this.validateIfNeeded();

        let validity_desc_rels;
        if (!validity) {
            validity_desc_rels = [
                'Validating code and enabling extra hotkeys...',
                React.createElement('div', { className:'uil-ripple-css' }, React.createElement('div'), React.createElement('div'))
            ];
        } else {
            let { isvalid, buyqty, reason } = validity;
            if (isvalid) {
                validity_desc_rels = [
                    `You can now enable a total of ${max_enable_count} hotkeys!`,
                    React.createElement('br'),
                    React.createElement('small', undefined, `(${buyqty} extra enabled hotkeys was added)`)
                ];
            } else {
                validity_desc_rels = [`The code is invalid. Reason: ${reason}`];
            }
        }

        return React.createElement('span', undefined,
          React.createElement('div', { className:'row text-center' },
            React.createElement('div', { className:'col-lg-12' },
              React.createElement('a', { href:'#', className:'btn btn-default pull-left', onClick:this.goBack},
                React.createElement('span', { className:'glyphicon glyphicon-triangle-left' }),
                ' ' + browser.i18n.getMessage('back')
              ),
            )
          ),
          React.createElement('hr'),
          // content
          error && React.createElement('div', { className:'jumbotron', style:{background:'none'} },
            React.createElement('h1', { className:'lead' }, 'Something went wrong, purhcase failed. Error returned: ' + error)
          ),
          !error && React.createElement('div', { className:'jumbotron', style:{paddingTop:'0',background:'none'} },
            React.createElement('p', { className:'lead' }, 'Thank you for your purchase! Your purchase code is:'),
            React.createElement('h1', undefined, serial),
            React.createElement('h2', { style:{marginTop:'35px'} }, ...validity_desc_rels),
            React.createElement('p', { className:'lead' },
              'Save this code in case you need it in the future.',
              React.createElement('div', { className:'container-fluid' },
                React.createElement('form', { className:'navbar-form' },
                  React.createElement('div', { className:'form-group form-group-lg' },
                    React.createElement('input', { className:'form-control', type:'text', id:'email_text' }),
                  ),
                  ' ',
                  React.createElement('button', { className:'btn btn-default btn-lg', type:'button', id:'email_btn', onClick:this.doEmail },
                    React.createElement('span', { className:'glyphicon glyphicon-send '}),
                    ' ' + 'Email Me'
                  )
                )
              ),
            ),
            React.createElement('p', { className:'lead' },
                React.createElement('p', { className:'lead' },
                  React.createElement('i', undefined, 'To enter this code in the futre, follow the steps below:'),
                ),
              React.createElement('img', { src:'../images/alreadyhavecode.png', style:{width:'50%'} } ),
              React.createElement('div', { style:{margin:'15px 0 10px 0'} },
                React.createElement('span', { className:'glyphicon glyphicon-arrow-down'}),
              ),
              React.createElement('img', { src:'../images/entercode.png', style:{width:'50%'} } ),
            ),
            React.createElement('p', { className:'lead' },
              React.createElement('i', undefined, 'This code will only work on your current computer. If you want to use it on another computer, contact Noitidart and prove that it is you, he will give you a coupon for free hotkeys.'),
            ),
          ),
          React.createElement('hr')
    	);
    }
}));
// end - PagePurchase

// start - PageAuth
const PageAuth = React.createClass({
	displayName: 'PageAuth',
  gotoMyhotkeys(e) {
		if (!stopClickAndCheck0(e)) return;
		loadPage('/');
  },
  closeTab(e) {
    if (!stopClickAndCheck0(e)) return;
    callInBackground('closeTab');
  },
  doReauth(e) {
    if (!stopClickAndCheck0(e)) return;
    let { location:{query} } = this.props; // router
    let { serviceid } = query;
    callInBackground('closeTab');
    callInBackground('openAuthTab', { serviceid })
  },
	render() {
		let { location:{query}, params } = this.props; // router
		console.log('params:', params, 'query:', query);

    let { serviceid, act } = query;

    let authtitle, authmsg, btn1, btn2;
    if (act == 'approved') {
      authtitle = browser.i18n.getMessage('authtitle_approved');
      authmsg = browser.i18n.getMessage('authmsg_approved_' + serviceid);

      btn1 = {
        label: browser.i18n.getMessage('myhotkeys'),
        onClick: this.gotoMyhotkeys,
        class: 'success'
      };
      btn2 = {
        label: browser.i18n.getMessage('close_tab'),
        onClick: this.closeTab,
        class: 'danger'
      };
    } else if (act == 'denied') {
      authtitle = browser.i18n.getMessage('authtitle_denied');
      authmsg = browser.i18n.getMessage('authmsg_denied_' + serviceid);
      btn1 = {
        label: browser.i18n.getMessage('reauthorize'),
        onClick: this.doReauth,
        class: 'primary'
      };
      btn2 = {
        label: browser.i18n.getMessage('close_tab'),
        onClick: this.closeTab,
        class: 'danger'
      };
    } else {
      authtitle = browser.i18n.getMessage('authtitle_unknown');
      authmsg = browser.i18n.getMessage('authmsg_unknown');
      btn1 = {
        label: browser.i18n.getMessage('close_tab'),
        onClick: this.closeTab,
        class: 'danger'
      };
    }


    return React.createElement('span', undefined,
      // content
      React.createElement('div', { className:'jumbotron jumbo-' + serviceid, style:{backgroundImage:`url(../images/${serviceid}.png)`} },
        React.createElement('h1', undefined, authtitle),
        React.createElement('p', { className:'lead' }, authmsg),
        React.createElement('p', undefined,
          btn1 && React.createElement('a', { href:'#', onClick:btn1.onClick, className:'btn btn-lg btn-' + btn1.class }, btn1.label),
          btn1 && btn2 && ' ',
          btn2 && React.createElement('a', { href:'#', onClick:btn2.onClick, className:'btn btn-lg btn-' + btn2.class }, btn2.label)
        )
      ),
      React.createElement('hr')
		);
	}
});
// end - PageAuth

// start - PageFatal
const PageFatal = React.createClass({
	displayName: 'PageFatal',
	render() {
        console.error('rendering page fatal');

        // build body, based on err.reason, with localized template and with err.text and errex
        let err = nub.self.fatal;
        let body, bodyarr;
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
                let txt = '';
                if (err.text) txt += err.text;
                // if (txt && errex) txt += '\n';
                // if (errex) txt += errex;

                bodyarr = [ txt || browser.i18n.getMessage('startupfailed_unknown') ];
        }
        body = browser.i18n.getMessage('startupfailed_body', bodyarr);

		return React.createElement('div', undefined,
			'Crticial error! Failed to startup! Please try to restart the extension. If this does not fix it, please contact Noitidart for help on the support page - https://www.github.com/Noitidart/Trigger/issues',
            React.createElement('br'),
            'Error details:',
            React.createElement('br'),
            'Step: ' + nub.self.fatal.stepname,
            React.createElement('br'),
            body
		);
	}
});
// end - PageFatal

// start - PageStartingup
const PageStartingup = React.createClass({
	displayName: 'PageStartingup',
	render() {
        console.error('rendering page fatal');

		return React.createElement('div', undefined,
			'Trigger is currently in the startup process. This can take up to a minute. Trigger is not usable until startup completes. Please try reloading the page later. The green loading badge will disappear from the toolbar button when ready: ',
            React.createElement('br'),
            React.createElement('img', { src:'/images/startupanim.png' }),
		);
	}
});
// end - PageFatal

// start - PageInvalid
const PageInvalid = React.createClass({
	displayName: 'PageInvalid',
    gotoMyhotkeys(e) {
    	if (!stopClickAndCheck0(e)) return;
    	loadPage('/');
    },
	render() {
		let { params } = this.props;
		console.log('params:', params);

		return React.createElement('div', undefined,
			browser.i18n.getMessage('invalidpage_message'),
            ' ' + React.createElement('a', { href:'/', onClick:this.gotoMyhotkeys }, browser.i18n.getMessage('invalidpage_link'))
		);
	}
});
// end - PageInvalid

// start - specific helpers
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

const origStopClickAndCheck0 = stopClickAndCheck0;
stopClickAndCheck0 = function(e) {
	// let target = e.target;
	// setTimeout(()=>target.blur());
	setTimeout(()=>document.activeElement.blur(), 0);
	return origStopClickAndCheck0(e);
}
function allowDownAndCheck0(e) {
	if (!e) return true;

	// e.stopPropagation();
	// e.preventDefault();
  setTimeout(()=>document.activeElement.blur(), 0);
	return e.button === 0 ? true : false;
}
function messageDownReactMarkup(str) {
    // takes a string 'Hi <B>rawr</B>!' and returns a bolded react element in the middle
    return (
        str
        .split(/<\/?b>/i)
        .map((el, i) => {
            if (i % 2) {
                return React.createElement('b', undefined, el);
            } else {
                return el;
            }
        })
        .filter(el => typeof(el) != 'string' ? true : el.length)
    );
}
// end - specific helpers
