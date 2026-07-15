let http = require('http');
let fs = require('fs');




function startServer(actions) {

    http.createServer((req, res) => {

        const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const query = Object.create(null);
        for (const [key, value] of requestUrl.searchParams.entries()) {
            if (Object.prototype.hasOwnProperty.call(query, key)) {
                query[key] = Array.isArray(query[key]) ? query[key].concat(value) : [query[key], value];
            } else {
                query[key] = value;
            }
        }
        const q = {
            pathname: requestUrl.pathname,
            query: query
        };

        if (q.pathname && q.pathname.startsWith('/api')) {

            let action = q.pathname.substring(4);
            if (!actions[action]) {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('no such action');
                return;
            }
            actions[action](req, res, q);


        } else {
            //static file
            let allowedContentTypes = {
                '.html': 'text/html',
                '.css': 'text/css',
                '.js' : 'text/javascript',
                '.png' : 'image/png',
                '.gif' : 'image/gif',
                '.ico' : 'image/vnd.microsoft.icon'
            };

            let filename = null;
            if (q.pathname == '/')
                filename = '/index.html';
            else filename = q.pathname;

            let indexOfDot = filename.indexOf('.');
            if (indexOfDot == -1) {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('invalid file name..');
                return;
            }
            let extension = filename.substring(indexOfDot);
            let contentType = null;
            if (allowedContentTypes[extension]) {
                contentType = allowedContentTypes[extension];

            } else {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('invalid extension..');
                return;
            }

            fs.readFile('static_files/' + filename.substring(1), (err, data) => {
                if (err) {
                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    res.end('file not found');
                    return;
                }
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(data);
            });

        }
    }).listen(3001, ()=>{console.log('now listening on 3001');
    });
}
exports.startServer = startServer;
