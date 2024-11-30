require("dotenv").config();
var Docker = require("dockerode");
const { App } = require("@slack/bolt");

const app = new App({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  signatureVerification: false,
  tokenVerificationEnabled: false,
  token: process.env.SLACK_TOKEN,
});
const memCacheMapOfUsernames = new Map();
const web = app.client;
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
  // new LogLineType(
  //   "connection_attempt",
  //   /^([\d\.]{7,15}):\d{1,5} is connecting\.\.\./,
  //   true,
  //   (ip) => `Connection attempt from ${"*".repeat(ip.length)}`,
  // ),
  new LogLineType(
    "connection_booted",
    /^([\d\.]{7,15}):\d{1,5} was booted: Invalid operation at this state\./,
    true,
    (ip) => `Connection from ${"*".repeat(ip.length)} was booted`,
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
// stop
let max_players = null;
let server_port = null;
(async () => {
  const containers = await docker1.listContainers();
  const containerD =
    containers.find((c) => c.Names.includes("terraria")) || containers[0];
  let lastMessage = "";

  let messageQueue = [];
  docker1
    .getContainer(containerD.Id)
    .attach({
      stream: true, // We want to receive data stream
      stdout: true, // Attach to stdout
      stderr: true, // Attach to stderr
      stdin: true, // Allow input to the container
      tty: true, // Allocate a pseudo-tty
    })
    .then(async (stream) => {
      global_stream = stream;
      //   setTimeout(() => {
      // setInterval(() => {
      //   console.log(stream)
      //   stream.write("say Hi\n");
      // }, 4000)
      stream.on("data", (data) => {
        const d = data.toString().trim();
        console.dir(d);
        // if (lastMessage && Date.now() - lastMessage < 10) {
        //   return;
        // }
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
      function execServerCmd(cmd) {
        return new Promise((res, rej) => {
          (global_stream || stream).write(cmd + "\n");
          (global_stream || stream).once("data", (data) => {
            // console.log(data.toString());
            res(data.toString());
          });
        });
      }
      globalThis.execServerCmd = execServerCmd;
      server_port = await execServerCmd("port").then(
        (d) => d.split("Port: ")[1].split("\r")[0],
      ) || "sorry i failed";
       max_players = await execServerCmd("maxplayers").then(
        (d) => d.split("Player limit: ")[1]?.split("\r")[0],
      ) || "sorry i failed";
      console.log(server_port.toString(), "#port", max_players);
    });

  // get static data, such as IP + port

  app.event("message", async (par) => {
    if (par.event.bot_id) return;
    if (!par.event.text.startsWith("!")) return;
    const args = par.event.text.split(" ");
    const cmd = args.shift().toLowerCase().slice(1);
    if (cmd == "ping") {
      await web.chat.postMessage({
        channel: par.event.channel,
        text: "Pong",
      });
    } else if (cmd == "online") {
    await web.chat.postMessage({
      channel: par.event.channel,
      text: `Max players: ${max_players}\nCurrently online: ${await execServerCmd("playing").then((d) => d.split("\n").map(e=>e.split("(")[0]).slice(1,d.split("\n").length - 2).join(", ").trim())}`,
    })
    } else if (cmd == "ip") {
      await web.chat.postMessage({
        channel: par.event.channel,
        text: `Server IP: ${process.env.SERVER_IP || "localhost"}:${server_port}`,
      });
    }
  });
  app.message(async ({ message, say }) => {
    let event = message;
    console.debug(`#message`, Boolean(global_stream));
    // console.log(message);
    if(event.text.startsWith("!")) return;
    // if no stream then ignore
    if (!global_stream) {
      return;
    }
    if (event.channel == require("./config").channel_term) {
      global_stream.write(`${event.text}\n`);
    }
    if (event.channel == require("./config").channel_logs) {
      let username =
        memCacheMapOfUsernames.get(event.user) ||
        (await web.users.info({ user: event.user }).then((d) => d.user.name));
      if (!memCacheMapOfUsernames.has(event.user)) {
        memCacheMapOfUsernames.set(event.user, username);
      }
      global_stream.write(`say [${username}] ${event.text}\n`);
    }
  });
  app.start(process.env.PORT || 3000).then(() => {
    console.log("⚡️ Bolt app is running!");
  });
})();
