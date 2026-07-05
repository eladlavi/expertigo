const vm = require('vm');
const https = require('follow-redirects').https;
const fs = require('fs');
const crypto = require("crypto");
const config = require("./config");
let mysql = require("mysql2");


let pool = mysql.createPool({
    connectionLimit: 1,
    host: "185.47.173.250",
    user: "remote",
    password: config.NODEJS_TEST_DB_PASSWORD,
    database: "whatsapp_db",
    queueLimit: 1,
    charset: 'utf8mb4'
});


exports.foo = (req, res, q) => {
    return;
    let options = {
        'method': 'POST',
        'hostname': 'pe3wdv.api.infobip.com',
        'path': '/whatsapp/1/message/template',
        'headers': {
            'Authorization': 'App ' + API_KEY,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        'maxRedirects': 20
    };

    let reqToInfobip = https.request(options, function (resFromInfobip) {
        var chunks = [];

        resFromInfobip.on("data", function (chunk) {
            chunks.push(chunk);
        });

        resFromInfobip.on("end", function (chunk) {
            var body = Buffer.concat(chunks);
            console.log(body.toString());
            res.writeHead(200);
            res.end("ok");
        });


        resFromInfobip.on("error", function (error) {
            console.error(error);
            res.writeHead(500);
            res.end();
        });
    });

    var postData = JSON.stringify({
        "messages": [
            {
                "from": "972505428200",
                "to": "972544455664",
                "messageId": "a28dd97c-1ffb-4fcf-99f1-0b557ed381da",
                "content": {
                    "templateName": "my_test_template",
                    "templateData": {
                        "body": {
                            "placeholders": [
                            ]
                        }
                    },
                    "language": "he"
                },
                "callbackData": "Callback data",
                //"notifyUrl": "https://www.example.com/whatsapp",
                "urlOptions": {
                    "shortenUrl": true,
                    "trackClicks": true,
                    "trackingUrl": "https://example.com/click-report",
                    "removeProtocol": true
                }
            }
        ]
    });

    reqToInfobip.write(postData);

    reqToInfobip.end();


};

exports.login = (req, res, q) => {
    if (req.method != "GET") {
        res.writeHead(403);
        res.end();
        return;
    }
    let whatsapp_number = q.query["whatsapp_number"];
    let password = q.query["password"];
    if (!whatsapp_number || !password) {
        res.writeHead(400);
        res.end();
        return;
    }
    pool.getConnection((err, conn) => {
        if (err) {
            console.log("error connecting to DB " + err);
            res.writeHead(500);
            res.end();
            return;
        }
        conn.query("SELECT API_key,base_url,whatsapp_number_to_send_code FROM accounts WHERE whatsapp_number=? AND BINARY password=? AND (TIME_TO_SEC(TIMEDIFF(NOW(),time_of_code))>10 OR time_of_code IS NULL)", [whatsapp_number, password], (err, result) => {
            if (err) {
                conn.release();
                console.log(err);
                res.writeHead(500);
                res.end();
                return;
            }
            if (result.length == 0) {
                conn.release();
                res.writeHead(403);
                res.end();
                //log this failure login attempt
                return;
            }
            const API_KEY = result[0]["API_key"];
            const BASE_URL = result[0]["base_url"];
            const whatsapp_number_to_send_code = result[0]["whatsapp_number_to_send_code"];
            const newToken = makeid(40);
            const code = makeCode();
            conn.query("UPDATE accounts SET new_token=?,code=?,time_of_code=? WHERE whatsapp_number=?", [newToken, code, new Date(), whatsapp_number], (err, result) => {
                conn.release();
                if (err) {
                    console.log(err);
                    res.writeHead(500);
                    res.end();
                    return;
                }
                if (result.affectedRows == 0) {
                    res.writeHead(500);
                    res.end();
                    return;
                }
                let options = {
                    'method': 'POST',
                    'hostname': BASE_URL,
                    'path': '/whatsapp/1/message/template',
                    'headers': {
                        'Authorization': 'App ' + API_KEY,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    'maxRedirects': 20
                };

                let reqToInfobip = https.request(options, function (resFromInfobip) {
                    var chunks = [];

                    resFromInfobip.on("data", function (chunk) {
                        chunks.push(chunk);
                    });

                    resFromInfobip.on("end", function (chunk) {
                        var body = Buffer.concat(chunks);
                        res.writeHead(200);
                        res.end(newToken);
                    });


                    resFromInfobip.on("error", function (error) {
                        console.error(error);
                        res.writeHead(500);
                        res.end();
                    });
                });
                const uuid = crypto.randomUUID();
                var postData = JSON.stringify({
                    "messages": [
                        {
                            "from": whatsapp_number,
                            "to": whatsapp_number_to_send_code,
                            "messageId": uuid,
                            "content": {
                                "templateName": "my_authentication_template",
                                "templateData": {
                                    "body": {
                                        "placeholders": [
                                            code
                                        ]
                                    },
                                    "buttons":[{
                                        "type":"URL",
                                        "parameter":code
                                    }]
                                },
                                "language": "he"
                            }
                        }
                    ]
                });

                reqToInfobip.write(postData);

                reqToInfobip.end();
                
            });
        });
    });
};

exports.messageReceived = (req, res, q) => {
    const forwardedIps = req.headers['x-forwarded-for'];
    if (forwardedIps != "193.105.74.58") {
        res.writeHead(403);
        res.end();
        return;
    }
    if (req.method != "POST") {
        res.writeHead(403);
        res.end();
        return;
    }
    let body = '';
    req.on('data', chunk => {
        if (body.length > 20000) {
            conn.release();
            res.writeHead(403); res.end(); return;
        }
        body += chunk;
    });
    req.on('end', () => {
        console.log("message received.." + forwardedIps);
        if (body.startsWith("{")) {
            const inboundMessageData = JSON.parse(body);
            for (let i = 0; i < inboundMessageData.results.length; i++) {
                let message = inboundMessageData.results[i];
                const messageId = message["messageId"];
                const from = message["from"];
                const to = message["to"];
                const seenAt = message["seenAt"];
                const sentAt = message["sentAt"];
                if (message.hasOwnProperty("message")) {
                    const receivedAt = message["receivedAt"];
                    const messageText = message["message"]["text"];
                    pool.getConnection((err, conn) => {
                        if (err) {
                            console.log("error connecting to DB " + err);
                            res.writeHead(500);
                            res.end();
                            return;
                        }
                        conn.query("SELECT API_key,base_url FROM accounts WHERE whatsapp_number=?", [to], (err, result) => {
                            if (err) {
                                console.log(err);
                                conn.release();
                                res.writeHead(500);
                                res.end();
                                return;
                            }
                            if (result.length == 0) {
                                conn.release();
                                res.writeHead(403);
                                res.end();
                                return;
                            } else {
                                const API_KEY = result[0]["API_key"];
                                const BASE_URL = result[0]["base_url"];
                                const SENDER = to;
                                conn.query("SELECT * FROM messages WHERE message_id = ?", [messageId], (err, result) => {
                                    if (err) {
                                        console.log(err);
                                        conn.release();
                                        res.writeHead(500);
                                        res.end();
                                        return;
                                    }
                                    if (result.length == 0) {
                                        const uuid = crypto.randomUUID();
                                        conn.query("INSERT INTO messages(message_id,from_number,to_number,message_content,response_message_id,received_at) VALUES (?,?,?,?,?,?)", [messageId, from, to, messageText, uuid, new Date(receivedAt)], (err, result) => {
                                            if (err) {
                                                console.log(err);
                                                conn.release();
                                                res.writeHead(500);
                                                res.end();
                                                return;
                                            }
                                            if (result.affectedRows == 1) {
                                                sendResponse(conn, SENDER, BASE_URL, API_KEY, res, message, uuid, messageText, to, from, messageId);
                                            } else {
                                                conn.release();
                                                res.writeHead(500);
                                                res.end();
                                                return;
                                            }
                                        });
                                    } else {
                                        conn.release();
                                        res.end();
                                    }

                                });
                            }
                        });


                    });

                } else {
                    pool.getConnection((err, conn) => {
                        if (err) {
                            console.log("error connecting to DB " + err);
                            res.writeHead(500);
                            res.end();
                            return;
                        }
                        conn.query("UPDATE messages SET sent_at=?,seen_at=? WHERE message_id=? AND to_number=? AND from_number=?", [new Date(sentAt), new Date(seenAt), messageId, to, from], (err, result) => {
                            if (err) {
                                console.log(err);
                            }
                            conn.release();
                            res.end("ok");
                        });
                    });
                }
            }


            res.end();

        } else {
            res.writeHead(400, { 'Content-type': 'text/plain' });
            res.end("expected JSON");
        }


    });

};


function sendResponse(conn, SENDER, BASE_URL, API_KEY, res, message, uuid, messageText, to, from, messageId) {
    conn.query("SELECT state, extra_data FROM contacts WHERE account_whatsapp_number=? AND client_whatsapp_number=?", [to, from], (err, result) => {
        if (err) {
            console.error(err.message);
            conn.release();
            res.writeHead(500);
            res.end();
            return;
        }
        if (result.length == 0) {
            conn.query("INSERT INTO contacts(account_whatsapp_number, client_whatsapp_number, state, extra_data) VALUES (?,?,?,?)", [to, from, "A", "{}"], (err, result) => {
                if (err) {
                    console.error(err.message);
                    res.writeHead(500);
                    res.end();
                    conn.release();
                    return;
                }
                sendResponseStep2(conn, SENDER, BASE_URL, API_KEY, res, message, uuid, messageText, to, from, messageId, "A", {});

            });
        } else {

            let state = result[0]["state"];
            let extra_data = JSON.parse(result[0]["extra_data"]);
            sendResponseStep2(conn, SENDER, BASE_URL, API_KEY, res, message, uuid, messageText, to, from, messageId, state, extra_data);
        }
    });
}

function sendResponseStep2(conn, SENDER, BASE_URL, API_KEY, res, message, uuid, messageText, to, from, messageId, state, extra_data) {
    conn.query("SELECT script FROM scripts WHERE whatsapp_number = ? AND state = ?", [to, state], (err, result) => {
        if (err) {
            conn.release();
            res.writeHead(500);
            res.end();
            console.error(err.message);
            return;
        }
        if (result.length == 0) {
            conn.release();
            res.writeHead(500);
            res.end();
            console.error("no such script and state");
            return;
        }
        let script = result[0]["script"];

        const context = {
            from: from,
            state: state,
            response: "חסרה תגובה",
            extra_data: extra_data,
            pool: null,
            https: https
        };
        vm.createContext(context);
        try {
            vm.runInContext(script, context);
        } catch (executionError) {
            conn.release();
            res.writeHead(500);
            res.end();
            console.error(executionError.message);
            return;
        }
        delete context["pool"];
        conn.query("UPDATE contacts SET state = ?, extra_data = ? WHERE account_whatsapp_number = ? AND client_whatsapp_number = ?", [context.state, JSON.stringify(context.extra_data), to, from], (err, result) => {
            //conn.release();//?
            if (err) {
                res.writeHead(500);
                res.end();
                console.error(err.message);
                return;
            }
            //send context.response to client 'from'
            const options = {
                'method': 'POST',
                'hostname': BASE_URL,
                'path': '/whatsapp/1/message/text',
                'headers': {
                    'Authorization': 'App ' + API_KEY,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                'maxRedirects': 20
            };
            let responseToClient = context.response;
            let reqToInfobip = https.request(options, function (resFromInfobip) {
                var chunks = [];

                resFromInfobip.on("data", function (chunk) {
                    chunks.push(chunk);
                });

                resFromInfobip.on("end", function (chunk) {
                    let body = Buffer.concat(chunks);
                    //console.log(body.toString());
                    conn.query("INSERT INTO messages(message_id,from_number,to_number,message_content,response_message_id,sent_at,is_sent) VALUES (?,?,?,?,?,?,1)", [uuid, to, from, responseToClient, messageId, new Date()], (err, result) => {
                        conn.release();
                        if (err) {
                            console.log(err);
                            res.writeHead(500);
                            res.end();
                            return;
                        }
                        res.writeHead(200);
                        res.end();
                    });

                });

                resFromInfobip.on("error", function (error) {
                    conn.release();
                    console.error(error);
                    res.writeHead(500);
                    res.end();
                });
            });

            const postData = JSON.stringify({
                "from": SENDER,
                "to": from,
                "messageId": uuid,
                "content": {
                    "text": responseToClient
                },
                //"callbackData": "Callback data",
                //"notifyUrl": "https://www.example.com/whatsapp",
                "urlOptions": {
                    "shortenUrl": true,
                    "trackClicks": true,
                    "trackingUrl": "https://example.com/click-report",
                    "removeProtocol": true
                }
            });

            reqToInfobip.write(postData);

            reqToInfobip.end();
        });

    });
}
const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function makeid(length) {
    let result = '';

    const charactersLength = characters.length;
    let counter = 0;
    while (counter < length) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
        counter += 1;
    }
    return result;
};

const charactersForCode = '0123456789';
function makeCode() {
    let result = '';

    const charactersLength = charactersForCode.length;
    let counter = 0;
    while (counter < 6) {
        result += charactersForCode.charAt(Math.floor(Math.random() * charactersLength));
        counter += 1;
    }
    return result;
};