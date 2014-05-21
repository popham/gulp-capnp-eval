var path = require('path');
var spawn = require('child_process').spawn;
var through = require('through2');

var File = require('vinyl');
var Ordered = require('ordered-read-streams');

var formats = {
    binary : '--binary',
    flat :   '--flat',
    packed : '--packed'
};

var encodings = {
    binary : null,
    flat : 'utf8',
    packed : null
};

var pseudoFile = through(
    { objectMode: true },
    function (chunk, enc, cb) {
        if (!this.isStarted) {
            this.isStarted = true;
            this.continuation = through();
            this.push(new File({
                path : this.capnpName,
                contents : this.continuation
            }));
        }

        this.continuation.push(chunk);
        cb();
    },
    function () {
        if (this.isStarted) {
            this.continuation.push(null);
            this.push(null);
        }
    }
);

pseudoFile.on('pipe', function (src) {
    if (src.capnpName) {
        this.capnpName = src.capnpName;
    }
})

function parseOptions(options) {
    var args = [];
    options = options ? options : {};

    if (options.format) {
        args.push(formats[options.format]);
    }

    if (options.verbose) {
        args.push('--verbose');
    }

    // Normalize to array of import paths.
    if (options.importPaths) {
        if (!Array.isArray(options.importPaths)) {
            options.importPaths = [options.importPaths];
        }
    } else {
        options.importPaths = [];
    }

    for (var i=0; i<options.importPaths.length; ++i) {
        args.push('-I');
        args.push(options.importPaths[i]);
    }

    if (options.noStandardImport) {
        args.push('--no-standard-import');
    }

    return args;
}

/**
 * @param {string[]} members - Constant names to strip.  Path syntax should
 * use `/` instead of the `.` of `capnp help eval` (in deference to eventual
 * minimatch support).
 * @param {string} schema - Filename of schema to strip.
 * @param {object} options - Options to pass to `capnp eval`.  See 
 * `capnp help eval` for details.
 *   * `format` : `binary`, `flat`, `packed`, or undefined for text output.  See
 *   `capnp help eval` for details.
 *   * `verbose` - `true` or `false`.
 *   * `importPaths` - Array of import path strings.
 *   * `noStandardImport` - `true` or `false`.
 */
module.exports = function (members, schema, options) {
    members = Array.isArray(members) ? members : [members];

    var args = ['eval'];
    args = args.concat(parseOptions(options));
    args.push(schema);

    var encoding = options && options.format ? encodings[options.format] : 'utf8';

    // Minimatch support requires Reader: members -> expanded paths.
    // (Visitor interface on Reader, with a visitor wraps Minimatch and emits
    // matches as found? see `stream-unique`).
    members = members.map(function (m) { return m.replace('/', '.'); });
    var stderrs = [];
    var stdouts = members.map(function (m) {
        var p = spawn('capnp', args.concat(m));
        p.stderr.setEncoding('utf8');
        stderrs.push(p.stderr);
        p.stdout.capnpName = path.join(path.resolve(path.dirname()), m);
        p.stdout.setEncoding(encoding);

        return p.stdout;
    });

    var streams = new Ordered(
        stdouts.map(function (stdout) { return stdout.pipe(pseudoFile); })
    );

    stderrs.forEach(function (stderr) {
        stderr.on('data', function (e) {
            streams.emit('error', new Error(e));
        });
    });

    return streams;
};
