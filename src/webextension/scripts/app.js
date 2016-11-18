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
		React.createElement(Header),
		React.createElement(Controls),
		React.createElement('hr'),
		React.createElement(Hotkey),
		React.createElement('hr')
		// React.createElement(Footer)
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
const SET_STG = 'SET_STG';
const SET_STGS = 'SET_STGS';
const SET_MAIN_KEYS = 'SET_MAIN_KEYS';

// ACTION CREATORS
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

var app = Redux.combineReducers({
	stg
});

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

var Header = React.createClass({
	displayName: 'Header',
	render() {
		return React.createElement('div', { className:'row' },
			React.createElement('div', { className:'col-lg-12' },
				React.createElement('h1', { className:'page-header' },
					'Trigger',
					' ',
					React.createElement('small', { className:'' },
						'Manage Hotkeys'
					)
				)
			)
		);
	}
});

var FeatureTitle = React.createClass({
	displayName: 'FeatureTitle',
	render() {
		return React.createElement('div', { className:'row' },
			React.createElement('div', { className:'col-lg-12' },
				React.createElement('h3', undefined,
					'Latest Features'
				)
			)
		);
	}
});

var Hotkey = React.createClass({
	displayName: 'Hotkey',
	render() {
		return React.createElement('div', { className:'row text-center' },
			React.createElement('div', { className:'col-md-3 col-sm-6 hero-feature' },
				React.createElement('div', { className:'thumbnail' },
					React.createElement('img', { src:'http://placehold.it/800x500', alt:'' }),
					React.createElement('div', { className:'caption' },
						React.createElement('h3', undefined,
							'Feature Label'
						),
						React.createElement('p', undefined,
							'Lorem ipsum dolor sit amet, consectetur adipisicing elit.'
						),
						React.createElement('p', undefined,
							React.createElement('a', { href:'#', className:'btn btn-primary' },
								'Buy Now!'
							),
							' ',
							React.createElement('a', { href:'#', className:'btn btn-default' },
								'More Info'
							)
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
		return React.createElement('div', { className:'row text-center' },
			React.createElement('div', { className:'col-lg-12' },

				React.createElement('div', { className:'input-group' },
					React.createElement('input', { className:'form-control', placeholder:'Search', name:'search', id:'search', type:'text' }),
					React.createElement('div', { className:'input-group-btn' },
						React.createElement('button', { className:'btn btn-default', type:'submit' },
							React.createElement('i', { className:'glyphicon glyphicon-search' })
						)
					)
				),

				React.createElement('ul', { className:'pagination' },
					React.createElement('li', undefined,
						React.createElement('a', { href:'#' },
							'«'
						)
					),
					React.createElement('li', { className:'active' },
						React.createElement('a', { href:'#' },
							'1'
						)
					),
					React.createElement('li', undefined,
						React.createElement('a', { href:'#' },
							'2'
						)
					),
					React.createElement('li', undefined,
						React.createElement('a', { href:'#' },
							'»'
						)
					)
				)
			)
		);
	}
})

var Footer = React.createClass({
	displayName: 'Footer',
	render() {
		return React.createElement('footer', undefined,
			React.createElement('div', { className:'row' },
				React.createElement('div', { className:'col-lg-12' },
					React.createElement('p', undefined,
						'Copyright &copy; Your Website 2014'
					)
				)
			)
		);
	}
});
