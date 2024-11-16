// oops, I forgot to add this file to the previous commit
import { DateTime } from "luxon";
import { exec } from "child_process";
import axios from "axios";

class AutoRetryConfig {
  constructor(interval_seconds) {
    this.interval_seconds = interval_seconds;
  }
}

class AutoRetryConfigs {
  constructor(container_not_found = null, container_not_running = null) {
    this.container_not_found = container_not_found;
    this.container_not_running = container_not_running;
  }
}

class DockerConnection {
  constructor(base_url) {
    this.base_url = base_url;
  }
}

class EnabledLogMessages {
  constructor() {
    this.connection_attempt = false;
    this.connection_booted = false;
    this.player_joined = true;
    this.player_left = true;
    this.chat_message = true;
    this.world_backup = false;
    this.terraria_error = false;
    this.server_listening = true;
    this.server_stopped = true;
  }
}

class Config {
  constructor(
    container,
    discord_webhook_url,
    auto_retry = null,
    docker_connection = null,
    log_messages = new EnabledLogMessages()
  ) {
    this.container = container;
    this.discord_webhook_url = discord_webhook_url;
    this.auto_retry = auto_retry;
    this.docker_connection = docker_connection;
    this.log_messages = log_messages;
  }
}

class LogLineType {
  constructor(
    name,
    regex,
    is_enabled = false,
    callback = null,
    capture_groups = 0
  ) {
    this.name = name;
    this.regex = regex;
    this.callback = callback;
    this.capture_groups = capture_groups;
    this.is_enabled = is_enabled;
  }

  match(line) {
    return new RegExp(this.regex).exec(line);
  }

  process_line(line) {
    const match_result = this.match(line);
    if (!match_result) {
      return false;
    }
    const groups = match_result.slice(1);
    if (groups.length !== this.capture_groups) {
      throw new Error(
        `Expected ${this.capture_groups} capture groups, but got ${groups.length}`
      );
    }

    if (this.is_enabled) {
      if (this.callback) {
        this.callback(...groups);
      } else {
        console.warn(
          `Warning: Tried to send a ${this.name} log message, but it has not been implemented`
        );
      }
    }
    return true;
  }
}

class ContainerNotRunning extends Error {}

class SlimeHook {
  constructor(config) {
    this.config = config;
    this.LINE_TYPES = [
      new LogLineType(
        "connection_attempt",
        /^([\d\.]{7,15}):\d{1,5} is connecting\.\.\./,
        this.config.log_messages.connection_attempt,
        (ip) => this.send_discord_message(`Connection attempt from ${ip}`),
        1
      ),
      new LogLineType(
        "connection_booted",
        /^([\d\.]{7,15}):\d{1,5} was booted: Invalid operation at this state\./,
        this.config.log_messages.connection_booted,
        (ip) => this.send_discord_message(`Connection from ${ip} was booted`),
        1
      ),
      new LogLineType(
        "player_joined",
        /^(.*) has joined.$/,
        this.config.log_messages.player_joined,
        (player) =>
          this.send_discord_message(`:inbox_tray: **${player}** has joined`),
        1
      ),
      new LogLineType(
        "player_left",
        /^(.*) has left.$/,
        this.config.log_messages.player_left,
        (player) =>
          this.send_discord_message(`:outbox_tray: **${player}** has left`),
        1
      ),
      new LogLineType(
        "chat_message",
        /^<(.*)> (.*)$/,
        this.config.log_messages.chat_message,
        (player, message) =>
          this.send_discord_message(`<**${player}**> ${message}`),
        2
      ),
      new LogLineType(
        "world_save_progress",
        /^Saving world data: (\d+)%/,
        this.config.log_messages.world_backup,
        null,
        1
      ),
      new LogLineType(
        "world_validation_progress",
        /^Validating world save: (\d+)%/,
        null,
        null,
        1
      ),
      new LogLineType(
        "world_backup",
        /^Backing up world file/,
        this.config.log_messages.world_backup,
        () => this.send_discord_message("_Backup successfully created_")
      ),
      new LogLineType(
        "terraria_error",
        /^Error on message Terraria\.MessageBuffer/,
        this.config.log_messages.terraria_error,
        () =>
          this.send_discord_message(
            "_Terraria.MessageBuffer error from the server_"
          )
      ),
      new LogLineType(
        "world_load_objects_progress",
        /^Resetting game objects (\d+)%/,
        null,
        null,
        1
      ),
      new LogLineType(
        "world_load_data_progress",
        /^Loading world data: (\d+)%/,
        null,
        null,
        1
      ),
      new LogLineType(
        "world_load_liquids_progress",
        /^Settling liquids (\d+)%/,
        null,
        null,
        1
      ),
      new LogLineType(
        "server_listening",
        /^Listening on port \d+/,
        this.config.log_messages.server_listening,
        () => this.send_discord_message(":zap: **Server has started!**")
      )
    ];
  }

  async send_discord_message(message) {
    await axios.post(this.config.discord_webhook_url, {
      content: message
    });
  }

  handle_line(line) {
    line = line.trim();
    for (const line_type of this.LINE_TYPES) {
      const did_process_line = line_type.process_line(line);
      if (did_process_line) {
        return line_type;
      }
    }
    console.log(Buffer.from(line));
  }

  get_docker_client() {
    const conn_options = this.config.docker_connection;
    if (!conn_options) {
      return exec("docker");
    }
    return exec(`docker --host=${conn_options.base_url}`);
  }

  async run() {
    const client = this.get_docker_client();

    const container = await client.containers.get(this.config.container);
    if (container.status !== "running") {
      throw new ContainerNotRunning(
        `Container "${container.name}" is not running`
      );
    }
    const incoming_log_parts = await container.logs({
      since: DateTime.now().toISO(),
      follow: true,
      stream: true
    });
    console.log("Listening to log output from container...");
    let line_buffer = "";
    for await (const log of incoming_log_parts) {
      try {
        const decoded_line = log.toString("utf-8");
        line_buffer += decoded_line;
        if (line_buffer.includes("\n")) {
          const lines = line_buffer.split("\n");
          for (const line of lines.slice(0, -1)) {
            try {
              this.handle_line(line);
            } catch (exception) {
              console.error(`Failed to process line: ${line}`);
              console.error(exception);
            }
          }
          line_buffer = lines[lines.length - 1];
        }
      } catch (error) {
        continue;
      }
    }

    if (this.config.log_messages.server_stopped) {
      this.send_discord_message(":skull: **Server has stopped**");
    }
    throw new ContainerNotRunning(
      `Container "${container.name}" is not running`
    );
  }

  async run_with_auto_retry() {
    if (!this.config.auto_retry) {
      throw new Error("No auto_retry config provided");
    }

    let has_shown_message = false;

    const retry_later = (error, retry_options, message) => {
      if (!retry_options) {
        throw error;
      }
      if (!has_shown_message) {
        console.log(message);
        has_shown_message = true;
      }
      setTimeout(() => {}, retry_options.interval_seconds * 1000);
    };

    while (true) {
      try {
        await this.run();
        break;
      } catch (error) {
        if (error instanceof docker.errors.NotFound) {
          retry_later(
            error,
            this.config.auto_retry.container_not_found,
            `Docker container "${this.config.container}" not found, retrying in background...`
          );
          continue;
        } else if (error instanceof ContainerNotRunning) {
          retry_later(
            error,
            this.config.auto_retry.container_not_running,
            `Docker container "${this.config.container}" not running, retrying in background...`
          );
          continue;
        }
      }
    }
  }
}
