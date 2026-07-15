const FormData = require("form-data"); // form-data v4.0.1
const Mailgun = require("mailgun.js"); // mailgun.js v11.1.0
const config = require("./config");

async function sendSimpleMessage(to,subject,text) {
  const mailgun = new Mailgun(FormData);
  const mg = mailgun.client({
    username: "api",
    key: config.MAILGUN_API_KEY,
    // When you have an EU-domain, you must specify the endpoint:
    // url: "https://api.eu.mailgun.net"
  });
  try {
    const data = await mg.messages.create("expertigo.co.il", {
      from: "Do NOT reply <dontreply@expertigo.co.il>",
      to: [to],
      subject: subject,
      text: text,
    });

    console.log(data); // logs response data
  } catch (error) {
    console.log(error); //logs any error
    throw error;
  }
}

module.exports = {
  sendSimpleMessage,
};

