var gBgComm = new Comm.client.webextports('tab');
var callInBackground = Comm.callInX2.bind(null, gBgComm, null, null);
var callInExe = Comm.callInX2.bind(null, gBgComm, 'callInExe', null);
var callInBootstrap = Comm.callInX2.bind(null, gBgComm, 'callInBootstrap', null);
var callInMainworker = Comm.callInX2.bind(null, gBgComm, 'callInMainworker', null);

var nub;
var store;

var gSupressUpdateHydrantOnce;
var gAppPageComponents = [];

async function init() {
	console.error('calling fetchData with hydrant skeleton:', hydrant);

	let data = await new Promise( resolve => callInBackground('fetchData', { hydrant, nub:1 }, val => resolve(val)) );

	nub = data.nub;

	// window.addEventListener('unload', uninit, false);

	// setup and start redux
	if (app) {
		if (hydrant) Object.assign(hydrant, data.hydrant); // dont update hydrant if its undefined, otherwise it will screw up all default values for redux

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

var hydrant = {
	stg: {
		// set defaults here, as if it never has been set with `storageCall('storaget', 'set')` then `fetchData` will get back an empty object
		mem_hotkeys: []
	}
};

// ACTIONS
const SET_MAIN_KEYS = 'SET_MAIN_KEYS';

const SET_STG = 'SET_STG';
const SET_STGS = 'SET_STGS';

const LOAD_PAGE = 'LOAD_PAGE';
const PREV_PAGE = 'PREV_PAGE';

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
// REDUCERS
function stg(state=hydrant.stg, action) {
	switch (action.type) {
		case SET_STG:
			var { name, val } = action;
			return Object.assign({}, state, {
				[name]: val
			});
		case SET_STGS:
			var { namevals } = action;
			return Object.assign({}, state, namevals);
		case SET_MAIN_KEYS:
			var { obj_of_mainkeys } = action;
			var mainkey = 'stg';
			return (mainkey in obj_of_mainkeys ? obj_of_mainkeys[mainkey] : state);
		default:
			return state;
	}
}
function page_history(state=['my_hotkeys'], action) {
	switch (action.type) {
		case SET_MAIN_KEYS:
			var { obj_of_mainkeys } = action;
			var mainkey = 'page_history';
			return (mainkey in obj_of_mainkeys ? obj_of_mainkeys[mainkey] : state);
		case LOAD_PAGE:
			let { name } = action;
			return [...state, name];
		case PREV_PAGE:
			var newhistory = [...state];
			newhistory.pop();
			return newhistory;
		default:
			return state;
	}
}

function editing(state='', action) {
	// state is hotkey filename
	switch (action.type) {
		case SET_MAIN_KEYS:
			var { obj_of_mainkeys } = action;
			var mainkey = 'editing';
			return (mainkey in obj_of_mainkeys ? obj_of_mainkeys[mainkey] : state);
		default:
			return state;
	}
}

var app = Redux.combineReducers({
	stg,
	page_history, // string; enum[my_hotkeys,add_hotkey,community,edit_hotkey,create_hotkey]
	editing // only respected if page is edit_hotkey
});

/* hotkey struct -
{
	combo: [], // remote_htk does not have
	filename: '', // generated based on filename's available on server // just a random hash // if not yet verified with server (meaning not yet shared) this is prefexed with `_`
	filehistory: [ // local has this too, but it will only have one entry
		{
			commit: '' // commit hash - if it doesnt have it, then it hasnt been upated yet, and any edits should keep updating this
			// remote meta data
			// filecontents is like this:
			locale: {
				'en-US': {
					name: ''
					description: ''
				}
			},
			code: ''
		}
	]
}
*/

// REACT COMPONENTS - PRESENTATIONAL
var App = React.createClass({
	render: function() {

		var app_components = [
			// 'HEADER',
			...gAppPageComponents
			// 'FOOTER'
		];

		return React.createElement('div', { id:'app', className:'app container' },
			app_components
		);
	}
});

var Page = React.createClass({
	displayName: 'Page',
	render() {
		let { page_history } = this.props; // mapped state
		let { load } = this.props; // dispatchers

		let page = page_history[page_history.length - 1];

		let rels = [];
		switch (page) {
			case 'add_hotkey':
					rels.push(
						React.createElement('div', { className:'row text-center' },
							React.createElement('a', { href:'#', className:'btn btn-default', onClick:load.bind(null, 'community') },
								React.createElement('span', { className:'glyphicon glyphicon-triangle-left' }),
								' ',
								'Browse Community'
							)
						)
					);

					rels.push(
						React.createElement('div', { className:'row text-center' },
							React.createElement('a', { href:'#', className:'btn btn-default', onClick:load.bind(null, 'create_hotkey') },
								React.createElement('span', { className:'glyphicon glyphicon-triangle-left' }),
								' ',
								'Create My Own'
							)
						)
					);
				break;
			case 'my_hotkeys':
					// rels = [
					// 	React.createElement('div', { className:'row text-center' },
					// 		React.createElement(Hotkey),
					// 		React.createElement(Hotkey),
					// 		React.createElement(HotkeyAdd)
					// 	)
					// ]
					rels.push(
						React.createElement('div', { className:'row text-center' },
							React.createElement(HotkeyAdd)
						)
					);
				break;
			case 'create_hotkey':
					rels.push(
						React.createElement('div', { className:'row text-center' },
							'you are on create a hotkey page'
						)
					);
				break;
			case 'community':
					rels.push(
						React.createElement('div', { className:'row text-center' },
							'you are on browse community page'
						)
					);
				break;
		};

		return React.createElement('span', undefined,
			rels
		);
	}
});

var Header = React.createClass({
	displayName: 'Header',
	render() {
		let { page_history } = this.props; // mapped state

		let crumbs = [];
		for (let pagename of page_history) {
			if (pagename != 'my_hotkeys') {
				crumbs.push(
					React.createElement('small', undefined,
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

var Hotkey = React.createClass({
	displayName: 'Hotkey',
	render() {
		return React.createElement('div', { className:'col-md-3 col-sm-6 hero-feature' },
			React.createElement('div', { className:'thumbnail' },
				// React.createElement('img', { src:'http://placehold.it/800x500', alt:'' }),
				React.createElement('div', { className:'caption' },
					React.createElement('h3', undefined,
						'HOTKEY + COMBO'
					),
					React.createElement('p', undefined,
						'Hotkey description goes here. Category only shown in explore.'
					),
					React.createElement('p', undefined,
						React.createElement('a', { href:'#', className:'btn btn-default', 'data-tooltip':'Change Hotkey' },
							React.createElement('span', { className:'glyphicon glyphicon-refresh' })
						),
						' ',
						React.createElement('a', { href:'#', className:'btn btn-default', 'data-tooltip':'Edit' },
							React.createElement('span', { className:'glyphicon glyphicon-pencil' })
						),
						' ',
						React.createElement('a', { href:'#', className:'btn btn-default', 'data-tooltip':'Disable' },
							React.createElement('span', { className:'glyphicon glyphicon-off' })
						),
						' ',
						React.createElement('a', { href:'#', className:'btn btn-default', 'data-tooltip':'Remove' },
							React.createElement('span', { className:'glyphicon glyphicon-trash' })
						),
						' ',
						React.createElement('a', { href:'#', className:'btn btn-default', 'data-tooltip':'Share' },
							React.createElement('span', { className:'glyphicon glyphicon-globe' })
						),
						' ',
						React.createElement('a', { href:'#', className:'btn btn-default', 'data-tooltip':'Update'},
							React.createElement('span', { className:'glyphicon glyphicon-download' })
						)
					)
				)
			)
		);
	}
});

var HotkeyAdd = React.createClass({
	displayName: 'HotkeyAdd',
	click(e) {
		if (stopClickAndCheck0(e)) {
			store.dispatch(loadPage('add_hotkey'));
		}
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

var Controls = React.createClass({
	displayName: 'Controls',
	render() {
		let { page_history } = this.props; // mapped state
		let { back } = this.props; // dispatchers

		let page = page_history[page_history.length - 1];
		let rels = [];

		// meat
		switch (page) {
			case 'my_hotkeys':
					rels.push('Manage your collection of hotkeys here. You can browse the community shared commands by click "Add" and then "Community". You can create your own custom commands and share it with the community.');
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
			rels.push(
				React.createElement('a', { href:'#', className:'btn btn-default', onClick:back },
					React.createElement('span', { className:'glyphicon glyphicon-triangle-left' }),
					' ',
					'Back'
				)
			);
		}
		return React.createElement('div', { className:'row text-center' },
			React.createElement('div', { className:'col-lg-12' },
				rels
			)
		);
	}
});

var HeaderContainer = ReactRedux.connect(
	function(state, ownProps) {
		return {
			page_history: state.page_history
		}
	}
)(Header);

var ControlsContainer = ReactRedux.connect(
	function(state, ownProps) {
		return {
			page_history: state.page_history
		}
	},
	function(dispatch, ownProps) {
		return {
			back: e => stopClickAndCheck0(e) ? dispatch(prevPage()) : undefined
		}
	}
)(Controls);

var PageContainer = ReactRedux.connect(
	function(state, ownProps) {
		return {
			page_history: state.page_history
		}
	},
	function(dispatch, ownProps) {
		return {
			load: (page, e) => stopClickAndCheck0(e) ? dispatch(loadPage(page)) : undefined
			// enable: () => {
			// 	let lat = document.getElementById('lat').value;
			// 	let lng = document.getElementById('lng').value;
			//
			// 	var stgvals = { pref_lat:lat, pref_lng:lng, mem_faking:true };
			// 	callInBackground('storageCall', { aArea:'local',aAction:'set',aKeys:stgvals }, ()=>callInBackground('setFaking', true))
			// 	dispatch(setStgs(stgvals));
			// },
			// disable: () => {
			// 	var stgvals = { mem_faking:false };
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
	var l = aTargetArr.length;
	for (var i=l-1; i>0; i--) {
		aTargetArr.splice(i, 0, aEntry);
	}
}
function stopClickAndCheck0(e) {
	e.stopPropagation();
	e.preventDefault();
	if (e.button === 0) {
		return true;
	} else {
		return false;
	}
}
// end - cmn
