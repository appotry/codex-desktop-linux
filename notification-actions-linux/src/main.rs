use std::{collections::HashMap, io::Write};

use anyhow::{bail, Context, Result};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use zbus::{zvariant::OwnedValue, Connection, Proxy};

const NOTIFICATIONS_SERVICE: &str = "org.freedesktop.Notifications";
const NOTIFICATIONS_PATH: &str = "/org/freedesktop/Notifications";
const NOTIFICATIONS_INTERFACE: &str = "org.freedesktop.Notifications";
const MAX_TITLE_BYTES: usize = 1024;
const MAX_BODY_BYTES: usize = 8192;
const MAX_ACTIONS: usize = 4;
const MAX_ACTION_TEXT_BYTES: usize = 256;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ShowRequest {
    title: String,
    body: String,
    #[serde(default)]
    actions: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "event", rename_all = "kebab-case")]
enum BridgeEvent<'a> {
    Shown { notification_id: u32 },
    Click,
    Action { index: usize },
    Closed,
    Unavailable { reason: &'a str },
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("{error:#}");
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    let mut commands = BufReader::new(tokio::io::stdin()).lines();
    let request_line = commands
        .next_line()
        .await
        .context("failed to read notification request")?
        .context("notification request was not provided")?;
    let request: ShowRequest =
        serde_json::from_str(&request_line).context("invalid notification request")?;
    validate_request(&request)?;

    let connection = match Connection::session().await {
        Ok(connection) => connection,
        Err(_) => {
            emit(&BridgeEvent::Unavailable {
                reason: "session-bus-unavailable",
            })?;
            return Ok(());
        }
    };
    let proxy = match Proxy::new(
        &connection,
        NOTIFICATIONS_SERVICE,
        NOTIFICATIONS_PATH,
        NOTIFICATIONS_INTERFACE,
    )
    .await
    {
        Ok(proxy) => proxy,
        Err(_) => {
            emit(&BridgeEvent::Unavailable {
                reason: "notification-service-unavailable",
            })?;
            return Ok(());
        }
    };

    let capabilities: Vec<String> = match proxy.call("GetCapabilities", &()).await {
        Ok(capabilities) => capabilities,
        Err(_) => {
            emit(&BridgeEvent::Unavailable {
                reason: "notification-capabilities-unavailable",
            })?;
            return Ok(());
        }
    };
    if !capabilities
        .iter()
        .any(|capability| capability == "actions")
    {
        emit(&BridgeEvent::Unavailable {
            reason: "notification-actions-unsupported",
        })?;
        return Ok(());
    }

    let mut action_stream = proxy
        .receive_signal("ActionInvoked")
        .await
        .context("failed to subscribe to notification actions")?;
    let mut closed_stream = proxy
        .receive_signal("NotificationClosed")
        .await
        .context("failed to subscribe to notification closure")?;
    let action_pairs = notification_actions(&request.actions);
    let hints: HashMap<String, OwnedValue> = HashMap::new();
    let notification_id: u32 = proxy
        .call(
            "Notify",
            &(
                "ChatGPT",
                0u32,
                "codex-desktop",
                request.title.as_str(),
                request.body.as_str(),
                action_pairs,
                hints,
                0i32,
            ),
        )
        .await
        .context("failed to show actionable notification")?;
    emit(&BridgeEvent::Shown { notification_id })?;

    loop {
        tokio::select! {
            message = action_stream.next() => {
                let message = message.context("notification action stream ended")?;
                let (id, action_key): (u32, String) = message
                    .body()
                    .deserialize()
                    .context("failed to decode notification action")?;
                if id != notification_id {
                    continue;
                }
                if action_key == "default" {
                    emit(&BridgeEvent::Click)?;
                } else if let Some(index) = action_index(&action_key, request.actions.len()) {
                    emit(&BridgeEvent::Action { index })?;
                } else {
                    continue;
                }
                close_notification(&proxy, notification_id).await;
                emit(&BridgeEvent::Closed)?;
                return Ok(());
            }
            message = closed_stream.next() => {
                let message = message.context("notification close stream ended")?;
                let (id, _reason): (u32, u32) = message
                    .body()
                    .deserialize()
                    .context("failed to decode notification closure")?;
                if id == notification_id {
                    emit(&BridgeEvent::Closed)?;
                    return Ok(());
                }
            }
            command = commands.next_line() => {
                match command.context("failed to read notification bridge command")? {
                    Some(command) if command == "close" => {
                        close_notification(&proxy, notification_id).await;
                        emit(&BridgeEvent::Closed)?;
                        return Ok(());
                    }
                    Some(command) if command.trim().is_empty() => {}
                    Some(_) => bail!("unknown notification bridge command"),
                    None => {
                        close_notification(&proxy, notification_id).await;
                        return Ok(());
                    }
                }
            }
        }
    }
}

fn validate_request(request: &ShowRequest) -> Result<()> {
    if request.title.is_empty() || request.title.len() > MAX_TITLE_BYTES {
        bail!("notification title must contain between 1 and {MAX_TITLE_BYTES} bytes");
    }
    if request.body.len() > MAX_BODY_BYTES {
        bail!("notification body exceeds {MAX_BODY_BYTES} bytes");
    }
    if request.actions.is_empty() || request.actions.len() > MAX_ACTIONS {
        bail!("notification must contain between 1 and {MAX_ACTIONS} actions");
    }
    if request
        .actions
        .iter()
        .any(|action| action.is_empty() || action.len() > MAX_ACTION_TEXT_BYTES)
    {
        bail!("notification action text must contain between 1 and {MAX_ACTION_TEXT_BYTES} bytes");
    }
    Ok(())
}

fn notification_actions(actions: &[String]) -> Vec<String> {
    let mut pairs = Vec::with_capacity(2 + actions.len() * 2);
    pairs.push("default".to_owned());
    pairs.push("View".to_owned());
    for (index, title) in actions.iter().enumerate() {
        pairs.push(format!("action-{index}"));
        pairs.push(title.clone());
    }
    pairs
}

fn action_index(action_key: &str, action_count: usize) -> Option<usize> {
    let index = action_key.strip_prefix("action-")?.parse::<usize>().ok()?;
    (index < action_count).then_some(index)
}

async fn close_notification(proxy: &Proxy<'_>, notification_id: u32) {
    let _: Result<(), _> = proxy.call("CloseNotification", &(notification_id,)).await;
}

fn emit(event: &BridgeEvent<'_>) -> Result<()> {
    let mut stdout = std::io::stdout().lock();
    serde_json::to_writer(&mut stdout, event).context("failed to encode bridge event")?;
    stdout
        .write_all(b"\n")
        .context("failed to write bridge event")?;
    stdout.flush().context("failed to flush bridge event")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(actions: &[&str]) -> ShowRequest {
        ShowRequest {
            title: "Approval required".to_owned(),
            body: "Run command?".to_owned(),
            actions: actions.iter().map(|action| (*action).to_owned()).collect(),
        }
    }

    #[test]
    fn builds_default_and_indexed_action_pairs() {
        assert_eq!(
            notification_actions(&request(&["Approve", "Decline"]).actions),
            ["default", "View", "action-0", "Approve", "action-1", "Decline",]
        );
    }

    #[test]
    fn accepts_only_in_range_action_keys() {
        assert_eq!(action_index("action-0", 2), Some(0));
        assert_eq!(action_index("action-1", 2), Some(1));
        assert_eq!(action_index("action-2", 2), None);
        assert_eq!(action_index("default", 2), None);
        assert_eq!(action_index("action-nope", 2), None);
    }

    #[test]
    fn rejects_empty_or_excessive_actions() {
        assert!(validate_request(&request(&[])).is_err());
        assert!(validate_request(&request(&["1", "2", "3", "4", "5"])).is_err());
    }

    #[test]
    fn rejects_oversized_fields() {
        let mut oversized_title = request(&["Approve"]);
        oversized_title.title = "x".repeat(MAX_TITLE_BYTES + 1);
        assert!(validate_request(&oversized_title).is_err());

        let mut oversized_action = request(&["Approve"]);
        oversized_action.actions[0] = "x".repeat(MAX_ACTION_TEXT_BYTES + 1);
        assert!(validate_request(&oversized_action).is_err());
    }
}
