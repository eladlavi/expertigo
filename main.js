let myServer = require('./my_server.js');
let myApi = require('./my_api.js');
let actions = {
    //"/foo": myApi.foo,
    //"/message_received": myApi.messageReceived,
    //"/login": myApi.login
    "send_email": myApi.sendEmail
};
myServer.startServer(actions);