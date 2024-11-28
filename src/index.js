require("dotenv").config();
var Docker = require("dockerode");
const { App } = require('@slack/bolt');

const app = new App({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  signatureVerification: false,
  tokenVerificationEnabled: false,
  token: process.env.SLACK_TOKEN,
});

const web = app.client 
var docker1 = new Docker();
let global_stream = null;
class LogLineType {
  constructor(
    name,
    regex,
    is_enabled = true,
    callback = null,
    capture_groups = 0,
  ) {
    this.name = name;
    this.regex = regex;
    this.callback = callback;
    this.capture_groups = capture_groups;
    this.is_enabled = is_enabled;
  }
}
const regexes = [
  new LogLineType(
    "connection_attempt",
    /^([\d\.]{7,15}):\d{1,5} is connecting\.\.\./,
    true,
    (ip) => `Connection attempt from ${"*".repeat(ip.length)}`,
  ),
  new LogLineType(
    "connection_booted",
    /^([\d\.]{7,15}):\d{1,5} was booted: Invalid operation at this state\./,
    true,
    (ip) => `Connection from ${ip} was booted`,
  ),
  new LogLineType(
    "player_joined",
    /^(.*) has joined.$/,
    true,
    (player) => `:inbox_tray: *${player}* has joined`,
  ),
  new LogLineType(
    "player_left",
    /^(.*) has left.$/,
    true,
    (player) => `:outbox_tray: *${player}* has left`,
  ),
  new LogLineType(
    "chat_message",
    /^<(.*)> (.*)$/,
    true,
    (player, message) => `*${player}*: ${message}`,
  ),
  new LogLineType(
    "world_save_progress",
    /^Saving world data: (\d+)%/,
    true,
    null,
  ),
  new LogLineType(
    "world_validation_progress",
    /^Validating world save: (\d+)%/,
    null,
    null,
  ),
  new LogLineType(
    "world_backup",
    /^Backing up world file/,
    true,
    () => "_Backup successfully created_",
  ),
  new LogLineType(
    "terraria_error",
    /^Error on message Terraria\.MessageBuffer/,
    true,
    () => "_Terraria.MessageBuffer error from the server_",
  ),
  new LogLineType(
    "world_load_objects_progress",
    /^Resetting game objects (\d+)%/,
    null,
    null,
    1,
  ),
  new LogLineType(
    "world_load_data_progress",
    /^Loading world data: (\d+)%/,
    null,
    null,
    1,
  ),
  new LogLineType(
    "world_load_liquids_progress",
    /^Settling liquids (\d+)%/,
    null,
    null,
    1,
  ),
  new LogLineType(
    "server_listening",
    /^Listening on port \d+/,
    true,
    () => ":zap: *Server has started!*",
  ),
];
app.event("message", console.log)
// stop
;(async () => {
  const containers = await docker1.listContainers();
  const containerD =
    containers.find((c) => c.Names.includes("terraria")) || containers[0];
  let lastMessage = "";
  let messageQueue = [];
  docker1
    .getContainer(containerD.Id)
    .attach({
      stream: true,  // We want to receive data stream
      stdout: true,  // Attach to stdout
      stderr: true,  // Attach to stderr
      stdin: true,   // Allow input to the container
      tty: true      // Allocate a pseudo-tty
    })
    .then((stream) => {
      global_stream = stream;
      //   setTimeout(() => {
        // setInterval(() => {
        //   console.log(stream)
        //   stream.write("say Hi\n");
        // }, 4000)
      stream.on("data", (data) => {
        const d = data.toString().trim();
        console.dir(d);
        if (lastMessage && Date.now() - lastMessage < 10) {
          return;
        }
        lastMessage = Date.now();

        if (d.length < 1000 && d.length > 0) {
          if (false) {
            messageQueue.push(d);
          } else {
            web.chat.postMessage({
              channel: require("./config").channel_term,
              text: d,
              username: "Terraria",
            });
          }
        }
        if (messageQueue.length > 0) {
          // messageQueue.push(d)
          let str = messageQueue.join("\n");
          messageQueue = [];
          web.chat.postMessage({
            channel: require("./config").channel_logs,
            text: str,
            username: "Terraria",
          });
        }
        for (const regex of regexes) {
          if (regex.regex.test(d)) {
            console.log("Matched", regex.name);
            // if (regex.callback) {
            //   const match = d.match(regex.regex);
            //   console.log("Match", match);
            //   const message = regex.callback(...match.slice(1));
            //   console.log("Message", message);
            // }
            if (regex.callback) {
              const match = d.match(regex.regex);
              const message = regex.callback(...match.slice(1));
              console.log("Message", message);
              web.chat.postMessage({
                channel: require("./config").channel_logs,
                text: message,
                username: "Terraria",
              });
            }
          }
        }
      });
      //   }, 2500);
    });
})();
app.message(async ({ message, say }) => {
  let event = message
  console.debug(`#message`, Boolean(global_stream))
  // if no stream then ignore
  if (!global_stream) {
    return;
  }
  if(event.channel != require("./config").channel_term || event.channel != require("./config").channel_logs || event.subtype == "bot_message" || event.subtype == "message_deleted") {
    return;
  }
  if(event.channel == require("./config").channel_term) {
    global_stream.write(`${event.text}\n`);
  }
  if(event.channel == require("./config").channel_logs) {
    global_stream.write(`say [${event.user.toString()}] ${event.text}\n`);
  }
});
app.start(process.env.PORT || 3000).then(() => {
  console.log("⚡️ Bolt app is running!");
})