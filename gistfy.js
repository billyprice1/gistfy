var PORT = process.env.OPENSHIFT_NODEJS_PORT || 3000,
    IP_ADDRESS = process.env.OPENSHIFT_NODEJS_IP || '127.0.0.1',
    BASE_URL = process.env.OPENSHIFT_APP_DNS || 'http://localhost:3000';

var express = require('express'),
    fs = require('fs'),
    hljs = require('highlight.js'),
    https = require('https'),
    swig  = require('swig'),
    url = require('url');

var app = express(),
    template = swig.compileFile('template.html');


String.prototype.format = function () {
    var s = this.toString();

    for (var i = 0; i < arguments.length; i++) {
        var re = new RegExp('\\{' + i + '\\}', 'gm');
        s = s.replace(re, arguments[i]);
    }

    return s;
};

/*

https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String

*/
Object.defineProperty(String.prototype, 'startsWith', {
    enumerable: false,
    configurable: false,
    writable: false,
    value: function (searchString, position) {
        position = position || 0;
        return this.lastIndexOf(searchString, position) === position;
    }
});

Object.defineProperty(String.prototype, 'endsWith', {
    value: function (searchString, position) {
        var subjectString = this.toString();
        if (position === undefined || position > subjectString.length) {
            position = subjectString.length;
        }
        position -= searchString.length;
        var lastIndex = subjectString.indexOf(searchString, position);
        return lastIndex !== -1 && lastIndex === position;
    }
});

function escapeJS(s) {
    return s.replace(/\n/g, '\\n').replace(/\'/g, '\\\'').replace(/\"/g, '\\\"');
}

function highlight(code, language) {
    if (language) {
        return hljs.highlight(language, code).value;
    } else {
        return hljs.highlightAuto(code).value;
    }
}

function range(low, high) {
    var list = [];
    for (var i = low; i <= high; i++) {
        list.push(i);
    }
    return list;
}

function downloadFile(urlStr, callback) {
    var options = url.parse(urlStr);

    options.headers = {
        'User-Agent': 'Gistfy-App 0.1.0'
    };

    https.get(options, function (response) {
        response.setEncoding('utf8');

        var body = '';

        response.on('data', function (chunk) {
            body += chunk;
        });

        response.on('end', function () {
            callback(body);
        });

    }).on('error', function (e) {
        // TODO:
    });
}

function downloadJSON(url, callback) {
    downloadFile(url, function (data) {
        callback(JSON.parse(data));
    });
}

function guessLanguage(file) {
    if (file) {
        // FIX ME: Doesn't work for all extensions. e.g. ".cpp".
        // http://highlightjs.readthedocs.org/en/latest/css-classes-reference.html
        return file.split('.').pop();
    } else {
        return null;
    }
}

function processData(data, slice) {

    var start, end, len;

    // TODO: Use while, maybe more than once.
    if (data.startsWith('\n')) {
        data = data.substring(1);
    }

    if (data.endsWith('\n')) {
        data = data.substring(0, data.length - 1);
    }

    if (slice) {

        if (slice.indexOf(':') > -1) {
            slice = slice.split(':');
            if (slice) {
                // e.g 1:5 or -3:-1
                start = parseInt(slice.shift()) || 0;
                end = parseInt(slice.shift()) || -1;
            }
        } else {
            start = parseInt(slice) || 0;
            end = start;
        }

        len = data.split('\n').length;

        if (start < 0) {
            start = len + start;
        } else if (start + 1 > len) {
            start = 0
        }

        if (end < 0) {
            end = len + end;
        } else if (end + 1 > len) {
            end = len - 1
        }

        data = data.split('\n').slice(start, end + 1).join('\n');

    } else {
        start = 0;
        end = data.split('\n').length - 1;
    }

    return { data: data, start: start, end: end };
}

function buildResponse(type, options, callback) {
    switch (type) {
        case "js":
            var js = 'document.write(\'<link rel=\"stylesheet\" href=\"' + BASE_URL + '/gistfy.css\">\');\n'+
                     'document.write(\'' + escapeJS(template(options)) + '\');';
            callback(200, js, 'text/javascript');
            break;
        case "html":
            var html = '<link rel=\"stylesheet\" href=\"' + BASE_URL + '/gistfy.css\"><br>' + template(options);
            callback(200, html.replace('\n', '<br>'), 'text/html');
            break;
        default:
            callback(400, 'Invalid type.', 'text/html')
    }
}

app.get('/', function (req, res) {
    res.redirect('/index.html');
});

/*

Optional parameters:
    @param extended     Use extended template. Show user information at header. e.g., extended=true. Default: false. 
    @param lang         Set code language, for highlight. e.g., lang=python. Default is based in file extension. e.g., file.py returns python highlight style.
    @param locale       Set template locale, for translation. e.g., locale=en. Default: en.
    @param slice        Slice file, returning only the lines selected. e.g., slice=1:8. Default: null.
    @param theme        Set template theme. e.g., theme=github, Default: github.
    @param type         Return type for content. e.g. type=html. Default: js.
*/
app.get('/github/gist/:id', function (req, res) {

    var extended = req.query.extended,
        lang = req.query.lang,
        locale = req.query.locale || 'en',
        slice = req.query.slice,
        theme = req.query.theme || 'github',
        type = req.query.type || 'js';

    var url = 'https://api.github.com/gists/{0}'.format(req.params.id);

    downloadJSON(url, function (data) {
        var files = [];

        for (var k in data.files) {
            var file = data.files[k];

            var newData = processData(file.content, slice),
                lines = range(newData.start, newData.end),
                c = highlight(newData.data, lang || guessLanguage(file.filename));

            files.push({
                htmlUrl: data.html_url,
                rawUrl: file.raw_url,
                fileName: file.filename,
                content: c,
                lineRange: lines,
            });
        }

        var options = {
            files: files,
            repoUrl: null,
            theme: theme,
            extended: extended
        };

        buildResponse(type, options, function (status, content, contentType) {
            res.setHeader('content-type', contentType);
            res.send(content);
        });
    });
});

/*

Optional parameters:
    @param branch       Set file branch or changeset. e.g., branch=master or branch=38d25e12627b. Default: master.
    @param extended     Use extended template. Show user information at header. e.g., extended=true. Default: false. 
    @param lang         Set code language, for highlight. e.g., lang=python. Default is based in file extension. e.g., file.py returns python highlight style.
    @param locale       Set template locale, for translation. e.g., locale=en. Default: en.
    @param slice        Slice file, returning only the lines selected. e.g., slice=1:8. Default: null.
    @param theme        Set template theme. e.g., theme=github, Default: github.
    @param type         Return type for content. e.g. type=html. Default: js.
*/
app.get('/:host/:user/:repo/:path(*)', function (req, res) {

    var host = req.params.host.toLowerCase(),
        path = req.params.path,
        repo = req.params.repo,
        user = req.params.user,
        branch = req.query.branch || 'master',
        extended = req.query.extended,
        lang = req.query.lang,
        locale = req.query.locale || 'en',
        slice = req.query.slice,
        theme = req.query.theme || 'github',
        type = req.query.type || 'js',
        fileName = path.split('/').pop(),
        htmlUrl, rawUrl, repoUrl, from, to;

    if (host === 'github') {
        htmlUrl =  'https://github.com/{0}/{1}/blob/{2}/{3}'.format(user, repo, branch, path);
        rawUrl =  'https://raw.githubusercontent.com/{0}/{1}/{2}/{3}'.format(user, repo, branch, path);
        repoUrl = 'https://github.com/{0}/{1}'.format(user, repo);
    } else if (host === 'bitbucket') {
        htmlUrl =  'https://bitbucket.org/{0}/{1}/src/{2}/{3}'.format(user, repo, branch, path);
        rawUrl =  'https://api.bitbucket.org/1.0/repositories/{0}/{1}/raw/{2}/{3}'.format(user, repo, branch, path);
        repoUrl = 'https://bitbucket.org/{0}/{1}'.format(user, repo);
    } else {
        res.end();
        return;
    }

    downloadFile(rawUrl, function (data) {

        var newData = processData(data, slice),
            lines = range(newData.start, newData.end),
            content = highlight(newData.data, lang || guessLanguage(fileName));

        var options = {
            files: [{
                htmlUrl: htmlUrl,
                rawUrl: rawUrl,
                fileName: fileName,
                content: content,
                lineRange: lines
            }],
            repoUrl: repoUrl,
            theme: theme,
            extended: extended
        };

        buildResponse(type, options, function (status, content, contentType) {
            res.setHeader('content-type', contentType);
            res.send(content);
        });
    });
});

app.get('/:file(*)', function(req, res, next) {

    fs.exists(req.params.file, function(exists) {
        if (exists) {
            res.sendFile(req.params.file, { root: __dirname });
        } else {
            res.sendStatus(404);
        }
    });
});

app.listen(PORT, IP_ADDRESS, function () {
    console.log('Listening on http://{0}:{1}'.format(IP_ADDRESS, PORT));
});