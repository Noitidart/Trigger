/* README
 * --txtype fxhyb can be omitted, its default
 * gulp --txtype fxhyb - will create dev vresion, with console logs
 * gulp --prod --txtype fxhyb - this will create release version, without console logs
 * gulp watch --txtype fxhyb - this will watch for changes
 */

// Include gulp
var gulp = require('gulp');

// Include core modules
var fs = require('fs');
var path = require('path');

// Include Our Plugins
var babel = require('gulp-babel');
var clean = require('gulp-clean');
var gulpif = require('gulp-if');
var gulp_src_ordered = require('gulp-src-ordered-globs'); // http://stackoverflow.com/a/40206149/1828637
var jshint = require('gulp-jshint');
var replace = require('gulp-replace');
var rename = require('gulp-rename');
var zip = require('gulp-zip');

// Command line options
var options  = { // defaults
	production: false, // production
		// clarg == --prod
		// strips the console messages // production/release
	txtype: 'fxhyb' // transpile type
		// clarg == --txtype BLAH
		// values:
			// fxhyb == firefox-webextension-hybrid
			// fxext == firefox-webextension
			// web == web
		// affects taskcopy-3rdjs - where to copy the babel-polyfill too
};

var clargs = process.argv.slice(2);
var clargs = clargs.map(el => el.toLowerCase().trim());

console.log('clargs:', clargs);
// production?
if (clargs.indexOf('--prod') > -1) {
	options.production = true;
}

// txtype?
var ix_txtype = clargs.indexOf('--txtype');
if (ix_txtype > -1) {
	options.type = clargs[++ix_txtype];
}

// start async-proc9939
gulp.task('clean', function() {
	return gulp.src('dist', { read:false })
		.pipe(clean());
});

gulp.task('copy-zip-exe', ['clean'], function() {
	var dest;
	var srcwebext;
	switch (options.txtype) {
		case 'fxhyb':
			dest = 'dist/webextension/exe';
			srcwebext = 'src/webextension';
			break;
		default:
			dest = 'dist/exe';
			srcwebext = 'src';
	}

	var addonname = JSON.parse(fs.readFileSync(srcwebext + '/_locales/en-US/messages.json', 'utf8')).addon_name.message;
	return gulp_src_ordered([
			'../' + addonname + 'Exe/**/*',
			'!../' + addonname + 'Exe/**/*.*',
			'../' + addonname + 'Exe/**/*.exe'
        ])
		.pipe(rename(function(file) {
			file.dirname = file.dirname.split(path.sep)[0];
		}))
		.pipe(gulp.dest(dest));
		// if not fxhyb then replaces executables with zipped version
});

gulp.task('copy', ['copy-zip-exe'], function() {
	// copy all files but js
    return gulp_src_ordered([
            'src/**/*',
			'!src/.*',			// no hidden files/dirs in src
			'!src/.*/**/*',		// no files/dirs in hidden dirs in src
			'!src/**/*.js',		// no js files from src
			'!src/webextension/exe/**/*',		// no exe folder
			'src/**/3rd/*.js'	// make sure to get 3rd party js files though
        ])
        .pipe(gulp.dest('dist'));
});

gulp.task('import-3rdjs', ['copy'], function() {
	// bring in babel-polyfill to 3rd party directory - determined by clarg txtype

	var dest;
	// switch (options.txtype) {
	// 	case 'fxhyb':
	// 			dest = 'dist/webextension/scripts/3rd';
	// 		break;
	// 	case 'web':
	// 	case 'fxext':
	// 			dest = 'dist/scripts/3rd';
	// 		break;
	// }

	if (fs.existsSync('dist/webextension/scripts/3rd')) {
		// options.txtype == fxhyb
		dest = 'dist/webextension/scripts/3rd';
	} else if (fs.existsSync('dist/scripts/3rd')) {
		// options.txtype == web || fxext
		dest = 'dist/scripts/3rd';
	} else {
		throw new Error('dont know where to import 3rd party scripts too!');
	}
	console.log('dest:', dest);

    return gulp.src([
			'node_modules/babel-polyfill/dist/polyfill.min.js',
			'node_modules/react/dist/react-with-addons.min.js',
			'node_modules/react-dom/dist/react-dom.min.js',
			'node_modules/redux/dist/redux.min.js',
			'node_modules/react-redux/dist/react-redux.min.js'
        ])
        .pipe(gulp.dest(dest));
});

gulp.task('initial-tx-js', ['import-3rdjs'], function() {
	return gulp.start('tx-then-xpi');
});
// end async-proc9939

// start - standalone3888 - is standalone because so `gulp watch` can trigger this without triggering the clean and copy stuff from above
gulp.task('tx-js', function() {
	// tx-js stands for transform-javascripts
	var BABEL_POLYFILL = fs.readFileSync('node_modules/babel-polyfill/dist/polyfill.min.js', 'utf8');

	return gulp.src(['src/**/*.js', '!src/**/3rd/*'])
		.pipe(gulpif(options.production, replace(/^.*?console\.(warn|info|log|error|exception|time|timeEnd|jsm).*?$/mg, '')))
		.pipe(babel())
		.pipe(replace(/(^.*?$)([\s\S]*?)\/\/ #includetop 'babel-polyfill'/m, function($0, $1, $2) { return $1 + '\n\n\/\/ START INCLUDE - babel-polyfill\nvar global = this;\n' + BABEL_POLYFILL + '\/\/ END INCLUDE - babel-polyfill' + $2 }))
		.pipe(gulp.dest('dist'));
});

gulp.task('tx-then-xpi', ['tx-js'], function() {
	return gulp.src('dist/**/*')
        .pipe(zip('_dist' + Date.now() + '.xpi', { compress:false }))
        .pipe(gulp.dest('./'));
});

gulp.task('xpi', function() {
	return gulp.src('dist/**/*')
        .pipe(zip('dist.xpi', { compress:false }))
        .pipe(gulp.dest('./'));
});
// end - standalone3888


gulp.task('default', ['initial-tx-js']); // copy-3rdjs triggers tx-js
gulp.task('watch', ['initial-tx-js'], function() {
	console.log('NOTE: wait for tx-then-xpi to finish, or it may have already finished. as that does the initial js copy');
	// var watcher = gulp.watch('src/**/*.js', ['tx-then-xpi']);
	var watcher = gulp.watch('src/**/*', ['initial-tx-js']);
	watcher.on('change', function(event) {
		console.log('JS file at path "' + event.path + '" was ' + event.type + ', running tx-js...');
	});
});
