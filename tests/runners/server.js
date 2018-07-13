/* global require, module */
'use strict';

var serveIndex;
try {
  serveIndex = require('serve-index');
} catch (err) { }
var express = require('express'),
    app = express(),
    help = false,
    skip = 2,
    port = 30100,
    build = false,
    dist = false,
    website = false;

process.argv.forEach(function (val, idx) {
  if (skip) {
    skip -= 1;
    return;
  }
  if (val === '--build' || val === '-b') {
    build = true;
  } else if (val === '--dist' || val === '-d') {
    dist = true;
  } else if ((val === '--port' || val === '-p') && idx + 1 < process.argv.length) {
    port = parseInt(process.argv[idx + 1], 10);
    skip = 1;
  } else if (val.substr(0, 7) === '--port=') {
    port = parseInt(val.substr(7), 10);
  } else if (val === '--website' || val === '--web' || val === '-w') {
    website = true;
  } else {
    help = true;
  }
});

if (help) {
  console.error('Serve the dist, website, and _build directories.  Options:\n' +
    '--build : serve _build directory as build/\n' +
    '--dist : serve distribution directory (default)\n' +
    '--port (port) : default 30100\n' +
    '--website : serve website directory (if this and dist are specified,\n' +
    '   dist is located as dist/)\n');
  process.exit(1);
}

if (!website) {
  if (!build || dist) {
    app.use(express.static('dist'));
  }
} else {
  if (dist) {
    app.use('/dist', express.static('dist'));
  }
  app.use(express.static('website/public'));
}
if (build) {
  if (serveIndex) {
    app.use('/build', express.static('_build'), serveIndex('_build', {icons: true, view: 'details'}));
  } else {
    app.use('/build', express.static('_build'));
  }
}

app.listen(port, function () {
  console.log('Server listening on ' + port);
});

module.exports = app;
