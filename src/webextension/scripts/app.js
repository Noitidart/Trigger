let gBgComm = new Comm.client.webextports('tab');
let callInBackground = Comm.callInX2.bind(null, gBgComm, null, null);
let callInExe = Comm.callInX2.bind(null, gBgComm, 'callInExe', null);
let callInBootstrap = Comm.callInX2.bind(null, gBgComm, 'callInBootstrap', null);
let callInMainworker = Comm.callInX2.bind(null, gBgComm, 'callInMainworker', null);

let nub;
let store;

let gSupressUpdateHydrantOnce;
let gAppPageComponents = [];

async function init() {
	console.error('calling fetchData with hydrant skeleton:', hydrant);

	let data = await new Promise( resolve => callInBackground('fetchData', { hydrant, nub:1 }, val => resolve(val)) );

	nub = data.nub;

	// window.addEventListener('unload', uninit, false);

	// setup and start redux
	if (app) {
		if (hydrant) objectAssignDeep(hydrant, data.hydrant); // dont update hydrant if its undefined, otherwise it will screw up all default values for redux
		store = Redux.createStore(app);

		if (hydrant) store.subscribe(shouldUpdateHydrant);
	}

	await Promise.all([initAppPage()]);

	// render react
	ReactDOM.render(
		React.createElement(ReactRedux.Provider, { store },
			React.createElement(App)
		),
		document.body
	);

	if (typeof(focusAppPage) != 'undefined') {
		window.addEventListener('focus', focusAppPage, false);
	}
}
window.addEventListener('DOMContentLoaded', init, false);

// app page stuff
function focusAppPage() {
	console.log('focused!!!!!!');
}

function initAppPage() {
	gAppPageComponents = [
		React.createElement(HeaderContainer),
		React.createElement(ControlsContainer),
		React.createElement('hr'),
		React.createElement(PageContainer),
		React.createElement('hr')
	];
}

function uninitAppPage() {

}

async function shouldUpdateHydrant() {
	return;

	console.log('in shouldUpdateHydrant');

	var state = store.getState();

	// check if hydrant updated
	var hydrant_updated = false;
	var pending_stg_update = {};
	for (var p in hydrant) {
		var is_different = React.addons.shallowCompare({props:hydrant[p]}, state[p]);
		if (is_different) {
			console.log('something in', p, 'of hydrant was updated');
			hydrant_updated = true;

			if (!gSupressUpdateHydrantOnce) {
				// update file storages or whatever storage this key in hydrant is connected to

				if (hydrant.stg && p in hydrant.stg) {
					pending_stg_update[p] = state[p];
				} else if (p == 'addon_info') {
					// make sure it is just applyBackgroundUpdates, as i only support changing applyBackgroundUpdates
					if (hydrant.addon_info.applyBackgroundUpdates !== state.addon_info.applyBackgroundUpdates) {
						callInBootstrap('setApplyBackgroundUpdates', state.addon_info.applyBackgroundUpdates);
					}
				}
			}
			console.log('compared', p, 'is_different:', is_different, 'state:', state[p], 'hydrant:', hydrant[p]);
			hydrant[p] = state[p];
			// break; // dont break because we want to update the hydrant in this global scope for future comparing in this function.
		}
	}

	if (gSupressUpdateHydrantOnce) {
		console.log('hydrant update supressed once');
		gSupressUpdateHydrantOnce = false;
		return;
	} else {
		if (pending_stg_update) {
			var aKeys = await callInBackground('storageCall', { aArea: 'local', aAction: 'set', aKeys: pending_stg_update})
			for (let setkey in aKeys) {
				if (setkey in nub.stg) nub.stg[setkey] = aKeys[setkey];
			}
		}
	}

	console.log('done shouldUpdateHydrant');
}

let hydrant = {
	stg: {
		// set defaults here, as if it never has been set with `storageCall('storaget', 'set')` then `fetchData` will get back an empty object
		pref_hotkeys: [],
		mem_oauth: {} // github, github_inactive
	}
};

// ACTIONS
const SET_MAIN_KEYS = 'SET_MAIN_KEYS';

const SET_STG = 'SET_STG';
const SET_STGS = 'SET_STGS';

const LOAD_PAGE = 'LOAD_PAGE';
const PREV_PAGE = 'PREV_PAGE';
const RELOAD_IF_PAGE = 'RELOAD_IF_PAGE';

// ACTION CREATORS
function setMainKeys(obj_of_mainkeys) {
	return {
		type: SET_MAIN_KEYS,
		obj_of_mainkeys
	}
}

function setStg(name, val) {
	return {
		type: SET_STG,
		name,
		val
	}
}
function setStgs(namevals) {
	return {
		type: SET_STGS,
		namevals
	}
}

function prevPage() {
	return {
		type: PREV_PAGE
	}
}
function loadPage(name) {
	// name is page name
	return {
		type: LOAD_PAGE,
		name
	}
}
function reloadPageIf(name) {
	return {
		type: RELOAD_IF_PAGE,
		name
	}
}

// REDUCERS
function stg(state=hydrant.stg, action) {
	switch (action.type) {
		case SET_STG:
			let { name, val } = action;
			return {
				...state,
				[name]: val
			};
		case SET_STGS:
			let { namevals } = action;
			return {...state, ...namevals};
		case SET_MAIN_KEYS:
			let { obj_of_mainkeys } = action;
			let mainkey = 'stg';
			return (mainkey in obj_of_mainkeys ? obj_of_mainkeys[mainkey] : state);
		default:
			return state;
	}
}
function page_history(state=['my_hotkeys'], action) {
	switch (action.type) {
		case SET_MAIN_KEYS: {
			let { obj_of_mainkeys } = action;
			let mainkey = 'page_history';
			return (mainkey in obj_of_mainkeys ? obj_of_mainkeys[mainkey] : state);
		}
		case LOAD_PAGE: {
			let { name } = action;
			return [...state, name];
		}
		case PREV_PAGE: {
			let newhistory = [...state];
			newhistory.pop();
			return newhistory;
		}
		case RELOAD_IF_PAGE: {
			let { name } = action;
			let curpage = state[state.length-1];
			if (curpage == name) {
				return [...state];
			} else {
				return state;
			}
		}
		default:
			return state;
	}
}

function editing(state=null, action) {
	// state is hotkey filename
	switch (action.type) {
		case SET_MAIN_KEYS:
			let { obj_of_mainkeys } = action;
			let mainkey = 'editing';
			return (mainkey in obj_of_mainkeys ? obj_of_mainkeys[mainkey] : state);
		default:
			return state;
	}
}

let app = Redux.combineReducers({
	stg,
	page_history, // string; enum[my_hotkeys,add_hotkey,community,edit_hotkey,create_hotkey]
	editing // only respected if page is edit_hotkey
});

/* HotkeyStruct -
{
	enabled: false,
	combo: [], // remote_htk does not have
	filename: '', // generated based on filename's available on server // just a random hash // if not yet verified with server (meaning not yet shared) this is prefexed with `_`
	// code is in filename_code.js
	// localized name and description are in filename_locale.js
	locale: {
		// remote meta data
		commit: ''
		content: `
			'en-US': {
				name: ''
				description: ''
			}
		`
	},
	code: [ // local has this too, but it will only have one entry
		{
			commit: ''
			// remote meta data
			// filecontents is like this:
			content: ''
		}
	]
}
*/

// REACT COMPONENTS - PRESENTATIONAL
let App = React.createClass({
	render() {

		let app_components = [
			// 'HEADER',
			...gAppPageComponents
			// 'FOOTER'
		];

		return React.createElement('div', { id:'app', className:'app container' },
			app_components
		);
	}
});

let gCommunityXhr;
let Page = React.createClass({
	displayName: 'Page',
	// functions for create_hotkey and edit_hotkey pages
	validateForm() {
		let { editing } = this.props; // mapped state

		let ids = ['name', 'description', 'code'];
		let isvalid = true;
		for (let id of ids) {
			if (document.getElementById(id).value.trim().length === 0) {
				isvalid = false;
				break;
			}
		}

		if (editing.isvalid !== isvalid) {
			store.dispatch(setMainKeys({
				editing: {
					...store.getState().editing,
					isvalid
				}
			}));
		}
	},
	// functions for add_hotkey pages
	loadCreateHotkey(e) {
		if (!stopClickAndCheck0(e)) return;

		store.dispatch(setMainKeys(
			{
				page_history: [...store.getState().page_history, 'create_hotkey'], // changes the page
				editing: {
					filename: '_' + Date.now(), // tells it what to save with
					isvalid: false // if the form is currently valid
				}
			}
		));
	},
	//
	render() {
		let { page_history } = this.props; // mapped state
		let { load, reload } = this.props; // dispatchers

		let page = page_history[page_history.length - 1];

		let rels = [];
		switch (page) {
			case 'add_hotkey': {
					rels.push(
						React.createElement('div', { className:'row text-center' },
							React.createElement('a', { href:'#', className:'btn btn-default btn-lg', onClick:load.bind(null, 'community') },
								React.createElement('span', { className:'glyphicon glyphicon-globe' }),
								' ',
								'Browse Community'
							),
							' ',
							React.createElement('a', { href:'#', className:'btn btn-default btn-lg', onClick:this.loadCreateHotkey },
								React.createElement('span', { className:'glyphicon glyphicon-console' }),
								' ',
								'Write My Own'
							)
						)
					);
				break;
			}
			case 'my_hotkeys': {
					// rels = [
					// 	React.createElement('div', { className:'row text-center' },
					// 		React.createElement(Hotkey),
					// 		React.createElement(Hotkey),
					// 		React.createElement(HotkeyAdd)
					// 	)
					// ]
					let { pref_hotkeys } = this.props; // mapped state

					let hotkeys_cnt = pref_hotkeys.length;

					const HOTKEYS_PER_ROW = 4; // based on twitter-bootstrap system

					let rows_cnt = Math.ceil((hotkeys_cnt + 1) / HOTKEYS_PER_ROW); // + 1 for HotkeyAdd block
					let hotkeyi = -1;
					for (let rowi=0; rowi<rows_cnt; rowi++) {
						let row_rels = [];
						for (let rowreli=0; rowreli<HOTKEYS_PER_ROW; rowreli++) {
							hotkeyi++;
							if (hotkeyi > hotkeys_cnt - 1) {
								// push in HotkeyAdd
								row_rels.push(
									React.createElement(HotkeyAdd)
								);
								break;
							} else {
								row_rels.push(
									React.createElement(Hotkey, { pref_hotkey:pref_hotkeys[hotkeyi] })
								);
							}
						}
						rels.push(
							React.createElement('div', { className:'row text-center' },
								...row_rels
							)
						);
					}
				break;
			}
			case 'create_hotkey':
			case 'edit_hotkey': {
					let { editing, pref_hotkeys } = this.props; // mapped state

					let locale = 'en-US'; // TODO: check to see if users locale is available, if not then check if English is available, if not then check whatever locale is avail
					let name, description, code;
					if (page == 'edit_hotkey') {
						// obviously isedit = true
						// let isedit = !!pref_hotkey;
						let pref_hotkey = pref_hotkeys.find(a_pref_hotkey => a_pref_hotkey.filename == editing.filename);
						let localejson = JSON.parse(pref_hotkey.locale.content)[locale];
						name = localejson.name;
						description = localejson.description;
						code = pref_hotkey.code.content;
					}

					rels.push(
						React.createElement('form', undefined,
							React.createElement('div', { className:'input-group' },
								React.createElement('span', { className:'input-group-addon' },
									'Language'
								),
								React.createElement('input', { className:'form-control' }),
								// React.createElement('div', { className:'input-group-btn open' },
								React.createElement('div', { className:'input-group-btn' },
									React.createElement('button', { type:'button', className:'btn btn-default dropdown-toggle' },
										'English',
										' ',
										React.createElement('span', { className:'caret' })
									),
									React.createElement('ul', { className:'dropdown-menu dropdown-menu-right' },
										React.createElement('li', undefined,
											React.createElement('div', { className:'input-group input-group-sm', style:{margin:'0 auto'} },
												React.createElement('input', { className:'form-control', type:'text', disabled:'disabled', id:'language' })
											)
										),
										React.createElement('li', { className:'divider' } ),
										React.createElement('li', undefined,
											React.createElement('a', { href:'#' },
												'French'
											)
										),
										React.createElement('li', undefined,
											React.createElement('a', { href:'#' },
												'Spanish'
											)
										)
									)
								)
							),
							React.createElement('br'),
							React.createElement('div', { className:'input-group' },
								React.createElement('span', { className:'input-group-addon' },
									'Name'
								),
								React.createElement('input', { className:'form-control', type:'text', id:'name', onChange:this.validateForm, defaultValue:name }),
							),
							React.createElement('br'),
							React.createElement('div', { className:'input-group' },
								React.createElement('span', { className:'input-group-addon' },
									'Description'
								),
								React.createElement('input', { className:'form-control', type:'text', id:'description', onChange:this.validateForm, defaultValue:description }),
							),
							React.createElement('br'),
							React.createElement('b', undefined,
								'Command (Javascript)'
							),
							React.createElement('div', { className:'form-group' },
								React.createElement('textarea', { className:'form-control', id:'code', onChange:this.validateForm, defaultValue:code, style:{resize:'vertical'} })
							)
						)
					);
				break;
			}
			case 'community': {
					if (!gCommunityXhr) {
						rels.push(
							React.createElement('div', { className:'row text-center' },
								React.createElement('button', { className:'btn btn-lg btn-default no-btn' },
									React.createElement('span', { className:'glyphicon glyphicon-globe spinning' }),
									' ',
									'Loading community from Github server...'
								)
							)
						);

						setTimeout(async function() {
							gCommunityXhr = (await xhrPromise('https://api.github.com/repos/Noitidart/Trigger-Community/contents')).xhr;
							reload('community');
						}, 0);
					} else {
						let xhr = gCommunityXhr;
						gCommunityXhr = undefined;

						let json;
						try {
							json = JSON.parse(xhr.response);
						} catch(ex) {
							console.warn('no json returned in xhr');
							json = {};
						}
						console.log('json:', json, 'xhr:', xhr);

						switch (xhr.status) {
							case 200: {
								switch (json.message) {
									default:

								}
							}
							default:
								rels.push(
									React.createElement('div', { className:'row text-center' },
										'Failed to connect to community.',
										React.createElement('br'),
										React.createElement('br'),
										React.createElement('dl', undefined,
											React.createElement('dt', undefined,
												React.createElement('dd', undefined,
													'Status Code: ' + xhr.status
												),
												React.createElement('dd', undefined,
													'Response: ' + xhr.response
												)
											)
										)
									)
								);
						}
					}
				break;
			}
		};

		return React.createElement('span', undefined,
			rels
		);
	}
});

let Header = React.createClass({
	displayName: 'Header',
	render() {
		let { page_history } = this.props; // mapped state

		let crumbs = [];
		for (let pagename of page_history) {
			if (pagename != 'my_hotkeys') {
				crumbs.push(
					React.createElement('small', { style:{whiteSpace:'normal'} },
						' > '
					)
				);
			}

			crumbs.push(
				React.createElement('small', undefined,
					pagename
				)
			);
		}

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

let Hotkey = React.createClass({
	displayName: 'Hotkey',
	trash(e) {
		if (!stopClickAndCheck0(e)) return;

		let { pref_hotkey:{filename} } = this.props;

		let state = store.getState();
		let newstg = {
			...state.stg,
			pref_hotkeys: state.stg.pref_hotkeys.filter(a_pref_hotkey => a_pref_hotkey.filename != filename)
		};

		store.dispatch(setMainKeys({
			stg: newstg
		}));

		let stgvals = { pref_hotkeys:newstg.pref_hotkeys };
		callInBackground('storageCall', { aArea:'local',aAction:'set',aKeys:stgvals });
	},
	edit(e) {
		if (!stopClickAndCheck0(e)) return;

		let { pref_hotkey:{filename} } = this.props;

		store.dispatch(setMainKeys(
			{
				page_history: [...store.getState().page_history, 'edit_hotkey'],
				editing: {
					filename,
					isvalid: false
				}
			}
		));
	},
	share(e) {
		if (!stopClickAndCheck0(e)) return;


	},
	render() {
		let { pref_hotkey } = this.props;

		let { enabled, filename, combo, locale, code } = pref_hotkey;

		let { name, description } = JSON.parse(locale.content)['en-US'];

		let combotxt;
		let hashotkey = true;
		if (!combo || !combo.length) {
			combotxt = 'NO HOTKEY';
			hashotkey = false;
		}

		let islocal = filename.startsWith('_'); // is something that was never submited to github yet
		// cant use `locale.commit` and `code.commit` to determine `islocal`, as it might be edited and not yet shared

		let isshared = (!islocal && locale.commit && code.commit);

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
						description
					),
					React.createElement('p', undefined,
						React.createElement('a', { href:'#', className:'btn btn-' + (!hashotkey ? 'warning' : 'default'), 'data-tooltip':(hashotkey ? 'Change Hotkey' : 'Set Hotkey') },
							React.createElement('span', { className:'glyphicon glyphicon-refresh' })
						),
						' ',
						React.createElement('a', { href:'#', className:'btn btn-default', 'data-tooltip':'Edit', onClick:this.edit },
							React.createElement('span', { className:'glyphicon glyphicon-pencil' })
						),
						hashotkey && ' ',
						hashotkey && React.createElement('a', { href:'#', className:'btn btn-' + (isenabled ? 'default' : 'danger'), 'data-tooltip':isenabled ? 'Disable' : 'Enable' },
							React.createElement('span', { className:'glyphicon glyphicon-off' })
						),
						' ',
						React.createElement('a', { href:'#', className:'btn btn-default', 'data-tooltip':'Remove', onClick:this.trash },
							React.createElement('span', { className:'glyphicon glyphicon-trash' })
						),
						!isshared && ' ',
						!isshared && React.createElement('a', { href:'#', className:'btn btn-default', 'data-tooltip':'Share' },
							React.createElement('span', { className:'glyphicon glyphicon-globe' })
						),
						!isupdated && ' ',
						!isupdated && React.createElement('a', { href:'#', className:'btn btn-info', 'data-tooltip':'Update Available'},
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
	click(e) {
		if (stopClickAndCheck0(e)) store.dispatch(loadPage('add_hotkey'));
	},
	render() {
		return React.createElement('div', { className:'col-md-3 col-sm-6 hero-feature hotkey-add' },
			React.createElement('div', { className:'thumbnail' },
				// React.createElement('img', { src:'http://placehold.it/800x500', alt:'' }),
				React.createElement('div', { className:'caption' },
					React.createElement('p'),
					React.createElement('p', undefined,
						React.createElement('a', { href:'#', className:'btn btn-default', onClick:this.click },
							React.createElement('span', { className:'glyphicon glyphicon-plus' })
						)
					)
				)
			)
		);
	}
});

let Controls = React.createClass({
	displayName: 'Controls',
	// for page edit_hotkey and create_hotkey
	saveHotkey(e) {
		let { editing, page_history } = this.props; // mapped state
		let isvalid = (editing && editing.isvalid);

		if (stopClickAndCheck0(e) && isvalid) {
			let newhotkey = {
				enabled: false,
				filename: editing.filename,
				combo: null,
				locale: {
					commit: null,
					content: JSON.stringify({
						'en-US': {
							name: document.getElementById('name').value.trim(),
							description: document.getElementById('description').value.trim()
						}
					})
				},
				code: {
					commit: null,
					content: document.getElementById('code').value.trim()
				}
			};

			let pref_hotkeys = store.getState().stg.pref_hotkeys;

			// is new creation? or edit?
			let page = page_history[page_history.length-1];
			let isedit = page == 'edit_hotkey';

			let isreallyedited = false;
			if (isedit) {
				let pref_hotkey = pref_hotkeys.find(a_pref_hotkey => a_pref_hotkey.filename == editing.filename);

				// test if anything changed - and if it wasnt, then take into newhotkey reference to it
				if (newhotkey.locale.content == pref_hotkey.locale.content) {
					// not changed, so even keep same reference
					newhotkey.locale = pref_hotkey.locale;
				} else {
					isreallyedited = true;
				}

				if (newhotkey.code.content == pref_hotkey.code.content) {
					// not changed, so even keep same reference
					newhotkey.code = pref_hotkey.code;
				} else {
					isreallyedited = true;
				}

				if (isreallyedited) {
					// copy non-editables (non-editable by this form) from the pref_hotkey to newhotkey
					for (let p in pref_hotkey) {
						if (['locale', 'code'].includes(p) === false) { // editables
							newhotkey[p] = pref_hotkey[p];
						}
					}
				}
			}

			// storageCall and dispatch if necessary (ie: not dispatching if `(isedit && !isreallyedited)` )
			if (isedit && isreallyedited) {
				// pref_hotkeys[edit_pref_hotkey_ix] = newhotkey; // dont do this, we want to change the reference to the array entry, so we create new array below with .map
				let newstg = {
					...store.getState().stg,
					pref_hotkeys: pref_hotkeys.map(a_pref_hotkey => a_pref_hotkey.filename == newhotkey.filename ? newhotkey : a_pref_hotkey)
				};

				// go back to 'my_hotkeys'
				let newpagehistory = ['my_hotkeys'];

				store.dispatch(setMainKeys({
					stg: newstg,
					page_history: newpagehistory
				}));

				let stgvals = { pref_hotkeys:newstg.pref_hotkeys };
				callInBackground('storageCall', { aArea:'local',aAction:'set',aKeys:stgvals })
			} else if (!isedit) {
				// so iscreate = true
				let newstg = {
					...store.getState().stg,
					pref_hotkeys: [...pref_hotkeys, newhotkey]
				};

				// go back to 'my_hotkeys'
				let newpagehistory = ['my_hotkeys'];

				store.dispatch(setMainKeys({
					stg: newstg,
					page_history: newpagehistory
				}));

				let stgvals = { pref_hotkeys:newstg.pref_hotkeys };
				callInBackground('storageCall', { aArea:'local',aAction:'set',aKeys:stgvals })

			}
		}
	},
	// for page my_hotkeys
	oauthAddForget(serviceid) {
		let { oauth } = this.props; // mapped state
		if (oauth[serviceid]) {
			// forget
			let state = store.getState();
			let newstg = {
				...state.stg,
				mem_oauth: { ...state.stg.mem_oauth }
			};
			delete newstg.mem_oauth[serviceid];

			store.dispatch(setMainKeys({
				stg: newstg
			}));

			let stgvals = { mem_oauth:newstg.mem_oauth };
			callInBackground('storageCall', { aArea:'local',aAction:'set',aKeys:stgvals });
		} else {
			// add
			callInBackground('openAuthTab', { serviceid });
		}
	},
	//
	render() {
		let { page_history } = this.props; // mapped state
		let { back } = this.props; // dispatchers

		let page = page_history[page_history.length - 1];
		let rels = [];

		// meat
		switch (page) {
			case 'my_hotkeys':
					let { oauth } = this.props; // mapped state

					rels.push('Manage your collection of hotkeys here. You can browse the community shared commands by click "Add" and then "Community". You can create your own custom commands and share it with the community.');
					rels.push(React.createElement('br'));
					rels.push(React.createElement('br'));
					for (let serviceid in nub.oauth) {
						rels.push(
							React.createElement('div', { className:'row text-center' },
								React.createElement('div', { className:'col-lg-12' },
									React.createElement('img', { src:'../images/' + serviceid + '.png', width:'22px', height:'22px', className:'pull-left' }),
									React.createElement('span', { className:'pull-left', style:oauth[serviceid] ? undefined : {fontStyle:'italic'} },
										!oauth[serviceid] ? '(no account)' : deepAccessUsingString(oauth[serviceid], nub.oauth[serviceid].dotname)
									),
									React.createElement('a', { href:'#', className:'btn btn-default btn-sm pull-right', onClick:this.oauthAddForget.bind(null, serviceid) },
										React.createElement('span', { className:'glyphicon glyphicon-' + (oauth[serviceid] ? 'minus-sign' : 'plus-sign') }),
										' ',
										oauth[serviceid] ? 'Forget Account' : 'Authorize Account'
									)
								)
							)
						);
					}
				break;
			case 'create_hotkey':
			case 'edit_hotkey':
					let { editing } = this.props; // mapped state

					let isvalid = (editing && editing.isvalid);
					rels.push(
						React.createElement('a', { href:'#', className:'btn btn-success pull-right', disabled:(isvalid ? '' : 'disabled'), onClick:this.saveHotkey },
							React.createElement('span', { className:'glyphicon glyphicon-ok' }),
							' ',
							page == 'edit_hotkey' ? 'Update Hotkey' : 'Add Hotkey'
						),
						' '
					);
				break;
		}

		// 	React.createElement('div', { className:'input-group' },
		// 		React.createElement('input', { className:'form-control', placeholder:'Search', name:'search', id:'search', type:'text' }),
		// 		React.createElement('div', { className:'input-group-btn' },
		// 			React.createElement('button', { className:'btn btn-default', type:'submit' },
		// 				React.createElement('i', { className:'glyphicon glyphicon-search' })
		// 			)
		// 		)
		// 	),
		//
		// 	React.createElement('ul', { className:'pagination' },
		// 		React.createElement('li', undefined,
		// 			React.createElement('a', { href:'#' },
		// 				'«'
		// 			)
		// 		),
		// 		React.createElement('li', { className:'active' },
		// 			React.createElement('a', { href:'#' },
		// 				'1'
		// 			)
		// 		),
		// 		React.createElement('li', undefined,
		// 			React.createElement('a', { href:'#' },
		// 				'2'
		// 			)
		// 		),
		// 		React.createElement('li', undefined,
		// 			React.createElement('a', { href:'#' },
		// 				'»'
		// 			)
		// 		)
		// 	)


		// has back button?
		if (page_history.length > 1) {
			rels.splice(0, 0,
				React.createElement('a', { href:'#', className:'btn btn-default pull-left', onClick:back },
					React.createElement('span', { className:'glyphicon glyphicon-triangle-left' }),
					' ',
					'Back'
				),
				' '
			);
		}
		return React.createElement('div', { className:'row text-center' },
			React.createElement('div', { className:'col-lg-12' },
				rels
			)
		);
	}
});

let HeaderContainer = ReactRedux.connect(
	function(state, ownProps) {
		return {
			page_history: state.page_history
		}
	}
)(Header);

let ControlsContainer = ReactRedux.connect(
	function(state, ownProps) {
		return {
			page_history: state.page_history,
			editing: state.editing,
			oauth: state.stg.mem_oauth
		}
	},
	function(dispatch, ownProps) {
		return {
			back: e => stopClickAndCheck0(e) ? dispatch(prevPage()) : undefined,
			savehtk: e => stopClickAndCheck0(e) ? dispatch(prevPage()) : undefined
		}
	}
)(Controls);

let PageContainer = ReactRedux.connect(
	function(state, ownProps) {
		return {
			page_history: state.page_history,
			editing: state.editing,
			pref_hotkeys: state.stg.pref_hotkeys
		}
	},
	function(dispatch, ownProps) {
		return {
			load: (page, e) => stopClickAndCheck0(e) ? dispatch(loadPage(page)) : undefined,
			reload: (page, e) => stopClickAndCheck0(e) ? dispatch(reloadPageIf(page)) : undefined
			// enable: () => {
			// 	let lat = document.getElementById('lat').value;
			// 	let lng = document.getElementById('lng').value;
			//
			// 	let stgvals = { pref_lat:lat, pref_lng:lng, mem_faking:true };
			// 	callInBackground('storageCall', { aArea:'local',aAction:'set',aKeys:stgvals }, ()=>callInBackground('setFaking', true))
			// 	dispatch(setStgs(stgvals));
			// },
			// disable: () => {
			// 	let stgvals = { mem_faking:false };
			// 	callInBackground('storageCall', { aArea:'local',aAction:'set',aKeys:stgvals }, ()=>callInBackground('setFaking', false))
			// 	dispatch(setStgs(stgvals));
			// }
		}
	}
)(Page);

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
// end - cmn
